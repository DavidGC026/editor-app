// ── Minimal ZIP reader (dependency-free) ────────────────────────────────
//
// Enough of the ZIP spec to read a .vsix (VSCode extension package):
// central-directory parsing + STORED/DEFLATE entries via node:zlib.
// No ZIP64 support — .vsix files are far below the 4 GB threshold.

import * as fs from 'fs';
import * as zlib from 'zlib';

const EOCD_SIG = 0x06054b50; // End of central directory
const CDFH_SIG = 0x02014b50; // Central directory file header
const LFH_SIG = 0x04034b50; // Local file header

export interface ZipEntry {
  /** Entry path inside the archive, always with forward slashes. */
  name: string;
  isDirectory: boolean;
  /** Decompresses and returns the entry contents. */
  getData: () => Buffer;
}

export function readZipEntries(zipPath: string): ZipEntry[] {
  const buf = fs.readFileSync(zipPath);

  // The EOCD record is at the very end of the file, preceded by an optional
  // comment (max 65535 bytes). Scan backwards for its signature.
  let eocd = -1;
  const scanStart = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= scanStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Archivo ZIP inválido (no se encontró el directorio central).');

  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16); // central directory start

  const entries: ZipEntry[] = [];
  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CDFH_SIG) break;

    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf-8')
      .replace(/\\/g, '/');

    entries.push({
      name,
      isDirectory: name.endsWith('/'),
      getData: () => {
        if (buf.readUInt32LE(localHeaderOffset) !== LFH_SIG) {
          throw new Error(`Cabecera local inválida para "${name}".`);
        }
        // Name/extra lengths in the LOCAL header can differ from the central
        // directory copy — read them from the local header itself.
        const localName = buf.readUInt16LE(localHeaderOffset + 26);
        const localExtra = buf.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localName + localExtra;
        const raw = buf.subarray(dataStart, dataStart + compressedSize);
        if (method === 0) return Buffer.from(raw); // STORED
        if (method === 8) return zlib.inflateRawSync(raw); // DEFLATE
        throw new Error(`Método de compresión no soportado (${method}) en "${name}".`);
      },
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
