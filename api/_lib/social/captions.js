// Captions built ONLY from a post's facts. Deterministic, so every sentence is traceable.
// The AI step (api/caption-generate.js) is wired in at Stage B-3 to rewrite these in a
// natural voice; its output must pass ungroundedNumbers() before it is accepted.
// House rules: no emojis, no em dashes, 3 to 5 hashtags, Instagram never relies on a clickable link.
import { CATEGORIES } from './config.js';

const F = (post, key) => post.facts.find((f) => f.key === key)?.text;
const utm = (url, campaign) => `${url}${url.includes('?') ? '&' : '?'}utm_source=social&utm_medium=post&utm_campaign=${campaign}`;
const IG_CTA = 'Full details on swimloading.com. Link in bio.';

export function buildCaptions(post) {
  const c = BUILDERS[post.category]?.(post);
  if (!c) throw new Error(`no caption builder for ${post.category}`);
  const camp = post.category.toLowerCase().replace(/[^a-z]+/g, '-');
  return {
    facebook: `${c.body}\n\n${c.fbCta} ${utm(post.sourceUrl, camp)}`,
    instagram: `${c.body}\n\n${IG_CTA}\n\n${c.tags.join(' ')}`,
    hashtags: c.tags,
  };
}

const BUILDERS = {
  [CATEGORIES.SWIM_SPOTLIGHT]: (p) => {
    const opened = F(p, 'opened');
    if (opened) {
      return {
        body: `${F(p, 'name')}, ${F(p, 'area')}. ${opened}.\n\n${F(p, 'headline')}.\n\n- ${F(p, 'fact0')}\n- ${F(p, 'fact1')}\n- ${F(p, 'fact3')}`,
        fbCta: 'More swimming spots, and live water temperatures where we have them:',
        tags: ['#openwaterswimming', '#lido', '#londonswimming', '#swimloading'],
      };
    }
    const region = F(p, 'region');
    return {
      body: `${F(p, 'name')}: ${F(p, 'water_type').toLowerCase()} swimming on the ${region}, ${F(p, 'country')}.\n\nSee the spot, its recent water temperatures and nearby places to swim.`,
      fbCta: 'See the spot on SwimLoading:',
      tags: ['#openwaterswimming', '#capetown', '#swimloading'],
    };
  },
  [CATEGORIES.CROSSING_INTELLIGENCE]: (p) => {
    const obs = F(p, 'observer');
    const tags = p.tags || ['#channelswimming', '#openwaterswimming', '#swimloading'];
    if (p.angle === 'season') return {
      body: `${F(p, 'name')}: when do people swim it?\n\n${F(p, 'season')}.${F(p, 'distance') ? ` Distance: ${F(p, 'distance')}.` : ''}${F(p, 'governing') ? ` ${F(p, 'governing')}.` : ''}\n\nConfirm the current season, rules and requirements with the governing body before you plan.`,
      fbCta: 'Crossing intelligence, conditions and preparation:', tags };
    if (p.angle === 'route') return {
      body: `The ${F(p, 'name')} route.\n\n${F(p, 'route')}, ${F(p, 'distance')}. The line on the map is indicative only; the actual swim path depends on tide and conditions.\n\nConfirm the current rules with the governing body before you plan.`,
      fbCta: 'Crossing intelligence, conditions and preparation:', tags };
    return {
      body: `Planning the ${F(p, 'name')}?\n\n${F(p, 'route') ? `The route runs ${F(p, 'distance')} from ${F(p, 'route')}.` : `The route is ${F(p, 'distance')}.`}\n\n${F(p, 'qualifying')}.${obs ? ` ${obs}.` : ''}\n\nCheck the governing body's current rules before you plan your training.`,
      fbCta: 'Crossing intelligence, conditions and preparation:', tags };
  },
  [CATEGORIES.BEHIND_THE_BRAND]: (p) => F(p, 'claim') ? ({
    body: `${p.partner.name} and SwimLoading.\n\n${F(p, 'claim')}\n\n${F(p, 'range')} ${F(p, 'stock')}`,
    fbCta: `Read more on the ${p.partner.name} partner page:`,
    tags: ['#openwaterswimming', '#swimnutrition', '#swimloading'],
  }) : ({
    body: `${p.partner.name} and SwimLoading.\n\n${F(p, 'blurb')}`,
    fbCta: `Read more on the ${p.partner.name} partner page:`,
    tags: ['#openwaterswimming', '#swimloading'],
  }),
  [CATEGORIES.DISCOVERS]: (p) => ({
    body: `Outdoor swimming ${p.regionPrep || 'around'} ${p.region}: three places to start.\n\n${p.spots.map((s) => `- ${s.name}: ${s.type}${s.area ? `, ${s.area}` : ''}`).join('\n')}`,
    fbCta: `Every ${p.region} swimming spot we list:`,
    tags: p.tags || ['#wildswimming', '#openwaterswimming', '#swimloading'],
  }),
  [CATEGORIES.OPEN_WATER_INTEL]: (p) => ({
    body: `Measured water temperatures, ${p.asOf}.\n\n${p.readings.map((r) => `- ${r.spot}, ${r.place}: ${r.temp}. ${r.source}, ${r.station}, observed ${r.observed}.`).join('\n')}\n\nThese are readings from monitoring stations near each spot, not forecasts. Conditions change by the hour and by the tide.`,
    fbCta: 'Spot pages with recent water temperatures:',
    tags: ['#openwaterswimming', '#watertemperature', '#swimloading'],
  }),
  [CATEGORIES.THIS_WEEK]: (p) => ({
    body: `${p.windowDays === 7 ? 'This week in open water' : `Coming up in open water, next ${p.windowDays} days`}: ${p.events.length} listed swims.\n\n${p.events.map((e) => `- ${e.date}: ${e.title}, ${e.place}${e.distance ? ` (${e.distance})` : ''}`).join('\n')}\n\nListed on SwimLoading Explore. Check each organiser's page for dates, entry and conditions before you travel.`,
    fbCta: 'Browse every listed swim:',
    tags: ['#openwaterswimming', '#swimevents', '#swimloading'],
  }),
};
