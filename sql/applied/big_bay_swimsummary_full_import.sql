-- ============================================================================
-- BIG BAY EVENTS FULL SWIM ARCHIVE IMPORT (Swim Summary New Format 1.1.xlsx)
-- Applied: 19-20 Aug 2026, via supabase-admin MCP apply_migration calls.
-- Authorized by Dave ("apply"), for the marathon-swims.html record page.
--
-- THIS FILE IS DOCUMENTATION OF WORK ALREADY APPLIED — DO NOT RE-RUN.
-- The actual SQL lives in the named migrations listed below (all applied via
-- mcp apply_migration; row data was generated from the spreadsheet by the
-- Python resolution step and chunked at 200 rows/file).
--
-- Scope decision (Dave, 20 Aug 2026): Langebaan Express (12km) and English
-- Channel swims stay in; 34 uncategorized swims kept, with category='unknown'.
-- ============================================================================

-- 1. SWIMMER RECONCILIATION (before this import batch)
--    Merged 1,245 duplicate identity groups: 2,579 -> 1,332 swimmers.
--    (Commit 911ac0a "historical_swimmers: merge 1,245 people who existed as
--    duplicate identities".)

-- 2. SCHEMA CHANGES
--    a) historical_swims_category_check extended to allow 'unknown'
--       (34 spreadsheet rows have no category recorded).
--    b) UNIQUE CONSTRAINT FIX (real bug): the old 2-column unique key
--       historical_swims_source_row_num_source_key (source_row_num, source)
--       silently dropped relay TEAMMATES via ON CONFLICT DO NOTHING when
--       multiple swimmers shared one spreadsheet row. Replaced with:
--         historical_swims_source_row_num_source_swimmer_key
--           UNIQUE (source_row_num, source, swimmer_id)
--       Verified fixed: row_nums 1377 and 1397 each now hold 4 teammates.

-- 3. NEW ROUTES (19 rows into historical_routes)
--    Langebaan Express, English Channel, Millers - Fish Hoek,
--    Fish Hoek - Millers, Robben Island - Dassen Island,
--    Preek Stoel - Mykonos - Pearly's, Loch Awe, Adventure Prison Escape,
--    Robben Island Adventure, False Bay double, Three Capes, and others.

-- 4. NEW SWIMMERS (701 rows into historical_swimmers)
--    Applied as swimmers_chunk_0..4 (5 files).

-- 5. SWIM ROWS (~2,096 target rows into historical_swims, source =
--    'big_bay_swimsummary', chunked 200 rows/file):
--    - "existing" chunks 0-5: swimmer matched by known swimmer_id (uuid).
--      Migrations: import_swims_existing_batch2..batch7.
--    - "new" chunks 0-4: swimmer joined by historical_swimmers.name_normalized.
--      Migrations: import_swims_new_batch1..batch5.
--    All inserts used:
--      ON CONFLICT (source_row_num, source, swimmer_id) DO NOTHING
--    Route resolved by JOIN historical_routes r ON r.name = v.route_name.

-- 6. FINAL VERIFICATION (queried 20 Aug 2026, after last chunk):
--      total_swims                        = 4,580   (was 2,484 pre-import)
--      swims where source =
--        'big_bay_swimsummary'            = 4,128
--      total_swimmers                     = 1,991   (1,332 + 701 new, minus
--                                                    reconciliation overlap)
--    Relay teammate integrity: shared-row relays preserved —
--      row_nums 1377, 1397, 1753, 2321, 2555 each hold 4 rows;
--      2489 holds 3; 1799, 2503 hold 2. Newer relays use one spreadsheet
--      row PER teammate, so singleton row_nums there are correct.

-- Downstream: marathon-swims.html reads these tables live (anon SELECT via
-- RLS) with .range() pagination, so no code change was needed for the page
-- to pick up the new totals.
