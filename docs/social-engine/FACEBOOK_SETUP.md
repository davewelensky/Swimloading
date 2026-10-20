# Facebook Page publishing: one-time setup

Facebook only for now. Instagram is separate and can be added later without changing anything here.
Publishing is **off** until you set `SOCIAL_PUBLISH_ENABLED=true`, and the CLI only sends when you add `--confirm`.

Never paste the app secret or tokens into chat, a commit, or a screenshot. They go in `.env.local` (gitignored).

## 1. Create a Meta app (about 5 minutes)

1. Go to developers.facebook.com, My Apps, **Create App**. Use case: "Other", type **Business**. Name it e.g. "SwimLoading Publisher". Attach it to your SwimLoading business portfolio.
2. Note the **App ID** and **App Secret** (App settings, Basic).
3. The app can stay in **Development mode**. As the app's admin and the Page's admin you should be able to post to your own Page without app review. (Meta's Page-photos doc does not state this either way; if a post fails with a permission error, tell me the message.)

## 2. Get a Page token that does not expire

1. Open the Graph API Explorer (developers.facebook.com/tools/explorer), choose your app, and generate a **User token** with these permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`. Pick the **SwimLoading** Page when asked.
2. In a terminal, exchange it for a long-lived user token, then read the Page token. Set the values as shell variables first so they never appear in a URL you paste anywhere:

```bash
read -s USER_TOKEN; read -s APP_SECRET; APP_ID=<your app id>
LONG=$(curl -s "https://graph.facebook.com/v26.0/oauth/access_token?grant_type=fb_exchange_token&client_id=$APP_ID&client_secret=$APP_SECRET&fb_exchange_token=$USER_TOKEN" | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s "https://graph.facebook.com/v26.0/me/accounts?access_token=$LONG" | python3 -c "import sys,json;[print(p['name'],p['id']) for p in json.load(sys.stdin)['data']]"
```

3. That prints each Page's name and id. Re-run the second command printing `p['access_token']` for SwimLoading only, or use the Explorer's "Page token" dropdown. A Page token derived from a long-lived user token does not expire (it stops working if you change your Facebook password or remove the app).
4. Create `.env.local` in the repo root:

```
META_PAGE_ID=<the SwimLoading page id>
META_PAGE_TOKEN=<the page token>
```

## 3. Check it, without posting anything

```bash
node scripts/publish-facebook.mjs verify
node scripts/publish-facebook.mjs post 3-crossing-english-channel
```

The first confirms the token belongs to the SwimLoading Page. The second is a **dry run** showing the exact caption and image count.

## 4. First real post (only when you say so)

```bash
SOCIAL_PUBLISH_ENABLED=true node scripts/publish-facebook.mjs post 3-crossing-english-channel --confirm
```

Posts needing review (Tooting, Clifton, Maurten, events) are refused unless you add `--approve-review`, which records that you approved them. A re-run never duplicates: results are remembered in `social-poc/publish-ledger.json`.

## What happens on failure

* Temporary errors and rate limits: up to 3 attempts with backoff.
* Network failure where the outcome is unknown: the Page's latest posts are checked, and nothing is re-posted if it landed.
* Expired or revoked token: stops at once with instructions (no retries).
* Anything else: stops and reports Meta's message.

## Still to build before it runs unattended

Scheduler (Tue/Thu/Sat 10:00 SAST), the posts table (migration is proposed, not applied), failure email, token-expiry alert, performance reporting. The publisher above is the piece that talks to Facebook; the rest wraps it.
