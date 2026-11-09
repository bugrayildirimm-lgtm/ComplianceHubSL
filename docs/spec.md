# Compliance Hub: specification

This is the host-independent description of what the hub does. The authoritative field-level definitions are
`app/server/entities/*.jsonc`, the behaviour is `app/server/functions/*` and `app/server/shared/*`, and the schedules
are `app/server/workflows/*.jsonc`. These were carried over from Base44 unchanged.

## Purpose

Official-source monitoring and a source-backed requirements baseline for Stakelogic's jurisdictions. It tells the
compliance team what regulators publish, what changed, and what each obligation is, with evidence. It does not decide
legal applicability: people do, through approvals.

## Rules that must survive any rebuild

1. **Unreviewed until approved.** Imported and researched requirements are candidates. Applicability stays unresolved
   where facts are missing. Approval is a server-side decision by a person with confirmed authority (`decideApproval`).
2. **Evidence is verbatim or labelled.** Quoted excerpts are real captured text. Researched paraphrases are never turned
   into excerpts. Missing evidence is recorded as a specific gap, never inferred or reconstructed.
3. **Separate the three questions.** Collection authorisation, source verification and legal applicability are
   independent states.
4. **Bounded collection.** At most one bounded attempt per missing source per import. Known PDF-extraction failures are
   not retried. No unlimited crawls. Per-run and per-cycle limits come from `MonitoringConfig`
   (max 8 sources per run, batch sizes 4, usage budget with 80% alert and pause).
5. **Queue-only guard.** Link-following only queues links actually observed on a listing page; processing has its own
   budget. The legacy direct-fetch collector stays disabled.
6. **No false alerts.** Importing existing requirements, or retaining more of an already-captured page, is a baseline
   correction, not a "new regulation". Alerts need a substantive change against a stored baseline hash.
7. **Full text is evidence; the preview is a preview.** The complete captured text goes to private storage with URL,
   retrieval time and scope. Captured and retained lengths are recorded separately. The 8,000-character limit applies
   only to interface preview and selected AI input.
8. **Provenance stays explicit.** Publisher and host are recorded separately (for example AGCO releases distributed by
   CNW). Trust is not extended to unrelated contributors or a whole host.
9. **Supplier versus operator duties are distinct.** Technical entries name the regulated party.
10. **Everything privileged is audited** (`AuditEvent`).

## Data model (32 entities)

| Group | Entities |
|---|---|
| Register | Jurisdiction, MarketProfile, MarketPermissionDecision, LegalEntity, LicenceCertificate, LiveStudio, GameProduct |
| Requirements | Requirement, RequirementVersion, RequirementBaseline |
| Sources and capture | Source, DocumentRecord, CrawlLink, CollectionJob, JobInvocation, MonitoringConfig |
| Discovery and import | DiscoveryRun, DiscoveryQueue, DiscoveryAttempt, ImportBatch, ImportRow |
| Monitoring output | RegulatoryAlert, Notification, ActionItem, Report |
| Governance | Approval, AuditEvent, TeamMember (roster), User, AccessAcceptance |
| Classifier QA | ClassificationFixture, ClassificationRegressionRun |

Storage: one table per entity, documents as JSONB (`id`, `created_date`, `updated_date`, `created_by`, `data`).

## Capture pipeline

`collectManaged` (every 15 min, Europe/Malta) runs a resumable daily cycle opened at 06:00 Malta time: due verified
sources, then queued publications, then amendment rechecks. A headless browser captures body text, links and page
structure; `pageType` classifies it (publication, index-like, and so on); `publicationExtract` computes the substantive
hash and compares against the baseline; `evidenceStorage` retains the full text. AI analysis runs only on relevant new or
changed material.

## Schedules (disabled by default in the new server)

| Workflow | Cron (Europe/Malta) | Function |
|---|---|---|
| Regulatory Monitoring Tick | `*/15 * * * *` | collectManaged |
| Initial Requirements Backlog Tick | `*/10 * * * *` | runRequirementResearch (initial) |
| Source Discovery Queue Tick | `15 */3 * * *` | runDiscoveryBatch |
| Requirements Baseline Tick | `30 6 * * 1` | runRequirementResearch (maintenance) |
| Monthly Source Re-discovery | `0 7 1 * *` | discoverSources |
| Month-end Compliance Report | `0 6 1 * *` | generateReport |

Scheduled runs act as the designated job-runner user in `MonitoringConfig`.

## Access

- Roster (`TeamMember`) decides admission and role; `admitUser` mirrors it onto the user (`access_admitted`).
- Entity-level rules come from each entity's `rls` block and are enforced by the API.
- **Not yet built:** multi-factor authentication and SSO (deferred by decision); field-level `rls` inside individual
  properties (server-side functions remain the write path for sensitive fields).

## Retrieve sample (direct fetch, Source review only)

The "Retrieve sample" button (`sourceReview` op `inspect`) can fetch one source page, once, for a reviewer. It is off
unless `DIRECT_FETCH_ENABLED=true` and `FETCH_CONTACT` are set; when off, it answers 503 `DIRECT_FETCH_DISABLED` exactly as
before. `discoverSources`, `runDiscoveryBatch`, `runRequirementResearch`, `correctMarketBlock`, `collectSources` and the
scheduler never use it: `requireProtectedFetch`, `protectedFetch`, `outboundDecision` and `FETCH_MAINTENANCE` still refuse.
The fetcher is `server/shared/inspectFetch.ts`; settings are read by `directFetchConfig()` in `protectedFetch.ts`.

- **Allowlist.** A URL may be fetched only if its host equals the host of an existing Source that is not Rejected (and not
  a fixture). A redirect may also stay on the same registrable domain as the starting host (approximated without a
  public-suffix list: last two labels, or three for `gov.uk`-style country-code second levels).
- **SSRF.** http/https only, ports 80/443 only, no credentials in the URL. The host is resolved; if ANY answer is
  private, loopback, link-local, metadata or reserved (IPv4 and IPv6, including IPv4-mapped and NAT64 forms) the request
  is refused. The connection is then made to the address that was checked, so a later DNS answer cannot change the target.
  The same checks run on every redirect hop (maximum `FETCH_MAX_REDIRECTS`, default 5).
- **Politeness.** `robots.txt` is fetched and honoured per host (longest matching rule wins; our product group beats `*`;
  404 means no rules; a 5xx or unreadable `robots.txt` means nothing is fetched). One request per host at a time, at least
  2 s apart. User agent `StakelogicComplianceHub/1.0 (+FETCH_CONTACT)`.
- **Bounds.** One attempt per source per click, no automatic retry, no link-following or sample crawl. Per-request timeout
  (`FETCH_TIMEOUT_MS`, 20 s), byte limit (`FETCH_MAX_BYTES`, 10 MB), text/HTML/PDF only. A source with a stored known
  PDF/format failure (`retrieval_failure_code` PDF_EXTRACTION_FAILED, UNSUPPORTED_CONTENT_TYPE or TOO_LARGE, or a legacy
  Base44 PDF/format gap) is not fetched again; the stored failure is shown.
- **Evidence, not conclusions.** HTML is reduced to visible text, PDF text comes from `unpdf`. The Source records HTTP
  status, content type, byte size, retrieval time, SHA-256 of the bytes, page title, final URL and the first 8,000
  characters of the extracted text (`retrieval_*` fields). If little or no text is extracted the result is a labelled gap
  ("no readable text retrieved", "PDF text extraction failed", "blocked by robots.txt", ...) and no text is invented.
  `FETCH_RENDER=true` adds an optional Playwright fallback for script-rendered pages under the same allowlist and limits
  (subresource hosts are checked but not pinned, and `robots.txt` is not re-read for subresources).
- **No side effects.** Retrieval never creates a RegulatoryAlert or Notification, never changes `verification_status`,
  `health_status`, the collection baseline (`last_content_hash`) or `collection_authorised`. It writes one AuditEvent
  per click. Retrieval is not verification.

## Known gaps


- Nine evidence text files were stored in Base44 private storage and are not in the export. They are re-captured on the
  next ordinary check, or re-supplied from Base44.
- The headless browser (Playwright) is untested against live sites in this environment. The Retrieve-sample fetcher is
  tested against local servers only; its optional `FETCH_RENDER` fallback has no automated test.
- The AI step uses the Anthropic API (`ANTHROPIC_API_KEY`); prompts were written for Base44's model and need re-checking.
- Base44-specific self-tests (`securitySelfTests`, `accessAcceptance`) were ported but depend on Base44 behaviour.
