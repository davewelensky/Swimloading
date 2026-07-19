# Sponsor CRM — Field Classification & Import Plan

Companion to `sql/2026-07-19_create-sponsor-crm.sql` (schema only, creates
empty tables). **No sponsor data has been imported.** This document proposes
how the import *would* work once Dave approves — per Step 4's explicit
requirement, personal-sensitive fields are not migrated without a separate
approval, even after the schema itself is approved.

## Source

`Sponsors/index.html`'s `const BRANDS = [...]` array (91 entries), currently
contained via routing block (not publicly reachable), content unchanged in
git. Each entry has: `id, category, name, prize, note, tags, contact`.

## Field mapping + classification

| Source field (`BRANDS[]`) | Target column (`sponsor_partners`) | Classification | Import without further approval? |
|---|---|---|---|
| `name` | `brand` | Operational | Yes |
| `category` | `category` | Operational | Yes |
| `tags` (`sa`, `verified`, `hot`, `new`) | `tags` | Operational | Yes |
| `tags` containing `'hot'` | `is_priority` (derived) | Operational | Yes |
| `contact` (a URL, e.g. `tyr.co.za`) | `website` | Operational | Yes — these are all public company URLs, not personal contact info |
| `prize` | `value_proposition` | Commercial-sensitive | Yes, with your sign-off — Rand values and discount specifics are business-sensitive but not personal to any individual |
| `note` (freeform strategy commentary) | `notes` | **Personal-sensitive** | **No — holds explicitly, per Step 4 requirement 6/8** |
| — (no source field yet) | `contact_name` | Personal-sensitive | N/A — not present in the source data at all; would only ever be populated going forward as new contacts are logged |
| — (no source field yet) | `contact_email` | Personal-sensitive | N/A — same as above |
| — (derived from `category` context, e.g. "Carina Tier 1 target" entries added Jul 2026) | `campaign_relevance` | Operational | Yes — this is a categorization label, not personal data |

**Why `note` is held back specifically:** sampled entries include commentary
like *"Approach Fluidlines as the wholesale intro, not Orca directly"* and
strategy framing tied to Carina Brüwer's personal sponsor search. This is
exactly the kind of "personal or confidential notes" Step 4 says not to
migrate blindly. It's not that the content is necessarily *wrong* to store —
it's that a blanket bulk-import wasn't the place to decide that, per your
explicit instruction.

## Proposed two-phase import (pending your approval, in this order)

**Phase A — operational + commercial-sensitive fields only:**
Import `brand`, `category`, `tags`, `is_priority`, `website`,
`value_proposition`, `campaign_relevance` for all 91 entries. Leave
`contact_name`, `contact_email`, `notes` as `NULL`. This alone recreates
~90% of the CRM's practical value (browse/filter/status-track brands) with
zero personal-sensitive data migrated.

**Phase B — notes, only after your explicit review:**
You (or I, under your direction) review the 91 `note` strings, decide which
are safe to import as-is (most are just factual sourcing/approach info, e.g.
*"SA distributor: Fluidlines, Greenpoint + Somerset West"*) versus which
should be trimmed or excluded (anything reading as more personal commentary
than sourcing fact). Only Phase B moves `note` → `notes`.

**`status` for all 91 rows on import:** default `not_contacted`, *except*
brands the Sponsors page's live/deployed status already reflected as further
along (e.g. TRIHARD, Funkita — both have live email threads this session).
I would map those explicitly rather than reset everyone to `not_contacted`,
but that mapping itself should be reviewed by you before Phase A runs, not
assumed.

## Rollback

Both phases are plain `INSERT` statements into empty tables created by this
migration — rollback is `TRUNCATE sponsor_partners CASCADE;` (also clears
`sponsor_partner_audit` via the FK cascade), or drop the tables entirely per
the migration's own rollback block. No data outside these two new tables is
ever touched.

## Test plan (before importing real data)

1. Apply `2026-07-19_create-user-roles.sql`, confirm `has_role('platform_admin')` returns `true` for Dave.
2. Apply `2026-07-19_create-sponsor-crm.sql`.
3. Insert one synthetic test row (not real sponsor data) — confirm the audit trigger fires (`created` row appears in `sponsor_partner_audit`).
4. Update the test row's `status` — confirm a `status_change` audit row appears.
5. Attempt `DELETE` on the test row as `platform_admin` — confirm it is rejected (no delete policy).
6. Archive the test row via `UPDATE ... SET status='archived', archived_at=now()` — confirm it succeeds and is audited.
7. Attempt to read `sponsor_partners` as a user with no role grant — confirm RLS returns zero rows, not an error (standard Postgres RLS behavior — the query succeeds, just returns nothing).
8. Only after 1–7 pass: run the Phase A import (operational + commercial-sensitive fields, 91 rows, no personal data) — as its own reviewed step, not bundled into this same session.
9. Phase B (notes) only after a separate, explicit walkthrough with you.

## What this does NOT do yet

- No UI. The schema exists; `Sponsors/index.html` itself is not rebuilt against it in this pass — that's a further step once the data model is proven (per Step 4 requirement 11: "search, filters and sorting only after security and data model are working," and requirement 12: "keep the first implementation operational, not visually elaborate").
- No `growth_sponsors` migration or merge — that table stays exactly as-is, serving growth-hub.html.
