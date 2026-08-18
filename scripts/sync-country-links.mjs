// Regenerate the crawlable country links in welcome.html from site-config.js.
//
//   node scripts/sync-country-links.mjs            # write
//   node scripts/sync-country-links.mjs --check    # verify only (CI/tests)
//
// WHY THIS EXISTS. welcome.html is a static file with no build step, and its
// International column was rendered purely by JavaScript from
// SITE_CONFIG.countries. Humans and Google both cope with that, but the
// served HTML contained no country links at all — the one surface where our
// country pages could earn their own crawl path had nothing in it.
//
// The obvious fix — type the list into the HTML — is the exact mistake
// site-config.js was created to end: a hand-written international list on
// this page silently fell five countries behind (Jul 2026). So the list is
// GENERATED from the same canonical config the runtime uses, into a marked
// block, and test/country-links.test.js fails the build if the two drift.
//
// The runtime renderer stays as it is: it rewrites the same container with
// the same links, so behaviour is unchanged for JS users and the static HTML
// is now correct for everyone else.

import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'welcome.html';
const BEGIN = '<!-- BEGIN generated-country-links (scripts/sync-country-links.mjs — do not edit by hand) -->';
const END = '<!-- END generated-country-links -->';

/** Load SITE_CONFIG without a DOM. site-config.js assigns to window. */
export function loadCountries(source = readFileSync('site-config.js', 'utf8')) {
  const scope = { window: {} };
  // eslint-disable-next-line no-new-func
  new Function('window', source)(scope.window);
  const config = scope.window.SITE_CONFIG;
  if (!config?.countries?.length) throw new Error('SITE_CONFIG.countries not found');
  return config.countries;
}

/**
 * The link list. South Africa is included explicitly: it is where
 * SwimLoading started and has the most spots, but it lives outside
 * SITE_CONFIG.countries (which is the INTERNATIONAL list — the count shown
 * on the site is `countries.length + 1` for exactly this reason).
 *
 * A country with `slug: null` has no page of its own yet (Italy), so it
 * links to the region page that actually contains it rather than to a URL
 * that would 404.
 */
export function buildCountryLinks(countries) {
  const links = [{ label: 'South Africa', href: '/spots/atlantic' }];
  for (const c of countries) {
    links.push({ label: c.label || c.name, href: c.slug ? `/spots/${c.slug}` : '/spots/europe' });
  }
  return links;
}

export function renderBlock(links) {
  const style = 'font-size:13px;color:var(--text-secondary);text-decoration:none;';
  const rows = links.map((l) =>
    `                        <a href="${l.href}" style="${style}">${escapeHtml(l.label)}</a>`).join('\n');
  return `${BEGIN}\n${rows}\n                        ${END}`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function applyBlock(html, block) {
  const start = html.indexOf(BEGIN);
  const end = html.indexOf(END);
  if (start !== -1 && end !== -1) {
    return html.slice(0, start) + block + html.slice(end + END.length);
  }
  // First run: seed the block inside the existing (empty) container.
  const container = '<div id="footer-intl-links" style="display:flex;flex-direction:column;gap:8px;"></div>';
  if (!html.includes(container)) {
    throw new Error('footer-intl-links container not found in welcome.html — has the markup changed?');
  }
  return html.replace(container,
    '<div id="footer-intl-links" style="display:flex;flex-direction:column;gap:8px;">\n'
    + `                        ${block}\n`
    + '                    </div>');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const links = buildCountryLinks(loadCountries());
  const html = readFileSync(FILE, 'utf8');
  const updated = applyBlock(html, renderBlock(links));

  if (check) {
    if (updated !== html) {
      console.error(`${FILE} country links are OUT OF SYNC with site-config.js — run: node scripts/sync-country-links.mjs`);
      process.exit(1);
    }
    console.log(`ok  ${FILE} country links match site-config.js (${links.length} links)`);
  } else {
    writeFileSync(FILE, updated);
    console.log(`Wrote ${links.length} country links into ${FILE}:`);
    for (const l of links) console.log(`  ${l.label.padEnd(20)} ${l.href}`);
  }
}
