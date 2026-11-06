# Stakelogic Compliance Hub (ComplianceHubSL)

Regulatory monitoring and a source-backed requirements baseline for Stakelogic's jurisdictions (GB, Malta, Denmark,
Sweden, Ontario and others). Owner: Technical Compliance Lead at Stakelogic. Moved out of Base44 on 2026-11-06 and
rebuilt to be host-independent (final host undecided, possibly Stakelogic's own servers).

Read `docs/spec.md` (rules, data model, schedules, known gaps) and `docs/cutover.md` (moving from Base44) first.

## Layout
- `app/server/`: Node 22 API. Entity store on Postgres/PGlite (JSONB documents), a compatibility layer for the Base44
  SDK (`sdk.js`, `loader.js`), 31 backend functions in `functions/` and `shared/` (ported from Base44, kept as close to
  unchanged as possible), cron `scheduler.js` (off by default), password auth `auth.js`, entity access rules `rls.js`.
- `app/web/`: React + Vite frontend. `src/api/base44Client.js` is the API client (name kept so pages work unchanged).
- `app/server/entities/*.jsonc` define the 32 entities; `app/server/workflows/*.jsonc` define the schedules.
- `legacy-base44/`: frozen original export. Reference only; do not edit.
- `data/snapshot-2026-11-06/`: CSV export of all Base44 tables. Contains user emails and audit events; repo stays private.

## Commands (run in `app/`)
- `npm run local`: first-run setup, loads the snapshot, starts at http://localhost:3000
- `npm test`: backend tests (in-memory database)
- `cd web && npx vite build`: frontend build; `npx vite` for dev (proxies `/api` to :3000)

## Rules (do not weaken without asking)
1. Requirements stay unreviewed candidates until a person approves them; applicability is never inferred.
2. Evidence is verbatim captured text or a labelled gap. Never reconstruct, invent or paraphrase into an excerpt.
3. One bounded attempt per missing source; no retries of known PDF failures; no unbounded crawls.
4. Importing or re-capturing existing content must not raise "new regulation" alerts.
5. Only one system collects at a time. `SCHEDULER_ENABLED` stays false until Base44 collection is switched off.
6. MFA/SSO is deferred by decision; do not add it unprompted. Do not add credentials to the repo.

## Status
Done: data loaded and verified (23 non-empty tables, 127 requirements), backend and tests (8 passing), frontend builds,
local launcher, spec, cutover checklist.
Not verified: pages in a real browser, Playwright capture against live sites, Docker build, AI prompts under the
Anthropic API, 9 private evidence files not in the export (re-capture on next check).
Placeholder: `app/web/public/brand/stakelogic-mark.svg` is a neutral stand-in for the official logo.

## Conventions
Small, reviewable changes; run `npm test` and the frontend build before committing; keep `docs/spec.md` current when
behaviour changes. The user is a compliance lead, not a developer: explain results in plain language.
