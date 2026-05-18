#!/usr/bin/env python3
"""
Import swim sets from Britt's weekly Excel files into SwimLoading.

Usage:
    python3 scripts/import_swim_sets.py <file.xlsx> <squad_name> [--slot AM|PM] [--pool SCM|LCM]

Examples:
    python3 scripts/import_swim_sets.py "11 to 15 May Seniors.xlsx" "Senior Squad"
    python3 scripts/import_swim_sets.py "4 to 8 May 2026.xlsx" "Intermediate" --slot PM

Outputs SQL ready to paste into Supabase or apply via MCP.
"""

import sys
import re
import uuid
import argparse
from datetime import datetime, date as date_type
from pathlib import Path

import openpyxl

# ── Club constants ────────────────────────────────────────────────────────────
CLUB_ID    = '385e2c9d-b32e-47d1-bb1d-1e042523de23'
CREATED_BY = '7ade0520-0cf0-4dfb-8275-f053a17a836c'  # Britt

SQUAD_IDS = {
    'masters':           'a1000001-0000-0000-0000-000000000001',
    'learn to swim':     'a1000001-0000-0000-0000-000000000002',
    'bronze':            'a1000001-0000-0000-0000-000000000003',
    'silver':            'a1000001-0000-0000-0000-000000000004',
    'gold':              'a1000001-0000-0000-0000-000000000005',
    'intermediate':      'a1000001-0000-0000-0000-000000000006',
    'junior':            'a1000001-0000-0000-0000-000000000006',
    'senior':            'a1000001-0000-0000-0000-000000000007',
}

# ── Normalisation maps ────────────────────────────────────────────────────────
SECTION_MAP = {
    'warm up': 'WARM UP', 'warm-up': 'WARM UP', 'warmup': 'WARM UP',
    'pre-set': 'PRE-SET', 'pre set': 'PRE-SET', 'preset': 'PRE-SET',
    'main set': 'MAIN SET', 'mainset': 'MAIN SET',
    'cool down': 'COOL DOWN', 'cool-down': 'COOL DOWN', 'cooldown': 'COOL DOWN',
}

FOCUS_KEYWORDS = {
    'aerobic': 'aerobic', 'endurance': 'endurance', 'threshold': 'aerobic',
    'at1': 'aerobic', 'at2': 'aerobic', 'speed': 'speed', 'sprint': 'speed',
    'drill': 'drills', 'technique': 'drills', 'tech': 'drills', 'kick': 'kick',
}

MONTHS = {m: i+1 for i, m in enumerate(
    ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'])}

SKIP_LINES = {'toilet break', 'fun relays', 'all free'}

# ── Date parsing ─────────────────────────────────────────────────────────────
def try_parse_date(val):
    """Return (date, extra_text) or (None, None)."""
    if isinstance(val, datetime):
        return val.date(), ''

    if not isinstance(val, str):
        return None, None

    s = val.strip()

    # "5/12/2026 - Tech & drill focus"
    m = re.match(r'(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})(.*)', s)
    if m:
        try:
            d = date_type(int(m.group(3)), int(m.group(1)), int(m.group(2)))
            return d, m.group(4).lstrip(' -').strip()
        except ValueError:
            pass

    # "Monday 11 May", "Wedneday 13 May - AT", "Monday 11 May Juniors"
    m = re.search(r'(\d{1,2})\s+([A-Za-z]{3,})', s)
    if m:
        day = int(m.group(1))
        mon = m.group(2)[:3].lower()
        if mon in MONTHS:
            year = 2026
            try:
                d = date_type(year, MONTHS[mon], day)
                # everything after the matched date fragment is extra
                after = s[m.end():].lstrip(' -,').strip()
                return d, after
            except ValueError:
                pass

    return None, None


# ── Focus inference ──────────────────────────────────────────────────────────
def infer_focus(text):
    t = text.lower()
    for kw, focus in FOCUS_KEYWORDS.items():
        if kw in t:
            return focus
    return 'mixed'


# ── Excel parser ─────────────────────────────────────────────────────────────
def parse_sessions(path):
    wb = openpyxl.load_workbook(path)
    ws = wb.active

    sessions = []   # list of dicts: {date, focus_text, sections, total_dist}
    cur = None

    def flush():
        if cur:
            sessions.append(cur)

    for row in ws.iter_rows(values_only=True):
        col_a = row[0]
        col_b = row[1] if len(row) > 1 else None

        # Skip formula strings
        if isinstance(col_b, str) and col_b.startswith('='):
            col_b = None

        # ── Detect new session boundary ──────────────────────────────────
        d, extra = try_parse_date(col_a)
        if d:
            flush()
            cur = {'date': d, 'focus_text': extra, 'sections': {}, 'cur_section': None,
                   'total_dist': 0, 'focus_captured': bool(extra)}
            continue

        if cur is None:
            continue

        if col_a is None and col_b is None:
            continue

        # ── Detect section header ────────────────────────────────────────
        if isinstance(col_a, str):
            norm = col_a.strip().lower().rstrip('.')
            if norm in SECTION_MAP:
                cur['cur_section'] = SECTION_MAP[norm]
                if cur['cur_section'] not in cur['sections']:
                    cur['sections'][cur['cur_section']] = []
                continue

            # Focus/title line: only the FIRST non-section string gets it
            if cur['cur_section'] is None and col_a.strip():
                if not cur.get('focus_captured'):
                    cur['focus_text'] = col_a.strip()
                    cur['focus_captured'] = True
                    continue
                # No section yet but focus already captured — default to WARM UP
                cur['cur_section'] = 'WARM UP'
                if 'WARM UP' not in cur['sections']:
                    cur['sections']['WARM UP'] = []

            # Skip noise lines
            if col_a.strip().lower() in SKIP_LINES:
                continue

        # ── Content line ─────────────────────────────────────────────────
        section = cur['cur_section']
        if section is None:
            continue

        if section not in cur['sections']:
            cur['sections'][section] = []

        # Build line text
        parts = []
        if isinstance(col_a, str) and col_a.strip():
            parts.append(col_a.strip())
        elif col_a is None and isinstance(col_b, str) and col_b.strip():
            # Sub-note: indent it
            parts.append('  ' + col_b.strip())
            col_b = None  # don't count as distance

        if parts:
            dist = col_b if isinstance(col_b, (int, float)) and col_b > 0 else None
            if dist and parts[0][:2] != '  ':
                cur['total_dist'] += int(dist)
            line = parts[0]
            cur['sections'][section].append(line)

    flush()
    return sessions


# ── Format set content ───────────────────────────────────────────────────────
def format_content(session):
    order = ['WARM UP', 'PRE-SET', 'MAIN SET', 'COOL DOWN']
    lines = []
    for section in order:
        items = session['sections'].get(section, [])
        if items:
            lines.append(section)
            lines.extend(items)
            lines.append('')

    dist = session['total_dist']
    lines.append(f'Total: {dist:,}m' if dist else 'Total: —')
    return '\n'.join(lines).strip()


# ── SQL generation ────────────────────────────────────────────────────────────
def sql_escape(s):
    return s.replace("'", "''")


def generate_sql(sessions, squad_id, squad_label, slot, pool):
    set_rows = []
    assign_rows = []

    for s in sessions:
        focus_text = s['focus_text'] or ''
        focus = infer_focus(focus_text)
        dist  = s['total_dist'] or None
        d_str = s['date'].strftime('%Y-%m-%d')
        d_fmt = s['date'].strftime('%-d %b')
        name  = focus_text or f"{d_fmt} Training set"
        content = format_content(s)
        set_id = str(uuid.uuid4())

        dist_sql = str(dist) if dist else 'NULL'

        set_rows.append(
            f"('{set_id}', '{CLUB_ID}', '{sql_escape(name)}', '{focus}', "
            f"'{pool}', '{squad_id}', {dist_sql}, false, '{CREATED_BY}',\n"
            f"$${content}$$)"
        )
        assign_rows.append(
            f"('{CLUB_ID}', '{set_id}', '{squad_id}', '{d_str}', '{slot}', '{CREATED_BY}')"
        )

    sql = f"-- Imported {len(sessions)} session(s) for {squad_label}\n"
    sql += "INSERT INTO club_swim_sets (id, club_id, name, focus, pool_type, squad_id, total_distance, ai_generated, created_by, set_content) VALUES\n"
    sql += ',\n\n'.join(set_rows) + ';\n\n'
    sql += "INSERT INTO club_set_assignments (club_id, set_id, squad_id, session_date, session_slot, created_by) VALUES\n"
    sql += ',\n'.join(assign_rows) + ';\n'
    return sql


# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description='Import swim sets from Excel')
    ap.add_argument('file',       help='Path to .xlsx file')
    ap.add_argument('squad',      help='Squad name (e.g. "Senior Squad", "Intermediate")')
    ap.add_argument('--slot',     default='PM', choices=['AM','PM','PM2','PM3'])
    ap.add_argument('--pool',     default='SCM', choices=['SCM','LCM','either'])
    args = ap.parse_args()

    # Resolve squad ID
    squad_key = args.squad.lower().split()[0]
    squad_id  = next((v for k, v in SQUAD_IDS.items() if k in args.squad.lower()), None)
    if not squad_id:
        print(f"ERROR: Unknown squad '{args.squad}'. Known squads: {list(SQUAD_IDS.keys())}")
        sys.exit(1)

    sessions = parse_sessions(args.file)
    if not sessions:
        print("ERROR: No sessions found in file.")
        sys.exit(1)

    print(f"\nFound {len(sessions)} session(s):\n")
    for s in sessions:
        dist_str = f"{s['total_dist']:,}m" if s['total_dist'] else '?m'
        sections = ', '.join(s['sections'].keys())
        print(f"  {s['date']}  |  {s['focus_text'] or '(no title)':40s}  |  {dist_str}  |  [{sections}]")

    sql = generate_sql(sessions, squad_id, args.squad, args.slot, args.pool)

    out_path = Path(args.file).stem.replace(' ', '_') + '_import.sql'
    with open(out_path, 'w') as f:
        f.write(sql)

    print(f"\nSQL written to: {out_path}")
    print("Review it, then apply via Supabase MCP or dashboard SQL editor.\n")


if __name__ == '__main__':
    main()
