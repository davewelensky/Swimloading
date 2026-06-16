-- Fix: make source_row_num nullable so import_swim_summary_ri.sql can run
-- The NOT NULL constraint was blocking big_bay_swimsummary import.
-- UNIQUE(source_row_num, source) still prevents duplicate re-imports.

ALTER TABLE historical_swims
  ALTER COLUMN source_row_num DROP NOT NULL;
