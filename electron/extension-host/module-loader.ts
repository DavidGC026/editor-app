/**
 * Entry point resolution and the `require('vscode')` interception.
 *
 * Two separate jobs, both security-relevant:
 *
 * 1. **Where the code comes from.** `main` in the manifest is attacker
 *    controlled. It is resolved against the install directory and the result
 *    must stay inside it *after* following symlinks — the same rule the
 *    package store applies when extracting (architecture §7). A VSIX that
 *    ships `main: "../../../.ssh/id_rsa"` gets a typed rejection, not a read.
 *
 * 2. **Who receives which facade.** `require('vscode')` returns a facade
 *    built *per extension*, because disposables, storage and diagnostics hang
 *    off an identity (design §4). The owner is decided by the file doing the
 *    require, so a shared helper module inside an extension gets its own
 *    extension's API and nothing can request somebody else's.
 */
import path from 'path';
import type { ExtensionHostDescriptor } from '../extensions/domain/rpc-protocol';

export type EntryPointFailure =
  | { code: 'no-main' }
  | { code: 'outside-extension'; resolved: string }
  | { code: 'not-found'; resolved: string };

export type EntryPointResolution =
  | { ok: true; entryPoint: string }
  | { ok: false; failure: EntryPointFailure };

export interface EntryPointResolverDeps {
  /** Resolves symlinks. Returns the input when the path does not exist yet,
   *  so "missing" and "escaping" stay distinguishable. */
  realpath: (target: string) => string;
  /** True only for regular files: a directory is not an entry point, and
   *  `require` of one without `index.js` would fail deep inside Node. */
  isFile: (target: string) => boolean;
}

/**
 * Resolves the `main` entry point of an extension inside its directory.
 *
 * Node's own `require` would happily follow a symlink out of the store, so
 * containment is checked on the *real* path of both ends, not on the string
 * the manifest provided.
 */
export function resolveEntryPoint(
  descriptor: ExtensionHostDescriptor,
  deps: EntryPointResolverDeps,
): EntryPointResolution {
  if (!descriptor.main) return { ok: false, failure: { code: 'no-main' } };

  const root = path.resolve(descriptor.dir);
  const candidate = path.resolve(root, descriptor.main);
  const realRoot = deps.realpath(root);

  const contained = (target: string): boolean => {
    const real = deps.realpath(target);
    return real === realRoot || real.startsWith(realRoot + path.sep);
  };

  // Checked before existence: an escaping path is a rejection even when the
  // file is missing, and reporting it as "not found" would hide an attack.
  if (!contained(candidate)) {
    return { ok: false, failure: { code: 'outside-extension', resolved: candidate } };
  }

  for (const target of entryPointCandidates(candidate)) {
    if (deps.isFile(target) && contained(target)) return { ok: true, entryPoint: target };
  }
  return { ok: false, failure: { code: 'not-found', resolved: candidate } };
}

/** `main: "./out/extension"` and `main: "./out"` are both legal in the wild.
 *  The candidate order mirrors Node's own — exact file, then extensions, then
 *  `index` — so nothing resolves here that `require` would then reject. */
function entryPointCandidates(candidate: string): string[] {
  if (path.extname(candidate)) return [candidate];
  return [
    candidate,
    `${candidate}.js`,
    `${candidate}.cjs`,
    `${candidate}.json`,
    path.join(candidate, 'index.js'),
    path.join(candidate, 'index.cjs'),
  ];
}

export function describeEntryPointFailure(
  failure: EntryPointFailure,
  descriptor: ExtensionHostDescriptor,
): string {
  switch (failure.code) {
    case 'no-main':
      return `"${descriptor.id}" no declara "main": no hay nada que cargar.`;
    case 'outside-extension':
      return `El entrypoint de "${descriptor.id}" resuelve fuera de su directorio `
        + `(${failure.resolved}); se rechaza la carga.`;
    case 'not-found':
      return `El entrypoint de "${descriptor.id}" no existe: ${failure.resolved}.`;
  }
}

// ── require('vscode') ───────────────────────────────────────────────────

/** Maps any file path to the extension that owns it. The longest matching
 *  directory wins, so a nested install is not swallowed by its parent. */
export interface ExtensionOwnerIndex {
  ownerOf(filename: string | null | undefined): string | null;
}

export function createOwnerIndex(descriptors: ExtensionHostDescriptor[]): ExtensionOwnerIndex {
  const roots = descriptors
    .map((descriptor) => ({ id: descriptor.id, root: path.resolve(descriptor.dir) }))
    .sort((a, b) => b.root.length - a.root.length);

  return {
    ownerOf(filename) {
      if (!filename) return null;
      const resolved = path.resolve(filename);
      for (const entry of roots) {
        if (resolved === entry.root || resolved.startsWith(entry.root + path.sep)) return entry.id;
      }
      return null;
    },
  };
}

/** The slice of Node's module system the hook needs. Injected so the hook is
 *  testable without patching the runtime the test itself is running on. */
export interface ModuleSystemLike {
  _load(request: string, parent: { filename?: string | null } | null, isMain: boolean): unknown;
}

export interface VscodeHookOptions {
  moduleSystem: ModuleSystemLike;
  ownerIndex: ExtensionOwnerIndex;
  /** Builds (and memoises, upstream) the facade for one extension. */
  apiFor: (extensionId: string) => unknown;
  /** Reports a `require('vscode')` from code no extension owns. */
  onOrphanRequire?: (parentFilename: string | null) => void;
}

/**
 * Installs the `Module._load` interception and returns its uninstaller.
 *
 * Only the literal request `'vscode'` is intercepted; everything else — the
 * extension's own files, its bundled dependencies, Node builtins — goes
 * through untouched. Restoring on uninstall matters because the host may
 * reload the extension set within a generation during tests.
 */
export function installVscodeModuleHook(options: VscodeHookOptions): () => void {
  const { moduleSystem, ownerIndex, apiFor } = options;
  const original = moduleSystem._load.bind(moduleSystem);

  moduleSystem._load = function load(request, parent, isMain) {
    if (request !== 'vscode') return original(request, parent, isMain);

    const owner = ownerIndex.ownerOf(parent?.filename ?? null);
    if (!owner) {
      options.onOrphanRequire?.(parent?.filename ?? null);
      // Refusing is the honest answer: handing a facade to unowned code would
      // attribute its disposables and storage to whichever extension happened
      // to be first.
      throw new Error(
        'require("vscode") desde código que no pertenece a ninguna extensión '
        + `(${parent?.filename ?? 'origen desconocido'}).`,
      );
    }
    return apiFor(owner);
  };

  return () => {
    moduleSystem._load = original;
  };
}
