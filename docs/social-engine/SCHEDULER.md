# Scheduler: Tuesday, Thursday, Saturday at 10:00 SAST (Facebook only)

The scheduler is `api/cron/social-publish.js` (hourly) running the rules in `api/_lib/social/publisher.js`.
It was built earlier as a dormant step; this update closes the gaps for a Facebook-only, unattended launch.
**Nothing here is deployed.** It stays inert after deploy until you turn on the switches below.

## How a post goes out

1. `node scripts/social-queue.mjs schedule` gives approved posts the next free Tue/Thu/Sat 10:00 SAST slots (soonest-expiring first).
2. Each hour the cron checks whether a slot has arrived. At most one post goes out per run; a slot missed by more than 12 hours is never posted late.
3. Immediately before posting it re-validates (expiry, and a live re-check of any Explore event). If that fails, an approved reserve post takes the slot; with no reserve the post is held for review and you are told.
4. It posts to Facebook, records the result, and marks the post PUBLISHED. Instagram is skipped while `SOCIAL_PLATFORMS=fb` (the default).

## Safety locks (all must be open before anything posts)

| Lock | Where | Shipped state |
|---|---|---|
| Global pause | `social_settings.paused` in the database | **true** (paused) |
| Live switch | `SOCIAL_PUBLISH_ENABLED=true` on Vercel | **not set** (every run is a dry run) |
| Credentials | `META_PAGE_ID`, `META_PAGE_TOKEN` on Vercel | not set yet |
| Review | Posts needing review are never selected; only APPROVED posts are | by design |

## No duplicates

* Each post is claimed with an idempotency key (`post:slot`); overlapping runs cannot both publish it.
* An "in flight" marker is written before the Facebook call. If a run dies mid-call, the next run looks for the post on the Page first and records it instead of posting again.
* A platform that succeeded is never posted again.

## Failure handling and alerts (email to dave.welensky@gmail.com via Resend, each at most once a day)

* Facebook call fails: retried with backoff (15 min, 1 h, 4 h); after 3 attempts the post is FAILED and you are emailed.
* Token expired or revoked: reported once as a token problem, nothing is attempted, the post is not burned.
* A slot arrives with nothing scheduled: you are emailed (the reserve queue is deliberately not used for empty slots).
* Reserve queue below the minimum (6): you are emailed.
* Publish-time check fails, or a slot is missed: you are emailed.

## Turning it on (when you decide)

1. On Vercel set `META_PAGE_ID`, `META_PAGE_TOKEN`, `SOCIAL_PLATFORMS=fb`, and (last) `SOCIAL_PUBLISH_ENABLED=true`.
2. Queue and approve posts, then `node scripts/social-queue.mjs schedule`.
3. Turn the pause off in the database (`social_settings.paused = false`) only after a day of dry-run reports look right.
4. Watch the first slot. To stop instantly: set `paused = true`, or remove `SOCIAL_PUBLISH_ENABLED`.

Instagram later: connect the account to the Page, set `META_IG_USER_ID`, and `SOCIAL_PLATFORMS=fb,ig`.

## Known limits

* The Facebook client used by the cron posts by public image URL from the `social-posts` bucket; the earlier direct-upload client (`facebook.js`) is still used by the manual CLI.
* Multi-photo (carousel) feed posts via `attached_media` are not documented by Meta for Pages. Test on the real Page before relying on them.
* Posts queued so far are from the proof-of-concept run: generating fresh posts weekly (rendering, validation, queueing) is still a manual step. Automating that is the next piece.
