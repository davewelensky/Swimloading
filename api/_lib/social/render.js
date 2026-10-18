// HTML -> JPEG via headless Chromium (same launcher approach as api/_lib/lab-report/pdf.js).
// Production: @sparticuz/chromium on Vercel. Local: set LAB_CHROME_PATH to a Chrome binary.
import puppeteer from 'puppeteer-core';
import { SIZE } from './templates.js';

export async function launch() {
  const local = process.env.LAB_CHROME_PATH;
  if (local) return puppeteer.launch({ executablePath: local, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const { default: chromium } = await import('@sparticuz/chromium');
  return puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
}

/** Minimum contrast of white text against the actual pixels behind it (WCAG "large text" = 3:1). */
const MIN_CONTRAST = 3;

/**
 * @param {(string|{html:string, template?:string})[]} items one per slide.
 * @returns {{jpeg:Buffer, clipped:string[], problems:string[], contrast:number[]}[]}
 * `problems` are quality failures: broken images/tiles, wrong template, text on a background too bright to read.
 */
export async function renderSlides(items) {
  const htmls = items.map((i) => (typeof i === 'string' ? { html: i } : i));
  const browser = await launch();
  try {
    const out = [];
    for (const { html, template } of htmls) {
      const page = await browser.newPage();
      await page.setViewport({ width: SIZE.w, height: SIZE.h, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
      await page.evaluate(() => document.fonts.ready);
      // Clipping check: nothing may overflow its box or the 1080x1350 canvas.
      const clipped = await page.evaluate((W, H) => {
        const bad = [];
        document.querySelectorAll('.fit').forEach((el) => { if (el.scrollHeight > el.clientHeight + 12 || el.scrollWidth > el.clientWidth + 2) bad.push('overflow: ' + el.textContent.trim().slice(0, 40)); });
        document.querySelectorAll('.slide *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > W + 1 || r.bottom > H + 1) && getComputedStyle(el).position !== 'absolute') bad.push('off-canvas: ' + (el.className || el.tagName) + ' ' + el.textContent.trim().slice(0, 30));
        });
        return [...new Set(bad)];
      }, SIZE.w, SIZE.h);
      // Quality checks beyond clipping.
      const problems = await page.evaluate((want) => {
        const bad = [];
        document.querySelectorAll('img').forEach((i) => { if (!(i.complete && i.naturalWidth > 0)) bad.push('image failed to load: ' + i.src.slice(0, 70)); });
        const t = document.querySelector('[data-template]')?.getAttribute('data-template');
        if (want && t !== want) bad.push(`template mismatch: wanted ${want}, rendered ${t}`);
        return bad;
      }, template || null);
      // Legibility: hide the text, screenshot what is behind it, measure the brightest 5% of each text box.
      const boxes = await page.evaluate(() => [...document.querySelectorAll('[data-hl]')].map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
      let contrast = [];
      if (boxes.length) {
        const hideTag = await page.addStyleTag({ content: '[data-hl]{color:transparent!important;text-shadow:none!important}' });
        const png = (await page.screenshot({ type: 'png' })).toString('base64');
        contrast = await page.evaluate(async (b64, bx) => {
          const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
          const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
          return bx.map((r) => {
            const d = g.getImageData(Math.max(0, r.x | 0), Math.max(0, r.y | 0), Math.max(1, Math.min(r.w | 0, 1080)), Math.max(1, Math.min(r.h | 0, 1350))).data;
            const L = []; for (let i = 0; i < d.length; i += 16) L.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]));
            L.sort((a, b) => a - b); const p95 = L[Math.floor(L.length * 0.95)] ?? 0;
            return Math.round((1.05 / (p95 + 0.05)) * 10) / 10;
          });
        }, png, boxes);
        for (const c of contrast) if (c < MIN_CONTRAST) problems.push(`headline/text contrast ${c}:1 is below ${MIN_CONTRAST}:1`);
        await hideTag.evaluate((n) => n.remove());
      }
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 92 });
      out.push({ jpeg: Buffer.from(jpeg), clipped, problems, contrast });
      await page.close();
    }
    return out;
  } finally { await browser.close(); }
}
