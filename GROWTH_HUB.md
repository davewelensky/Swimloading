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
| New partner page or partner going live | A row in the `partner_pages` table (name, hero_page, section active/coming_soon, status_note + the homepage card fields). The `#mi-sponsors` Active Partners list, the `welcome.html` partner grid and the admin Partner Report all READ that table, so nothing is hand-edited. The lists written in the HTML are only the fallback. |
| Partner prospect identified | Add it in **/Sponsors** (the `growth_sponsors` row). The `#mi-sponsors` "Sponsor leads in progress" list is generated from that table; there is no hand-written target list any more. Link a signed partner to its `partner_pages` row via `growth_sponsors.partner_page_id` and it shows its status next to the Active Partners entry. |
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
- 2026-10-05: Sponsor data consolidated. `/Sponsors` (`sponsor-pipeline.html`) owns every sponsor
  relationship and the commercial layer (contacts, relationship history, ledger, rate card, deal builder).
  The Growth Hub Sponsors tab and the Master Index partner lists are READ-ONLY views of `growth_sponsors`;
  the Hub has no sponsor editor. Do not add one back, and never hand-type a partner or lead list in the Hub.

## Sponsors: who owns what (Oct 2026)

| Data | Where | Who can see it |
|---|---|---|
| Brand record: status, category, country, contact, next action, member benefit, exclusivity (existence/scope), athlete involvement (who, not fees) | `growth_sponsors` | Founders (Dave, Lindi, Bella) |
| Extra contacts, relationship history | `sponsor_contacts`, `sponsor_interactions` | Founders |
| Cash / product / other value, inventory committed, athlete cost, deal lines, rate card | `sponsor_ledger`, `sponsor_deal_lines`, `sponsor_rate_card` | **Dave only (RLS)** |

- One status list and one category/country rule live in `sponsors-core.js`; both pages load it. Statuses: Idea, Researching, Contacted, In Discussion, Confirmed, Passed (also enforced by a DB CHECK).
- Legacy Growth Hub statuses were canonicalised on 5 Oct 2026: "Not Now" and "Interested" both map to In Discussion (REVVI was the only row; its follow-up date was kept and an audit note was added to its history). `sponsors-core.js` applies the same mapping on read.
- `country` is an ISO-style code or NULL. "ALL" is a Growth Hub view filter and can never be stored.
- Money is per line in its own currency. There is no FX conversion; product value is never shown as cash.
- `growth_sponsors.conversation_log` / `.conversations` are DEPRECATED; history lives in `sponsor_interactions`.
