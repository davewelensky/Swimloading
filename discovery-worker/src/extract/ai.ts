import * as cheerio from 'cheerio';

// AI-assisted extraction — the LAST resort, and deliberately the smallest
// possible job.
//
// Everything before this in the pipeline is deterministic: JSON-LD, then
// a tabular-calendar parser, then fixed CSS selectors, then a headless
// render and another go at all three. That covers structured sources.
// What it cannot read is the most common shape in the world's swim
// calendars — an ordinary HTML list, one <div> per race, dates in prose,
// no schema.org, no <table>. 32 of the 36 sources seeded on 2026-08-04
// fetched perfectly (HTTP 200, real content) and produced zero candidates
// for exactly that reason.
//
// So the model is given ONE narrow job: read a page and copy what it says
// into columns. It does not decide whether something is an open-water
// swim, it does not resolve a year, it does not parse a distance, and it
// never produces a confidence score. Its output is fed into the SAME
// deterministic path a real HTML table takes (process-table-page's
// buildFromRow), so every downstream fact — weekday-verified dates,
// subdivision-aware locations, distance parsing, classification, scoring
// — is computed by the same rule-based code that has always computed it.
//
// That boundary is the point. A model reading text off a page is doing
// something it is reliable at. A model asserting "this swim is on the
// 14th and I'm 82% sure" is something we will not build.

export interface AiEventRow {
  name: string | null;
  dateText: string | null;
  locationText: string | null;
  distanceText: string | null;
  timeText: string | null;
  url: string | null;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface AiExtractionResult {
  // Rows that survived the minimum-evidence filter below.
  rows: AiEventRow[];
  // How many the model actually returned, before filtering. Kept separate
  // so "the model returned 40 rows and 3 were usable" stays visible —
  // that gap is the signal that a prompt or a source needs attention.
  rowsReturned: number;
  usage: AiUsage | null;
  model: string | null;
  condensedChars: number;
  truncated: boolean;
  warnings: string[];
}

// ─────────────────────────── condensing ────────────────────────────────
//
// Raw HTML is mostly not content. Measured across ten of the silent
// sources on 2026-08-04: median 109 KB of markup carrying 6 KB of visible
// text. Sending the markup would cost roughly twelve times as much for no
// extra information, so the page is reduced to its readable text plus the
// one piece of markup that carries a fact the text does not — the href
// behind a link, which is how an event row points at its own page.

const DROP_SELECTORS = [
  'script',
  'style',
  'noscript',
  'svg',
  'iframe',
  'template',
  'head',
  'nav',
  'header',
  'footer',
  'form',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[aria-hidden="true"]',
].join(', ');

export interface CondenseOptions {
  // Hard ceiling on what is sent to the model. A page over this is
  // truncated rather than dropped: a calendar's events are near the top
  // far more often than not, and half a calendar beats none. Truncation
  // is always reported so it can never be mistaken for full coverage.
  maxChars?: number;
}

export interface CondensedPage {
  text: string;
  originalChars: number;
  condensedChars: number;
  truncated: boolean;
}

// Blocks whose text should stand alone on a line. Anything else is
// inlined into its parent, so "5 km" inside a <span> does not become its
// own orphaned line divorced from the race it belongs to.
const BLOCK_TAGS = new Set([
  'p', 'div', 'li', 'tr', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'td', 'th', 'dd', 'dt', 'figcaption', 'blockquote', 'summary',
]);

export function condenseForAi(html: string, options: CondenseOptions = {}): CondensedPage {
  const maxChars = options.maxChars ?? 60_000;
  const $ = cheerio.load(html);
  $(DROP_SELECTORS).remove();

  const lines: string[] = [];
  const isBlock = (node: any): boolean => BLOCK_TAGS.has(String(node?.tagName ?? node?.name ?? '').toLowerCase());

  // Walk the tree, emitting one line per block that has its own text.
  // A block whose text comes entirely from block children emits nothing
  // itself, which is what stops a deeply nested layout from repeating the
  // whole page once per wrapper <div>.
  function walk(node: any): void {
    if (!node?.tagName && !node?.name) return;
    const $el = $(node);
    const blockChildren = $el.children().toArray().filter(isBlock);

    let ownText: string;
    if (blockChildren.length === 0) {
      ownText = $el.text().replace(/\s+/g, ' ').trim();
    } else {
      const clone = $el.clone();
      clone.children().each((_i, c) => {
        if (isBlock(c)) $(c).remove();
      });
      ownText = clone.text().replace(/\s+/g, ' ').trim();
    }

    if (ownText) {
      // The href of the first link in this block, resolved against the
      // page URL downstream. This is the only attribute kept — it is a
      // fact about the event (where to enter), not styling.
      const href = $el.find('a[href]').first().attr('href') ?? $el.closest('a[href]').attr('href');
      lines.push(href ? `${ownText}  [${href}]` : ownText);
    }

    for (const child of blockChildren) walk(child);
  }

  let rootNodes: any[];
  if ($('body').length > 0) rootNodes = $('body').children().toArray();
  else rootNodes = $.root().children().toArray();
  for (const node of rootNodes) walk(node);

  // Collapse consecutive duplicates — repeated menu labels and the like
  // survive the structural drop above on plenty of real sites.
  const deduped: string[] = [];
  for (const line of lines) {
    if (line.length < 2) continue;
    if (deduped[deduped.length - 1] === line) continue;
    deduped.push(line);
  }

  const joined = deduped.join('\n');
  const truncated = joined.length > maxChars;
  return {
    text: truncated ? joined.slice(0, maxChars) : joined,
    originalChars: html.length,
    condensedChars: Math.min(joined.length, maxChars),
    truncated,
  };
}

// ───────────────────────────── the model ───────────────────────────────

// Injectable so the pipeline is testable without a network call or an API
// key, exactly like CrawlPorts. A test supplies a fake that returns fixed
// rows; production supplies the Anthropic client below.
export interface AiModelPort {
  extractRows(input: {
    pageText: string;
    pageUrl: string;
    countryHint: string | null;
  }): Promise<{ rows: AiEventRow[]; usage: AiUsage | null; model: string | null }>;
}

export const AI_SYSTEM_PROMPT = [
  'You read one web page and copy what it says about swimming events into rows. You are a transcriber, not an analyst.',
  '',
  'Rules, in order of importance:',
  '1. Copy text VERBATIM from the page. Never translate, reformat, correct, or tidy it. A Finnish date stays Finnish; "12.7." stays "12.7.".',
  '2. If the page does not state something, the field is null. Never infer it, never carry it over from another row, never supply a default.',
  '3. Never add a year the page does not print. A date column reading "Sat 14 Feb" must be copied as "Sat 14 Feb" — the year is resolved downstream against the weekday, and a year you invent would defeat that check.',
  '4. One row per distinct event. If one event lists several distances, that is ONE row with the distances together in distanceText.',
  '5. Do not judge whether an event qualifies as open-water swimming, and do not filter on that basis. Include pool galas, triathlons and past events if the page lists them; a separate classifier decides what to keep.',
  '6. If the page is not an event listing at all — a homepage, an article, a results archive with no forthcoming dates — return an empty list. An empty list is a correct and useful answer.',
  '',
  'The page text you receive is the readable text of the page, one block per line, with any link target in square brackets at the end of the line.',
].join('\n');

export const AI_ROW_SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      description: 'One entry per distinct event listed on the page. Empty when the page lists none.',
      items: {
        type: 'object',
        properties: {
          name: { type: ['string', 'null'], description: 'The event name exactly as printed.' },
          dateText: { type: ['string', 'null'], description: 'The date exactly as printed, including any weekday. Never add a year.' },
          locationText: { type: ['string', 'null'], description: 'The place exactly as printed.' },
          distanceText: { type: ['string', 'null'], description: 'All distances for this event exactly as printed, e.g. "1.5 km, 3 km, 5 km".' },
          timeText: { type: ['string', 'null'], description: 'Start time exactly as printed.' },
          url: { type: ['string', 'null'], description: "The link target for this event's own page, copied from the square brackets. Null if none." },
        },
        required: ['name', 'dateText', 'locationText', 'distanceText', 'timeText', 'url'],
        additionalProperties: false,
      },
    },
  },
  required: ['events'],
  additionalProperties: false,
} as const;

export function buildUserPrompt(pageText: string, pageUrl: string, countryHint: string | null): string {
  return [
    `Page URL: ${pageUrl}`,
    countryHint
      ? `The site that published this page covers ${countryHint}. Use that only to read ambiguous place names; never put it in a field the page does not state.`
      : '',
    '',
    'Page text:',
    '---',
    pageText,
    '---',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface AnthropicExtractorOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

// Lazily imports the SDK so a worker with AI disabled never loads it —
// same pattern as the Playwright renderer.
export function createAnthropicExtractor(options: AnthropicExtractorOptions = {}): AiModelPort {
  const model = options.model ?? 'claude-opus-5';
  // Extraction is transcription, not reasoning. Low effort is markedly
  // cheaper and, on this task, no worse — but thinking stays ON (its
  // default on this model): with thinking disabled the model has a known
  // habit of leaking internal tags into its output, which is exactly the
  // wrong failure mode when the output is parsed as data.
  const effort = options.effort ?? 'low';
  const maxTokens = options.maxTokens ?? 16_000;

  return {
    async extractRows({ pageText, pageUrl, countryHint }) {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});

      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: AI_SYSTEM_PROMPT,
        output_config: {
          effort,
          format: { type: 'json_schema', schema: AI_ROW_SCHEMA as unknown as Record<string, unknown> },
        },
        messages: [{ role: 'user', content: buildUserPrompt(pageText, pageUrl, countryHint) }],
      } as never);

      const usage: AiUsage = {
        inputTokens: (response as any).usage?.input_tokens ?? 0,
        outputTokens: (response as any).usage?.output_tokens ?? 0,
        cacheReadInputTokens: (response as any).usage?.cache_read_input_tokens ?? 0,
        cacheCreationInputTokens: (response as any).usage?.cache_creation_input_tokens ?? 0,
      };

      // A refusal is a successful HTTP response with no content — read
      // stop_reason before touching content, or this throws on a page
      // that tripped a safety classifier.
      if ((response as any).stop_reason === 'refusal') {
        return { rows: [], usage, model };
      }

      const textBlock = ((response as any).content ?? []).find((b: any) => b.type === 'text');
      if (!textBlock?.text) return { rows: [], usage, model };

      let parsed: unknown;
      try {
        parsed = JSON.parse(textBlock.text);
      } catch {
        return { rows: [], usage, model };
      }
      const events = (parsed as { events?: unknown })?.events;
      if (!Array.isArray(events)) return { rows: [], usage, model };

      return { rows: events as AiEventRow[], usage, model };
    },
  };
}

// ──────────────────────────── the caller ───────────────────────────────

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// A row is only usable if it has a name AND something that anchors it in
// time or space. Structured output guarantees the SHAPE of what comes
// back, never the truth of it, so the same minimum-evidence bar the rest
// of the pipeline applies is applied here too.
function usable(row: AiEventRow): boolean {
  return nonEmpty(row.name) !== null && (nonEmpty(row.dateText) !== null || nonEmpty(row.locationText) !== null);
}

export async function extractEventsWithAi(
  html: string,
  pageUrl: string,
  countryHint: string | null,
  port: AiModelPort,
  condenseOptions: CondenseOptions = {}
): Promise<AiExtractionResult> {
  const warnings: string[] = [];
  const condensed = condenseForAi(html, condenseOptions);

  // Below this there is no page worth paying for. A JavaScript-rendered
  // shell condenses to a few hundred characters of chrome; sending it
  // spends money to be told there is nothing there. Those pages need the
  // headless renderer, which runs before this.
  if (condensed.condensedChars < 400) {
    return {
      rows: [],
      rowsReturned: 0,
      usage: null,
      model: null,
      condensedChars: condensed.condensedChars,
      truncated: false,
      warnings: [`Page condensed to ${condensed.condensedChars} characters — too thin to be an event listing; no AI call made`],
    };
  }
  if (condensed.truncated) {
    warnings.push(
      `Page was longer than the AI input budget and was truncated to ${condensed.condensedChars} characters — events past that point were not seen this run`
    );
  }

  const { rows, usage, model } = await port.extractRows({
    pageText: condensed.text,
    pageUrl,
    countryHint,
  });

  const cleaned: AiEventRow[] = [];
  let discarded = 0;
  for (const row of rows) {
    const normalised: AiEventRow = {
      name: nonEmpty(row?.name),
      dateText: nonEmpty(row?.dateText),
      locationText: nonEmpty(row?.locationText),
      distanceText: nonEmpty(row?.distanceText),
      timeText: nonEmpty(row?.timeText),
      url: nonEmpty(row?.url),
    };
    if (!usable(normalised)) {
      discarded++;
      continue;
    }
    cleaned.push(normalised);
  }
  if (discarded > 0) {
    warnings.push(`${discarded} AI row(s) discarded for having no name, or neither a date nor a location`);
  }

  return {
    rows: cleaned,
    rowsReturned: rows.length,
    usage,
    model,
    condensedChars: condensed.condensedChars,
    truncated: condensed.truncated,
    warnings,
  };
}
