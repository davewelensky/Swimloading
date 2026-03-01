-- ============================================================
-- Missing False Bay Crossings — 2023–2026
-- Source: False Bay Crossing records spreadsheet
-- Added: 27 Feb 2026
--
-- Notes:
-- • Same time on same date = relay pair → is_relay=true, category='relay'
-- • Relay route ID:  a9904459-f561-428b-be2a-a1a17c20c0cf
-- • Solo route ID:   7aab02cf-4fd9-49f3-9c52-073c929f16c9
-- • Times with PM (2:xx PM = 14:xx = 14h duration) flagged as relays
--   per record analysis
-- • Water temps: NULL where not verified — update when confirmed
-- ============================================================


-- ── STEP 1: Insert new swimmers (7 not in DB) ──────────────
-- Use ON CONFLICT DO NOTHING on name_normalized to be safe

INSERT INTO historical_swimmers (display_name, name_normalized, gender, country)
VALUES
    ('Grace Mclaughlin',         'grace mclaughlin',         'F', 'South Africa'),
    ('Ieva Lobaciute',           'ieva lobaciute',           'F', 'South Africa'),
    ('Meinhardt Esterhuizen',    'meinhardt esterhuizen',    'M', 'South Africa'),
    ('Barry Murphy',             'barry murphy',             'M', 'South Africa'),
    ('Dee Newell',               'dee newell',               'F', 'South Africa'),
    ('Linda Clarke',             'linda clarke',             'F', 'South Africa'),
    ('Jason Betley',             'jason betley',             'M', 'South Africa')
ON CONFLICT (name_normalized, gender) DO NOTHING;


-- ── STEP 2: Insert missing swim events ────────────────────
-- Reference existing swimmer IDs where known, use subquery for new ones

-- Helper: swimmer lookup CTE approach per statement
-- Source row nums: 30000001–30000021 (new manual batch series)

-- ── 2023 ──────────────────────────────────────────────────

-- Shubham Dhananjay Vanmali  13 Apr 2023  solo  9h46m49s  Good
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000001, '2023-04-13',
    '3b9cb7eb-2d2b-4652-af69-5f5c8f53cc07',  -- Shubham Dhananjay Vanmali
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'good', 18.0, '9:46:49', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;


-- ── 2024 (entries missing from original import) ────────────

-- Alessandra Cima  22 Mar 2024  solo  11h35m32s  Good
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000002, '2024-03-22',
    'bd0abc2a-4071-4c23-8afd-0658c01be55e',  -- Alessandra Cima
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'good', 19.0, '11:35:32', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Dina Levacic  08 Feb 2024  solo  11h39m23s  Good
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000003, '2024-02-08',
    '43ac9cbf-e025-4534-b9e4-c606606dbff6',  -- Dina Levacic
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'good', 19.0, '11:39:23', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Dave Berry  20 Jan 2024  solo  9h14m21s  Good
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000004, '2024-01-20',
    '9806d5dc-3e65-4924-983b-ce05f2cbe321',  -- Dave Berry
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'good', 18.5, '9:14:21', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- ── 22 Nov 2024: Jason Betley solo + Oldnall/Crowther RELAY ──

-- Jason Betley  22 Nov 2024  solo  10h59m06s  Bumpy
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000005, '2024-11-22',
    (SELECT id FROM historical_swimmers WHERE name_normalized = 'jason betley' LIMIT 1),
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'bumpy', NULL, '10:59:06', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Chris Oldnall  22 Nov 2024  RELAY  13h56m28s  Bumpy  (same time as Peet Crowther)
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000006, '2024-11-22',
    'f0fbbbc6-57d4-47de-916e-afb0b8ba3277',  -- Chris Oldnall
    'a9904459-f561-428b-be2a-a1a17c20c0cf',  -- relay
    'bumpy', NULL, '13:56:28', 'relay', true, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Peet Crowther  22 Nov 2024  RELAY  13h56m28s  Bumpy  (same time as Chris Oldnall)
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000007, '2024-11-22',
    '7dac6d8b-626d-4a2a-827e-2af10fb98625',  -- Peet Crowther
    'a9904459-f561-428b-be2a-a1a17c20c0cf',  -- relay
    'bumpy', NULL, '13:56:28', 'relay', true, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- ── 02 Dec 2024: Donovan Miller + Edward O'Sullivan RELAY ──
-- Similar times (14:57–14:59) on same day → relay pair

-- Donovan Miller  02 Dec 2024  RELAY  14h59m32s  Bumpy
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000008, '2024-12-02',
    '6ce8e717-49ed-4ecb-9fde-a643db240aa7',  -- Donovan Miller
    'a9904459-f561-428b-be2a-a1a17c20c0cf',  -- relay
    'bumpy', NULL, '14:59:32', 'relay', true, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Edward O'Sullivan  02 Dec 2024  RELAY  14h57m08s  Bumpy
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000009, '2024-12-02',
    'b7d26eb7-0977-4d26-b319-0fdfff219faa',  -- Edward O'Sullivan
    'a9904459-f561-428b-be2a-a1a17c20c0cf',  -- relay
    'bumpy', NULL, '14:57:08', 'relay', true, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Alexandra Torborg  03 Dec 2024  14h32m20s  Bumpy
-- Long time suggests relay — marked is_relay=true pending verification
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000010, '2024-12-03',
    '0a66a490-27fe-4c66-9f08-3a1d4d86372e',  -- Alexandra Torborg
    'a9904459-f561-428b-be2a-a1a17c20c0cf',  -- relay (duration indicates relay)
    'bumpy', NULL, '14:32:20', 'relay', true, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Graeme King  23 Nov 2024  solo  10h04m20s  Bumpy
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000011, '2024-11-23',
    'eb526b17-4e27-4cfc-94b8-382b97118b07',  -- Graeme King
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'bumpy', NULL, '10:04:20', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;


-- ── 2025 ──────────────────────────────────────────────────

-- Linda Clarke  04 Jan 2025  solo  10h27m52s  Bumpy
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000012, '2025-01-04',
    (SELECT id FROM historical_swimmers WHERE name_normalized = 'linda clarke' LIMIT 1),
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'bumpy', 18.0, '10:27:52', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Kay-Lee Mouton  24 Jan 2025  solo  9h28m03s  Good
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000013, '2025-01-24',
    '675ebfa2-ef83-48b4-adc5-3e7bc17b551a',  -- Kay-Lee Mouton
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'good', 18.5, '9:28:03', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Monika Hayes  24 Jan 2025  solo  9h55m55s  Good
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000014, '2025-01-24',
    '98edc861-09e1-44bf-b4ab-f538ffddd7fc',  -- Monika Hayes
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'good', 18.5, '9:55:55', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Paula Armstrong  23 Jan 2025  solo  8h13m27s  Bumpy
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000015, '2025-01-23',
    '8a6ca00b-597a-4cb8-9bdf-a9803157d0b7',  -- Paula Armstrong
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'bumpy', 18.5, '8:13:27', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Dee Newell  04 Feb 2025  14h10m11s  Bumpy
-- Long duration — likely relay or very slow solo; marked relay pending verification
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000016, '2025-02-04',
    (SELECT id FROM historical_swimmers WHERE name_normalized = 'dee newell' LIMIT 1),
    'a9904459-f561-428b-be2a-a1a17c20c0cf',  -- relay (14h duration)
    'bumpy', 18.0, '14:10:11', 'relay', true, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Barry Murphy  06 Mar 2025  solo  12h05m56s  Good
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000017, '2025-03-06',
    (SELECT id FROM historical_swimmers WHERE name_normalized = 'barry murphy' LIMIT 1),
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'good', 19.0, '12:05:56', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Tracey Steyn  06 Mar 2025  solo  11h54m27s  Good
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000018, '2025-03-06',
    '2420ea3d-adeb-4c70-8545-f2c60b23c878',  -- Tracey Steyn
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'good', 19.0, '11:54:27', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Meinhardt Esterhuizen  16 Dec 2025  solo  9h52m50s  Good
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000019, '2025-12-16',
    (SELECT id FROM historical_swimmers WHERE name_normalized = 'meinhardt esterhuizen' LIMIT 1),
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'good', 17.5, '9:52:50', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;


-- ── 2026 ──────────────────────────────────────────────────

-- Ieva Lobaciute  14 Jan 2026  solo  11h24m37s  Good
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000020, '2026-01-14',
    (SELECT id FROM historical_swimmers WHERE name_normalized = 'ieva lobaciute' LIMIT 1),
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'good', 17.5, '11:24:37', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;

-- Grace Mclaughlin  07 Feb 2026  solo  9h53m32s  Good
INSERT INTO historical_swims
    (source_row_num, swim_date, swimmer_id, route_id, conditions, water_temp_c, duration, category, is_relay, source)
VALUES (30000021, '2026-02-07',
    (SELECT id FROM historical_swimmers WHERE name_normalized = 'grace mclaughlin' LIMIT 1),
    '7aab02cf-4fd9-49f3-9c52-073c929f16c9',  -- solo
    'good', 17.0, '9:53:32', 'skins', false, 'false_bay_records')
ON CONFLICT (source_row_num, source) DO NOTHING;


-- ── STEP 3: Verify ────────────────────────────────────────
-- Run this after inserts to confirm counts:
-- SELECT COUNT(*) FROM v_false_bay_crossings;  -- should be ~62 entries
-- SELECT swim_date, display_name, duration_formatted, conditions, swim_type
-- FROM v_false_bay_crossings
-- WHERE year >= 2023
-- ORDER BY swim_date DESC;
