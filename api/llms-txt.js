// Serves /llms.txt — a curated map of the site for language models.
//
// WHAT THIS IS. llms.txt (llmstxt.org) is to an LLM what sitemap.xml is to
// a crawler: not a list of every URL, but a short, opinionated summary of
// what a site is and which pages are worth reading. A model answering
// "where can I swim in Greece in September" has a context window, not a
// crawl budget, so a 3,940-URL sitemap is useless to it and 60 curated
// lines are not.
//
// WHY IT IS GENERATED, not a static file. The counts and the country list
// move every day. A hand-typed llms.txt would be wrong within a week — the
// same failure as the /explore <title>, which read "259 Swims in 28
// Countries" while the page said 341 across 31. Everything factual below
// is read from the database at request time.
//
// IMPORTANT CAVEAT, recorded here because it makes this file inert: as of
// 2026-08-09 robots.txt blocks ClaudeBot, GPTBot, Google-Extended, CCBot
// and others via Cloudflare's managed rules. Those crawlers will not fetch
// this file while that stands. It is served anyway because it costs
// nothing, is correct the moment the block is lifted, and is readable by
// anything not covered by those rules.

import { dbGet } from './seo-utils.js';
import { countryByCode } from './_countries.js';

const SITE = 'https://www.swimloading.com';

export default async function handler(req, res) {
  const today = new Date().toISOString().slice(0, 10);

  // Live facts. Every number below is counted here, never typed.
  const [editions, spots, routes] = await Promise.all([
    dbGet(`event_editions?is_searchable=eq.true&start_date=gte.${today}` +
          '&select=start_date,venue_id,event_venues(country_code)&limit=2000'),
    dbGet('spots?active=eq.true&select=country_code&limit=2000'),
    dbGet('swim_routes?is_public=eq.true&select=slug,name&order=name.asc&limit=100'),
  ]);

  const evs = editions || [];
  const byCountry = new Map();
  for (const e of evs) {
    const code = e.event_venues && e.event_venues.country_code;
    if (code) byCountry.set(code, (byCountry.get(code) || 0) + 1);
  }
  const countries = [...byCountry.entries()]
    .map(([code, n]) => ({ code, n, c: countryByCode(code) }))
    .filter((x) => x.c)
    .sort((a, b) => b.n - a.n);

  const spotCountries = new Set((spots || []).map((s) => s.country_code).filter(Boolean));
  const in30 = evs.filter((e) => e.start_date <= addDays(30)).length;

  const line = (c) => `- [Open water swims in ${c.c.name}](${SITE}/swims/${c.c.slug}): ` +
    `${c.n} upcoming ${c.n === 1 ? 'swim' : 'swims'} with dates, distances and venue water temperature.`;

  const body = `# SwimLoading

> A global calendar of open water swims, and the water temperature for the places they happen.
> ${evs.length} upcoming swims across ${countries.length} countries, ${in30} of them in the next 30 days,
> plus ${(spots || []).length} swim spots in ${spotCountries.size} countries with swimmer-reported water temperatures.

SwimLoading answers two questions a swimmer asks together and most sites answer
separately: *where and when is there a swim*, and *how cold will the water be*.

Water temperature comes from two sources, kept separate and labelled as such:
readings logged by swimmers who were actually in the water, and a marine model
(Open-Meteo sea-surface temperature) for coastal spots. Swimmer readings are
treated as ground truth; the model fills gaps. Pools, lakes, dams and rivers have
no model coverage and are swimmer-reported only.

Events are crawled from organiser sites and national federations, then reviewed by
a person before publishing. A date that could not be read from the source page is
never stored or guessed — an event with an unconfirmed date is held back rather
than published with an invented one.

## Find a swim

- [Swim calendar](${SITE}/explore): every upcoming swim, filterable by country, date and distance. Three kinds — races you enter, escorted crossings you book, and places to swim without an event.
- [List your swim](${SITE}/list-your-swim): organisers add their own event, free and without an account. Reviewed before it appears.

## Swims by country

${countries.slice(0, 25).map(line).join('\n')}

## Bookable crossings

Escorted swims with no fixed date, run when conditions allow.

${(routes || []).slice(0, 15).map((r) => `- [${r.name}](${SITE}/swims/${r.slug})`).join('\n') || '- (none published)'}

## Water temperature and conditions

- [Swim spots](${SITE}/spots): water temperature by location, logged by swimmers.
- [English Channel](${SITE}/crossings/english-channel): water temperature, tides and crossing forecast for the most-swum marathon crossing in the sport.
- [Robben Island](${SITE}/robben): conditions and swim windows for the 7.4 km Cape Town crossing.
- [Crossing intelligence](${SITE}/intel): tides, wind and swimmable-hour forecasting for South African crossings.

## About

- [SwimLoading](${SITE}/): what the platform does and who it is for.
- [Pricing](${SITE}/pricing)

## Notes for machine readers

- Individual events are at ${SITE}/events/{slug} and carry schema.org SportsEvent
  markup with date, location, distances and organiser.
- Country hubs are at ${SITE}/swims/{country-slug}.
- The full URL list is at ${SITE}/sitemap.xml.
- Every count on this page was read from the database on ${today}. Nothing here is
  hand-maintained, so it does not go stale between edits.
`;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(body);
}

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
