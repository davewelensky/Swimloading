# SwimLoading SEO acquisition layer — handover

**As at 2026-08-14.** Increments 1 and 2 are done and live. Increment 3
(the shared crossing template) has not been started; everything it needs
is in place.

---

## 1. The finding that shaped everything

`/crossings/*` are **eleven hand-written static HTML files**, each routed
individually in `vercel.json`, with zero data binding. A `crossings` table
existed with almost exactly the right columns — but it was **sparse, and
the content was in the HTML, not the database**.

Gibraltar earns **194 of the site's 447 organic clicks**. Its row held a
distance, a temperature range and a 101-character description; its file
held ~1,900 words. Rendering that page from the database would have
reduced it to three facts.

So the order is **backfill, then template** — never the reverse. That is
the single most important thing to preserve.

---

## 2. What is done

### Increment 1 — sitemap, freshness, indexability (`f6d10ee`)

| File | What |
|---|---|
| `api/_lib/temperature-freshness.js` | `getTemperatureFreshness()` — live / recent / stale / unavailable. Thresholds in ONE place. `spotTitle()` only says "Today" when the reading supports it. A future timestamp is treated as a clock fault and can never earn the strongest claim. |
| `api/_lib/indexability.js` | `isPublicPageIndexable(record, kind)` — returns `{indexable, reasons, missing}`. Failing is not deletion: the page still renders, served `noindex,follow`. |
| `api/sitemap-dynamic.js` | Crossings now emitted FROM THE TABLE. Spots pass the gate first. |
| `test/seo-helpers.test.js` | 17 tests. `npm test` at repo root (node:test, no new deps). |

**`/crossings/strait-of-gibraltar` was not in the sitemap at all** before
this — only `/crossings/english-channel` was hand-listed.

**The gate was wrong on its first draft and real data caught it.** Gating
on swimmer readings alone held back 67 of 194 spots — Boulders Beach,
Ballito, Blouberg, real named beaches whose only failing was that nobody
had logged a temperature there lately. Gating on `spot_temp_estimate`
(the blended view the app itself shows) takes that to 6. Verify against
real data before shipping a gate, not after.

### Increment 2 — crossings content backfilled (`e5729e5`, `b6b03d9`)

Ten of eleven crossings now hold their own page content: 4 hazards, 4
conditions, ~4 about paragraphs, 6–7 preparation blocks, 4–5 FAQs, plus
season months, duration, governing body, start and finish.

New columns: `hazards`, `conditions`, `preparation`, `faqs` (jsonb arrays
— `faqs` feeds FAQPage JSON-LD directly), `about_md`, `oceans_seven`,
`duration_text`, `connects`.

`connects` is a **human phrasing**, not derived from ISO codes, because
codes cannot express any of the hard cases: Ceuta is Spanish soil so
Gibraltar is ES→ES, Cook Strait is NZ→NZ, Tsugaru is JP→JP.
`country_code` stays the sovereign country for filtering and
`/swims/{country}`.

### Parity is proven (`8c9590d`)

`scripts/crossing-parity.mjs` compares each live page's words against what
is now stored:

```
nine crossings   83–89% covered   -> a template CAN match them
english-channel      3% covered   -> keep it separate (see §5)
```

The residue is page chrome plus **the hero intro paragraph**, which has no
column (§4).

---

## 3. Scripts

| Script | Does | Writes? |
|---|---|---|
| `scripts/extract-crossing-content.mjs` | Reads the HTML into structured sections + Key Facts | No — reports, `--json` to dump |
| `scripts/backfill-crossings.mjs` | Generates the migration AND applies from the same source | `--apply` only |
| `scripts/crossing-parity.mjs` | Page words vs stored words | No |

Two extractor mistakes worth knowing, both found by running it: keying on
`h1`–`h4` found zero "About the crossing" and zero FAQs (those labels are
`section-title` divs), and the h3s that DO exist sit inside a section, so
heading-splitting ran one section into the next. Hazards and Conditions
genuinely are nested h3s, so the extractor uses both mechanisms.

---

## 4. Increment 3 — what to do next

1. **Extract the hero intro** into the database. Gibraltar's is 306 chars;
   `description` holds 101. It is the sentence doing the most SEO work
   ("Swimming between Europe and Africa across the world's busiest
   shipping strait…"). Takes coverage past 90%.
2. **Build `api/crossings-handler.js`**, modelled on `api/spots-handler.js`
   — which already has `pageShell()` centralising title/description/
   canonical/JSON-LD, and emits Dataset + BreadcrumbList + FAQPage. **Do
   not build a parallel system.**
3. **Render Gibraltar to a file and diff it against the live page.** Dave
   approves before any route changes. This is the gate.
4. Switch routes crossing by crossing, Gibraltar LAST.

---

## 5. Things that will bite

- **English Channel must stay separate.** 3% parity, a 197 KB page, and
  its own content cluster (`/english-channel/cost`, `/pilots`, `/records`
  and seven more, all separately routed). Forcing it into a shared
  template is a downgrade, not a standardisation.
- **`north-channel.html` states something false.** Its Key Facts note says
  "The Infinity Channel Association (ICA) sanctions and ratifies
  crossings". Dave confirmed 2026-08-14 that Infinity Channel Swimming is
  a piloting and support operation, not a sanctioning body; ratification
  sits with the **ILDSA**. The database now says ILDSA. **The page has not
  been corrected.**
- **`ROUTED_CROSSING_SLUGS` in `api/sitemap-dynamic.js`** mirrors
  `vercel.json` by hand. It is marked temporary and goes away when every
  active crossing has a route.
- **Six spots have no `country_code`** and are therefore held out of the
  sitemap. A separate session was fixing this (Paternoster, Curro
  Durbanville, Kirstenhof Primary School Pool, Ai Ais POOL Namibia, Virgin
  Active Paarl, Maclear Beach — all ZA except Ai Ais, NA). Confirm it
  landed, then all 194 pass.
- **`custom-marathon-swim` and `robben-island`** are rows without
  `/crossings/` routes. `robben-island` has its own page at `/robben`.
  Neither should get a crossing page by accident.

---

## 6. Not started

Sections 6–17 of the brief: nearby helpers (spots/events/crossings),
Explore deep-links with geographic context, analytics events (GA4 via
`gtag` is already present on the spot handler and the crossing pages — do
not add a second platform), location landing pages, and the crossing
template itself.

Section 12's quality gate is done for spots and crossings; it needs
extending to events and any location pages.
