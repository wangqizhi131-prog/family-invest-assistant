# Claude Handoff: Family A-share Assistant

## Goal

Migrate the current Render-hosted A-share assistant to a free persistent Cloudflare stack:

- Cloudflare Pages/Workers for always-on web access
- Cloudflare D1 for persistent accounts and portfolio data
- iTick token for A-share realtime quote/K-line data

The user wants: no paid Render disk, no local-computer dependency, mobile/desktop login anywhere, data not lost.

## Current Production

- Current site: https://family-invest-assistant.onrender.com
- GitHub private repo: https://github.com/wangqizhi131-prog/family-invest-assistant
- Local project: `C:\Users\Wqz\Desktop\王麒智codex\family-invest-assistant`
- Render service id: `srv-d82hdojrjlhs73dh2i8g`
- Render is currently free and stores data in `/tmp/family-invest-data`, so data can disappear.

## Current Features

- A-share only; funds removed.
- Login/register with real name + phone only.
- Per-account holdings, watchlist, screenshot import records.
- Stock code lookup auto-infers market and resolves names.
- iTick realtime quote and K-line APIs.
- Technical analysis: MA5/10/20, 20-day change, volume ratio, support/resistance, score, suggestion.
- News/policy links are source links, not scraped text.

## Important Token/Security

- The iTick token was provided by the user and is currently set in Render env vars.
- Do not commit it to GitHub.
- For Cloudflare, set it as a Worker secret:

```powershell
npx wrangler secret put ITICK_TOKEN
npx wrangler secret put APP_SECRET
```

## New Cloudflare Files Added

- `worker/index.mjs`: Cloudflare Worker implementation of the API.
- `schema.sql`: Cloudflare D1 database schema.
- `wrangler.toml`: Cloudflare config. Needs `database_id` filled after D1 creation.

## Commands Already Verified Locally

```powershell
npm run lint
npm run build
npm run smoke
npx wrangler --version
```

## Next Steps

1. Ask the user to log in to Cloudflare with Wrangler:

```powershell
npx wrangler login
```

2. Create D1 database:

```powershell
npx wrangler d1 create family-invest-assistant
```

3. Put returned database id into `wrangler.toml`.

4. Apply schema:

```powershell
npx wrangler d1 execute family-invest-assistant --file=./schema.sql
```

5. Add secrets:

```powershell
npx wrangler secret put APP_SECRET
npx wrangler secret put ITICK_TOKEN
```

6. Build and deploy:

```powershell
npm run build
npx wrangler deploy
```

7. Validate:

```powershell
curl https://<worker-url>/api/health
curl https://<worker-url>/api/stocks/lookup?code=600000
```

## Caveats

- Cloudflare free tier is strong for personal use, but not a legal guarantee of permanent availability.
- D1 persistence is the free persistence target; Render free filesystem is not persistent.
- Screenshot upload currently stores only import records in D1; the base64 image body is not stored long-term in D1 to avoid DB bloat. If image retention is required, add Cloudflare R2 later.
