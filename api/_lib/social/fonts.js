// Bebas Neue + DM Sans bundled as base64 @font-face, so rendering never touches a font CDN
// (a Vercel function or an offline machine renders identically). Files: ./fonts/ (SIL OFL 1.1).
import { readFileSync } from 'node:fs';

const b64 = (f) => readFileSync(new URL(`./fonts/${f}`, import.meta.url)).toString('base64');
let cached;
/** CSS declaring 'Bebas Neue' (400) and 'DM Sans' (400 to 800, variable) from embedded data. */
export function fontCss() {
  if (cached) return cached;
  const bebas = b64('BebasNeue-latin.woff2'), dm = b64('DMSans-latin.woff2');
  cached = `@font-face{font-family:'Bebas Neue';font-weight:400;font-style:normal;src:url(data:font/woff2;base64,${bebas}) format('woff2')}` +
    `@font-face{font-family:'DM Sans';font-weight:400 800;font-style:normal;src:url(data:font/woff2;base64,${dm}) format('woff2')}`;
  return cached;
}
