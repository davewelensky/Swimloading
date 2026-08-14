# SEO measurement baseline

Google Search Console is the measurement source for the SEO work. This
file records the state of the pages we are changing **before** we change
them, so the next increment can tell improvement from noise.

It is a record, not a feature. There is deliberately no Search Console API
integration — numbers are pasted in by hand when a baseline is taken.

---

## Baseline — 14 August 2026

Taken immediately before Increment 4 (search-intent presentation, nearby
content, crossing analytics). Window: previous 3 months.

| Page | Clicks | Impressions | CTR | Avg position |
|---|---:|---:|---:|---:|
| `/spots/tooting-bec-lido` | 96 | ~6,200 | ~1.5% | ~7.4 |
| `/crossings/catalina-channel` | 11 | ~1,880 | ~0.6% | ~8.1 |
| `/crossings/english-channel` | 18 | ~1,600 | ~1.1% | ~7.6 |
| `/crossings/tsugaru-strait` | 3 | ~1,503 | ~0.2% | ~8.6 |
| `/crossings/cook-strait` | 9 | ~730 | ~1.2% | ~7.4 |

CTR is derived from the clicks and impressions above, not read separately.

### Query opportunities these pages already surface for

- `tsugaru strait swim`, `tsugaru strait swim distance`
- `catalina channel`, `catalina channel swim`, `catalina channel swim distance`
- `english channel water temperature`
- Spot pattern, recurring: `[spot] temperature`, `[spot] water temperature`,
  `[spot] temperature today`

### Why Gibraltar is NOT the success signal

`/crossings/strait-of-gibraltar` earned 194 of 447 organic clicks in the 28
days to 2026-08-13. That spike was substantially driven by a July 2026 news
event about mass border crossings from Morocco into Ceuta — people
searching for the border, not for a swim. Judging this increment on
Gibraltar would be measuring a news cycle. The five pages above are the
honest scoreboard.

### What to expect, and what would count as success

The pages above rank around positions 7–9 — page one, but below the fold
of attention. The changes in Increment 4 target **CTR and engagement at
existing rank**, not rank itself:

- Tsugaru converts 3 clicks from 1,503 impressions (0.2%). Its distance is
  now stated as an explicit, labelled fact rather than buried in prose. If
  the "answer the query above the fold" theory is right, CTR moves first.
- Catalina and Cook Strait carried factually wrong records and, for Cook
  Strait, a geographically impossible route. Correctness is a precondition
  for anything else, not an optimisation.
- Nearby content and the Explore CTA target what happens **after** the
  click, which GSC cannot see — that is what the new `crossing_page_view`
  and `crossing_explore_click` events are for.

Re-take this baseline no sooner than **six weeks** after deployment.
Google needs to recrawl, and a fortnight of data on a page with three
clicks a quarter is noise.

---

## Spot cohort baseline — 14 August 2026

Taken immediately before Increment 5, which changed spot titles and meta
descriptions to tell the truth about how old each temperature reading is.
Window: previous 3 months.

| Page | Clicks | Impressions | CTR | Avg position |
|---|---:|---:|---:|---:|
| `/spots/tooting-bec-lido` | 96 | ~6,200 | ~1.5% | ~7.4 |
| `/spots/simons-town` | — | — | — | — |
| `/spots/brockwell-lido` | — | — | — | — |
| `/spots/aquatic-park-san-francisco` | — | — | — | — |
| `/spots/langebaan-channel` | — | — | — | — |
| `/spots/clifton-4th-beach` | — | — | — | — |

Only Tooting Bec's figures were supplied. The other five are listed
because they are the agreed cohort and because each represents a distinct
freshness state — **paste their GSC numbers in before the next re-take, or
this table cannot support a before/after comparison.** Deliberately left
blank rather than estimated.

### The freshness state each page was in at the moment of the change

This is the part that matters for reading the next measurement, because
only some of these pages had their title changed at all:

| Page | Reading age | State | Title before | Title after |
|---|---:|---|---|---|
| Tooting Bec Lido | 0.3 h | live | …Pool Temperature Today | **unchanged** |
| Brockwell Lido | 0.3 h | live | …Pool Temperature Today | **unchanged** |
| Clifton 4th Beach | 7.3 h | recent | …Water Temperature Today | …Water Temperature & Swimming Conditions |
| Simons Town | 149 h | stale | …Water Temperature Today | …Water Temperature & Swimming Conditions |
| Boulders Beach | 967 h | stale | …Water Temperature Today | …Water Temperature & Swimming Conditions |
| Langebaan — Channel | 1,326 h | stale | …Water Temperature Today | …Water Temperature & Swimming Conditions |
| Muizenberg | no reading | unavailable | …Water Temperature Today | …Swimming Conditions |

**The canary did not change.** Tooting Bec's reading was 18 minutes old, so
it keeps "Today" and its title is byte-identical. That is the cleanest
possible canary result: the fix is proven correct without disturbing the
best-performing page, and any movement in its numbers is therefore noise,
not this change.

Expect CTR on the *stale* pages to move — down as often as up. Losing the
word "Today" may cost clicks. That trade is deliberate: a swimmer who
clicks "temperature today" and finds a six-day-old number learns not to
trust the site, and that costs more than a click.

---

## Tooting Bec Lido — review, 14 August 2026

Reviewed as the cleanest spot-SEO canary (96 clicks, position ~7.4).
**No changes were made.** It is the most stable measurement surface we
have, and it already answers its queries. Findings, in priority order:

### It answers its two target queries

- `Tooting Bec Lido water temperature` — the `<title>` is
  "Tooting Bec Lido Pool Temperature Today | SwimLoading"; the tagline
  under the H1 reads "Live water temperature for lakes & lidos"; a live
  sensor reading is fetched client-side from `/api/mywaterlive`.
- `Tooting Bec Lido temperature today` — the "Today" claim is honest
  *here* specifically, because this is a my-water.live sensor venue with a
  continuously updated reading and a visible "Sensor updated …" timestamp.

Canonical is correct and self-referencing. Three JSON-LD blocks are
present and valid (Dataset, BreadcrumbList, FAQPage). Eleven recent-log
rows give the page real, current substance.

### Recommendations — deliberately NOT implemented in Increment 4

**Status: item 1 was FIXED in Increment 5 (14 Aug 2026).** Items 2–4 remain
open. The original finding is kept below as the record of what was wrong.

1. ~~**`spotTitle()` is not actually used by the spot handler.**~~ Increment 1
   added a helper whose entire purpose is to say "Today" only when a
   reading supports it. `renderSpotPage()` still builds the title with a
   hardcoded `Today`. It is defensible on Tooting Bec (live sensor) but is
   a false claim on any spot whose last log is weeks old. **This is the
   single highest-value correction outstanding** — and it is deliberately
   deferred because it would rewrite the title of ~194 ranking pages at
   once, which is exactly the kind of simultaneous change SEO change
   control forbids mid-measurement. It deserves its own increment, its own
   canary and its own baseline.
2. **The sensor-venue H1 is just the venue name.** Non-sensor spots render
   `<h1>{name} Water Temperature</h1>`; sensor venues render `<h1>{name}</h1>`.
   The query intent survives in the title and tagline, so this is an
   opportunity rather than a defect — but it should be tested on a
   lower-traffic sensor venue first, not on the canary.
3. **No Explore CTA.** Crossing pages now offer a geographic path into
   `/explore`; spot pages offer none. Worth extending, again on a
   lower-traffic page first.
4. **No crossing-style analytics.** Spot pages carry GA4 but not the
   `*_page_view` / `*_explore_click` events crossings now emit, so we
   cannot yet see what a spot visitor does next. The helper in
   `api/_lib/public-analytics.js` was written to be reusable for exactly
   this.

Leaving all four alone keeps Tooting Bec a clean control while the
crossing changes are measured against it.
