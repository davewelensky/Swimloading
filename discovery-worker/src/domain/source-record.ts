// A single retrieved source page. In this phase every SourceRecord comes
// from a checked-in fixture file (see jobs/process-fixture.ts) — nothing
// here performs or implies a network fetch.
export interface SourceRecord {
  sourceId: string;
  sourceUrl: string;
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
