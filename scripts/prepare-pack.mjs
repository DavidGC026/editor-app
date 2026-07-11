/**
 * Build a self-contained staging directory for electron-builder.
 *
 * pnpm keeps dependencies inside `.pnpm/…`; electron-builder only bundles
 * top-level node_modules entries. We flatten production deps into
 * `.electron-pack/node_modules` without mutating the dev tree.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pnpmDir = path.join(root, 'node_modules', '.pnpm');
const stagingRoot = path.join(root, '.electron-pack');
const stagingNodeModules = path.join(stagingRoot, 'node_modules');

function findVirtualNodeModules(packageName) {
  if (packageName.startsWith('@')) {
    const [scope, name] = packageName.split('/');
    const prefix = `${scope}+${name}@`;
    const entry = fs.readdirSync(pnpmDir).find((dir) => dir.startsWith(prefix));
    if (!entry) return null;
    return path.join(pnpmDir, entry, 'node_modules');
  }

  const entry = fs
    .readdirSync(pnpmDir)
    .find((name) => name.startsWith(`${packageName}@`));
  if (!entry) return null;
  return path.join(pnpmDir, entry, 'node_modules');
}

function ensurePackage(packageName, seen = new Set()) {
  if (seen.has(packageName)) return;
  seen.add(packageName);

  const virtualNodeModules = findVirtualNodeModules(packageName);
  if (!virtualNodeModules) {
    console.warn(`[prepare-pack] ${packageName} not found in .pnpm`);
    return;
  }

  const src = path.join(virtualNodeModules, packageName);
  const dest = path.join(stagingNodeModules, packageName);
  if (!fs.existsSync(src)) {
    console.warn(`[prepare-pack] ${packageName} source missing`);
    return;
  }

  if (!fs.existsSync(dest)) {
    fs.cpSync(src, dest, { recursive: true, dereference: true });
    console.log(`[prepare-pack] copied ${packageName}`);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf8'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) {
    ensurePackage(dep, seen);
  }
}

function copyIfExists(from, to) {
  if (!fs.existsSync(from)) {
    throw new Error(`[prepare-pack] required path missing: ${from}`);
  }
  fs.cpSync(from, to, { recursive: true });
}

if (!fs.existsSync(pnpmDir)) {
  console.error('[prepare-pack] node_modules/.pnpm not found — run pnpm install first');
  process.exit(1);
}

// Clean staging on every run so stale deps never linger.
if (fs.existsSync(stagingRoot)) {
  fs.rmSync(stagingRoot, { recursive: true, force: true });
}
fs.mkdirSync(stagingNodeModules, { recursive: true });

const appPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// Minimal package.json for the packaged app (no devDependencies / scripts).
const stagingPkg = {
  name: appPkg.name,
  version: appPkg.version,
  description: appPkg.description,
  main: appPkg.main,
  type: appPkg.type,
  dependencies: appPkg.dependencies,
  build: {
    ...appPkg.build,
    directories: {
      ...(appPkg.build?.directories ?? {}),
      // Keep artifacts at repo-root/release even though we build from staging.
      output: '../release',
    },
  },
};

let electronVersion = appPkg.devDependencies?.electron?.replace(/^\^/, '');
const electronPkgPath = path.join(root, 'node_modules', 'electron', 'package.json');
if (fs.existsSync(electronPkgPath)) {
  electronVersion = JSON.parse(fs.readFileSync(electronPkgPath, 'utf8')).version;
}
if (!electronVersion) {
  throw new Error('[prepare-pack] could not determine electron version — run pnpm install');
}
stagingPkg.build.electronVersion = electronVersion;

copyIfExists(path.join(root, 'dist'), path.join(stagingRoot, 'dist'));
copyIfExists(path.join(root, 'dist-electron'), path.join(stagingRoot, 'dist-electron'));

for (const dep of Object.keys(appPkg.dependencies ?? {})) {
  ensurePackage(dep);
}

fs.writeFileSync(
  path.join(stagingRoot, 'package.json'),
  JSON.stringify(stagingPkg, null, 2),
);

console.log(`[prepare-pack] staging ready at ${stagingRoot}`);
