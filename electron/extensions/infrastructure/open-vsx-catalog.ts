import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  CatalogExtensionMetadata,
  ExtensionCatalog,
} from '../application/ports/extension-catalog';
import { ExtensionInstallError } from '../domain/extension-install-error';

// Open VSX (open-vsx.org) is the vendor-neutral extension registry used by
// VSCode forks — the Microsoft marketplace is licensed for MS products only.

/** Minimal fetch shape compatible with both global fetch and Electron's
 *  `net.fetch` (whose input type omits URL). The catalog only passes URLs
 *  as strings. */
export type CatalogFetch = (input: string) => Promise<Response>;

export interface OpenVsxCatalogOptions {
  /** Directory for downloaded VSIX files (e.g. Electron's temp path). */
  tempDir: () => string;
  /** Injected so Electron can pass `net.fetch`; defaults to global fetch. */
  fetchImpl?: CatalogFetch;
  baseUrl?: string;
}

const EXTENSION_ID_PATTERN = /^([A-Za-z0-9][\w.-]*)\.([A-Za-z0-9][\w-]*)$/;

/** Open VSX reports dependencies/bundled extensions as reference objects. */
function referencedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const entry of value) {
    const id =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? `${(entry as any).namespace}.${(entry as any).extension}`
          : '';
    const normalized = id.trim().toLowerCase();
    if (EXTENSION_ID_PATTERN.test(normalized)) ids.add(normalized);
  }
  return [...ids];
}

export class OpenVsxCatalog implements ExtensionCatalog {
  private readonly fetchImpl: CatalogFetch;
  private readonly baseUrl: string;

  constructor(private readonly options: OpenVsxCatalogOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? 'https://open-vsx.org';
  }

  async latestMetadata(extensionId: string): Promise<CatalogExtensionMetadata> {
    const { namespace, name } = this.parseId(extensionId);
    const meta = await this.fetchLatest(namespace, name);
    if (typeof meta?.version !== 'string' || !meta.version) {
      throw new ExtensionInstallError(
        'download-failed',
        `Open VSX no reporta una versión para "${namespace}.${name}".`,
      );
    }
    return {
      id: `${namespace}.${name}`.toLowerCase(),
      version: meta.version,
      extensionDependencies: referencedIds(meta?.dependencies),
      extensionPack: referencedIds(meta?.bundledExtensions),
    };
  }

  async downloadLatestVsix(extensionId: string): Promise<string> {
    const { namespace, name } = this.parseId(extensionId);
    const meta = await this.fetchLatest(namespace, name);
    const downloadUrl: string | undefined = meta?.files?.download;
    if (!downloadUrl) {
      throw new ExtensionInstallError(
        'download-failed',
        `"${namespace}.${name}" no tiene un paquete descargable en Open VSX.`,
      );
    }

    const dlRes = await this.fetchImpl(downloadUrl);
    if (!dlRes.ok) {
      throw new ExtensionInstallError(
        'download-failed',
        `La descarga del VSIX falló (HTTP ${dlRes.status}).`,
      );
    }
    const buffer = Buffer.from(await dlRes.arrayBuffer());

    const tmpPath = path.join(
      this.options.tempDir(),
      `forge-vsix-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.vsix`,
    );
    fs.writeFileSync(tmpPath, buffer);
    return tmpPath;
  }

  private parseId(extensionId: string): { namespace: string; name: string } {
    const match = extensionId.trim().match(EXTENSION_ID_PATTERN);
    if (!match) {
      throw new ExtensionInstallError(
        'not-found',
        `Identificador inválido: "${extensionId}". Usa el formato publisher.nombre ` +
          '(ej. dracula-theme.theme-dracula).',
      );
    }
    return { namespace: match[1], name: match[2] };
  }

  private async fetchLatest(namespace: string, name: string): Promise<any> {
    const metaRes = await this.fetchImpl(
      `${this.baseUrl}/api/${encodeURIComponent(namespace)}/${encodeURIComponent(name)}/latest`,
    );
    if (metaRes.status === 404) {
      throw new ExtensionInstallError(
        'not-found',
        `No se encontró "${namespace}.${name}" en Open VSX (open-vsx.org).`,
      );
    }
    if (!metaRes.ok) {
      throw new ExtensionInstallError(
        'download-failed',
        `Open VSX respondió ${metaRes.status} al buscar "${namespace}.${name}".`,
      );
    }
    return metaRes.json();
  }
}
