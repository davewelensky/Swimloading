# Growth Hub Sync — MANDATORY

**Live page:** https://www.swimloading.com/growth-hub (file: `growth-hub.html`)

The Growth Hub Master Index is Dave's single dashboard of everything SwimLoading:
pages, clubs, partners, founding members, emails, capabilities. If it drifts from
reality, effort and developments get lost. **Keeping it in sync is part of every
ship, not an afterthought.**

## The rule

Any change that adds or removes something user-visible or strategic MUST update
`growth-hub.html` in the SAME commit/ship. Never leave it for "later".

## What maps where (Master Index tab, `growth-hub.html` ~line 470–680)

| You changed / added | Update this section |
|---|---|
| New public page or route | `#mi-core` Core Platform table (or the more specific section below) |
| New partner page or partner going live | `#mi-sponsors` Active Partners list — AND the homepage partner grid in `welcome.html` |
| Partner prospect identified (UK) | `#mi-sponsors` UK Target Partners list (move to Active when signed) |
| New club onboarded | `#mi-clubs` Club Admin + Public Club Pages tables |
| New crossing / journey / intel page | `#mi-intel` Key Links card |
| New app capability or community feature | `#mi-intel` Capabilities list and/or `#mi-community` feature chips |
| New founding member or region | `#mi-founders` table |
| New @swimloading.com email address | `#mi-email` table |
| Positioning / strategy shift | `#mi-strategy` |

The Notes section (`#mi-notes`) states the same rule on the page itself.

## Checklist for the ship loop

Before reporting a ship as done, ask: **"Does this change add, remove, or rename
anything a stranger reading /growth-hub should know about?"**
If yes → edit `growth-hub.html`, include it in the same commit, and verify the
live page shows it (`curl -s https://www.swimloading.com/growth-hub | grep <thing>`).

## History

- 2026-07-03: Rule created after the BlueSeventy UK partner launch shipped without
  a growth-hub update (caught by Dave, fixed same day).
