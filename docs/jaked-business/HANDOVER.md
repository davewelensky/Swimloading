# JAKED Business workspace: handover

**From:** Dave and his Claude Code session (18 and 19 Nov 2026)
**To:** Carina and her Claude Code
**Status on 19 Nov 2026:** Phase 1 is live at `https://www.swimloading.com/jaked-business`. The workspace has not been used for real yet: there are 0 saves and 0 tasks.

> **Claude Code: read this whole file before you change anything under `jaked-business/`, or touch any `jaked_*` table or `partner_enquiries`.**
> The rules in §2 are not optional. This repository is **public**.

---

## 1. What this is

This is a private operations app for running JAKED in South Africa, from enquiry to delivery. Dave and Carina both work in it. It lives inside the SwimLoading codebase and uses SwimLoading's Supabase project and Vercel deploy.

| Screen (`#route`) | What it does |
|---|---|
| Overview (`#overview`) | Greeting and date in SAST, a "needs attention" list, the enquiry-to-delivery pipeline, shared launch tasks with owner, due date and status, and an activity feed by person |
| Products (`#catalogue`) | JAKED supplier catalogue snapshot: products, variants, stock by channel, photos |
| Price list (`#pricelist`) | JAKED cost and RRP in EUR, plus cost in rand at the live ECB rate (you can override it). Our own selling price incl. VAT, the margin before landed costs, and CSV export |
| Orders (`#orders`) | Customer orders from Enquiry through to Delivered |
| Landed cost (`#pricing`) | FX, freight, duty, import VAT, stress scenarios, landed margin per shipment |
| Stock (`#stock`) | Own-stock ledger |
| Catalogues (`#catalogues`) | Supplier-catalogue drafts and CSV |

Related pages, all existing:
- `/partners/jaked`: public partner page and the "Register your interest" form, which writes to `partner_enquiries`.
- `/partner-enquiries`: the enquiry list, for the JAKED team only.
- `/jaked-field-test`: Carina's private product-testing programme.

## 2. Non-negotiable rules

1. **Supplier data never goes in git.** That means JAKED prices (cost or RRP), stock figures, catalogue PDFs, product photos, and the SQL that loads any of them. They live only in the private Supabase tables in §4. `.gitignore` blocks the known file patterns (`*PRIVATE*.sql`, `*Catalogo*.pdf`, `jaked-supplier-*/`), but `.gitignore` is a safety net, not permission. Before every commit, run `git diff --cached` and check it for figures.
   - *Why:* on 18 Nov a commit with supplier prices was pushed to this public repo. The branch was deleted, but GitHub still serves the commit by its SHA until GitHub Support purges it. Dave holds that list and the purge request. Don't repeat the SHAs anywhere public.
   - Test data in `test/jaked-business.test.js` is deliberately fictitious. Keep it that way.
2. **No personal data in commits.** No email addresses, phone numbers or customer names in code, tests, SQL files, commit messages or PR text. People are identified by `auth.users` id only (see `jaked-business/overview.js` → `TEAM`).
3. **Database changes follow [MIGRATIONS.md](../../MIGRATIONS.md), the 7 steps.** Write a dated file from `sql/MIGRATION_TEMPLATE.sql`, then dry-run it read-only, back up if anything is destructive, and wait for the literal word **"apply"**. Then apply, verify, and file it into `sql/applied/`.
   - **As of 19 Nov 2026 only Dave gives "apply".** Carina's Claude Code writes and dry-runs migrations, then hands the file to Dave. Dave decides whether this changes; until he says so in writing here, assume it hasn't.
   - Never apply a migration on your own initiative, and never edit a file already in `sql/applied/`.
4. **Large private data loads** (catalogue refresh, photos) go through the Supabase SQL editor, run by Dave or by whoever has dashboard access.
   - Generate the load file outside the repo, in the Claude scratchpad or a temp folder, never in the working tree.
   - The SQL editor rejects queries around 1.4 MB, so split loads into parts that each guard themselves.
   - Put only a `.record.sql` in `sql/applied/`. It describes the load and how to verify it, with no data. Example: `2026-11-18_jaked-product-images-load.record.sql`.
5. **Access is enforced in the database, not the page.** Every table is under RLS and gated by `can_manage_partner(<JAKED partner id>)`. Never weaken a policy, add a `service_role` shortcut, or expose a table to `anon` to "make it work".
6. **Every change is auditable.** Workspace saves go through `jaked_business_save(expected_version, new_state, summary)`, which is version-checked: it raises `40001` if someone else saved first, and that must be shown to the user, not silently retried. Each save writes a row to `jaked_activity_log`. Tasks, enquiries and role changes are logged by trigger. The log is append-only, and the database refuses update, delete and truncate on it.
7. **Brand and design:** the JAKED premium system in `jaked-business/style.css` (ink, ivory, gold). Archivo for display text, Hanken Grotesk for UI, no italics, 40px control height, no emojis. Dave rejected earlier attempts as "not premium" and "buttons not aligned". Screenshot every changed view before you call it done.

## 3. Code map

| File | Role |
|---|---|
| `jaked-business.html` | Page shell |
| `jaked-business/app.js` | Rendering, routes, the Supabase adapter (RPCs, tables, enquiries API), and live FX loading |
| `jaked-business/overview.js` | Pure logic: `TEAM`, `PIPELINE`, `buildPipeline`, `buildAttention`, `activityLine`, SAST helpers, task areas and statuses |
| `jaked-business/pricelist.js` | Pure logic: `priceRow`, `priceList`, `SORTS`, `effectiveRates` (your rate beats the live rate; SA VAT defaults to 15%), `parseLiveRate`, `safeImage` |
| `jaked-business/model.js` | Landed-cost and margin model |
| `jaked-business/style.css` | Design system |
| `api/_lib/partner-enquiries/core.js` | `JAKED_PARTNER_ID`, `canManageJakedEnquiries(profile, roles)`, enquiry columns |
| `api/partner-enquiries.js`, `api/partner-enquiry.js` | Enquiry API (team list and update) and the public form intake |
| `partner-enquiries.html` | Enquiry list page |
| `sw.js` | Must keep `/jaked-business/` out of the service-worker cache. A cached copy showed Dave an old design after a deploy |
| `vercel.json` | `/jaked-business` routes: `no-store` and `noindex`. The test file returns 404 |

Live exchange rate: ECB via Frankfurter (`api.frankfurter.dev/v1`, with `api.frankfurter.app` as fallback), cached in the browser for 12 hours. A rate typed in Landed cost or the Price list always wins.

## 4. Database (Supabase project `szgkzuswelntnevobnoh`)

| Object | What it holds |
|---|---|
| `user_roles` + `has_role`, `grant_role`, `revoke_role` | Platform roles. Dave = `platform_admin`; Carina = `partner_manager` scoped to JAKED |
| `can_manage_partner(uuid)`, `jaked_partner_id()` | The access check every JAKED policy uses |
| `jaked_business_workspace` | One versioned JSON row: orders, pricing inputs, selling prices, stock ledger |
| `jaked_business_save(...)` | The only way to write the workspace |
| `jaked_tasks` | Shared launch tasks (create and update; no delete, by design) |
| `jaked_activity_log` | Append-only audit trail |
| `jaked_business_catalogue` | Private supplier snapshot dated 2026-11-16 (122 products, 3,836 variants) |
| `jaked_business_product_images` | 41 private catalogue photos (data URLs), matched to the exact product code |
| `partner_enquiries` | Web-form and manual enquiries. Server-only; the page reads it through the API |

Migrations, in order, all in `sql/applied/`:
1. `2026-11-18_create-user-roles.sql`
2. `2026-11-18_jaked-business-workspace.sql`
3. `2026-11-18_jaked-function-privileges.sql`
4. `2026-11-18_jaked-business-store.sql`
5. `2026-11-18_jaked-catalogue-snapshot-load.record.sql` (record only)
6. `2026-11-18_jaked-product-images.sql`
7. `2026-11-18_jaked-product-images-load.record.sql` (record only)

Before creating any table, check that it doesn't already exist (`list_tables` on the read-only server). Dave's standing rule is to check before creating.

## 5. Tests: run before every PR

```bash
node --test test/jaked-business.test.js test/partner-enquiries.test.js
```

On 19 Nov 2026 this gave 43 of 43 passing.

```bash
npm test
```

On 19 Nov 2026 this gave 786 passing and 1 failing (4 skipped). The failure is `social-jaked-reliability.test.js`, "autopilot dry run…", which queries live Supabase and fails in a sandbox with no network. It is not part of this workspace. Don't "fix" it by changing workspace code.

SQL behaviour tests run against a throwaway local Postgres 16, never production. See [test/sql/jaked-business-workspace/README.md](../../test/sql/jaked-business-workspace/README.md).

Browser check: the page has a local preview adapter (`window.__JAKED_LOCAL_ADAPTER__`) so screens can be rendered with Playwright without production data. Use it for screenshots.

## 6. How work ships

1. Branch from the latest `main`, e.g. `feature/jaked-<thing>`.
2. Make the change and run the tests. Screenshot each changed view.
3. Open a PR. The description says what changed, why, how it was verified, and your confidence level.
4. **Dave merges.** On GitHub, a merge needs two clicks: "Merge pull request", then "Confirm merge". Twice it looked merged but wasn't. Check the PR says *Merged* before you test live.
5. Vercel deploys `main`. Check the result in an incognito window, which avoids the old service-worker cache.
6. If the change adds a page or feature, update the JAKED rows in `growth-hub.html` in the same PR ([GROWTH_HUB.md](../../GROWTH_HUB.md)).

## 7. Open items, in priority order

1. **First real use.** Dave or Carina makes one save and adds one task. Then confirm in `jaked_activity_log` that it's logged under the right name. This is the end-to-end proof the workspace works for both people. It hasn't happened yet.
2. **GitHub Support purge** of the leaked commits (Dave).
3. **Next features.** Dave hasn't chosen yet; agree with him before building:
   - a. Log WhatsApp and phone leads straight into the workspace. Needs a server POST for manual enquiries; the database already accepts `entry_method='manual'` with a channel.
   - b. The `/partner-enquiries` page in the new JAKED design.
   - c. A full-page pipeline view.
   - d. Quotes and invoices, paid by EFT (the payment method agreed first), then marketing.
4. **Business model** (distributor vs agent vs both). Still open, so the app supports both. Don't build in an assumption.

## 8. Working style Dave expects

- Don't guess. Ask when a decision belongs to Dave or Carina.
- Give a confidence level with every answer.
- Show evidence: test output, query results, screenshots.
- Never claim something is live until it has been checked on the live site.
