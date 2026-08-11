# Global Swim Discovery — Handoff

**As at 2026-08-09, end of day.** Live in production unless marked
otherwise. Supersedes the 2026-08-05 version.

---

## 1. Where it stands

| | |
|---|---|
| Live upcoming events | **309** |
| Countries | **35** (was 29) |
| Enabled sources | **44** (was 38) |
| Review queue | **652**, every one of them dateless |
| Ready to review | **0** — Dave cleared it |
| Organiser submissions received | 0 (the form is hours old) |

### Access

- **Public:** https://www.swimloading.com/explore — indexed, in the
  sitemap, linked from nav, hero, footer and all 218 event pages
- **Submit a swim:** `/list-your-swim` — public, no account
- **Admin:** `/discovery-review`
- **Worker:** Railway `heartfelt-benevolence` → service **Swimloading**.
  GitHub auto-deploy works again as of 6 Aug.

---

## 2. AI crawling — already correct, do not change it

**Verified 2026-08-09 in Cloudflare AI Crawl Control, not inferred from
robots.txt.** An earlier version of this handoff said AI crawlers were
blocked and that the SEO work was inert until that changed. That was
wrong, and the mistake is worth recording: it came from reading the
`Disallow:` lines without checking what was actually being served.

Last 24 hours: **372 AI-crawler requests, 361 allowed, 328 returning HTTP
200.**

| Crawler | What it is | Allowed |
|---|---|---|
| ChatGPT-User | fetches a page to answer a user's question | 147 |
| BingBot | search | 144 |
| Googlebot | search | 37 |
| Claude-SearchBot | Anthropic's answer crawler | 19 |
| Applebot, DuckAssistBot, PerplexityBot | answer engines | present |

The managed block targets the **training** crawlers — GPTBot, ClaudeBot,
CCBot, Google-Extended, Bytespider, Amazonbot, meta-externalagent. The
**answering** crawlers are different agents and are allowed. GPTBot is not
ChatGPT-User; ClaudeBot is not Claude-SearchBot.

So the site already sits exactly where its own content signal says it
should — `search=yes, ai-train=no, use=reference` — and that position is
being honoured. AI assistants can read the event pages, the structured
data and `llms.txt` today.

**Leave Managed robots.txt ON.** Turning it off would only admit training
crawlers, which send no traffic back.

Worth a look, not urgent: **"Markdown for Agents"** (Cloudflare Pro; this
zone is on free) serves clean Markdown to agents that ask for it instead
of 124 KB of HTML. With ChatGPT-User alone at 147 requests a day it may
pay for itself — check the price against what that traffic converts.

Also worth watching: the 62.7% week-on-week drop shown on that screen is
probably noise over 24 hours, but a sustained fall in ChatGPT-User would
mean fewer people being pointed here from an AI answer, which is the
metric that matters for this work.

---

## 2b. The one thing still blocked on Dave

**Turnstile needs its keys.** `/list-your-swim` is protected by Cloudflare
Turnstile in code but **inactive** until two Vercel env vars exist:

    TURNSTILE_SITE_KEY      public
    TURNSTILE_SECRET_KEY    secret

Until then the form keeps its original direct-to-Supabase path and works
normally — the endpoint reports whether it is configured and the page
adapts, so there is no broken window. See §5 for what must happen *after*
the keys are set.

## 3. What changed on 2026-08-09 (and 08-06)

**Countries resolved.** The country was in the JSON-LD all along; two gaps
in our own parsing threw it away — a twelve-entry country table, and a
JSON-LD path that never applied the subdivision inference the free-text
path already had. 22 candidates recovered. Country vocabulary is now
generated from CLDR, not typed.

**134 dates recovered.** Wholly numeric dates (`3.10.2026`), month-first
dates (`Sep. 19, 2026`) and year-first dates (`2026-08-21`) were all
unreadable. Worse, the fallback stored 1 January and marked it
**confirmed**, so 134 candidates were auto-retired as "date_passed" on a
date that never existed. Finland went 0 → 23 live events from this alone.

**Distances.** A comma-split broke decimal commas (`1,666 km` → 666 km)
and a borrowed unit turned `Swim250` into 402 km. Both fixed.

**Non-swims removed.** Two running races were live on /explore. Kretsloppet
is the one to remember: its distances are 400 m / 2 / 5 / 10 km —
perfectly ordinary open-water distances. Only the sport label
distinguished it, and Lopplistan printed that label in a column we never
read.

**Review queue.** It was silently truncated — an unpaged select against a
1777-row table returned 1000, so Dave saw 340 of 814 and the rest were
unreachable. Now paged, split by whether a decision can have any effect,
and bulk-approvable per source.

**Site-wide SEO.** 15 pages had no headings at all; the crossing
intelligence pages served 124 KB with no `h1`, no `h2` and no description.
All fixed, plus canonical and Open Graph across the partner pages,
structured data on the crossing pages, and `llms.txt` (generated, never
stale).

**Organiser submissions.** `/list-your-swim` — the first route by which a
swim can arrive without us fetching it.

---

## 4. Rules that must not be broken

Carried forward, plus what this week added.

**A wave is not an event.** `rejectAsEventName()` blocks waves, age
brackets and numbered placeholders at build time.

**A lesson is not a swim you enter.** `NON_RACE_PHRASES` is checked
*before* the open-water signal — a class held in the sea is still a class.

**An entry option is not an event.** New 6 Aug. Castle Race Series
publishes one festival as a menu of ways to enter it; the AI transcribed
the menu as 19 swims. Bare distances, race formats and hyphenated age
ranges are now blocked — all **anchored to the whole string**, because
"Capri-Napoli Marathon" and "10K Lake Zurich Swim" must survive.

**Discipline is separate from event type.** Still fixed for classes,
**not yet for multisport** — the surviving "Lough Cutra Castle Triathlon
and Multisport Festival" candidate still carries `discipline: open_water`.

**An unconfirmed date is never stored.** Schema-enforced, and as of 9 Aug
actually honoured: the year-only fallback used to mark its own failure
`dateConfirmed = true`.

**Day-first vs month-first is decided, never guessed.** `21/02` is the
21st anywhere; `10/07` is settled by the source's registered country or
refused. Same discipline as the `listopad` month-name rule.

**Only `operates` may carry a booking link.** CHECK-enforced on
`swim_routes`.

**Never invent a coordinate.** Dassen and West Angle have no `Place`
schema for exactly this reason.

**AI-read candidates never auto-publish, and are never indexable.**

---

## 5. Needs attention, in order

**1. Revoke the anon grant on `submit_organiser_event`** — *after* the
Turnstile keys are set and the form is confirmed working in a real
browser. A widget on the form is decorative while the RPC is still
callable by anon: anyone can skip the page and POST to Supabase directly.
This is the step that makes Turnstile real, and doing it first would break
a live form.

    REVOKE EXECUTE ON FUNCTION public.submit_organiser_event FROM anon;

**2. Verify the Turnstile widget renders.** Not verified — Turnstile
detects automation and refuses to initialise in an automated browser,
which is correct behaviour on its part and a hard limit on what could be
proven here. The no-keys fallback IS verified.

**3. ~~France's 187 are still stale.~~ RESOLVED 11 Aug — it was never
staleness, it was duplication.** The 6 Aug re-extraction *had* worked: it
produced 187 candidates all carrying real dates, already triaged 37
approved / 149 rejected. The 187 "stale" rows were **orphans of the
pre-fix run** — 187/187 matching their replacements on both
`canonical_name` and `source_url`, sharing **zero** candidate keys.

Cause: `candidate_key` hashes URL + name + edition year, and an
unconfirmed date contributes `'unknown-year'`. The moment the date became
readable the key changed, so the upsert on `(source_id, candidate_key)`
**inserted a sibling** and stranded the original as `pending` forever.
Fixed in `persistCandidate` — see §6, and it was 302 rows queue-wide, not
187.

**4. The queue is 652 → 544 and every one is dateless.** 108 healed
automatically on 11 Aug when France was re-crawled on the fixed code. What
remains splits into two genuinely different problems:

*Orphans awaiting a re-crawl (194).* Sweden 68, Poland 26, Japan 14, plus
France's own 79. These retire themselves the moment their source
re-extracts — clear `content_hash` to force it. **France's remaining 79
are a separate defect**: `calendrier-eau-libre` now yields
`rowsFound=0` with *"Table matched headers but produced no usable event
rows"*, while its sibling calendar pages yield 88 and 20 cleanly. Fix that
page before assuming the orphan logic failed.

*Real parser gaps (~350).* Verified from the stored warnings:
- **Brazil 97** — Portuguese `"13 de Abril"`; the `de` connector is
  unhandled, as are `"19 a 21 de Março"` ranges. Nothing else is wrong
  with that source; it is `healthy` and has produced 0 approved.
- **Japan 14** — CJK `"6月28日"` unparsed.
- **Mexico 67** — mostly `"Noviembre"`, i.e. month with no day. **Not a
  bug**: refusing to store it is the rule working. These need a source
  that publishes days, not a parser change.
- **South Africa 18** — AI-read, awaiting review rather than parsing.

**5. Chillswim Windermere is duplicated.** "Chillswim Windermere End to
End" (approved, published) and "Chillswim Windermere 11 Miles End to End"
(pending) are the same event, same date, same page.
`discovery_dedupe_links` has **no row for it** — it was never compared.
The pending one has the better name.

**6. Bookable swims as `swim_routes`.** Dave, 6 Aug: *"this is a global
list of SWIMS — guided is a swim, SwimTrek, swim holidays, those are all
swims."* Chillswim's guided Windermere swims, SwimTrek trips and Derrick's
escorted crossings all belong in the catalogue and none is a dated event.

**7. Two partnership emails, drafted and unsent.** Ahotu
(`contact@ahotu.com`) and Eventrac. Ahotu is a booking marketplace whose
thinnest vertical (437 swims of 60,000 events) is the only one SwimLoading
does — the ask is a referral partnership, not a data favour.

**8. The crawler wanders.** `expand_url_pattern` exists and is set on
Lopplistan only. Watch active.com's daily runs: if `ai_calls` climbs while
`candidates` does not, set a pattern rather than re-parking the source.

---

## 6. Gotchas that cost real time

- **PostgREST caps at 1000 rows silently.** Bit the venue geocoder, the
  date-replay script, and the review queue. Page explicitly.
- **A parser fix that changes a candidate's KEY orphans its own row.**
  `candidate_key` includes the edition year, so unknown-year → 2026 is a
  new identity and the upsert inserts rather than updates. Cost: 302
  stranded rows, 46% of the review queue, and a handoff item that read as
  "the worker never ran". `persistCandidate` now reclaims the dateless
  predecessor before writing — re-keying it in place where it can, so the
  row keeps its id, review decision, evidence and dedupe links. **The fix
  is also the backfill**: any source that re-extracts heals itself. Watch
  for this whenever a fix changes what goes INTO an identity, not just
  what comes out of a parser.
- **"Still pending" is not the same as "never extracted".** Both look
  identical in a status count. Compare `extracted_at` and the warnings
  fingerprint against the *run* history before concluding a deploy failed.
- **A one-off backfill is not a rule.** If it must hold continuously, it
  is a trigger.
- **Unchanged pages are never re-extracted**, so a parser fix does not
  retroactively repair stored candidates. Clearing `content_hash` is the
  force lever — `next_run_at` alone is a no-op, proved twice.
- **`information_schema.routine_privileges` under-reports grants.** Use
  `has_function_privilege`.
- **Postgres fires same-timing triggers in NAME order.**
- **Slugs are permanent.** Fixes to name-stripping are not retroactive.
- **`tsx` does not typecheck.** Run both.
- **Regex-parsing HTML: strip comments, scripts and inline SVG first.**
  `scripts/site-audit.py` reported a 241-character title because a comment
  on that page contained literal tag syntax while discussing titles.
- **Turnstile's `render=explicit` populates `window.turnstile` via its
  `onload` callback, not the script's onload event.** Rendering early
  throws "render is not a function".
- **A probe verdict of "no dates" means "not deterministically
  extractable"**, not "this page states no dates" — the probe never runs
  the AI fallback the real crawler has.
- **The probe measures dates, not discipline.** It rated the Swimming
  Federation of India `seed-with-ai` on 25 genuine future dates, every one
  a pool championship or water polo tie.
- **Northern calendars are half-spent in August.** Japan, New Zealand and
  Hong Kong all have working sources that are simply out of season.

---

## 7. Tools

```bash
# Site audit: broken links, SEO fields, structured data
python3 scripts/site-audit.py                 # standard page set
python3 scripts/site-audit.py /explore /pro   # spot check

# Probe candidate sources — reports DATED EVENTS, not reachability
cd discovery-worker && DISCOVERY_LIVE_FETCH_ENABLED=true \
  npm run probe:batch -- candidates.tsv

# Replay a parser fix over stored rows before backfilling anything
cd discovery-worker && npx tsx scripts/replay-dates.ts --sql
cd discovery-worker && npx tsx scripts/replay-country-resolution.ts
cd discovery-worker && npx tsx scripts/sweep-not-a-name.ts

# Regenerate the country table from CLDR
cd discovery-worker && node scripts/gen-country-names.mjs > src/normalize/country-names.ts
```

The replay scripts are the pattern worth keeping: **run a parser fix over
each row's own stored payload and read the result before writing
anything.** Every date and country backfilled this week was produced that
way, not chosen by hand — and it caught a bug in the very upsert meant to
apply it.

---

## 8. Deploying the worker

GitHub auto-deploy works. If it breaks again, the CLI path is:

```bash
cd discovery-worker && railway up
```

`link` from **inside `discovery-worker`**. Running `up` from the repo root
creates a stray project and bundles 512 MB of `.git`.

**Verify by behaviour, not the deploy log.** Fingerprint in
`discovery_candidate_events.warnings`:

- old: `"no weekday to verify the year"`
- new: `"Year 2026 taken from the page's own heading"`

Railway's *Redeploy* button rebuilds **the same commit** — it does not
ship new code. Five "successful" redeployments once shipped nothing.
