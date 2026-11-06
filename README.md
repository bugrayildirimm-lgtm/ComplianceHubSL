# Stakelogic Compliance Hub (ComplianceHubSL)

Regulatory monitoring and requirements baseline for Stakelogic jurisdictions
(GB, Malta, Denmark, Sweden, Ontario and others). Moved out of Base44 on 2026-11-06.

## Layout

| Path | What it is |
|---|---|
| `legacy-base44/` | Frozen, untouched Base44 export (frontend, entity schemas, backend functions). Reference only. |
| `data/snapshot-2026-11-06/` | CSV export of every Base44 table at the time of the move. |
| `docs/` | Specification and migration notes. |
| `app/` | The rebuilt, host-independent application (not started yet). |

## Status

- Base44 build is frozen; its scheduled captures keep running until the new collector replaces them.
- Hosting target is undecided (possibly Stakelogic's own servers), so the rebuild stays portable.
- All requirements remain unreviewed candidates; applicability and approval are decided by people, never imported.

## Handling

The data snapshot contains user emails, notifications and audit events. Keep this repository private.
