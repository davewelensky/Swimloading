# SwimLoading Developer Guide

Everything you need to develop, deploy, and maintain the SwimLoading app.

---

## Table of Contents

1. [How the App Works](#how-the-app-works)
2. [Development Workflow](#development-workflow)
3. [Running Locally](#running-locally)
4. [Deploying to Production](#deploying-to-production)
5. [Code Architecture (index.html)](#code-architecture-indexhtml)
6. [Making Common Changes](#making-common-changes)
7. [Supabase Configuration](#supabase-configuration)
8. [DNS & Email Setup](#dns--email-setup)
9. [SQL Scripts](#sql-scripts)
10. [Troubleshooting](#troubleshooting)

---

## How the App Works

SwimLoading is a **single-page PWA** built entirely in one file (`index.html`). It uses Supabase for authentication, database, and real-time features. The app is hosted on Vercel with auto-deploy from GitHub.

**User flow:**
1. User visits `swimloading.com` → sees marketing page (`welcome.html`)
2. Clicks "Open App" → goes to `swimloading.com/app` → loads `index.html`
3. Signs up / logs in via Supabase Auth (email + password)
4. Accepts legal waivers (Terms, Privacy, Liability)
5. Completes profile (name, avatar, experience level)
6. Uses the app: log temps, view trends, create/join swims, check leaderboard

**Auth flow (critical to understand):**
- Supabase sends email links with `#access_token=...&type=recovery` (or `type=signup`)
- The Supabase JS client (`createClient()`) auto-detects and consumes this hash **before** `DOMContentLoaded` fires
- We capture `window.location.hash` into `INITIAL_HASH` at the very top of the first `<script>` block, before `createClient()` runs
- `checkAuth()` uses the saved `INITIAL_HASH` flags (`IS_PASSWORD_RECOVERY`, `IS_EMAIL_VERIFY`, etc.) to route correctly

> **Never move the `INITIAL_HASH` capture below `createClient()`** — the hash will be gone.

---

## Development Workflow

### The Simple Version

```
Edit locally  →  Test in browser  →  Commit & push  →  Auto-deploys to Vercel
```

### Step by Step

1. **Edit files** in `/Users/davewelensky/SwimLoading/` (or use Claude Code)
2. **Test locally** by opening `index.html` in your browser (see [Running Locally](#running-locally))
3. **Commit changes:**
   ```bash
   cd ~/SwimLoading
   git add index.html          # Add specific files
   git commit -m "Description of change"
   ```
4. **Push to GitHub:**
   ```bash
   git push origin main
   ```
5. **Vercel auto-deploys** — within ~30 seconds the change is live at `swimloading.com`

### Branching (for bigger changes)

For risky changes, work on a branch first:

```bash
git checkout -b feature/my-change     # Create branch
# ... make changes, test ...
git add .
git commit -m "Add feature X"
git push -u origin feature/my-change  # Push branch

# When happy, merge to main:
git checkout main
git merge feature/my-change
git push origin main                  # Triggers Vercel deploy
git branch -d feature/my-change      # Clean up
```

### Reverting a Bad Deploy

If something breaks in production:

```bash
# Option 1: Revert the last commit
git revert HEAD
git push origin main

# Option 2: Vercel dashboard → Deployments → click "..." on a previous deploy → "Promote to Production"
```

---

## Running Locally

### Quick way (limited)

Just open `index.html` directly in your browser:
```bash
open ~/SwimLoading/index.html
```
This works for UI changes but Supabase auth redirects will point to `swimloading.com/app`, not your local file.

### Better way (local server)

Use any local server to get proper URL routing:

```bash
cd ~/SwimLoading

# Python (built-in)
python3 -m http.server 8000

# Then open http://localhost:8000/index.html
```

> **Note:** Auth callbacks (password reset, email verify) will still redirect to `swimloading.com/app` since that's configured in Supabase. For testing auth flows, you need to deploy or temporarily change the Supabase redirect URL.

---

## Deploying to Production

### Automatic (recommended)

Every push to `main` on GitHub auto-deploys to Vercel:

```bash
git push origin main
# → Vercel detects push → builds → deploys → live in ~30s
```

### Vercel Dashboard

- **URL:** [vercel.com/dashboard](https://vercel.com/dashboard)
- **Project:** SwimLoading
- **Deployments:** See build history, logs, and rollback options
- **Settings:** Domain config, environment variables

### What Gets Deployed

Everything in the repo root (not in `.gitignore`). Key deployed files:
- `index.html` → served at `/app`
- `welcome.html` → served at `/`
- `sw.js` → service worker
- `manifest.json` → PWA config
- `icons/` → app icons
- `screenshots/` → used by welcome.html

Files that are **not deployed** (in `.gitignore`):
- `archive/` — old backups
- `Deploy_SwimLoading/` — legacy deploy folder
- `.DS_Store`, `node_modules/`, `.vercel/`

---

## Code Architecture (index.html)

The entire app lives in `index.html` (~6000 lines). Here's the structure from top to bottom:

### 1. Head Section (lines ~1-30)
- Meta tags, PWA manifest link, viewport, theme color
- CDN imports: Chart.js, Supabase JS, Lucide icons

### 2. CSS Styles (lines ~30-800)
- CSS custom properties (`:root` variables for theming)
- Component styles: buttons, cards, modals, forms
- Tab navigation styles
- Responsive breakpoints
- Animation keyframes (spin, fadeIn)

### 3. HTML Body Structure (lines ~800-2500)
- **Auth screens:** Login form, signup form, forgot password, reset password
- **Onboarding screens:** Terms/privacy/waiver acceptance, profile setup
- **Main app wrapper** (`#mainApp`):
  - Header (logo, notification bell, avatar)
  - Tab navigation (Dashboard, Temps, Trends, Swims, Safety)
  - Tab content panels
  - Modals (profile settings, event details, etc.)

### 4. JavaScript (lines ~2500-6100)

#### Initialization (top of first `<script>`)
```
INITIAL_HASH capture → IS_PASSWORD_RECOVERY / IS_AUTH_ERROR / IS_EMAIL_VERIFY flags
SUPABASE_URL + SUPABASE_ANON_KEY constants
supabaseClient = createClient(...)
AVATARS array (icon definitions with colors)
currentUser variable
```

#### Key Functions (in rough order)

| Function | What it does |
|----------|-------------|
| `checkAuth()` | Entry point — routes based on auth state and URL hash flags |
| `waitForSession(maxMs)` | Polls for Supabase session (used after password reset redirect) |
| `showAuth()` | Shows login/signup screen |
| `signIn(email, pass)` | Handles login |
| `signUp(email, pass)` | Handles registration + shows verification screen |
| `sendPasswordReset(email)` | Sends reset email with 60s cooldown |
| `showResetPasswordForm()` | Shows the "set new password" form |
| `resetPassword(newPass)` | Submits new password to Supabase |
| `loadApp()` | Main bootstrap — loads profile, checks terms, shows main UI |
| `updateHeaderAvatar(url)` | Sets header avatar icon + color |
| `showDashboard()` | Loads dashboard stats, upcoming swims, recent logs |
| `showTemps()` | Temperature logging screen |
| `submitTempLog()` | Submits a temp reading (with 1hr spam cooldown) |
| `showTrends()` | Temperature trend charts |
| `loadTrendChart(spotId)` | Fetches data and renders Chart.js chart |
| `showSwims()` | Lists swim events |
| `createEvent(...)` | Creates a new swim event |
| `loadEventDetails(id)` | Shows event detail modal with participants |
| `rsvpToEvent(id, status)` | RSVP with safety gate for "going" |
| `checkSafetyInfo()` | Blocks RSVP if emergency contacts missing |
| `showLeaderboard()` | Community rankings |
| `showSafety()` | Safety information page |
| `showProfileSettings()` | Profile edit modal |
| `saveProfileSettings()` | Saves profile + emergency contacts |
| `showNotifications()` | Notification panel |
| `showToast(msg, type)` | Toast notification helper |

---

## Making Common Changes

### Adding a new swim spot

1. Insert into Supabase `spots` table:
   ```sql
   INSERT INTO spots (name, code, lat, lng, type, water_type, domain)
   VALUES ('Spot Name', 'SPOT_CODE', -34.xxx, 18.xxx, 'OCEAN', 'salt', 'atlantic');
   ```
2. The `code` column is **required** — without it, the spot won't appear in Trends (the `latest_spot_temps` view filters `WHERE s.code IS NOT NULL`).
3. Save the SQL to `sql/applied/add_[spot_name].sql` for the record.

### Adding a new hazard button

In `index.html`, find the hazards toggle group (search for "Jellyfish") and add a new button:
```html
<div class="toggle-btn" onclick="this.classList.toggle('active')">🆕 New Hazard</div>
```

### Adding a new tab/page

1. Add a nav button in the tab bar HTML
2. Add a content panel div (`<div id="myTabContent" class="tab-content">`)
3. Add a `showMyTab()` function in JavaScript
4. Wire up the nav button's `onclick`

### Changing styles

All CSS is in the `<style>` block at the top of `index.html`. Key variables:
```css
:root {
    --primary: #0ea5e9;        /* Main blue */
    --primary-dark: #0284c7;
    --bg-primary: #0f172a;     /* Dark background */
    --bg-secondary: #1e293b;   /* Card background */
    --text-primary: #f1f5f9;
    --text-secondary: #94a3b8;
}
```

### Modifying Supabase queries

All Supabase calls use the JS client pattern:
```javascript
const { data, error } = await supabaseClient
    .from('table_name')
    .select('columns')
    .eq('column', value)
    .single();
```

---

## Supabase Configuration

### Project Details
- **Dashboard:** [supabase.com/dashboard](https://supabase.com/dashboard)
- **Project region:** (check dashboard)
- **API URL:** Set as `SUPABASE_URL` constant in `index.html`
- **Anon Key:** Set as `SUPABASE_ANON_KEY` constant in `index.html`

### Auth Settings (Authentication → URL Configuration)
- **Site URL:** `https://swimloading.com/app`
- **Redirect URLs:** `https://swimloading.com/app`

### Auth Settings (Authentication → Auth Providers)
- **Email:** Enabled
- **Confirm email:** ON (users must verify email)

### Email Templates (Authentication → Email Templates)
Templates configured for:
- Confirm signup
- Reset password
- Magic link (if used)

### Row Level Security
RLS is enabled on all tables. Policies are documented in `sql/applied/rls_policies.sql`.

**Key policy patterns:**
- Users can read their own profile, update their own profile
- All authenticated users can read spots, temp_logs, swim_events
- Users can only insert/update/delete their own temp_logs
- Event members can only manage their own RSVPs

### Database Functions & Triggers
Managed via SQL Editor in Supabase dashboard. Scripts saved in `sql/applied/`:
- `fix_spam_logs.sql` — 1hr cooldown trigger
- `new_user_notification.sql` — Admin notification on signup
- `supabase_cleanup.sql` — Auto-delete old temp logs

---

## DNS & Email Setup

### Domain (GoDaddy → Vercel)
- Domain `swimloading.com` registered on GoDaddy
- DNS pointed to Vercel nameservers
- Vercel manages the domain and SSL

### Email (Resend via Supabase)
- Supabase Auth sends emails via Resend SMTP
- Sending domain: `getcls.co` (configured in Resend)
- DNS records on Cloudflare for `getcls.co`:
  - **SPF** — `v=spf1 include:amazonses.com ~all`
  - **DKIM** — Resend DKIM record
  - **DMARC** — `v=DMARC1; p=none; ...` (set to `p=none` for new domain)

> If emails are slow or not arriving, check:
> 1. Resend dashboard for delivery status
> 2. DMARC policy (should be `p=none` while building sender reputation)
> 3. User's spam folder

---

## SQL Scripts

### `sql/applied/` — One-time scripts (already executed)

These have been run in Supabase SQL Editor and exist here for documentation/version control:

| Script | What it does |
|--------|-------------|
| `rls_policies.sql` | Row Level Security policies for all tables |
| `add_emergency_contacts.sql` | Added phone, emergency_contact_name, emergency_contact_phone to profiles |
| `add_virgin_active_pools.sql` | Inserted 7 Virgin Active pool spots |
| `fix_virgin_active_pools.sql` | Added missing `code` column values + Wembley Square |
| `add_langebaan_zones.sql` | Renamed Langebaan → Pearly's, added Island/Channel/Mykonos/Kraalbaai |
| `new_user_notification.sql` | Trigger: notifies Dave on new user signup |
| `fix_spam_logs.sql` | Trigger: 1hr cooldown per user per spot + cleaned up existing dupes |
| `rsvp_schema_update.sql` | RSVP schema changes |
| `supabase_cleanup.sql` | Auto-remove temp_logs older than 4 days |

### `sql/debug/` — Diagnostic queries

Safe to re-run anytime for debugging:

| Script | What it does |
|--------|-------------|
| `check_spots_and_view.sql` | Queries spots table and latest_spot_temps view |
| `check_view_definition.sql` | Shows the SQL definition of latest_spot_temps view |

### Writing new SQL scripts

When you need to make database changes:

1. Write the SQL and test it in Supabase SQL Editor
2. Save the script to `sql/applied/descriptive_name.sql`
3. Add a comment at the top of the file with date and what it does
4. Commit to git so there's a record of every database change

---

## Troubleshooting

### Password reset redirects to main app instead of reset form
- **Cause:** `INITIAL_HASH` capture is missing or below `createClient()`
- **Fix:** Ensure `const INITIAL_HASH = window.location.hash;` is the very first line in the first `<script>` block

### New spots don't appear in Trends
- **Cause:** The `latest_spot_temps` view has `WHERE s.code IS NOT NULL`
- **Fix:** Make sure the spot has a `code` value in the `spots` table

### Service worker serves stale content (especially on iPhone)
- **Cause:** Cache-first strategy for HTML
- **Fix:** SW v2 uses network-first for HTML. If updating SW, bump the cache version name in `sw.js`

### Emails not arriving
- Check Resend dashboard for bounces/failures
- Check DMARC policy on `getcls.co` (should be `p=none`)
- Check user's spam folder
- Supabase rate-limits auth emails to ~4/hour per email address

### Leaderboard gaming (spam temp logs)
- **Prevention:** App-side 1hr cooldown check in `submitTempLog()` + database trigger `check_temp_log_cooldown`
- **Cleanup:** Use query pattern from `fix_spam_logs.sql` to find and remove dupes

### Vercel deploy not updating
- Check Vercel dashboard → Deployments for build errors
- Make sure you pushed to `main` branch
- Hard refresh browser (`Cmd+Shift+R`) to bypass service worker cache

### Auth callback URL mismatch
- **Supabase Site URL** must be `https://swimloading.com/app`
- **Redirect URLs** must include `https://swimloading.com/app`
- All `redirectTo` in code must use `window.location.origin + '/app'`

---

## Quick Reference

### Key URLs
| What | URL |
|------|-----|
| Live site | https://swimloading.com |
| Live app | https://swimloading.com/app |
| GitHub repo | https://github.com/davewelensky/Swimloading |
| Vercel dashboard | https://vercel.com/dashboard |
| Supabase dashboard | https://supabase.com/dashboard |
| GoDaddy domain | https://dcc.godaddy.com |
| Resend dashboard | https://resend.com |

### Key Files to Edit
| Change | File |
|--------|------|
| App features, UI, logic | `index.html` |
| Marketing page | `welcome.html` |
| URL routing | `vercel.json` |
| PWA config | `manifest.json` |
| Service worker / caching | `sw.js` |
| Database schema | Supabase SQL Editor → save to `sql/applied/` |

---

*Last updated: 2026-02-16*
