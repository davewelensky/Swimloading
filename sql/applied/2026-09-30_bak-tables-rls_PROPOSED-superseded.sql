-- PROPOSED — NOT APPLIED. Review, then run through the MIGRATIONS.md workflow (dry-run, Dave types 'apply').
-- Enables RLS on the       94 _bak_* tables in public that currently have it off (4 others already have it on).
-- RLS on with no policies = anon/authenticated get nothing; service role and postgres still bypass. No app code reads _bak_* tables.
-- Reversible per table: ALTER TABLE public.<t> DISABLE ROW LEVEL SECURITY;

-- === A. Contains personal data — do these first ===
ALTER TABLE public._bak_20260911_dup_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260923_swim_lab_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260826_club_roster_k8 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260826_club_roster_dupes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260826_senior_squad_dupes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260820_swimmer_merge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260820b_historical_swimmers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260922_clubs_bluefin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260922d_clubs_bluefin ENABLE ROW LEVEL SECURITY;

-- === B. Everything else ===
ALTER TABLE public._bak_20260720_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260722_spot_eze ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260724_club_sessions_tarryn ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260728_temp_logs_yolanda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260729_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260731_june_challenge_events_steve_deon ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260731_temp_logs_steve_deon ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260803_crossing_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260803_discovery_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260804_discovery_source_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260804_event_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260804b_candidate_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260804b_event_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260804d_event_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260804e_source_backoff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260804f_source_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260804g_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260804h_wave_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260805_candidate_country ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260805_discovery_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260805_event_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260805_swimmer_event_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260805_venue_country ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260805b_discovery_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260805c_event_editions_discipline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260805d_event_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260805e_event_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260805e_event_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260805f_event_venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260806_fr_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260806_jan1_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260806_lopplistan_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260806_lopplistan_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260806_lough_cutra ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260807_club_sessions_tarryn ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260812_club_attendance_bronze_dup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260812_club_sessions_bronze_dup ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260813_bluff_title ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260813_caramoan_venue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260813_cross_source_dupes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260813_duplicate_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260813_non_swim_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260813_placeholder_regurl ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260814_crossings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260814_gibraltar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260814_nine_crossings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260814_spots_country_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260814b_crossings_nc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260814c_crossings_fb ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260814d_crossings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260820_discovery_candidate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260820_edition_indexable ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260820_eo_active_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260820_event_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260820_event_distances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260820_event_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260820_explore_fns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260820_swims_swimmer_id ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260820b_historical_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260820b_historical_swims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260820b_recurring_swims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260821_club_sessions_coachmerge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260821_club_squad_sessions_coachmerge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260821_historical_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260821_spots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260822_hot_chocolate ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260822_recurring_swims_location ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260823_recurring_swims_coord_fix ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260826_club_members_k8merge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260826_club_sessions_k8 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260826_club_set_assignments_k8 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260826_club_squad_sessions_k8 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260826_club_squads_k8 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260826_club_squads_senior_cap ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260826_club_swim_sets_k8 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260911_dup_lqp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260914_partner_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260921_club_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260922d_club_squad_sessions_bluefin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260923_club_roster_bluefin_userids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260923_clubs_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260923_search_roster_fn ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260929_club_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260929_feature_flags_ui_v2_default_all ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._bak_20260929_spots_mykonos ENABLE ROW LEVEL SECURITY;

-- === C. OPTIONAL alternative: DROP (irreversible). Only for backups you no longer need. Candidates, oldest data-only ones — Dave to choose: ===
-- DROP TABLE public._bak_20260911_dup_profiles;   -- duplicate profiles incl. email/phone/DOB/address, 11 Sep
-- DROP TABLE public._bak_20260826_club_roster_k8;  -- K8 roster with phone/DOB, superseded by the Aquasharks merge
