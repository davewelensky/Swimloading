# SwimLoading — Architecture & Deployment Guide

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
5. `style.css` — styling applied after DOM loaded

## Data Model

### Key Supabase Tables

- **users** — auth, profile status (onboarding_completed_at), home_domain
- **spots** — swim locations (name, code, domain, type)
- **domains** — regions (code, display_name, is_coastal, sort_order)
- **temp_logs** — temperature readings (spot_id, temperature, created_at, created_by)
- **swim_events** — upcoming group swims (title, date, domain, participants)
- **leaderboard** — April 2026 challenge scores (user_id, points, rank)

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
| Old CSS still visible | Edge cache not invalidated | Add `Cache-Control: no-cache` to vercel.json |
| Nav icons squeezed | CSS not applied to mobile | Check `@media (max-width: 520px)` rules |
| Supabase error 401 | Auth token expired | Auto-refreshes on page reload |
| Changes don't appear | Not pushed to git | Run `git push` before hard refresh |

## Deployment Monitoring

- **Live site:** https://swimloading.vercel.app
- **Vercel dashboard:** https://vercel.com/davewelensky/swimloading
- **GitHub commits:** https://github.com/davewelensky/Swimloading/commits/main

## Future Considerations

If code size becomes an issue again:
- Split `app.js` into: `app-home.js`, `app-log.js`, `app-profile.js`
- Lazy-load based on active page
- Use dynamic imports (`import()`) if converting to ES modules

---

**Last Updated:** April 24, 2026  
**Maintained by:** Dave Welensky & Claude
