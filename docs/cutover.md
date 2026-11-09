# Cutover checklist: Base44 to the new server

Rule for the whole sequence: **only one system collects at a time**, and **only one system takes edits**. Base44 keeps
collecting and changing data until the final export, so anything you edit in the new server before cutover is
overwritten by the final reload.

## 1. Prepare the host
- [ ] Linux host with Docker (or Node 22 + PostgreSQL 16) and outbound HTTPS to the regulator sites
- [ ] TLS reverse proxy in front of port 3000; no direct public exposure
- [ ] `.env` filled in: `SESSION_SECRET` (random, 32+ bytes), `ADMIN_EMAIL=amtbgryldrm@gmail.com` (the roster email),
      `ADMIN_PASSWORD` (12+ characters), `ANTHROPIC_API_KEY`, `DB_PASSWORD`
- [ ] `SCHEDULER_ENABLED=false`
- [ ] Database backup job and a restore test; evidence files volume included in the backup
- [ ] Official Stakelogic SVG placed in `app/web/public/brand/stakelogic-mark.svg`

## 2. Dry run on a test copy
- [ ] `load-csv.js` against `data/snapshot-2026-11-06`: row counts match
- [ ] Sign in; open every page (Dashboard, Jurisdictions, Radar, Requirements, Baseline, Licences, Actions, Sources,
      Discovery, Approvals, Reports, Administration) and note anything broken
- [ ] Spot-check 5 requirements against Base44 (wording, evidence, status, owner)
- [ ] Run one manual capture of a single known source (`collectManaged` with `source_ids`, scheduler still off).
      Confirm: text captured, full text retained, baseline hash unchanged, **no alert created**
- [ ] Confirm the 8 tests pass (`npm test`)

## 3. Final data pull (cutover day)
- [ ] In Base44, set monitoring to disabled in the monitoring configuration (stops new cycles); wait for any running
      slice to finish (check CollectionJob has nothing in progress)
- [ ] Export code is not needed again; export **data** (every table) again from the Base44 Data section
- [ ] Re-export the 9 private evidence files, or accept re-capture on the next check
- [ ] Load into the new server with `--replace`; confirm counts against the new CSVs
- [ ] `--replace` wipes the Sources imported from `docs/source-packs/*.json` (they are not in the Base44 export unless
      they were added there). Re-run the source-pack import from `app/`:
      `node --import ./server/register.js server/scripts/import-source-packs.js` (add `--dry-run` to preview).
      It skips URLs that already exist, sets new Sources to "Awaiting source verification", raises no alerts and is safe
      to re-run. Check the added/duplicate counts it prints.

## 4. Switch on
- [ ] Set `SCHEDULER_ENABLED=true` and restart
- [ ] Watch the first full cycle: CollectionJob rows appear, usage counters move, pending queue stays within limits,
      Notification and RegulatoryAlert show **no** spurious new items
- [ ] Check the Malta 06:00 cycle opens once, and GB/Malta/Denmark/Sweden/Ontario sources all progress

## 5. Hold, then retire
- [ ] Keep Base44 read-only (monitoring off) for two weeks as the reference copy
- [ ] After that, export once more for the archive, then retire the Base44 app

## Rollback
Before step 4: nothing to undo, Base44 is untouched apart from monitoring being switched off. After step 4: set
`SCHEDULER_ENABLED=false`, re-enable monitoring in Base44, and re-export any records created in the new server.

## Security and ISMS follow-ups (not blocking)
- Multi-factor authentication or company SSO (deferred by decision)
- Access review of the roster; password rotation for the bootstrap administrator
- Record the new host, backup and restore evidence, and the Anthropic API processor in the asset and supplier registers
- Field-level access rules from the Base44 schemas are not enforced yet (see `docs/spec.md`)
