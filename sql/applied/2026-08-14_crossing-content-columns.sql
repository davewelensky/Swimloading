-- ================================================================
-- SwimLoading — Migration Template
-- Copy this header into EVERY new migration file.
-- The safety block hard-fails if you are in the wrong project.
-- ================================================================

-- ⚠️  SAFETY CHECK — runs first, aborts everything if wrong project
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM _project_identity
    WHERE key = 'project_name' AND value = 'swimloading'
  ) THEN
    RAISE EXCEPTION
      E'\n\n'
      '╔══════════════════════════════════════════════════════════╗\n'
      '║  WRONG PROJECT — MIGRATION ABORTED                       ║\n'
      '║                                                          ║\n'
      '║  This migration is for: SwimLoading                     ║\n'
      '║  Expected project ref:  szgkzuswelntnevobnoh            ║\n'
      '║                                                          ║\n'
      '║  You are connected to a DIFFERENT Supabase project.     ║\n'
      '║  No changes have been made. Check your browser URL.     ║\n'
      '╚══════════════════════════════════════════════════════════╝'
    USING HINT = 'Check the project ref in your Supabase dashboard URL';
  END IF;
  RAISE NOTICE '✅ Project identity confirmed: swimloading (szgkzuswelntnevobnoh)';
END $$;

-- ================================================================
-- Migration: 2026-08-14_crossing-content-columns.sql
-- Process:   see MIGRATIONS.md
-- ================================================================

-- Purpose:
--   Give the crossings table somewhere to hold what the crossing PAGES
--   already say, then move Strait of Gibraltar's content into it.
--
--   WHY. /crossings/strait-of-gibraltar earns 194 of the site's 447
--   organic clicks. The page is ~1,900 words; the row behind it holds a
--   distance, a temperature range and a 101-character description. Render
--   that page from the database today and it becomes three facts. So the
--   content moves first, the template comes after, and the page is never
--   served less than it has now.
--
--   NOTHING HERE IS WRITTEN BY HAND. Every prose value was lifted verbatim
--   from strait-of-gibraltar.html by scripts/extract-crossing-content.mjs.
--   The scalars below are likewise quoted from that page:
--     start/end     "Tarifa, Spain to Ceuta (Spanish territory, Morocco)"
--     season        "Jun - Oct"
--     governing     "ACNEG - Asociacion Cruce a Nado del Estrecho de Gibraltar"
--     duration      "3-5 hrs"
--     oceans seven  "a prized Oceans Seven crossing"
--
--   TWO SMALL NORMALISATIONS, stated rather than hidden:
--   1. The page writes the governing body's site as "cruzadogibraltar.es".
--      Stored with an https:// scheme to match english-channel's
--      "https://cspf.co.uk". The host is unchanged.
--   2. country_code is a single column and this crossing spans two
--      countries. Set to 'ES', the START country, following the
--      english-channel precedent ('GB', which starts at Dover). The page's
--      own "Spain / Morocco" framing is preserved in start/end_location,
--      which is where a reader sees it.
--
--   distance_km is left at 14.4. The page says "~14 km"; 14.4 is the more
--   precise figure already stored and the two do not conflict.

-- Requested by:
--   Dave, 2026-08-14 — "add those columns and backfill gibraltar".

-- ----------------------------------------------------------------
-- PRE-CHECKS — run on the READ-ONLY connection BEFORE applying.
-- ----------------------------------------------------------------
-- SELECT column_name FROM information_schema.columns
--  WHERE table_schema='public' AND table_name='crossings'
--    AND column_name IN ('hazards','conditions','about_md','preparation','faqs','oceans_seven','duration_text');
-- expect: 0 rows (none exist yet)
--
-- SELECT slug, start_location, governing_body, season_start_month, length(description)
--   FROM public.crossings WHERE slug='strait-of-gibraltar';
-- expect: 1 row, start_location/governing_body/season_start_month all NULL, description 101 chars

-- ----------------------------------------------------------------
-- BACKUP — required: the UPDATE touches an existing row.
-- ----------------------------------------------------------------
-- CREATE TABLE _bak_20260814_gibraltar AS
--   SELECT * FROM public.crossings WHERE slug = 'strait-of-gibraltar';

-- ----------------------------------------------------------------
-- MIGRATION — applied only after Dave types "apply".
-- ----------------------------------------------------------------
BEGIN;

-- Prose the page has and the table had nowhere to put. jsonb arrays for
-- the repeated sections so a template can loop, and so faqs can feed
-- FAQPage JSON-LD directly without a second parse.
ALTER TABLE public.crossings
  ADD COLUMN IF NOT EXISTS hazards       jsonb,
  ADD COLUMN IF NOT EXISTS conditions    jsonb,
  ADD COLUMN IF NOT EXISTS about_md      text,
  ADD COLUMN IF NOT EXISTS preparation   jsonb,
  ADD COLUMN IF NOT EXISTS faqs          jsonb,
  ADD COLUMN IF NOT EXISTS oceans_seven  boolean,
  ADD COLUMN IF NOT EXISTS duration_text text;

COMMENT ON COLUMN public.crossings.hazards       IS 'Array of strings, verbatim from the source page. What can go wrong on this crossing.';
COMMENT ON COLUMN public.crossings.conditions    IS 'Array of strings, verbatim. Wind, current and visibility behaviour.';
COMMENT ON COLUMN public.crossings.about_md      IS 'Long-form description, paragraphs separated by a blank line.';
COMMENT ON COLUMN public.crossings.preparation   IS 'Array of strings, verbatim. Training benchmarks and logistics.';
COMMENT ON COLUMN public.crossings.faqs          IS 'Array of {q,a}. Feeds both the page and its FAQPage JSON-LD.';
COMMENT ON COLUMN public.crossings.duration_text IS 'Typical finish time AS THE SOURCE WRITES IT ("3-5 hrs") — a range, not a number, because that is what is known.';

UPDATE public.crossings SET
  start_location     = 'Tarifa, Spain',
  end_location       = 'Ceuta (Spanish territory, Morocco)',
  country_code       = 'ES',
  water_body         = 'Strait of Gibraltar',
  season_start_month = 6,
  season_end_month   = 10,
  governing_body     = 'ACNEG',
  governing_body_url = 'https://cruzadogibraltar.es',
  duration_text      = '3-5 hrs',
  oceans_seven       = true,
  hazards            = '["The Strait of Gibraltar is one of the world''s busiest shipping lanes — over 100 vessels transit daily. Escort boats must navigate across multiple vessel traffic separation schemes, and swimmers must stop and tread water to allow ships to pass.", "The Levante wind — a strong easterly that funnels through the strait — can produce steep, short-period chop up to 2–3m within hours. Swims are frequently abandoned mid-crossing when the Levante arrives unexpectedly.", "The Atlantic inflow creates a strong surface current running east into the Mediterranean. Swimmers who cannot maintain sufficient speed are carried rapidly off the Ceuta target and onto the open Mediterranean coast of Morocco.", "Jellyfish blooms — particularly Pelagia noctiluca (mauve stinger) — occur frequently in late summer and can be dense enough to cause continuous stinging throughout a crossing."]'::jsonb,
  conditions         = '["The strait acts as a wind funnel between the Atlantic and Mediterranean — even calm offshore conditions can produce violent localised wind within minutes.", "Two distinct current layers operate simultaneously: a surface inflow of Atlantic water moving east (which swimmers ride), and a deeper, saltier Mediterranean outflow moving west below.", "The actual crossing path is a diagonal arc — swimmers aim north of Ceuta and let the current carry them east onto their target, requiring precise pilot navigation.", "Visibility in the strait is generally good, but haze and sea-level fog occasionally reduce it in early mornings."]'::jsonb,
  about_md           = 'The Strait of Gibraltar connects the Atlantic Ocean to the Mediterranean Sea at the western end of the Mediterranean basin. At its narrowest point, the strait is approximately 14km wide, separating Tarifa in southern Spain from the Moroccan coastline. The territory of Ceuta — a Spanish exclave on the African continent — sits on the Moroccan side of the strait, providing a defined finishing point in a politically complex geography. Swimmers who complete the crossing become one of two continents literally in a single swim.

The first recorded swim of the strait was by Captain Matthew Webb in 1875 — the same year he became the first person to swim the English Channel. The Gibraltar crossing has since attracted hundreds of solo and relay swimmers, making it one of the most attempted of the Oceans Seven crossings. ACNEG, the governing body based in Algeciras, has been ratifying crossings since the 1980s and maintains a database of all sanctioned swims.

Despite its relatively short straight-line distance of 14km, the strait is notoriously difficult to plan. The Levante wind can arrive with little warning and makes conditions dangerous within an hour. Most experienced Gibraltar pilots monitor multiple weather models and will make a go/no-go call only 6–12 hours before a planned start. Swimmers typically stay near Tarifa for multiple days waiting for a suitable window. The ACNEG system allocates time slots to registered swimmers on a first-come basis when a window opens.

The crossing has unique geopolitical significance as one of the few swims that crosses an international border — from the European Union (Spain) to an African territory. Swimmers arrive in Ceuta, which remains under Spanish sovereignty despite being geographically within Morocco. This crossing is literally swimming between continents, between the Atlantic and Mediterranean, and between two of the world''s great cultural spheres.',
  preparation        = '["Longest single open water swim of at least 10km — the strait itself is short, but unpredictable conditions can extend a crossing significantly.", "Weekly training volume of 20–30km, with a strong emphasis on rough water and chop tolerance.", "Sustained pace swimming: Gibraltar rewards faster swimmers who can fight the eastward current drift and maintain a straight line. Speed matters more here than in pure endurance crossings.", "Experience waiting and restarting: mental preparation for days of waiting at Tarifa, then going from rest to a race-pace start when a window opens.", "Gibraltar is unusual among the Oceans Seven in that it genuinely rewards faster swimmers. A swimmer maintaining 3km/h or more can use the current effectively and aim directly for Ceuta; a slower swimmer is carried progressively east and either misses Ceuta or swims a significantly longer diagonal arc. If your open water pace is below 2.5km/h, you will likely need the current to carry you to the African coast east of the planned finish, and your pilot must account for this in setting your start angle. Discuss your realistic pace honestly with your pilot before the crossing.", "The most important preparation beyond fitness is logistics: registering with ACNEG well in advance, booking accommodation in Tarifa with flexible check-out (plan for a minimum one week stay to allow for weather waits), and engaging an ACNEG-approved pilot early in the season as experienced pilots have limited availability. Tarifa has a well-established community of Gibraltar crossing operators and support infrastructure — it is the most logistically straightforward of the Oceans Seven to organise."]'::jsonb,
  faqs               = '[{"q": "Can I swim from Morocco to Spain instead of Spain to Morocco?", "a": "Yes, both directions are ratified by ACNEG and count for Oceans Seven purposes. However, the Spain-to-Morocco direction (Tarifa to Ceuta) is far more common because the Atlantic inflow current assists the crossing. Swimming from Morocco to Spain means fighting the surface current for the entire crossing, significantly increasing difficulty and time."}, {"q": "What is the Levante and how do I plan around it?", "a": "The Levante is a hot, dry easterly wind that funnels through the strait from the Mediterranean. It can appear with little warning and generate steep chop that makes swimming dangerous. The crossing season (June–October) coincides with the highest frequency of Levante events. Your pilot monitors weather models daily and will identify windows of westerly or calm conditions — these are often brief (12–36 hours) and must be taken quickly. Budget at least 5–7 days in Tarifa for a realistic chance of getting a weather window."}, {"q": "How do I register with ACNEG?", "a": "Contact ACNEG through their official channels (cruzadogibraltar.es or through their Algeciras office). You register as a swimmer, provide swim history, pay sanctioning fees, and are allocated to the ACNEG pilot queue. ACNEG manages the scheduling of crossings and assigns time slots when weather windows open to avoid congestion in the busy shipping lane. Registration should happen months in advance of your planned attempt."}, {"q": "Do ships really stop for swimmers?", "a": "No — ships do not stop or significantly alter course. Your escort boat communicates with vessel traffic control and with individual ships via VHF radio, and you must stop swimming and tread water while large vessels pass. This can happen multiple times during a crossing. The most dangerous moments are when communication fails or a vessel does not respond — your pilot and escort crew manage this risk, but it is a genuine hazard that cannot be fully eliminated."}, {"q": "Is the Gibraltar crossing a good entry point into the Oceans Seven?", "a": "Many marathon swimmers use Gibraltar as their first or second Oceans Seven crossing because of the relatively short distance and warm water. However, \"entry point\" can be misleading — the shipping traffic, Levante unpredictability, and current management make it a serious undertaking. It is a better first Oceans Seven crossing than Cook Strait or the North Channel, but it demands genuine preparation and experienced pilot support."}]'::jsonb,
  updated_at         = now()
WHERE slug = 'strait-of-gibraltar';

COMMIT;

-- ----------------------------------------------------------------
-- ROLLBACK
-- ----------------------------------------------------------------
-- UPDATE public.crossings c SET
--   start_location=b.start_location, end_location=b.end_location, country_code=b.country_code,
--   water_body=b.water_body, season_start_month=b.season_start_month, season_end_month=b.season_end_month,
--   governing_body=b.governing_body, governing_body_url=b.governing_body_url
--   FROM _bak_20260814_gibraltar b WHERE c.id=b.id;
-- ALTER TABLE public.crossings
--   DROP COLUMN hazards, DROP COLUMN conditions, DROP COLUMN about_md,
--   DROP COLUMN preparation, DROP COLUMN faqs, DROP COLUMN oceans_seven, DROP COLUMN duration_text;

-- ----------------------------------------------------------------
-- VERIFY — run on the READ-ONLY connection AFTER applying.
-- ----------------------------------------------------------------
-- SELECT jsonb_array_length(hazards)     AS hazards,      -- expect 4
--        jsonb_array_length(conditions)  AS conditions,   -- expect 4
--        jsonb_array_length(preparation) AS preparation,  -- expect 6
--        jsonb_array_length(faqs)        AS faqs,         -- expect 5
--        length(about_md)                AS about_chars,  -- expect ~2400
--        start_location, end_location, governing_body, oceans_seven, duration_text
--   FROM public.crossings WHERE slug='strait-of-gibraltar';
--
-- The words are all there — this should be close to the page's own count:
-- SELECT array_length(regexp_split_to_array(
--          about_md || ' ' || (SELECT string_agg(value, ' ') FROM jsonb_array_elements_text(hazards)),
--        '\s+'), 1) FROM public.crossings WHERE slug='strait-of-gibraltar';
--
-- No other crossing was touched:
-- SELECT count(*) FROM public.crossings WHERE hazards IS NOT NULL;   -- expect 1
