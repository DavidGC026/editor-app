import * as path from 'path';

/** Resolves a contribution resource and rejects reads outside its extension. */
export function resolveExtensionPath(extensionDir: string, resourcePath: string): string {
  const root = path.resolve(extensionDir);
  const target = path.resolve(root, resourcePath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Extension resource escapes package root: ${resourcePath}`);
  }
  return target;
}
