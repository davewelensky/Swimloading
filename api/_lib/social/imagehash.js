// 64-bit difference hash (dHash) computed in headless Chromium, so no image dependency is needed.
// Run when photos are imported; the hash is stored in the catalogue and compared with hamming().
import { readFileSync } from 'node:fs';
import { launch } from './render.js';

export async function dhashFiles(paths) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id=c width=9 height=8></canvas>');
    const out = {};
    for (const p of paths) {
      const b64 = readFileSync(p).toString('base64');
      const mime = /\.png$/i.test(p) ? 'image/png' : 'image/jpeg';
      out[p] = await page.evaluate(async (src) => {
        const img = new Image(); img.src = src; await img.decode();
        const c = document.getElementById('c'), g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, 9, 8);
        const d = g.getImageData(0, 0, 9, 8).data;
        const L = (x, y) => { const i = (y * 9 + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
        let bits = '';
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += L(x, y) > L(x + 1, y) ? '1' : '0';
        return BigInt('0b' + bits).toString(16).padStart(16, '0');
      }, `data:${mime};base64,${b64}`);
    }
    return out;
  } finally { await browser.close(); }
}
