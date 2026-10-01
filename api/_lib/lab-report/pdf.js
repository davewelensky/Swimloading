// HTML -> PDF with headless Chromium. In production: @sparticuz/chromium on Vercel. Locally: set LAB_CHROME_PATH to a Chrome binary.
import puppeteer from 'puppeteer-core';

async function launch() {
  const local = process.env.LAB_CHROME_PATH;
  if (local) return puppeteer.launch({ executablePath: local, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const { default: chromium } = await import('@sparticuz/chromium');
  return puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
}

/** @param {string} url @returns {Promise<Buffer>} */
export async function renderPdf(url) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 40000 });
    await page.waitForSelector('html[data-ready="1"]', { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => document.fonts && document.fonts.ready);
    await page.emulateMediaType('print');
    return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } }));
  } finally { await browser.close(); }
}
