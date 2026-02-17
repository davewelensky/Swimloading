# SwimLoading Roadmap

## Vision
The go-to app for Cape Town ocean swimmers — and eventually, the platform that makes open water swimming insurable.

---

## Phase 1: MVP (Beta Testers) — IN PROGRESS

### Auth & Onboarding
- [x] Signup/login via Supabase
- [x] Email verification
- [x] Password reset flow (with hash capture fix)
- [x] Legal waivers (POPIA compliant)
- [x] Personal details collection
- [x] Avatar selection
- [ ] Swimming profile (pace, cold tolerance)
- [x] Emergency contact (required for swim RSVPs)

### Core Features
- [x] Temperature logging with conditions/hazards
- [x] GPS location detection
- [x] Dashboard with stats, streaks, points
- [x] Swim events + RSVP with safety gate
- [x] Leaderboard
- [x] Temperature trends (ocean + pool charts)
- [x] Notification bell + in-app notifications
- [x] Sewage hazard button + safety info

### Spots
- [x] Atlantic ocean spots
- [x] False Bay ocean spots
- [x] Virgin Active pools (8 branches)
- [x] Langebaan lagoon zones (5 spots)

### Security & Infrastructure
- [x] Row Level Security on all tables
- [x] Spam prevention (1hr cooldown per spot)
- [x] Service worker v2 (network-first HTML)
- [x] PWA installable
- [x] Custom domain (swimloading.com)
- [x] Marketing landing page
- [x] GitHub + Vercel CI/CD auto-deploy
- [x] New user signup notifications (to admin)
- [x] Auto-cleanup of old temp logs (4 days)

### Goal: 20 beta testers actively logging

---

## Phase 2: Safety & Community

### Safety System (Insurance Foundation)
- [ ] "Going swimming" check-in
- [ ] "I'm out safe" check-out
- [ ] Auto-alert if no check-out (configurable: 1hr, 2hr, 3hr)
- [ ] Emergency contact notification
- [ ] Incident reporting (near-miss, injury, rescue)
- [ ] Hazard alerts (shark sighting, bluebottles, rips)

### Community
- [ ] Public swimmer profiles
- [ ] Activity feed
- [ ] Photo uploads
- [ ] Comments on logs/events
- [ ] Follow other swimmers

### Gamification
- [x] Points system
- [x] Streak tracking
- [ ] Badges & achievements
- [ ] Weekly/monthly leaderboards

### Goal: 200 active users, safety data flowing

---

## Phase 3: Data & Intelligence

### Analytics
- [x] Historical temp trends per spot
- [ ] Best swimming times predictions
- [ ] Crowd patterns (busy vs quiet times)
- [ ] Personal stats dashboard (enhanced)

### Integrations
- [ ] Tide/swell data (Surfline API?)
- [ ] Weather overlay
- [ ] Water quality data (City of CT?)
- [ ] Strava/Garmin import

### AI Features
- [ ] Smart recommendations
- [ ] Condition analysis

### Goal: Rich dataset proving swimmer behavior patterns

---

## Phase 4: Insurance Play

### What Insurers Need
1. **Verified Identity** — Know who's swimming
2. **Risk Assessment** — Experience level, behavior patterns
3. **Loss Prevention** — Safety features reduce incidents
4. **Claims Data** — What happened, where, conditions

### Features for Insurance
- [ ] Verified swimmer certification
- [ ] Safety score (based on check-in compliance, group swims, etc.)
- [ ] Incident reports with conditions data
- [ ] Swimming history export (PDF for applications)
- [ ] Integration hooks for insurer systems

### Insurance Product Ideas

#### Per-Swim Coverage
- User buys R20-50 coverage before swim
- Covers: emergency rescue, medical, liability
- Payout: Up to R500k
- SwimLoading takes 15-20% commission

#### Monthly Membership
- R150-300/month
- Unlimited swims covered
- Includes premium app features
- Family plans available

#### Event Insurance
- Organizer buys coverage for group swim
- R10-20 per participant
- Covers all RSVPed swimmers

#### Data Licensing
- Anonymized swimming patterns
- Incident/near-miss data
- Risk modeling for actuaries
- Seasonal trends

### Target Partners
| Company | Why |
|---------|-----|
| Discovery Vitality | Fitness data obsessed, rewards active lifestyle |
| Outsurance | Digital-first, innovative products |
| Hollard | Niche sports insurance experience |
| King Price | Disruptive, might try something new |
| Specialized marine insurers | Understand water risks |

---

## Revenue Streams

### Phase 1-2 (Free)
- Build userbase, no revenue
- Maybe: Tip jar / "buy us a coffee"

### Phase 3 (Premium)
- Premium features: R50/month
  - Advanced stats, data export, priority support, ad-free

### Phase 4 (Insurance)
- Commission on insurance sales (15-20%)
- Data licensing fees
- White-label for swim clubs

### Phase 5 (Expansion)
- Other regions (Durban, PE, Mozambique)
- Other sports (trail running, MTB, paddling)
- Corporate wellness programs
- Coaching marketplace

---

## Technical Debt / Cleanup

- [ ] Single HTML file → proper component structure (or Flutter)
- [ ] Proper error handling & logging
- [ ] Offline support (log temps without signal)
- [ ] Push notifications
- [ ] Admin dashboard
- [x] Branded email templates (configured in Supabase)
- [x] Folder structure cleanup (SQL scripts organized)
- [x] Developer documentation

---

## Success Metrics

| Metric | Phase 1 | Phase 2 | Phase 3 |
|--------|---------|---------|---------|
| Registered users | 50 | 500 | 2000 |
| Weekly active | 20 | 200 | 800 |
| Temp logs/week | 50 | 500 | 2000 |
| Check-in rate | - | 60% | 80% |
| Events/month | 5 | 30 | 100 |

---

*Last updated: 2026-02-16*
