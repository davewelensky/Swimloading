# Channel Pro Access Model — Scope

**Status:** scoping only. No code changes, no migration, nothing applied.
**Trigger:** the Channel Pro paywall on `english-channel.html` was found gating
real content (16-day forecast, full records, prediction tool, tide window
editor) behind `isChannelPro()`, which checks a **2-email array hardcoded in
the page source** (`dave.welensky@gmail.com`, `lindi@mitchell.co.za`). The
funnel-discovery fix (linking the gate to `/pricing`, linking `/pro` from the
homepage) shipped 2026-07-21 — this scope covers the access model itself,
which that fix deliberately left untouched.

---

## The problem in one sentence

Granting Channel Pro access today means editing `english-channel.html`,
committing, and redeploying the whole site — for one person.

## Current state

```js
const CHANNEL_PRO_ALLOWLIST = ['dave.welensky@gmail.com', 'lindi@mitchell.co.za'];
...
async function loadChannelProStatus() {
    const { data: { session } } = await sb.auth.getSession();
    const email = (session?.user?.email || '').toLowerCase();
    _channelProUser = email && CHANNEL_PRO_ALLOWLIST.includes(email);
}
function isChannelPro() { return !!_channelProUser; }
```

`/pricing` describes a real (manual) purchase flow — "Email
support@swimloading.com with your payment confirmation. We'll link Pro
access to your SwimLoading account within 24 hours" — but nothing in the
code executes that link. There is currently no path from "someone paid" to
"the array contains their email" other than Dave hand-editing a file.

This also means: no expiry, no plan tier (the pricing page lists three tiers
— single route / Big 5 / all routes — the allowlist has none of that
distinction), no per-swimmer visibility into their own access, and no way to
revoke access without another deploy.

## Proposed model

Move access to a **`channel_pro_access` table**, checked via Supabase from
the client (same shape as `feature_flags`, but per-user and per-route rather
than global):

```sql
CREATE TABLE channel_pro_access (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id),
  route        text NOT NULL,        -- 'english-channel' | 'all' | future route slugs
  tier         text NOT NULL,        -- 'single' | 'big5' | 'all' — matches pricing.html tiers
  granted_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,          -- NULL = no expiry (manual admin grants); real subscriptions get one
  granted_by   text,                 -- 'admin_manual' | future: 'stripe_webhook'
  UNIQUE (user_id, route)
);
```

- **RLS:** own-row `SELECT` only (a swimmer can see their own access, nothing
  else) — mirrors the `push_subscriptions` pattern already in place.
- **Client check** (`loadChannelProStatus`) becomes a single-row `SELECT`
  instead of an array lookup: `WHERE user_id = auth.uid() AND route IN
  ('english-channel','all') AND (expires_at IS NULL OR expires_at > now())`.
- **Granting access** becomes an admin-panel action (a form in `/admin`:
  email → route → tier → optional expiry → insert row) instead of a code
  change. Dave grants access the same way he already handles the manual
  "email support@, we link it within 24 hours" flow — just via a UI button
  instead of a git commit.

## What this does NOT include (explicitly out of scope for this piece)

- **No payment processing.** The manual email → admin-grants-access flow
  stays manual. Automating checkout (Stripe, PayFast, whatever) is its own,
  separate, much larger piece of work — this scope only fixes "how does a
  granted swimmer's access get recognised by the code," not "how does money
  get collected."
- **No changes to pricing, tiers, or copy** on `/pricing` — this is a
  backend/access-check swap, not a repricing.
- **No other crossing pages.** `english-channel.html` is the only page using
  `isChannelPro()` today; the `route` column is designed so other crossings
  (Robben Island, Catalina, etc.) can reuse the same table later without a
  schema change, but wiring them up is separate work.

## Migration shape (when approved to build)

1. `sql/YYYY-MM-DD_channel-pro-access.sql` — new table + RLS policies
   (additive only, no existing data touched).
2. One-time backfill: insert rows for the 2 current allowlist emails
   (`route='all'`, `tier='all'`, `expires_at=NULL`, `granted_by='admin_manual'`)
   so Dave and Lindi's access carries over exactly as it is today — zero
   behaviour change for them.
3. `english-channel.html`: replace `CHANNEL_PRO_ALLOWLIST` + the array check
   with the Supabase row lookup.
4. Admin panel: a small "Grant Channel Pro access" form (email lookup →
   route → tier → expiry) writing to the new table.
5. Test plan (mirroring this session's pattern): rolled-back transaction
   scenarios — grant with no expiry, grant with a future expiry, grant with
   a past expiry (must read as NOT pro), no row at all, wrong route, RLS
   cross-user check (user A cannot see user B's row).

## Effort estimate

Small-to-medium. The table + RLS + client swap is a single migration +
one function edit, similar in size to the Passport RPC work already shipped
this session. The admin grant form is the same shape as the Partner Report
builder already shipped. No new infrastructure (no payment gateway, no
webhook) — that's the part that would make this a bigger job, and it's
explicitly excluded above.

## Decision needed before building

Nothing controversial — this is close to "the obvious right shape" given
what already exists in the codebase (`feature_flags`, `push_subscriptions`
both use the same own-row-RLS pattern). The one real choice:

- **Expiry enforcement now, or later?** The table supports it from day one,
  but if nobody's Pro access is meant to lapse yet (i.e. every current/near-term
  grant is a manual, indefinite "yes"), the admin form can default
  `expires_at` to NULL and the expiry logic simply never fires until you
  want it to. No reason to block on this — build it in, use it or don't.
