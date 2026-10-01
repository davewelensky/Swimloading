// Builds test/lab-eo-fingerprints.json: SHA-256 prefixes of every 6-word run in EO specimen text.
// The output contains hashes only, so the repo can prove "no verbatim EO prose" without holding any EO prose.
// Usage: node scripts/lab-eo-fingerprints.mjs <text-file> [<text-file> ...]   (text extracted locally from EO reports)
import fs from 'node:fs'; import crypto from 'node:crypto';
export const SHINGLE = 6;
export const tokens = (s) => String(s).toLowerCase().replace(/[^a-z0-9% .]+/g, ' ').replace(/\./g, ' ').split(/\s+/).filter(Boolean);
export const hashes = (s) => { const t = tokens(s), out = new Set(); for (let i = 0; i + SHINGLE <= t.length; i++) out.add(crypto.createHash('sha256').update(t.slice(i, i + SHINGLE).join(' ')).digest('hex').slice(0, 16)); return out; };
if (import.meta.url === `file://${process.argv[1]}`) {
  const all = new Set(); for (const f of process.argv.slice(2)) for (const h of hashes(fs.readFileSync(f, 'utf8'))) all.add(h);
  fs.writeFileSync(new URL('../test/lab-eo-fingerprints.json', import.meta.url), JSON.stringify({ shingle: SHINGLE, count: all.size, hashes: [...all].sort() }));
  console.log('fingerprints:', all.size);
}
