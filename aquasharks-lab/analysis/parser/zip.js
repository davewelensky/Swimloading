// @ts-check
/**
 * Minimal ZIP reader (enough for .docx). No dependencies: inflate uses the platform's DecompressionStream('deflate-raw'),
 * which exists in Node 18+, browsers and serverless runtimes. Reads the central directory, so entries with data
 * descriptors work. Does not support encryption, ZIP64 or multi-disk archives (EO reports use none of these).
 */

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** @param {Uint8Array} data @returns {Promise<Uint8Array>} */
async function inflateRaw(data) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([/** @type {BlobPart} */ (data)]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ names: string[], read: (name: string) => Promise<Uint8Array | null> }}
 */
export function readZip(bytes) {
  // end of central directory record: search backwards for its signature
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a ZIP file (no end-of-central-directory record)');
  const count = u16(bytes, eocd + 10), cdOffset = u32(bytes, eocd + 16);
  /** @type {Map<string, {method: number, csize: number, local: number}>} */
  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const method = u16(bytes, p + 10), csize = u32(bytes, p + 20), nameLen = u16(bytes, p + 28), extraLen = u16(bytes, p + 30), commentLen = u16(bytes, p + 32), local = u32(bytes, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    names: [...entries.keys()],
    async read(name) {
      const e = entries.get(name); if (!e) return null;
      if (u32(bytes, e.local) !== 0x04034b50) throw new Error('corrupt ZIP local header');
      const start = e.local + 30 + u16(bytes, e.local + 26) + u16(bytes, e.local + 28);
      const raw = bytes.subarray(start, start + e.csize);
      if (e.method === 0) return raw;
      if (e.method === 8) return inflateRaw(raw);
      throw new Error('unsupported ZIP compression method ' + e.method);
    },
  };
}
export const utf8 = (/** @type {Uint8Array} */ b) => new TextDecoder().decode(b);
