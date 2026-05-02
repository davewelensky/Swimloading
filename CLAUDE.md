# SwimLoading — Architecture & Deployment Guide

> **Adding a region, spot, or international domain?** See [EXPANDING.md](EXPANDING.md) — it has the complete checklist, hardcode map, and cross-app consistency checks.

## Architecture Overview (Split April 2026)

The codebase was split from a single 12,300-line `index.html` into modular files to prevent crashes and improve maintainability.

### File Structure

```
index.html (1,792 lines)
  ├─ HTML shell only
  ├─ Links to: app.js, app-nav.js, app-trends.js, app-fuel.js, style.css
  └─ All scripts use global scope (NOT ES modules)

app.js (6,879 lines)
  ├─ Core app initialization
  ├─ Auth / Dashboard / Home page
  ├─ Temperature logging
  ├─ Real-time updates
  └─ All shared utilities

app-nav.js (1,375 lines)
  ├─ Navigation logic & UI
  ├─ Profile completion
  ├─ Onboarding flow
  ├─ User settings
  └─ Account management

app-trends.js (829 lines)
  ├─ Trends tab
  ├─ Region grid rendering
  ├─ Temperature analytics
  └─ Historical data views

app-fuel.js (282 lines)
  ├─ Fuel/Challenges tab
  ├─ April Challenge UI
  ├─ Leaderboard
  └─ Points system

app-strava.js
  ├─ Strava connection UI (dashboard banner, profile card)
  ├─ Activity import modal
  ├─ Log form (prefill spot/date from activity)
  └─ Submit to /api/strava/import-activity

api/strava/
  ├─ connect-url.js   — GET, returns signed OAuth URL
  ├─ callback.js      — handles OAuth redirect, stores tokens
  ├─ token-helper.js  — shared: getValidStravaToken, getUserId
  ├─ activities.js    — fetches swims, spot matching, upserts strava_imports
  └─ import-activity.js — creates temp_log from selected activity

style.css (1,138 lines)
  ├─ All styling (dark theme)
  ├─ Desktop & mobile responsive
  ├─ Component styles (cards, buttons, nav)
  └─ Media queries for mobile optimization

manifest.json
  └─ PWA manifest (home screen install)

sw.js
  └─ Service worker (offline support)

vercel.json
  └─ Vercel routing & cache config (CRITICAL)
```

### Script Loading Order

All scripts are loaded sequentially in `index.html` **with global scope** (no ES modules). Order matters:
1. `app.js` — initializes everything, sets up global functions
2. `app-nav.js` — depends on app.js globals
3. `app-trends.js` — depends on app.js globals
4. `app-fuel.js` — depends on app.js globals
5. `app-strava.js` — depends on app.js globals (Strava integration)
6. `style.css` — styling applied after DOM loaded

**Cache busting:** Bump the `?v=N` query string on any script tag when you change that file (e.g. `app-strava.js?v=3`). Vercel's edge cache won't invalidate otherwise.

## Data Model

### Key Supabase Tables

- **users** — auth, profile status (onboarding_completed_at), home_domain
- **spots** — swim locations (name, code, domain, type, latitude, longitude)
- **domains** — regions (code, display_name, is_coastal, sort_order)
- **temp_logs** — temperature readings (spot_id, temperature, created_at, created_by)
- **swim_events** — upcoming group swims (title, date, domain, participants)
- **leaderboard** — April 2026 challenge scores (user_id, points, rank)
- **strava_connections** — OAuth tokens per user (service role writes; RLS enforced)
- **strava_imports** — cached Strava activities; `imported_to_log_id` set once imported

### Key Global Variables

```javascript
let supabaseClient  // Supabase client instance
let currentUser     // Logged-in user object
let currentUserProfile  // Full profile (onboarding_completed_at, home_domain, etc.)
let domains = []    // All regions (loaded at startup)
let conditionsCache // Temperature cache by spot
let swimEventsCache // Upcoming swims cache
```

## Deployment Process

### Local Development Workflow

```bash
# 1. Make changes to any file (app.js, style.css, index.html, etc.)
# 2. Test locally in browser (F12 dev tools)

# 3. Commit changes
git add <file>
git commit -m "description of change"

# 4. Push to GitHub
git push

# 5. Vercel auto-deploys (watches main branch)
# Monitor: https://vercel.com/davewelensky/swimloading
```

### Vercel Configuration (vercel.json)

**CRITICAL:** Cache headers prevent stale assets from being served.

```json
{
  "routes": [
    {
      "src": "^/style\\.css$",
      "dest": "/style.css",
      "headers": {
        "Cache-Control": "no-cache, no-store, must-revalidate"
      }
    },
    {
      "src": "^/sw\\.js$",
      "dest": "/sw.js",
      "headers": {
        "Cache-Control": "no-cache",
        "Service-Worker-Allowed": "/"
      }
    },
    {
      "src": "^/app$",
      "dest": "/index.html",
      "headers": {
        "Cache-Control": "no-cache, no-store, must-revalidate"
      }
    }
  ]
}
```

**Without these headers**, Vercel's edge cache serves old versions of CSS/JS even after redeployment.

### Deployment Checklist

1. ✅ Change file (app.js, style.css, etc.)
2. ✅ `git add <file>`
3. ✅ `git commit -m "message"`
4. ✅ `git push`
5. ✅ Vercel redeploys automatically
6. ✅ Hard refresh browser: **Cmd+Shift+R** (Mac) or **Ctrl+Shift+R** (Windows)

**If changes don't appear**: Check Vercel dashboard for failed deployments, verify cache headers in vercel.json.

## Making Changes — By Feature

### Adding a New UI Component

1. **Decide which file**: Dashboard → `app.js` | Nav → `app-nav.js` | Trends → `app-trends.js`
2. **Add HTML** to the appropriate section in `index.html`
3. **Add JS logic** to the matching file (app.js, app-nav.js, etc.)
4. **Add CSS** to `style.css`
5. **Commit + Push** (see Deployment Checklist above)

### Fixing Styling (CSS)

1. Edit `style.css`
2. Commit + Push (Vercel redeploys)
3. Hard refresh browser
4. If old CSS still appears: Check cache headers in `vercel.json`

### Updating Navigation UI

1. Modify nav buttons in `index.html`
2. Update logic in `app-nav.js`
3. Update CSS in `style.css` (media queries for mobile!)
4. Commit + Push
5. Hard refresh on live site

### Adding a New Database Table

1. Create migration in Supabase (`supabase/migrations/`)
2. Deploy via Supabase CLI
3. Update `app.js` with fetch queries
4. Test locally
5. Commit + Push

## Mobile Optimization

### Responsive Design Breakpoints

```css
@media (max-width: 520px) {
  /* Mobile styles here */
  /* These override desktop defaults */
}
```

**Important:** Always test changes on actual mobile device (not just browser resize).

### Common Mobile Issues

- **Icons squeezed**: Check `flex-direction: column` and `gap` property
- **Text too small**: Ensure `font-size` is readable on small screens
- **Buttons hard to tap**: Ensure padding/height ≥ 44px (Apple guidelines)

## Performance Considerations

### File Size Impact

- app.js is 371K (largest)
- If it exceeds 500K, consider splitting further (e.g., challenges logic into separate file)

### Lighthouse Monitoring

Vercel provides Lighthouse scores in deployment preview. Monitor:
- First Contentful Paint (FCP) < 2s
- Cumulative Layout Shift (CLS) < 0.1
- Largest Contentful Paint (LCP) < 2.5s

## Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| Blank page | Script load failed | Check browser console (F12), verify all .js files exist |
| Old CSS/JS still visible | Edge cache not invalidated | Bump `?v=N` on script tags; verify `Cache-Control: no-cache` in vercel.json |
| Nav icons squeezed | CSS not applied to mobile | Check `@media (max-width: 520px)` rules |
| Supabase error 401 | Auth token expired | Auto-refreshes on page reload |
| Changes don't appear | Not pushed to git | Run `git push` before hard refresh |
| Strava "Limit of connected athletes" | Sandbox = 1 athlete max | Revoke existing connection at strava.com → My Apps, reconnect |
| Strava save does nothing | Missing strava_imports row or stale form state | import-activity.js creates row inline; form state resets on open |
| Toast hidden behind modal | z-index clash | Toast z-index must be 99999; stravaLogModal is 10004 |
| Strava connect-url 500 | Missing env vars in Preview | SUPABASE_URL hardcoded fallback in all api/strava/*.js files |

## Strava Integration

### Principle
"Strava tracks the swim. SwimLoading tracks the water." Users import a Strava activity and add water temperature, conditions, and hazards that Strava doesn't capture.

### Required Vercel Env Vars
- `STRAVA_CLIENT_ID` — 230706
- `STRAVA_CLIENT_SECRET` — (secret; regenerate at strava.com/settings/api if leaked)
- `STRAVA_REDIRECT_URI` — `https://www.swimloading.com/api/strava/callback`
- `STRAVA_HMAC_SECRET` — signs OAuth state parameter

### Sandbox Limit
Currently 1 athlete allowed (sandbox). Production quota requires emailing `developers@strava.com` — 7-10 business day review. Include Client ID 230706 and read-only justification.

### GPS Spot Matching
Spots GPS columns: `latitude`/`longitude` (NOT `lat`/`lng`). Haversine radius: 1.5km.

## Deployment Monitoring

- **Live site:** https://www.swimloading.com
- **Vercel fallback:** https://swimloading.vercel.app
- **Vercel dashboard:** https://vercel.com/davewelensky/swimloading
- **GitHub commits:** https://github.com/davewelensky/Swimloading/commits/main

## Brand Guidelines

Use these for every page, demo, email, or component built for SwimLoading. Do not deviate without explicit instruction.

### New Page Checklist
Every SwimLoading HTML page must have all of the following before shipping:
1. **Nav brand** — `logo-wave.png` (22px) + "SwimLoading" gradient text (see below)
2. **Mouse spotlight** — `body::before` CSS + `mousemove` JS (see below)
3. **No emojis** — Lucide icons only
4. **Dark background** — `#080f1a` or `#0a1628`
5. **Fonts** — Bebas Neue (headings) + DM Sans (body) — never Inter/Roboto/system-ui on branded pages

### Logo Assets (`/icons/`)

| File | What it is | When to use |
|------|-----------|-------------|
| `logo-wave.png` | Wave mark only (no text), cyan on transparent | **Nav bars** — use alongside "SwimLoading" text |
| `logo-nav.png` | Wave mark + "SWIMLOADING" wordmark stacked, cyan | Auth screens / login panels only (used at ~56px) |
| `logo.png` | Rounded square app icon (swimmer in water) | App store, PWA, favicon contexts only |
| `icons/icon.svg` | SVG wave icon | Favicon / `<link rel="icon">` |

**Nav brand HTML (always this pattern):**
```html
<a href="https://swimloading.com" style="display:flex;align-items:center;gap:7px;text-decoration:none;font-size:15px;font-weight:800;letter-spacing:-0.5px;background:linear-gradient(135deg,#38bdf8 0%,#0ea5e9 50%,#0284c7 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
  <img src="/icons/logo-wave.png" alt="" style="height:22px;width:auto;">SwimLoading
</a>
```
The text uses a **cyan gradient** (`#38bdf8 → #0ea5e9 → #0284c7`), weight 800, font-size 20px (mobile) / 24px (desktop), letter-spacing -0.5px. Never plain white.

### Buttons (marketing pages / demos)
- **Primary**: `background: #38bdf8`, `color: #080f1a`, `border-radius: 50px`, `font-weight: 700`, `padding: 13px 26px` — pill shape
- **Ghost**: `background: transparent`, `border: 1px solid rgba(255,255,255,0.15)`, `border-radius: 50px`, same padding
For pages in subdirectories (e.g. `/blog/`), use `../icons/logo-wave.png`.

### Colors

```css
--bg:          #080f1a   /* primary dark background */
--bg-card:     #0d1728   /* card background */
--cyan:        #38bdf8   /* brand accent — buttons, links, highlights */
--text:        #f1f5f9   /* primary text */
--text-sec:    #64748b   /* secondary/muted text */
--border:      rgba(255,255,255,0.06)
--amber:       #f59e0b   /* warnings, alerts */
--green:       #10b981   /* success, qualifies */
--danger:      #ef4444   /* errors */
```

### Typography

- **Headings / display:** `Bebas Neue` (Google Fonts)
- **Body / UI:** `DM Sans` (Google Fonts)
- Never use Inter, Roboto, Arial, or system-ui for SwimLoading branded pages

Google Fonts import:
```html
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,300&display=swap" rel="stylesheet">
```

### No emojis
Never use emojis in any SwimLoading UI. Use Lucide icons instead (`https://unpkg.com/lucide@latest`).

### Mouse Spotlight Effect
Used on `welcome.html` and all club demo pages. Add to any dark-background SwimLoading page:

**CSS** (inside `<style>`, on `body`):
```css
body::before {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  background:
    radial-gradient(18px circle at var(--mouse-x, -999px) var(--mouse-y, -999px),
      rgba(56, 189, 248, 0.55), transparent 100%),
    radial-gradient(500px circle at var(--mouse-x, -999px) var(--mouse-y, -999px),
      rgba(56, 189, 248, 0.07), transparent 70%);
}
```

**JS** (single `mousemove` listener — merge with any existing one, don't duplicate):
```javascript
document.addEventListener('mousemove', e => {
  document.body.style.setProperty('--mouse-x', e.clientX + 'px');
  document.body.style.setProperty('--mouse-y', e.clientY + 'px');
});
```
Default `-999px` keeps the dot off-screen until the mouse enters.

---

## Page Index — All swimloading.com Routes

Complete inventory of every public page. Brand checklist: spotlight = mouse cursor glow, logo = logo-wave.png + gradient text nav, pill = border-radius:50px buttons.

### App (authenticated)

| Route | File | Purpose | Spotlight | Logo Nav | Pill Btns |
|-------|------|---------|-----------|----------|-----------|
| `/app` | `index.html` + `app.js` etc | Main PWA — Dashboard, Temps, Swims, Trends, Safety, Leaderboard | n/a (mobile app) | n/a | ✅ (style.css .btn) |

### Marketing / Landing Pages

| Route | File | Purpose | Spotlight | Logo Nav | Pill Btns |
|-------|------|---------|-----------|----------|-----------|
| `/` | `welcome.html` | Main landing page — hero, features, sign up CTA | ✅ | ✅ | ✅ |
| `/pricing` | `pricing.html` | Pricing tiers (Free / Pro / Club) | ✅ | ✅ | ✅ |
| `/landing` | `landing.html` | Alternate landing / campaign page | ✅ | ✅ | ✅ |
| `/pro` | `pro.html` | Big Water Intel — race intelligence product page | ✅ | ✅ | ✅ |

### Intelligence / Race Pages (paid data)

| Route | File | Purpose | Spotlight | Logo Nav | Pill Btns |
|-------|------|---------|-----------|----------|-----------|
| `/intel` | `intel.html` | Open water race intelligence hub | ✅ | ✅ | ✅ |
| `/robben` | `robben.html` | Robben Island crossing intelligence | ✅ | ✅ | ✅ |
| `/ri` | `ri.html` | RI swim data / conditions | ✅ | ✅ | ✅ |
| `/big5` | `big5.html` | Big 5 swim event intelligence | ✅ | ✅ | ✅ |
| `/capepoint` | `capepoint.html` | Cape Point swim intelligence | ✅ | ✅ | ✅ |
| `/dassen` | `dassen.html` | Dassen Island intelligence | ✅ | ✅ | ✅ |
| `/preekstool` | `preekstool.html` | Preekstoel crossing intelligence | ✅ | ✅ | ✅ |
| `/westangle` | `westangle.html` | West Angle crossing intelligence | ✅ | ✅ | ✅ |

### Campaign / Demo Pages

| Route | File | Purpose | Spotlight | Logo Nav | Pill Btns |
|-------|------|---------|-----------|----------|-----------|
| `/campaign` | `campaign.html` | Marketing campaign page | ✅ | ✅ | ✅ |
| n/a (direct link) | `blog/duc-demo.html` | DUC Club tier sales demo | ✅ | ✅ | ✅ |

### SEO Pages (SSR via Vercel)

| Route | Handler | Purpose | Spotlight | Logo Nav |
|-------|---------|---------|-----------|----------|
| `/spots` | `api/spots-handler.js` | All spots overview | ✅ | ✅ |
| `/spots/atlantic` | `api/spots-handler.js` | Atlantic Seaboard spots | ✅ | ✅ |
| `/spots/false-bay` | `api/spots-handler.js` | False Bay spots | ✅ | ✅ |
| `/spots/west-coast` | `api/spots-handler.js` | West Coast spots | ✅ | ✅ |
| `/spots/kzn` | `api/spots-handler.js` | KwaZulu-Natal spots | ✅ | ✅ |
| `/spots/garden-route` | `api/spots-handler.js` | Garden Route spots | ✅ | ✅ |
| `/spots/overberg` | `api/spots-handler.js` | Overberg spots | ✅ | ✅ |
| `/spots/inland` | `api/spots-handler.js` | Inland spots (dams/rivers) | ✅ | ✅ |
| `/spots/gauteng` | `api/spots-handler.js` | Gauteng (JHB/Pretoria) pools | ✅ | ✅ |
| `/spots/free-state` | `api/spots-handler.js` | Free State (Bloemfontein) | ✅ | ✅ |
| `/spots/{spot-name}` | `api/spots-handler.js` | Individual spot pages (~90+) | ✅ | ✅ |

**SEO config lives in:** `api/seo-utils.js` (DOMAIN_MAP, REGION_DOMAINS, REGION_NAMES, REGION_INTROS)

### Internal / Admin

| Route | File | Purpose | Brand Required |
|-------|------|---------|---------------|
| `/admin` | `admin.html` | Admin panel (internal only) | No |
| n/a | `blog/march-challenge.html` | Email template (March challenge) | Email only |
| n/a | `blog/april-recap_8.html` | Email template (April recap) | Email only |

### New Page Checklist

Every new public-facing SwimLoading page MUST have:

1. **Nav bar** — `logo-wave.png` (22px) + SwimLoading gradient text + CTA button
   ```html
   <nav style="...sticky top-0...">
     <a href="/" style="display:flex;align-items:center;gap:8px;text-decoration:none;">
       <img src="icons/logo-wave.png" alt="" style="height:22px;">
       <span style="font-size:20px;font-weight:800;background:linear-gradient(135deg,#38bdf8 0%,#0ea5e9 50%,#0284c7 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-0.5px;">SwimLoading</span>
     </a>
   </nav>
   ```
2. **Mouse spotlight** — `body::before` CSS + `mousemove` JS (see Brand Guidelines above)
3. **Pill buttons** — `border-radius: 50px` on all primary CTAs
4. **Dark background** — `#050d1a` or similar (never white/light backgrounds)
5. **No emojis** — use Lucide icons only
6. **Brand fonts** — Bebas Neue (display) + DM Sans (body) from Google Fonts

---

## Future Considerations

If code size becomes an issue again:
- Split `app.js` into: `app-home.js`, `app-log.js`, `app-profile.js`
- Lazy-load based on active page
- Use dynamic imports (`import()`) if converting to ES modules

---

**Last Updated:** May 1, 2026  
**Maintained by:** Dave Welensky & Claude
