# Progress checkpoint

Date: 2026-05-13

## Current goal

Upgrade the family investment assistant from a local single-user MVP into a multi-user, remotely accessible, editable portfolio tool.

## Completed in this checkpoint

- Rebuilt `server.mjs` with:
  - Local JSON persistence at `data/db.json`
  - Account registration and login without phone number
  - Required fields: nickname, relation to site creator, local access passcode
  - Token-based API access
  - Per-user holdings
  - Per-user screenshot import records
  - CRUD endpoints for holdings
  - Data source labeling with `verified`, `fallback`, and `warning`
  - Safer fallback behavior: fallback/last-known data is marked unverified

- Rebuilt `src/App.tsx` with:
  - Registration/login gate
  - Portfolio dashboard
  - Advice tab
  - Holdings add/edit/delete form
  - Screenshot upload entry
  - Settings tab with remote access recommendation
  - Data trust warnings that pause buy/sell suggestions when data is unverified

- Finished the follow-up continuation:
  - Added missing CSS for account, edit form, upload, and action controls
  - Fixed backend syntax and removed unfinished OCR route from the stable path
  - Added static serving from `dist` on port `8787`
  - Added `npm run serve`
  - Added `scripts/start-remote-tunnel.ps1` for Cloudflare Tunnel remote access
  - Rewrote `README.md` with remote access instructions
  - Verified registration, portfolio read, holding create/update/delete, screenshot upload, and cleanup through API
  - Verified `npm run lint`, `npm run build`, `http://localhost:8787`, and `/api/health`
  - Downloaded verified `tools/cloudflared.exe`
  - Started a Cloudflare quick tunnel and saved the public HTTPS URL to `REMOTE_URL.txt`
  - Verified the public URL returns the app and `/api/health`

- Cloud-ready update:
  - Restored `server.mjs` after the in-progress rewrite
  - Added cloud environment support through `DATA_DIR`, `APP_SECRET`, `MARKET_PROVIDER`, `STRICT_REALTIME`, and `ITICK_TOKEN`
  - Added strict real-time behavior: missing/failed authorized market data returns `verified:false` and pauses trading suggestions
  - Added `Dockerfile`, `.dockerignore`, `.env.example`, `render.yaml`, and `DEPLOYMENT.md`
  - Added `npm run smoke` to verify registration, portfolio seed data, holding CRUD, screenshot import, and strict unverified market fallback
  - Updated the app settings copy from local tunnel guidance to cloud deployment guidance
  - Removed unused OCR dependencies from `package.json`

## Still needs work next session

- Upload the project to a private GitHub repository or another cloud deploy source.
- Create a cloud service, preferably using `render.yaml`.
- Add an authorized market data token as `ITICK_TOKEN`.
- Add real OCR later as a separate feature.
- Optionally replace `data/db.json` with SQLite and backups.

## Recommended next command sequence

```bash
cd C:\Users\Wqz\Desktop\王麒智codex\family-invest-assistant
npm run lint
npm run build
npm run smoke
npm run api
npm run public
```

## Important note

The app is no longer mid-upgrade for the account/editing MVP. The stable local address is `http://localhost:8787` after `npm run build` and `npm run api`. `npm run public` is only temporary; true computer-independent access requires cloud deployment and a persistent data disk.
