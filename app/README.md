# Compliance Hub app

Node 22 server (`server/`) and React frontend (`web/`). Behaviour is the Base44 app's, ported (see `../docs/spec.md`).

## Run locally (embedded database, no Docker)

```bash
cd app && npm install && (cd web && npm install && npx vite build)
cp .env.example .env     # set ADMIN_EMAIL, ADMIN_PASSWORD (12+ chars), SESSION_SECRET
node --import ./server/register.js scripts/load-csv.js ../data/snapshot-2026-11-06   # one-time data load
export $(grep -v '^#' .env | xargs) && npm start
```

Frontend development: `npm start` in one terminal, `cd web && npx vite` in another (proxies `/api`).

## Deploy on a server

`docker compose up -d --build` (set `DB_PASSWORD` and the `.env` values). This needs PostgreSQL, Playwright's Chromium
(in the image) and outbound HTTPS to the official regulator sites. Put it behind your TLS reverse proxy. Keep
`SCHEDULER_ENABLED=false` until Base44's own schedules are switched off.

## Tests

`npm test` runs the query layer, access rules and an end-to-end function call against an in-memory database.
