# SwimLoading 🏊‍♂️🌊

**Cape Town's ocean swimming community app** — log water temps, organise group swims, track your streaks, and stay safe.

🌐 **Live at:** [swimloading.com](https://swimloading.com)
📱 **App:** [swimloading.com/app](https://swimloading.com/app)
💻 **Repo:** [github.com/davewelensky/Swimloading](https://github.com/davewelensky/Swimloading)

---

## What It Does

- **Temperature logging** — Record water temps at 30+ spots (Atlantic, False Bay, Lagoons, Pools) with conditions & hazards
- **Group swims** — Create and RSVP to swim events with emergency contact sharing for safety
- **Dashboard** — Personal stats, streaks, points, upcoming swims
- **Trends** — Historical temperature charts per spot (ocean & pool)
- **Leaderboard** — Community rankings by points
- **Safety** — Emergency contacts required for RSVPs, hazard alerts, sewage warnings
- **PWA** — Installable as a home-screen app on mobile

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla HTML / CSS / JS (single-page app in `index.html`) |
| Backend | [Supabase](https://supabase.com) — Auth, PostgreSQL database, Row Level Security |
| Hosting | [Vercel](https://vercel.com) — auto-deploys from `main` branch |
| Charts | [Chart.js](https://www.chartjs.org/) via CDN |
| Icons | [Lucide](https://lucide.dev/) via CDN |
| Domain | swimloading.com (GoDaddy → Vercel) |
| Email | [Resend](https://resend.com) SMTP via Supabase Auth (sending domain: getcls.co) |

---

## Project Structure

```
SwimLoading/
├── index.html              # Main app (6000+ lines — all UI, CSS, JS)
├── welcome.html            # Marketing / landing page (swimloading.com/)
├── landing.html            # Legacy copy of landing page (unused)
├── sw.js                   # Service worker v2 (network-first HTML, cache-first assets)
├── manifest.json           # PWA manifest (start_url: /app)
├── vercel.json             # Vercel routing config
├── .gitignore              # Git ignore rules
│
├── icons/                  # App icons (PWA, Apple touch, logo)
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── apple-touch-icon.png
│   ├── icon-maskable-*.png
│   ├── icon.svg
│   ├── logo.png
│   └── logo-nav*.png
│
├── screenshots/            # App screenshots (used in welcome.html)
│
├── sql/
│   ├── applied/            # One-time SQL scripts (already run in Supabase)
│   │   ├── rls_policies.sql
│   │   ├── add_emergency_contacts.sql
│   │   ├── add_virgin_active_pools.sql
│   │   ├── fix_virgin_active_pools.sql
│   │   ├── add_langebaan_zones.sql
│   │   ├── new_user_notification.sql
│   │   ├── fix_spam_logs.sql
│   │   ├── rsvp_schema_update.sql
│   │   └── supabase_cleanup.sql
│   └── debug/              # Diagnostic queries (not destructive, re-runnable)
│       ├── check_spots_and_view.sql
│       └── check_view_definition.sql
│
├── 14files/                # Legal documents & onboarding reference
│   ├── terms-of-service.txt
│   ├── privacy-policy.txt
│   ├── liability-waiver.txt
│   ├── ONBOARDING_SQL.md
│   └── ONBOARDING_TEST_GUIDE.md
│
├── archive/                # Old app versions (git-ignored, local backup only)
├── ROADMAP.md              # Product vision & phased plan
└── DEVELOPER_GUIDE.md      # How to develop, deploy, and maintain the app
```

---

## Supabase Database

### Tables
| Table | Purpose |
|-------|---------|
| `profiles` | User profiles — display name, avatar, phone, emergency contacts, experience level |
| `spots` | Swim locations — name, code, lat/lng, type (OCEAN/POOL), water_type, domain |
| `temp_logs` | Temperature readings — spot, temp, conditions, hazards, GPS coords |
| `swim_events` | Group swim events — title, spot, date/time, description, route type |
| `swim_event_members` | RSVPs — user, event, status (going/maybe/cancelled) |
| `user_stats` | Points, streaks, log counts |
| `badges` | Badge definitions |
| `user_badges` | Badges earned by users |
| `notifications` | In-app notifications |

### Key Views
- `latest_spot_temps` — Latest temperature per spot (joins `spots` + `temp_logs`, filters `WHERE s.code IS NOT NULL`)

### Security
- **Row Level Security (RLS)** enabled on all tables
- Policies in `sql/applied/rls_policies.sql`

### Database Triggers
- `check_temp_log_cooldown` — Prevents duplicate temp logs (1hr per user per spot)
- `notify_new_signup` — Notifies admin when a new user registers
- `auto_cleanup_temp_logs` — Removes temp_logs older than 4 days

---

## Routing (vercel.json)

| URL | Serves | Purpose |
|-----|--------|---------|
| `swimloading.com/` | `welcome.html` | Marketing / landing page |
| `swimloading.com/app` | `index.html` | The main app |
| `swimloading.com/sw.js` | `sw.js` | Service worker (no-cache) |
| `swimloading.com/manifest.json` | `manifest.json` | PWA manifest |

---

## Getting Started

See **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** for the full development workflow, including:
- How to run locally
- How to make changes and deploy
- Supabase configuration
- Key code architecture

---

## Contributing

Built by Dave ([@davewelensky](https://github.com/davewelensky)) with Claude 🤖

---

Built with 🌊 in Cape Town
