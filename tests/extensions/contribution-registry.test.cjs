const assert = require('node:assert/strict');
const test = require('node:test');

// The registry is dependency-free renderer TypeScript; Node's built-in type
// stripping lets the suite consume it without a bundler.
const { ContributionRegistry } = require('../../src/extensions/contributionRegistry.ts');

function createHarness({ failApplyFor = [], failDisposeFor = [] } = {}) {
  const log = [];
  const applier = (family) => ({
    family,
    apply(host, ext) {
      if (failApplyFor.includes(ext.id)) throw new Error(`${family} boom`);
      log.push(`apply:${family}:${ext.id}@${ext.version}`);
      return [{
        dispose: () => {
          if (failDisposeFor.includes(ext.id)) throw new Error('dispose boom');
          log.push(`dispose:${family}:${ext.id}`);
        },
      }];
    },
  });
  const warnings = [];
  const registry = new ContributionRegistry(
    [applier('themes'), applier('snippets')],
    (message) => warnings.push(message),
  );
  return { registry, log, warnings, host: {} };
}

const ext = (id, version = '1.0.0') => ({ id, version });

test('sync applies new extensions and leaves unchanged ones untouched', () => {
  const h = createHarness();

  let result = h.registry.sync(h.host, [ext('a'), ext('b')]);
  assert.deepEqual(result, { applied: ['a', 'b'], retired: [] });

  h.log.length = 0;
  result = h.registry.sync(h.host, [ext('a'), ext('b')]);
  assert.deepEqual(result, { applied: [], retired: [] });
  assert.deepEqual(h.log, [], 'a no-op sync touches nothing');
});

test('extensions leaving the active set retire exactly their disposables', () => {
  const h = createHarness();
  h.registry.sync(h.host, [ext('a'), ext('b')]);

  h.log.length = 0;
  const result = h.registry.sync(h.host, [ext('b')]);
  assert.deepEqual(result, { applied: [], retired: ['a'] });
  assert.deepEqual(h.log, ['dispose:themes:a', 'dispose:snippets:a']);
});

test('a version change retires the old contributions and re-applies', () => {
  const h = createHarness();
  h.registry.sync(h.host, [ext('a', '1.0.0')]);

  h.log.length = 0;
  const result = h.registry.sync(h.host, [ext('a', '2.0.0')]);
  assert.deepEqual(result, { applied: ['a'], retired: ['a'] });
  assert.deepEqual(h.log, [
    'dispose:themes:a',
    'dispose:snippets:a',
    'apply:themes:a@2.0.0',
    'apply:snippets:a@2.0.0',
  ]);
});

test('a failing applier warns but neither blocks other families nor extensions', () => {
  const h = createHarness({ failApplyFor: ['bad'] });
  const result = h.registry.sync(h.host, [ext('bad'), ext('good')]);

  assert.deepEqual(result.applied, ['bad', 'good']);
  assert.deepEqual(h.log, ['apply:themes:good@1.0.0', 'apply:snippets:good@1.0.0']);
  assert.equal(h.warnings.length, 2, 'both families warned for the bad extension');
  assert.match(h.warnings[0], /themes.*"bad"/);
});

test('a failing dispose warns and still forgets the extension', () => {
  const h = createHarness({ failDisposeFor: ['a'] });
  h.registry.sync(h.host, [ext('a')]);

  const result = h.registry.sync(h.host, []);
  assert.deepEqual(result.retired, ['a']);
  assert.equal(h.warnings.length, 2);

  // The extension can come back cleanly after the faulty retirement.
  const back = h.registry.sync(h.host, [ext('a')]);
  assert.deepEqual(back, { applied: ['a'], retired: [] });
});

test('reset retires everything so a fresh host starts clean', () => {
  const h = createHarness();
  h.registry.sync(h.host, [ext('a'), ext('b')]);

  h.log.length = 0;
  h.registry.reset();
  assert.deepEqual(h.log.filter((l) => l.startsWith('dispose:')).length, 4);

  const result = h.registry.sync({}, [ext('a')]);
  assert.deepEqual(result, { applied: ['a'], retired: [] });
});
