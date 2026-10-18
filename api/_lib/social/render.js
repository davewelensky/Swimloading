// HTML -> JPEG via headless Chromium (same launcher approach as api/_lib/lab-report/pdf.js).
// Production: @sparticuz/chromium on Vercel. Local: set LAB_CHROME_PATH to a Chrome binary.
import puppeteer from 'puppeteer-core';
import { SIZE } from './templates.js';

async function launch() {
  const local = process.env.LAB_CHROME_PATH;
  if (local) return puppeteer.launch({ executablePath: local, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const { default: chromium } = await import('@sparticuz/chromium');
  return puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
}

/** @param {string[]} htmls one per slide. @returns {{jpeg:Buffer, clipped:string[]}[]} */
export async function renderSlides(htmls) {
  const browser = await launch();
  try {
    const out = [];
    for (const html of htmls) {
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
      const jpeg = await page.screenshot({ type: 'jpeg', quality: 92 });
      out.push({ jpeg: Buffer.from(jpeg), clipped });
      await page.close();
    }
    return out;
  } finally { await browser.close(); }
}
