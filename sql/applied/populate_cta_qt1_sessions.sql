-- ================================================================
-- Populate sessions_json for CTA QT #1 (13 June 2026)
--
-- Run this AFTER add_sessions_json.sql has been applied.
-- Find the event ID first with:
--   SELECT id, title, event_date FROM club_events WHERE title ILIKE '%CTA%';
-- Then update by ID, or use the WHERE clause below if title is unique enough.
-- ================================================================

UPDATE club_events
SET
  course        = 'LC',
  sessions_json = '[
    {
      "number": 1,
      "level": "L3",
      "label": "Level 3+",
      "start_time": "09:00",
      "events": [
        { "name": "800 Free",  "min_age": 11 },
        { "name": "100 Back"  },
        { "name": "200 Fly",   "min_age": 11 },
        { "name": "50 Breast" },
        { "name": "200 Free"  },
        { "name": "100 Free"  },
        { "name": "50 Fly"    },
        { "name": "400 Free",  "min_age": 11 },
        { "name": "100 IM"    }
      ]
    },
    {
      "number": 2,
      "level": "L2",
      "label": "Level 2",
      "start_time": "13:00",
      "events": [
        { "name": "200 IM"    },
        { "name": "50 Breast" },
        { "name": "100 Back"  },
        { "name": "200 Free"  },
        { "name": "50 Fly"    },
        { "name": "50 Free"   },
        { "name": "50 Back"   }
      ]
    }
  ]'::jsonb
WHERE title ILIKE '%CTA QT%'
  AND event_date = '2026-06-13'
  AND club_id = (SELECT id FROM clubs WHERE slug = 'aqua-sharks-atlantic');
