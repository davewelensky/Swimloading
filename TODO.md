# SwimLoading — Immediate TODO

> Immediate action items only. Full roadmap → ROADMAP.md. Club feature detail → CLUBS.md.

---

## Strava API Changes — Action Required

- [ ] **TODAY** — Go to strava.com/settings/api → check tier (Standard vs Extended Access)
- [x] **TODAY** — Redeem 3-month free Strava subscription code: `6dd19196f2` ✓ Subscriber since 6/1/26
- [x] **By 30 Jun 2026** — Ensure active Strava subscription on developer account ✓ Done
- [ ] **By 1 Jun 2027** — Update API base URL in `api/strava/activities.js` line 45:
  - FROM: `https://www.strava.com/api/v3/`
  - TO:   `https://www.api-v3.strava.com/`
- [ ] **By 1 Jun 2027** — Replace `oauth/deauthorize` with `oauth/revoke` if used anywhere
- Note: SwimLoading is NOT affected by: intermediary restrictions (direct integration), Club endpoints (unused), Segments (unused). JSON body token calls are fine — only form params are deprecated.

---

## Club Admin — Priority 1 (Britt replaces the spreadsheet)

- [ ] **CSV / bulk import** — let Britt upload her May 2026.xlsx (or a CSV export), map columns, and import all ~50 swimmers at once. Biggest onboarding blocker.
- [ ] **Monthly attendance report** — grid view: swimmers × sessions, status codes, %, DNP count. Mirrors Britt's spreadsheet. Export to CSV or PDF.
- [ ] **Inline trial/fee toggles** on roster table — currently only editable in Edit modal; should be a one-click toggle in the table row.
- [ ] **Trial expiry alert** — badge on roster row when `trial_end_date` is within 7 days.
- [ ] **Fee overdue filter** — filter roster to `fee_paid = false` AND `fee_due_date` past today.

## Club Admin — Priority 2 (Replace WhatsApp)

- [ ] **Session cancellation** — admin cancels a session; intent-holders get notified.
- [ ] **Swimmer intent** ("I'm coming") — visible to coach before session.
- [ ] **Email to parent on attendance** — automated email when child marked `no_contact`, `no_show`, or `dnp`.
- [ ] **Coach session notes** — free-text notes per session, visible to squad.
- [ ] **WhatsApp deep link** — "Message parent" on roster row opens WhatsApp with pre-filled number.

## Club Admin — Priority 3 (Performance tracking)

- [ ] **Swimmer progress view** — attendance %, PB count, QT progress in one card.
- [ ] **Attendance trend chart** — attendance rate per swimmer over last 30/90 days.
- [ ] **Birthday reminders** — weekly digest email to admin.
- [ ] **QT deadline tracker** — days remaining, who's qualified, who hasn't.

## DUC Onboarding

- [ ] Wire Steve Evans as DUC admin (once he has SwimLoading account)
- [ ] Generate first join link for DUC, share with Steve for WhatsApp blast to ~100 members
- [ ] Test league result entry UI with DUC data

## Core App

- [ ] Test new user signup end-to-end (email verification ON)
- [ ] Verify branded Supabase email templates are configured
- [ ] Consider removing `landing.html` (replaced by `welcome.html`)

---

## Recently Shipped (May 2026)

- [x] 7 attendance status codes matching Britt's spreadsheet (present, nc, notice, no_show, away, dnp, catch_up)
- [x] Coach name on sessions — shown in Today's Schedule and session cards
- [x] Trial swimmer flag (`is_trial`) — red badge in attendance mark modal
- [x] Fee paid flag (`fee_paid`) — amber badge in attendance mark modal
- [x] Trial dates and fee due date columns on `club_roster`
- [x] Squad management in Settings — add/remove squads
- [x] Weekly timetable builder in Settings — add recurring sessions per squad
- [x] Squad picker in Edit Member and Add Member modals
- [x] Trial + Fee Paid checkboxes in both Add Member and Edit Member modals
- [x] Fixed Today's Schedule (was always empty due to bad club_id filter on club_squad_sessions)
- [x] RLS locked down on club_coaches, club_member_profile, club_squads, club_squad_sessions, club_admins
- [x] Dropped dead `club_league_results` table
- [x] Aqua Sharks public club page improved for parent/swimmer sign-up conversion

*Last updated: 12 May 2026*
