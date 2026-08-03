import * as cheerio from 'cheerio';

export interface HtmlDistanceRaw {
  label: string;
  distanceAttr: string | null;
  startTime: string | null;
  wetsuit: string | null;
  registrationUrl: string | null;
  qualificationRequired: string | null;
}

// Everything the deterministic HTML fallback can pull from a fixture page
// using fixed selectors — never a generic "read all text" heuristic. Real
// organiser markup varies far more than this; this phase's job is proving
// the pipeline shape, not a general-purpose scraper (see README "what is
// deliberately not implemented").
export interface HtmlExtractionResult {
  titleText: string | null;
  descriptionText: string | null;
  dateText: string | null;
  locationText: string | null;
  venueName: string | null;
  organiserName: string | null;
  officialUrl: string | null;
  registrationUrl: string | null;
  statusText: string | null;
  waterBodyHint: string | null;
  categoryHint: string | null;
  eventWetsuitPolicy: string | null;
  hasSeparateSwimEntry: boolean | null;
  distances: HtmlDistanceRaw[];
  warnings: string[];
}

function textOrNull($el: cheerio.Cheerio<any>): string | null {
  const t = $el.first().text().trim();
  return t.length > 0 ? t : null;
}

function attrOrNull($el: cheerio.Cheerio<any>, name: string): string | null {
  const v = $el.first().attr(name);
  return v !== undefined && v.trim().length > 0 ? v.trim() : null;
}

export function extractHtml(html: string): HtmlExtractionResult {
  const $ = cheerio.load(html);
  const warnings: string[] = [];

  const titleText = textOrNull($('.event-title')) ?? textOrNull($('h1')) ?? textOrNull($('title'));
  const descriptionText =
    attrOrNull($('meta[name="description"]'), 'content') ?? textOrNull($('.event-description'));
  const dateText = textOrNull($('.event-date'));
  const locationText = textOrNull($('.event-location'));
  const venueName = textOrNull($('.venue-name'));
  const organiserName = textOrNull($('.organiser'));
  const officialUrl = attrOrNull($('a.official-link'), 'href');
  const registrationUrl = attrOrNull($('a.registration-link'), 'href');
  const statusText = attrOrNull($('.event-status'), 'data-status') ?? textOrNull($('.event-status'));
  const waterBodyHint = attrOrNull($('.water-body'), 'data-type');
  const categoryHint = attrOrNull($('.category-hint'), 'data-category');
  const eventWetsuitPolicy = attrOrNull($('.event-wetsuit'), 'data-policy');
  const separateSwimAttr = attrOrNull($('.category-hint'), 'data-separate-swim-entry');
  const hasSeparateSwimEntry = separateSwimAttr === null ? null : separateSwimAttr === 'true';

  const distances: HtmlDistanceRaw[] = [];
  $('.distance-options li[data-distance]').each((_i, el) => {
    const $el = $(el);
    const label = $el.text().trim();
    if (!label) {
      warnings.push('Skipped a .distance-options entry with no visible label');
      return;
    }
    distances.push({
      label,
      distanceAttr: attrOrNull($el, 'data-distance'),
      startTime: attrOrNull($el, 'data-start-time'),
      wetsuit: attrOrNull($el, 'data-wetsuit'),
      registrationUrl: attrOrNull($el, 'data-registration-url'),
      qualificationRequired: attrOrNull($el, 'data-qualification-required'),
    });
  });

  if (!titleText) warnings.push('No title found via .event-title, h1, or <title>');

  return {
    titleText,
    descriptionText,
    dateText,
    locationText,
    venueName,
    organiserName,
    officialUrl,
    registrationUrl,
    statusText,
    waterBodyHint,
    categoryHint,
    eventWetsuitPolicy,
    hasSeparateSwimEntry,
    distances,
    warnings,
  };
}
