import * as cheerio from 'cheerio';

// Loosely-typed — schema.org JSON-LD is not validated against a schema by
// publishers in practice, so every field here is optional/unknown-shaped
// on purpose. normalize/event.ts is responsible for turning this into the
// strict CandidateEvent shape.
export interface JsonLdPlace {
  name?: unknown;
  address?: {
    streetAddress?: unknown;
    addressLocality?: unknown;
    addressRegion?: unknown;
    addressCountry?: unknown;
  };
  geo?: {
    latitude?: unknown;
    longitude?: unknown;
  };
}

export interface JsonLdOrganizer {
  name?: unknown;
  url?: unknown;
}

export interface JsonLdOffer {
  url?: unknown;
  name?: unknown;
  category?: unknown;
}

export interface JsonLdEventNode {
  '@type'?: unknown;
  '@id'?: unknown;
  name?: unknown;
  url?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  eventStatus?: unknown;
  description?: unknown;
  location?: unknown;
  organizer?: unknown;
  offers?: unknown;
  [key: string]: unknown;
}

export interface JsonLdExtractionResult {
  events: JsonLdEventNode[];
  warnings: string[];
}

const EVENT_TYPE_NAMES = new Set(['Event', 'SportsEvent']);

function typeMatchesEvent(typeValue: unknown): boolean {
  if (typeof typeValue === 'string') return EVENT_TYPE_NAMES.has(typeValue);
  if (Array.isArray(typeValue)) return typeValue.some((t) => typeof t === 'string' && EVENT_TYPE_NAMES.has(t));
  return false;
}

// Flattens one parsed JSON-LD value (which may be a single node, an array
// of nodes, or a node with an @graph array) into a flat list of nodes.
function flattenNodes(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed.flatMap((entry) => flattenNodes(entry));
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj['@graph'])) {
      return (obj['@graph'] as unknown[]).flatMap((entry) => flattenNodes(entry));
    }
    return [obj];
  }
  return [];
}

// Resolves an inline-or-by-reference property (schema.org allows
// `"location": {"@id": "#venue"}` pointing at a sibling node in the same
// @graph, or a fully inline object). Only handles the shapes our fixtures
// exercise — this is deliberately not a general JSON-LD/RDF processor.
function resolveRef(value: unknown, allNodes: Record<string, unknown>[]): unknown {
  if (value && typeof value === 'object' && '@id' in (value as Record<string, unknown>)) {
    const id = (value as Record<string, unknown>)['@id'];
    const match = allNodes.find((n) => n['@id'] === id);
    return match ?? value;
  }
  return value;
}

export function extractJsonLd(html: string): JsonLdExtractionResult {
  const $ = cheerio.load(html);
  const warnings: string[] = [];
  const allNodes: Record<string, unknown>[] = [];

  const scripts = $('script[type="application/ld+json"]');
  scripts.each((i, el) => {
    const text = $(el).contents().text();
    if (!text || !text.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      warnings.push(`Malformed JSON-LD in script block ${i}: ${message}`);
      return;
    }
    for (const node of flattenNodes(parsed)) {
      if (node && typeof node === 'object') allNodes.push(node as Record<string, unknown>);
    }
  });

  const events = allNodes
    .filter((node) => typeMatchesEvent(node['@type']))
    .map((node) => {
      const resolved: JsonLdEventNode = { ...node };
      if ('location' in node) resolved.location = resolveRef(node.location, allNodes);
      if ('organizer' in node) resolved.organizer = resolveRef(node.organizer, allNodes);
      return resolved;
    });

  if (scripts.length === 0) {
    warnings.push('No application/ld+json script blocks found on the page');
  } else if (events.length === 0 && warnings.length === 0) {
    warnings.push('JSON-LD present but no Event or SportsEvent node found');
  }

  return { events, warnings };
}
