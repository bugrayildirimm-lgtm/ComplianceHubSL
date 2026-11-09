# Compliance Hub app

Node 22 server (`server/`) and React frontend (`web/`). Behaviour is the Base44 app's, ported (see `../docs/spec.md`).

## Quick start (any computer)

1. Install [Node.js 22.18 or newer](https://nodejs.org) and Git.
2. `git clone https://github.com/bugrayildirimm-lgtm/ComplianceHubSL` and `cd ComplianceHubSL/app`
3. `npm run local`

First run asks for an administrator email and password, builds everything, loads the data snapshot and starts the
server at http://localhost:3000. Later runs just start it. Local runs never collect from regulator sites.

## Run locally, step by step (embedded database, no Docker)

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

The Source review "Retrieve sample" button is off by default. To turn it on set `DIRECT_FETCH_ENABLED=true` and
`FETCH_CONTACT` (a URL or email address for the user agent); see `.env.example` and `docs/spec.md`.

## Tests

`npm test` runs the query layer, access rules and an end-to-end function call against an in-memory database.
