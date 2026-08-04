#!/usr/bin/env python3
"""
Build a per-venue seasonal water-temperature climatology from Copernicus
Marine reanalysis, and write it to venue_water_climatology.

WHY THIS EXISTS
---------------
Today SwimLoading can answer "how warm is the water right now" (Open-Meteo
Marine, every 6h) and nothing else. That is a fair guide to next weekend and
useless for the question people actually plan travel around: "what will the
water be like at this swim in March?"

A climatology answers it honestly — not a forecast, but "here is what this
water has typically done in this week of the year, across N years".

WHY IT IS A SCRIPT AND NOT A SERVICE
------------------------------------
A climatology is computed once from decades of history and refreshed
yearly. That is a completely different lifecycle from the 6-hourly cron, so
there is nothing to deploy, host, monitor or pay for. Run it locally when
the venue list has grown enough to be worth re-running.

It is also Python, because the Copernicus toolbox is; the discovery worker
is TypeScript and this deliberately does not live inside it.

WHAT IT DOES NOT DO
-------------------
Copernicus SST products are SEA surface temperature: ocean and sea only, at
a 0.05 degree (~5.5 km) grid. Lakes, dams and rivers get nothing, exactly as
they get nothing from Open-Meteo today. This makes coastal venues
answerable for ANY date; it does not widen coverage. Venues off the grid are
reported at the end, not silently skipped.

It also does not replace the current-temperature cron. The reprocessed
product ends 31 March 2026 by design — it is history, not news.

SETUP
-----
    pip install copernicusmarine

    export COPERNICUSMARINE_SERVICE_USERNAME=...   # your Copernicus login
    export COPERNICUSMARINE_SERVICE_PASSWORD=...
    export SUPABASE_URL=https://<project-ref>.supabase.co
    export SUPABASE_SERVICE_KEY=...               # server-side only, never committed

USAGE
-----
    # 0. Optional — the dataset id and variable below were read off the
    #    catalogue on 2026-08-04. Re-run this if a new version appears.
    #    Needs no credentials: the catalogue is public.
    python scripts/copernicus-climatology.py --describe

    # 1. One venue, nothing written — proves the whole chain cheaply.
    python scripts/copernicus-climatology.py --limit 1 --dry-run

    # 2. A handful, written.
    python scripts/copernicus-climatology.py --limit 5

    # 3. Everything.
    python scripts/copernicus-climatology.py
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import statistics
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime
from typing import Iterable

# ── Configuration ────────────────────────────────────────────────────────

# OSTIA reprocessed L4: daily, gap-free, 0.05 degrees, 1 Oct 1981 to
# 31 Mar 2026. This is the PRODUCT id; the dataset id passed to subset()
# lives inside it and is NOT the same string — run --describe and set
# DATASET_ID from what it prints. Deliberately left as the product id so a
# wrong guess fails loudly instead of silently fetching something else.
PRODUCT_ID = "SST_GLO_SST_L4_REP_OBSERVATIONS_010_011"

# Read off the live catalogue with --describe on 2026-08-04, not guessed:
#   dataset_id  METOFFICE-GLO-SST-L4-REP-OBS-SST   (version 202003)
#   analysed_sst  units='kelvin'  sea_surface_foundation_temperature
#   time  1981-10-01 .. 2026-03-31, daily
# The units line is why to_celsius() exists — this product really does
# publish Kelvin, so a naive read would put every swim at ~290 degrees.
# Re-run --describe if a new product version appears; both are overridable
# from the environment so that never needs a code change.
DATASET_ID = os.environ.get("COPERNICUS_DATASET_ID", "METOFFICE-GLO-SST-L4-REP-OBS-SST")
VARIABLE = os.environ.get("COPERNICUS_SST_VARIABLE", "analysed_sst")

# The most recent 20 full years, not a 1981-2010 normal. Comfortably inside
# the product's 1981-10-01..2026-03-31 range. The ocean has warmed
# measurably over the record, so an older baseline would systematically
# understate what a swimmer will actually meet. Twenty years is long enough
# for the seasonal shape and recent enough to still describe today's sea.
BASELINE_START = int(os.environ.get("COPERNICUS_BASELINE_START", "2006"))
BASELINE_END = int(os.environ.get("COPERNICUS_BASELINE_END", "2025"))

# Half-width of the box requested around each venue, in degrees. One grid
# cell is 0.05, so this asks for roughly a 3x3 neighbourhood: enough that a
# venue sitting just inside a coastline still finds water, small enough that
# the average still describes that beach rather than the open ocean.
BOX = 0.06

# A week with fewer years behind it than this is not a climatology, it is an
# anecdote. Recorded rather than published.
MIN_YEARS = 5


# ── Small helpers ────────────────────────────────────────────────────────

def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(
            f"{name} is not set.\n"
            f"  This script reads every credential from the environment and never stores one.\n"
            f"  See the SETUP section at the top of this file."
        )
    return value


def supabase(path: str, *, method: str = "GET", body: object = None) -> list[dict]:
    """Minimal PostgREST call. Deliberately stdlib-only — this is a one-off
    script and a dependency list is a maintenance cost with no payoff."""
    url = f"{env('SUPABASE_URL').rstrip('/')}/rest/v1/{path}"
    key = env("SUPABASE_SERVICE_KEY")
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    if method in ("POST", "PATCH"):
        # merge-duplicates makes the write idempotent: re-running the script
        # updates each venue-week in place rather than accumulating rows.
        req.add_header("Prefer", "resolution=merge-duplicates,return=minimal")
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode().strip()
            return json.loads(raw) if raw else []
    except urllib.error.HTTPError as e:
        sys.exit(f"Supabase {method} {path} failed: {e.code} {e.read().decode()[:400]}")


def week_of_year(d: date) -> int:
    """1..52, with the final week absorbing the leftover days.

    Deliberately not ISO weeks: those slide against the calendar year and
    would put "mid-August" in a different bucket depending on the year,
    which is the one thing a seasonal average must not do.
    """
    return min(52, (d.timetuple().tm_yday - 1) // 7 + 1)


def to_celsius(value: float) -> float:
    """OSTIA publishes Kelvin. Detected rather than assumed, because a
    silent 273-degree error would be obvious, and a silent unit change in a
    future product version would not."""
    return value - 273.15 if value > 200 else value


# ── The work ─────────────────────────────────────────────────────────────

def fetch_venues(limit: int | None) -> list[dict]:
    """Venues worth asking about: they have coordinates and they host an
    edition that has not already happened."""
    rows = supabase(
        "event_venues?select=id,display_name,latitude,longitude"
        "&latitude=not.is.null&longitude=not.is.null&order=display_name"
    )
    return rows[:limit] if limit else rows


def subset_venue(cm, venue: dict, out_dir: str) -> str | None:
    """Download this venue's daily SST history as CSV. Returns the path, or
    None when the venue is not on the marine grid (inland, or up an estuary
    the model does not resolve) — which is an expected outcome, not an error."""
    lat, lon = float(venue["latitude"]), float(venue["longitude"])
    name = f"{venue['id']}.csv"
    try:
        cm.subset(
            dataset_id=DATASET_ID,
            variables=[VARIABLE],
            minimum_longitude=lon - BOX,
            maximum_longitude=lon + BOX,
            minimum_latitude=lat - BOX,
            maximum_latitude=lat + BOX,
            start_datetime=f"{BASELINE_START}-01-01T00:00:00",
            end_datetime=f"{BASELINE_END}-12-31T23:59:59",
            output_filename=name,
            output_directory=out_dir,
            file_format="csv",
            overwrite=True,
        )
    except Exception as e:  # noqa: BLE001 - the toolbox raises many types
        print(f"    no data ({type(e).__name__}: {str(e)[:90]})")
        return None
    path = os.path.join(out_dir, name)
    return path if os.path.exists(path) else None


def climatology_from_csv(path: str) -> list[dict]:
    """Daily values -> one row per week of the year.

    Averages across the grid cells in the box first (so a single cell's
    quirk cannot dominate), then across years.
    """
    by_week: dict[int, list[float]] = defaultdict(list)
    years_by_week: dict[int, set[int]] = defaultdict(set)

    with open(path, newline="") as fh:
        for row in csv.DictReader(fh):
            raw = row.get(VARIABLE) or row.get("value")
            stamp = row.get("time") or row.get("date")
            if not raw or not stamp:
                continue
            try:
                celsius = to_celsius(float(raw))
                when = datetime.fromisoformat(stamp.replace("Z", "+00:00")).date()
            except (ValueError, TypeError):
                continue
            # Sea ice and land mask edges come through as absurd values.
            if not (-3.0 <= celsius <= 45.0):
                continue
            w = week_of_year(when)
            by_week[w].append(celsius)
            years_by_week[w].add(when.year)

    out = []
    for week, values in sorted(by_week.items()):
        years = len(years_by_week[week])
        if years < MIN_YEARS or len(values) < 2:
            continue
        ordered = sorted(values)
        out.append(
            {
                "week_of_year": week,
                "mean_c": round(statistics.fmean(values), 1),
                "min_c": round(ordered[0], 1),
                "max_c": round(ordered[-1], 1),
                # p10/p90 rather than the extremes for the headline range:
                # one freak day should not widen what we tell a swimmer to
                # expect, but it should still be visible in min/max.
                "p10_c": round(ordered[int(len(ordered) * 0.10)], 1),
                "p90_c": round(ordered[int(len(ordered) * 0.90)], 1),
                "years_observed": years,
                "sample_days": len(values),
            }
        )
    return out


def write_climatology(venue_id: str, rows: Iterable[dict], dry_run: bool) -> int:
    payload = [
        {
            "venue_id": venue_id,
            "source": "copernicus",
            "baseline_start_year": BASELINE_START,
            "baseline_end_year": BASELINE_END,
            **row,
        }
        for row in rows
    ]
    if not payload:
        return 0
    if dry_run:
        sample = payload[len(payload) // 2]
        print(
            f"    dry run: {len(payload)} weeks; mid-year week {sample['week_of_year']} "
            f"= {sample['mean_c']}C ({sample['p10_c']}-{sample['p90_c']}), "
            f"{sample['years_observed']} years"
        )
        return len(payload)
    supabase("venue_water_climatology?on_conflict=venue_id,week_of_year,source",
             method="POST", body=payload)
    return len(payload)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--describe", action="store_true",
                    help="print the product's datasets and variables, then exit — run this first")
    ap.add_argument("--limit", type=int, default=None, help="only process the first N venues")
    ap.add_argument("--dry-run", action="store_true", help="compute everything, write nothing")
    args = ap.parse_args()

    try:
        import copernicusmarine as cm
    except ImportError:
        sys.exit("copernicusmarine is not installed.  pip install copernicusmarine")

    if args.describe:
        # The dataset id passed to subset() is NOT the product id, and the
        # variable name is not guessable either. Read both off the
        # catalogue rather than trusting the constants above.
        info = cm.describe(product_id=PRODUCT_ID)
        print(json.dumps(info, indent=2, default=str)[:6000])
        print("\nSet COPERNICUS_DATASET_ID (and COPERNICUS_SST_VARIABLE if it "
              "is not 'analysed_sst') from the output above.")
        return

    # Credentials are needed to DOWNLOAD, not to read the catalogue — so
    # --describe above works with nothing set up at all.
    env("COPERNICUSMARINE_SERVICE_USERNAME")
    env("COPERNICUSMARINE_SERVICE_PASSWORD")

    venues = fetch_venues(args.limit)
    print(f"{len(venues)} venue(s) with coordinates; baseline {BASELINE_START}-{BASELINE_END}\n")

    covered, uncovered, weeks_written = 0, [], 0
    with tempfile.TemporaryDirectory() as tmp:
        for i, v in enumerate(venues, 1):
            print(f"[{i}/{len(venues)}] {v['display_name']}")
            path = subset_venue(cm, v, tmp)
            if not path:
                uncovered.append(v["display_name"])
                continue
            rows = climatology_from_csv(path)
            if not rows:
                print(f"    on the grid but too few years to be a climatology")
                uncovered.append(v["display_name"])
                continue
            weeks_written += write_climatology(v["id"], rows, args.dry_run)
            covered += 1
            os.remove(path)

    print(f"\n{covered} venue(s) with a climatology, {weeks_written} venue-weeks "
          f"{'computed' if args.dry_run else 'written'}")
    if uncovered:
        # Named, not counted. These are the lakes, dams and rivers the marine
        # model does not cover — the same venues that show nothing today. If
        # a coastal venue appears here it is worth investigating.
        print(f"\n{len(uncovered)} venue(s) with no marine coverage:")
        for n in uncovered[:40]:
            print(f"  - {n}")
        if len(uncovered) > 40:
            print(f"  ... and {len(uncovered) - 40} more")


if __name__ == "__main__":
    main()
