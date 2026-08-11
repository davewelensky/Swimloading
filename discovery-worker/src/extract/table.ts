import * as cheerio from "cheerio";

// Tabular calendar extraction.
//
// A large share of the best sources publish their whole season as one
// HTML table and nothing else — Ray's Notebook carries 338 swims that way,
// with coordinates and start times per row, and Swimchannel Brazil,
// Lopplistan and ows-mikawa are the same shape. None of it is reachable
// by the JSON-LD-then-CSS-selector path, which assumes one event per page.
//
// Deliberately GENERIC rather than a Ray's-Notebook parser: columns are
// mapped by header wording in many languages, so one implementation
// covers every tabular source we have found. Anything it cannot map is
// left null rather than guessed.

export interface TableEventRow {
  dateText: string | null;
  name: string | null;
  locationText: string | null;
  distanceText: string | null;
  timeText: string | null;
  // First same-row link that looks like the event's own page/entry.
  url: string | null;
  latitude: number | null;
  longitude: number | null;
  // The row as extracted, cell by cell, kept verbatim for the evidence
  // trail so a reviewer can see exactly what was read.
  rawCells: Record<string, string>;
}

export interface TableExtractionResult {
  rows: TableEventRow[];
  // Year taken from the page's own heading/title, used to resolve
  // yearless row dates. Null when the page never states one.
  pageYear: number | null;
  warnings: string[];
}

// Header wordings that identify each column, folded and matched as
// substrings. Ordered so more specific words win where a header combines
// several (e.g. "date & time").
const HEADER_MAP: { field: keyof TableEventRow; words: string[] }[] = [
  {
    field: "dateText",
    words: [
      "date",
      "datum",
      "fecha",
      "data",
      "dato",
      "datas",
      "quand",
      "when",
      "termin",
      "tanggal",
      "tarih",
      "pvm",
      "paivamaara",
      "日付",
      "開催日",
    ],
  },
  {
    field: "name",
    words: [
      "name",
      "event",
      "race",
      "swim",
      "nombre",
      "evento",
      "prueba",
      "nom",
      "epreuve",
      "veranstaltung",
      "wettkampf",
      "gara",
      "evenement",
      "wedstrijd",
      "arrangement",
      "lopp",
      "tavling",
      "zawody",
      "nazwa",
      "yarisma",
      "kilpailu",
      "nimi",
      "大会",
      "大会名",
    ],
  },
  {
    field: "locationText",
    words: [
      "location",
      "place",
      "venue",
      "where",
      "lugar",
      "ubicacion",
      "sede",
      "lieu",
      "ort",
      "luogo",
      "plaats",
      "sted",
      "plats",
      "miejsce",
      "yer",
      "paikka",
      "local",
      "会場",
      "開催地",
    ],
  },
  {
    field: "distanceText",
    words: [
      "distance",
      "distancia",
      "distanza",
      "afstand",
      "entfernung",
      "strecke",
      "dystans",
      "mesafe",
      "matka",
      "lange",
      "length",
      "km",
      "距離",
    ],
  },
  {
    field: "timeText",
    words: [
      "time",
      "start",
      "hora",
      "heure",
      "zeit",
      "ora",
      "tijd",
      "tid",
      "godzina",
      "saat",
      "aika",
      "時間",
    ],
  },
];

function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// Visible cell text only. <details> is collapsed supplementary content —
// Ray's Notebook hides the full street address, raw {lat,lon} and three
// map-service links in there, and sweeping it into the cell turned
// "Clearwater, FL" into "Clearwater, FL Lifeguard Tower 5 … -82.828739}
// 🄱 🄶 🄾". Coordinates are still read separately from the row's raw HTML,
// so nothing is lost by ignoring it here.
function cellText($: cheerio.CheerioAPI, el: any): string {
  const clone = $(el).clone();
  clone.find("details, script, style, .latlon, .map_menu").remove();
  return clone.text().replace(/\s+/g, " ").trim();
}

// Coordinates appear either as an explicit "{lat,lon}" span or embedded
// in a map link (Google/Bing/OSM all encode them differently).
function coordsFromRow(html: string): {
  lat: number | null;
  lon: number | null;
} {
  const brace = /\{\s*(-?\d{1,3}\.\d{3,}),\s*(-?\d{1,3}\.\d{3,})\s*\}/.exec(
    html,
  );
  if (brace?.[1] && brace[2])
    return { lat: Number(brace[1]), lon: Number(brace[2]) };

  const q = /[?&](?:q|mlat)=(-?\d{1,3}\.\d{3,})[,&]/.exec(html);
  const qLon = /[?&](?:q=-?\d{1,3}\.\d{3,},|mlon=)(-?\d{1,3}\.\d{3,})/.exec(
    html,
  );
  if (q?.[1] && qLon?.[1]) return { lat: Number(q[1]), lon: Number(qLon[1]) };

  const generic = /(-?\d{1,3}\.\d{4,}),\s?(-?\d{1,3}\.\d{4,})/.exec(html);
  if (generic?.[1] && generic[2])
    return { lat: Number(generic[1]), lon: Number(generic[2]) };
  return { lat: null, lon: null };
}

function validCoords(lat: number | null, lon: number | null): boolean {
  return (
    lat !== null &&
    lon !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

// A four-digit year stated by the page itself (title or first heading).
// Only accepted within a sane window so a street address or a copyright
// line cannot masquerade as a season.
export function pageYearFrom(html: string, now = new Date()): number | null {
  const $ = cheerio.load(html);
  const sources = [
    $("title").text(),
    $("h1").first().text(),
    $("h2").first().text(),
  ];
  const thisYear = now.getUTCFullYear();
  for (const s of sources) {
    for (const m of s.matchAll(/\b(20\d{2})\b/g)) {
      const y = Number(m[1]);
      if (y >= thisYear - 1 && y <= thisYear + 3) return y;
    }
  }
  return null;
}

// Extracts event rows from the largest plausible table on the page.
// Returns an empty row list (never throws) when the page has no table,
// no header row, or no column that reads like a date or a name.
export function extractTableEvents(
  html: string,
  now = new Date(),
): TableExtractionResult {
  const warnings: string[] = [];
  const $ = cheerio.load(html);
  const pageYear = pageYearFrom(html, now);

  const tables = $("table").toArray();
  if (tables.length === 0) return { rows: [], pageYear, warnings };

  // The calendar is the biggest table; navigation and layout tables are
  // small. Sorting by row count avoids hard-coding a selector per site.
  tables.sort((a, b) => $(b).find("tr").length - $(a).find("tr").length);
  const table = tables[0]!;
  const allRows = $(table).find("tr").toArray();
  if (allRows.length < 3)
    return {
      rows: [],
      pageYear,
      warnings: ["Largest table has too few rows to be a calendar"],
    };

  // Header row: the first row with <th>, else the first row whose cells
  // read like headers rather than data.
  const headerRow =
    allRows.find((r) => $(r).find("th").length > 0) ?? allRows[0]!;
  const headerCells = $(headerRow)
    .find("th,td")
    .toArray()
    .map((c) => fold(cellText($, c)));

  const fieldsFor = (cells: string[]): (keyof TableEventRow | null)[] =>
    cells.map((h) => {
      for (const { field, words } of HEADER_MAP) {
        if (words.some((w) => h === fold(w) || h.includes(fold(w))))
          return field;
      }
      return null;
    });

  const columnField: (keyof TableEventRow | null)[] = fieldsFor(headerCells);

  if (!columnField.includes("dateText") && !columnField.includes("name")) {
    return {
      rows: [],
      pageYear,
      warnings: [
        `No date or name column recognised in headers: ${headerCells.join(" | ")}`,
      ],
    };
  }

  // A season published as ONE TABLE PER MONTH is still one calendar.
  // Taking only the biggest table read March and discarded the other
  // eleven — Brazil's 2026 calendar is 12 tables and we saw 22 of its 164
  // rows. Sibling tables are admitted only when their header signature is
  // identical to the calendar's, which is what keeps navigation and
  // layout tables out: those do not carry a date or name column in the
  // same positions.
  const signature = columnField.join(",");
  // `any` for the element type matches cellText() above — cheerio's
  // element type is not exported consistently across versions.
  const sections: Array<{ rows: any[]; header: any; cells: string[] }> = [
    { rows: allRows, header: headerRow, cells: headerCells },
  ];
  for (const other of tables.slice(1)) {
    const otherRows = $(other).find("tr").toArray();
    if (otherRows.length < 2) continue;
    const otherHeader =
      otherRows.find((r) => $(r).find("th").length > 0) ?? otherRows[0]!;
    const otherCells = $(otherHeader)
      .find("th,td")
      .toArray()
      .map((c) => fold(cellText($, c)));
    if (fieldsFor(otherCells).join(",") !== signature) continue;
    sections.push({ rows: otherRows, header: otherHeader, cells: otherCells });
  }
  if (sections.length > 1) {
    warnings.push(
      `Calendar split across ${sections.length} tables with identical headers — all read as one calendar`,
    );
  }

  const rows: TableEventRow[] = [];
  for (const section of sections) {
    for (const tr of section.rows) {
      if (tr === section.header) continue;
      const cells = $(tr).find("td").toArray();
      if (cells.length === 0) continue; // nested header / spacer row

      const row: TableEventRow = {
        dateText: null,
        name: null,
        locationText: null,
        distanceText: null,
        timeText: null,
        url: null,
        latitude: null,
        longitude: null,
        rawCells: {},
      };

      cells.forEach((cell, i) => {
        const text = cellText($, cell);
        const field = columnField[i] ?? null;
        const key = section.cells[i] || `col${i}`;
        if (text) row.rawCells[key] = text;
        if (field && text && row[field] === null) {
          (row as unknown as Record<string, string>)[field] = text;
        }
      });

      // The event's own link: prefer one inside the name cell, else the
      // first non-map link in the row. Map links are location, not entry.
      const nameIdx = columnField.indexOf("name");
      const scope = nameIdx >= 0 && cells[nameIdx] ? $(cells[nameIdx]) : $(tr);
      const href = scope
        .find("a[href]")
        .toArray()
        .map((a) => $(a).attr("href") || "")
        .find(
          (h) =>
            h &&
            !/^#/.test(h) &&
            !/(google\.[a-z.]+\/maps|bing\.com\/maps|openstreetmap\.org)/i.test(
              h,
            ),
        );
      row.url = href || null;

      const { lat, lon } = coordsFromRow($.html(tr));
      if (validCoords(lat, lon)) {
        row.latitude = lat;
        row.longitude = lon;
      }

      // A row earns its place only if it has a name AND something dateish;
      // a name alone is usually a section divider.
      if (row.name && (row.dateText || row.rawCells["date"])) rows.push(row);
    }
  }

  if (rows.length === 0)
    warnings.push("Table matched headers but produced no usable event rows");
  return { rows, pageYear, warnings };
}
