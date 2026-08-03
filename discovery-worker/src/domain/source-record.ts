// A single retrieved source page — from a checked-in fixture file (see
// jobs/process-fixture.ts) or a live crawl fetch (see jobs/crawl-source.ts).
// Nothing in this module performs a network fetch itself.
export interface SourceRecord {
  sourceId: string;
  sourceUrl: string;
  // Where the HTML physically came from: a fixture file path, or
  // `live:<url>` for a crawled page.
  fixturePath: string;
  html: string;
  retrievedAt: string;
}

export function makeFixtureSourceRecord(fixturePath: string, html: string, sourceUrl: string): SourceRecord {
  return {
    sourceId: `fixture:${fixturePath}`,
    sourceUrl,
    fixturePath,
    html,
    retrievedAt: new Date().toISOString(),
  };
}

// A live-crawled page. sourceId is the real discovery_sources uuid, so
// the candidate's (source_id, candidate_key) upsert identity works
// without translation at persist time.
export function makeLiveSourceRecord(sourceId: string, sourceUrl: string, html: string): SourceRecord {
  return {
    sourceId,
    sourceUrl,
    fixturePath: `live:${sourceUrl}`,
    html,
    retrievedAt: new Date().toISOString(),
  };
}
