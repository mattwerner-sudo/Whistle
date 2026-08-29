import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";

/**
 * Minimal in-memory ZIP builder using only Node built-ins.
 * Produces a Store/Deflate ZIP stream of the files in `sourceDir`.
 * Cached: re-zips only when any source file mtime changes.
 */

interface CachedZip {
  buffer: Buffer;
  mtimeMs: number;
  baseUrl: string;
}

const cacheByBaseUrl = new Map<string, CachedZip>();

function readAllFiles(dir: string, baseDir = dir): Array<{ relPath: string; data: Buffer; mtimeMs: number }> {
  const out: Array<{ relPath: string; data: Buffer; mtimeMs: number }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...readAllFiles(full, baseDir));
    } else if (entry.isFile()) {
      const stat = fs.statSync(full);
      out.push({
        relPath: path.relative(baseDir, full).replace(/\\/g, "/"),
        data: fs.readFileSync(full),
        mtimeMs: stat.mtimeMs,
      });
    }
  }
  return out;
}

// CRC32 (table-driven)
const crcTable: number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// MS-DOS date/time encoding
function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

function buildZip(files: Array<{ relPath: string; data: Buffer; mtimeMs: number }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const { time, date } = dosDateTime(now);

  for (const file of files) {
    const nameBuf = Buffer.from(file.relPath, "utf8");
    const compressed = zlib.deflateRawSync(file.data, { level: 9 });
    const useDeflate = compressed.length < file.data.length;
    const stored = useDeflate ? compressed : file.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(file.data);

    // Local file header
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0, 6); // flags
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(time, 10);
    lfh.writeUInt16LE(date, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(stored.length, 18);
    lfh.writeUInt32LE(file.data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    local.push(lfh, nameBuf, stored);

    // Central directory entry
    const cde = Buffer.alloc(46);
    cde.writeUInt32LE(0x02014b50, 0);
    cde.writeUInt16LE(20, 4); // version made by
    cde.writeUInt16LE(20, 6); // version needed
    cde.writeUInt16LE(0, 8);
    cde.writeUInt16LE(method, 10);
    cde.writeUInt16LE(time, 12);
    cde.writeUInt16LE(date, 14);
    cde.writeUInt32LE(crc, 16);
    cde.writeUInt32LE(stored.length, 20);
    cde.writeUInt32LE(file.data.length, 24);
    cde.writeUInt16LE(nameBuf.length, 28);
    cde.writeUInt16LE(0, 30);
    cde.writeUInt16LE(0, 32);
    cde.writeUInt16LE(0, 34);
    cde.writeUInt16LE(0, 36);
    cde.writeUInt32LE(0, 38);
    cde.writeUInt32LE(offset, 42);
    central.push(cde, nameBuf);

    offset += lfh.length + nameBuf.length + stored.length;
  }

  const localBuf = Buffer.concat(local);
  const centralBuf = Buffer.concat(central);

  // End of central directory
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localBuf, centralBuf, eocd]);
}

/**
 * Build a Whistle Connect extension zip with the ingestion base URL hard-coded
 * into popup.js / background.js. This guarantees the extension never points
 * anywhere except this Whistle workspace (no user-editable URL field).
 */
export function buildExtensionZip(sourceDir: string, baseUrl: string): Buffer {
  const files = readAllFiles(sourceDir);
  const maxMtime = files.reduce((m, f) => Math.max(m, f.mtimeMs), 0);
  const cached = cacheByBaseUrl.get(baseUrl);
  if (cached && cached.mtimeMs === maxMtime) return cached.buffer;

  // Substitute __WHISTLE_BASE__ + __WHISTLE_HOST_PATTERN__ in JS / HTML / manifest.
  // The host pattern is what Chrome's manifest_v3 host_permissions uses; we derive
  // it from the baseUrl so the extension works against ANY domain that issued the
  // zip (including custom domains), not just *.replit.app/*.replit.dev.
  const cleanBase = baseUrl.replace(/\/+$/, "");
  let hostPattern: string;
  try {
    const u = new URL(cleanBase);
    hostPattern = `${u.protocol}//${u.host}/*`;
  } catch {
    hostPattern = "https://*/*";
  }
  const transformed = files.map(f => {
    if (f.relPath.endsWith(".js") || f.relPath.endsWith(".html") || f.relPath === "manifest.json") {
      const text = f.data.toString("utf8");
      const replaced = text
        .replace(/__WHISTLE_BASE__/g, cleanBase)
        .replace(/__WHISTLE_HOST_PATTERN__/g, hostPattern);
      return { ...f, data: Buffer.from(replaced, "utf8") };
    }
    return f;
  });

  const buf = buildZip(transformed);
  cacheByBaseUrl.set(baseUrl, { buffer: buf, mtimeMs: maxMtime, baseUrl });
  return buf;
}

export function extensionZipETag(sourceDir: string, baseUrl: string): string {
  const buf = buildExtensionZip(sourceDir, baseUrl);
  return crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16);
}
