# Source policy: what to watch, how closely, and who decides

This ties the hub's purpose (see `docs/spec.md`) to how sources are handled. It is a **proposal for the Technical
Compliance Lead to approve**; nothing here changes code or any jurisdiction classification.

## Why sources exist

Stakelogic supplies slots and live casino games. For each jurisdiction the hub answers three questions: may we operate
there, what must a supplier meet (certification, technical standards, licensing steps), and what has changed. Sources are
the official pages that answer the last two. They are only as good as the evidence behind them, so a source is a
*candidate* until a person verifies it (spec rules 1 to 3).

"Prohibited Territory" is an internal commercial and legal-department decision (not recommended, not entering). It is
not a legal finding, and it is not changed here.

## Monitoring tiers

The app already ranks by classification (`priorityRank` in `shared/discovery.ts`: Licensed 1, Conditionally Permitted 2,
Not on RTL / Under Consideration 3, Prohibited 4, Unknown 5). The policy follows the same order. The frequency values
are the ones the Source entity allows (Six-hourly, Daily, Weekly, Manual).

| Tier | Why watch | Default check frequency | Requirements research |
|---|---|---|---|
| Licensed Jurisdiction | Live obligations; changes can hit certified products | Daily for regulator publications and technical standards; Weekly for legislation and gazettes | Yes |
| Conditionally Permitted | Entry or continued operation depends on conditions that can change | Weekly; Daily for the regulator's publication page | Yes |
| Not on RTL / Under Consideration | Early signal before a market decision | Weekly | On demand |
| Prohibited, regulated market exists (triage group "Regulated market exists") | Detect a regime that would make legal reconsider | Weekly, regulator page only | No |
| Prohibited, state monopoly, total ban or sanctions | Almost no signal; cost not justified | Manual (review in a periodic pass) | No |

Why this fits the limits: collection is capped (`MonitoringConfig`: max 8 sources per run, usage budget with an 80%
alert). Spending the budget on the first three tiers first keeps the daily cycle inside it. Defaults are set at
verification time, never at import.

## Verification order

1. Licensed, then Conditionally Permitted, then Under Consideration, then Prohibited with a regulated market.
2. Within a tier: regulator publication page, legislation database, technical standards, then gazettes and the rest.
3. Sanctions and total-ban jurisdictions are not verified until someone asks for them.

## What a reviewer checks (matches `sourceReview`)

The server refuses a verification without all of: an official provenance reference URL, a sample document, territorial
scope, subjects covered, an explicit "provenance confirmed" tick, and a rationale of at least 25 characters saying who
publishes it and what it covers, "not merely HTTP success". The link check done in chat (loads, right title) is only a
pre-screen for this.

## Dead or stale links

1. A link that fails the pre-screen is not verified.
2. Look for the official replacement. Add it through a source pack as a new Awaiting candidate, with the dead URL in the
   notes (example: `2026-11-09-link-corrections.json`).
3. Verify the replacement; reject the dead candidate with a rationale. **Gap:** `sourceReview` can verify or reject
   pending candidates only. Nothing sets an already-verified source to Superseded, so that step needs a small new
   operation (to be built only if the owner asks).
4. Never delete the history; the audit trail records each decision.

## Guards that always hold

- Importing sources creates no alerts and no "new regulation" signal (rule 4).
- Collection authorisation, source verification and legal applicability stay separate (rule 3).
- Only one system collects at a time; the scheduler stays off until Base44 collection is off (rule 5).
- After cutover with `--replace`, re-run `import-source-packs.js` so packs are not lost (`docs/cutover.md`, section 3).

## Open decisions for the owner

- Approve or change the frequencies in the tier table.
- Whether sanctions and total-ban jurisdictions should have any sources at all.
- Whether to build the Superseded operation.
