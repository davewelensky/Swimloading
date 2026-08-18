# Route Investigation — `swimmers.html`, `galas.html`, Legal Documents

## `/swimmers` — recommendation: **KEEP** (as static; clean up the dead RPC call)

- **Content:** a small, curated "Meet the Swimmers" page featuring five named
  elite athletes (Cameron Bellamy, Carina Bruwer, Ryan Stramrood, Sarah
  Ferguson, Andy Donaldson) — static bios/photos, not a general roster tool.
- **Supabase project:** hardcodes `dwetwxpkqfjwbgkbxgat.supabase.co`
  (anon key embedded), used for exactly one thing: a per-swimmer RPC call
  (`get_swimmer_last_log`) that tries to show "Last logged X°C · Nh ago"
  under each name.
- **Is that project still reachable?** No. `curl` to
  `https://dwetwxpkqfjwbgkbxgat.supabase.co/rest/v1/` returned connection
  failure (curl exit code 6 / `000` status) — DNS does not resolve. The
  project is gone.
- **Does the page break as a result?** No. The RPC call is wrapped in
  `try { ... } catch {}` with an early `if (!res.ok) return;` — a failed
  fetch silently leaves the "last logged" line blank; the static bio content
  renders regardless. **Confirmed graceful degradation, not a visible bug.**
- **Is it linked anywhere?** Yes — `welcome.html` (the live homepage) links
  to it: *"Meet all five swimmers →"*. Real, intentional traffic.
- **Does equivalent functionality exist elsewhere?** Not exactly — this is a
  small athlete-spotlight page, distinct from the main app's live temp
  feed. No duplicate.
- **Recommendation: KEEP the page as-is (it works and is linked).**
  Separately — not urgent, no user-facing impact — either delete the dead
  `get_swimmer_last_log` fetch entirely, or repoint it at the canonical
  project (`szgkzuswelntnevobnoh`) if an equivalent RPC exists there. Not
  done in this pass; needs your call on which (delete vs. repoint), and
  repointing specifically needs approval per Step 5's "do not repoint
  without approval."

## `/galas` — recommendation: **RETIRE** (pending your confirmation)

- **Content:** a per-club gala-entry tool — swimmer signs in, the page looks
  up their club by URL slug (`/galas/<club-slug>`), finds their roster
  entry, and lets them submit gala entries against qualifying times.
- **Supabase project:** hardcodes `ykcgbknreftuymhpfwxd.supabase.co`
  (anon key embedded) for its client (`sb`), used for real queries:
  `clubs`, `club_roster`, `club_events`, `club_gala_entries`,
  `club_swimmer_times`, `ssa_qualifying_times`.
- **Is that project still reachable?** No — same result as above, DNS does
  not resolve, connection fails entirely.
- **Does the page break as a result?** For the bare `/galas` route (no
  slug), no — the code explicitly checks `if (!slug) { showError('No club
  specified'...) }` before ever querying Supabase, so that path shows a
  clean, intentional message. **For `/galas/<real-slug>`, the club lookup
  query would fail against the dead project** — not fully traced to a
  definitive UI outcome (stuck loading screen vs. a shown error depends on
  whether the Supabase client throws or returns `{data: null, error}` on a
  DNS failure, and this wasn't live-tested per the "no destructive
  production tests" constraint — loading a real club's gala page wasn't
  attempted since it's a mutating tool one click away from real inserts).
- **Is it linked anywhere?** No. Checked `welcome.html`/`welcome-motion.html`
  and the general HTML tree for an `href="/galas"` — no hits. It requires a
  club-specific slug to do anything useful anyway, meaning it was likely
  only ever shared as a direct link per club (not discoverable via
  navigation), and even that direct-link flow is broken since the
  backing project is gone.
- **Does equivalent functionality already exist?** Yes — CLAUDE.md
  documents `hasGalaEntries` as a live `club-admin.html` feature flag
  ("Entries tab — Aquasharks only"), using tables that overlap heavily
  with what `galas.html` queries (`club_gala_entries` exists in the
  *canonical* project's schema right now, confirmed via
  `information_schema.tables`). This strongly suggests `galas.html` is an
  earlier, superseded standalone version of what `club-admin.html`'s
  Entries tab does today.
- **Recommendation: RETIRE.** It's unreachable regardless of any code fix
  (the project is gone, not just misconfigured), not linked from anywhere,
  and its function appears to already live in `club-admin.html`. **Not
  retired in this pass** — per Step 5's explicit instruction, this needs
  your confirmation that `club-admin.html`'s Entries tab actually covers
  what `galas.html` did for Aquasharks (and any other club that may have
  used it) before the route is pulled, since "no live users depend on it"
  wasn't independently confirmed with usage data, only inferred from
  unreachability + lack of linkage.

## Legal document routes

- **Canonical, live document:** the `consentDocuments` object hardcoded in
  `app.js` (`app.js:6185`), rendered via an in-app modal
  (`openConsentModal('terms'|'privacy'|'waiver'|'data')`) during onboarding.
  This is what real users actually see and accept — confirmed by tracing
  `index.html`'s onboarding checkboxes ("Terms of Service", "Privacy Policy
  (POPIA)", "Liability Waiver") through their `View` links to
  `openConsentModal()`, which reads directly from that in-JS object. No
  fetch, no external route involved.
- **Draft documents (not live):** `14files/liability-waiver.txt`,
  `14files/privacy-policy.txt`, `14files/terms-of-service.txt`. Confirmed
  via a full-repo grep for any reference to these paths — **zero hits
  anywhere in the app.** These are standalone drafts, not wired to
  anything.
- **Broken links from `.vercelignore`?** **None.** Since nothing referenced
  `14files/*` before this session's containment fix, blocking that
  directory changed nothing functionally. Confirmed by re-checking the
  onboarding flow's actual data source (`app.js`, not `14files/`).
- **Duplicate or contradictory versions?** Not compared line-by-line in this
  pass (out of scope — "do not rewrite legal content," and a content diff
  wasn't requested). Worth a quick manual check from you: do the
  `14files/*.txt` drafts roughly match what's in `consentDocuments`, or are
  they an older/different version that should either be reconciled or
  deleted so there's only one source of truth going forward?
- **Proposed canonical route:** none needs to change — `app.js`'s
  `consentDocuments` already is the canonical, working source. No routing
  fix is needed because nothing was actually broken.
