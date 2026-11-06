# Stakelogic Compliance Hub — isolated retrieval service (NOT USED, kept for history)

> **Status: unused.** The application does not depend on this package and requires no
> external endpoint, certificate, proxy or shared secret. It is retained only as project
> history. The app's direct-retrieval guard stays disabled, and search-based discovery uses
> Base44's native web-search integration instead. Ignore the deployment and IT steps below
> unless this package is ever deliberately revived.

Small HTTPS retrieval service that satisfies the retrieval specification the app already
carries (`base44/shared/protectedFetch.ts`): every destination is validated, the validated
address is pinned for the connection, TLS hostname and certificate checks stay on, redirects
are never followed blindly, and time/size/hop limits are enforced. It is **not** a general
proxy: two routes, one of them authenticated and destination-restricted.

Status: implemented and unit-tested locally. **Not deployed, not connected to a live
publication.** Do not describe it as production-ready until the IT acceptance steps below pass.

## What it guarantees

| Control | Implementation |
|---|---|
| Validated destination only | `src/policy.js`: https only, no address literals, no userinfo, port allowlist, approved-host allowlist (monitoring mode) |
| Private/metadata blocking | All A/AAAA answers must be public; loopback, RFC1918, link-local, ULA, multicast, `169.254.169.254`, NAT64 and v4-mapped answers are refused |
| Connection pinning | `src/pinnedRequest.js`: the hostname stays for SNI + certificate verification, a custom `lookup` forces the socket to the single validated address |
| TLS | Never disabled; a mismatch surfaces as `TLS_VALIDATION_FAILED` (covered by a test) |
| Redirects | Never auto-followed. Default `MAX_REDIRECTS=0` returns the hop to the caller; above 0 each hop is revalidated and re-pinned |
| Limits | `MAX_RESPONSE_BYTES`, `CANDIDATE_MAX_BYTES`, `REQUEST_TIMEOUT_MS`, request-body cap, 4-hop ceiling |
| Authentication | HMAC-SHA256 over `timestamp.nonce.sha256(body)`; 300 s window; replay-protected nonce |
| Structured errors | `code`, `message`, `stage`, `retryable` — no stack traces, no configuration echo |
| No credentials in output | Secret is read once from the environment; tests assert it never appears in a response |

### Approved monitoring vs candidate testing

- `mode: "monitoring"` — host must be on `APPROVED_HOSTS` (a host a human has verified). Result carries `trusted_for_monitoring: true`.
- `mode: "candidate"` — the host need not be approved, but the destination rules, size cap and untrusted marking still apply. Result carries `trusted_for_monitoring: false`, `approval_effect: "none"`. Retrieving a candidate never verifies a publisher, and this service never writes to the app.
- Candidate mode is off unless `ALLOW_CANDIDATE=true`; both modes cap content type to official-document formats.

## Files

```
retriever/
  package.json                 no runtime dependencies (Node >= 20.11, Web/Node crypto only)
  src/config.js                environment configuration
  src/policy.js                destination policy
  src/auth.js                  HMAC request authentication + replay store
  src/pinnedRequest.js         pinned HTTPS request, limits, structured failures
  src/retrieve.js              one validated retrieval, envelope contract 1.0
  src/server.js                HTTP surface: GET /healthz, POST /retrieve
  test/policy.test.js          7 tests — destinations, allowlists, redirect scope
  test/auth.test.js            6 tests — signature, replay, skew, unset secret
  test/retrieve.test.js        11 tests — permitted retrieval, PDF, redirects, limits, timeout, TLS
  test/server.test.js          7 tests — auth gate, contract, routing, body cap
  test/fixtures/               self-signed localhost cert for tests only
  Dockerfile                   non-root, read-only rootfs
  docker-compose.example.yml   internal binding, dropped capabilities, log caps
  .env.example                 every setting, no values
```

## Tests — executed

`npm test` (Node 24.22.1, 2026-11-04): **30 tests, 30 passed, 0 failed** (≈0.46 s).
Run against a local TLS server, so the pinning path, certificate verification and limits are
exercised for real, not mocked. The certificate for that server is supplied through
`NODE_EXTRA_CA_CERTS`; verification is never switched off.

Covered: permitted retrieval with content + integrity hash; PDF binary content; unsupported
type refused; redirect reported rather than followed; bounded follow with per-hop approval;
off-host redirect refused; size limit; hanging destination timeout; TLS hostname mismatch
refused; candidate untrusted; candidate disabled; unsigned request; stale/replayed signature;
unexpected request fields; unknown path and wrong method; oversized body.

**Not executed** (needs IT infrastructure): retrieval from a real external regulator over the
public internet, egress through a corporate proxy/firewall, and behaviour under the platform's
own network policy. Those are the acceptance tests in step 6.

## Required configuration (names only)

| Name | Where | Purpose |
|---|---|---|
| `RETRIEVER_BASE_URL` | Base44 secret | Approved HTTPS endpoint of this service, e.g. `https://retriever.internal.example` (no path) |
| `RETRIEVER_HMAC_SECRET` | Base44 secret **and** service env | Shared secret, identical on both sides; generate with `openssl rand -hex 32` |
| `APPROVED_HOSTS` | service env | Comma list of verified official hosts (exact, or `.gov.uk` style suffix) |
| `ALLOWED_PORTS` | service env | `443` in normal operation |
| `MAX_REDIRECTS` | service env | `0` recommended |
| `MAX_RESPONSE_BYTES`, `CANDIDATE_MAX_BYTES`, `REQUEST_TIMEOUT_MS` | service env | Limits |
| `ALLOW_CANDIDATE` | service env | Untrusted candidate testing, default off |

## Deployment

1. Build and run on an internal host with outbound 443 only:
   `docker build -t compliance-retriever . && docker run --env-file .env -p 127.0.0.1:8443:8443 compliance-retriever`
2. Terminate TLS in front of the container with an internal certificate the Base44 runtime trusts; the app adapter refuses a non-HTTPS endpoint.
3. Do not expose the service to the internet; bind to the internal interface and allow only the function runtime's egress as a client.
4. Set the two Base44 secrets (Dashboard → Secrets). The endpoint must be HTTPS and the secret identical on both sides.
5. Confirm configuration: the Sources & Monitoring page shows **Retriever configured**, and `retrieverTransport` `op: "status"` returns `configured: true`.

## Health check

`GET /healthz` → `{"status":"ok","contract_version":"1.0","approved_hosts":<n>,"candidate_mode":<bool>}`.
Unauthenticated by design, returns no hostnames and no secret. The container healthcheck uses it.

## Rollback

- Clear `RETRIEVER_BASE_URL` (or the shared secret) on the Base44 side: the app immediately returns
  **Retriever not configured**, fetching stops, and no fallback path exists. Queues, continuation
  points, documents and audit history are untouched.
- On the service side: stop the container. Nothing in the app degrades beyond the same
  "not configured" behaviour.
- No database migration exists, so rollback has no data consequence.

## IT acceptance steps (all outstanding)

1. Approve and provision the host, internal TLS certificate and DNS name for the endpoint.
2. Decide the egress path (direct 443, or corporate proxy) and confirm the service is reachable from the function runtime only.
3. Set `APPROVED_HOSTS` to hosts of sources already verified in the app — no unverified host.
4. Set both secrets; run the health check; confirm **Retriever configured** in the app.
5. Run one genuine retrieval as the designated job runner against a verified source's real publication and confirm: authority and official URL, retrieval time, evidenced publication date from the document itself, content hash, extraction limitations.
6. Repeat the same retrieval and confirm no duplicate document and no duplicate alert.
7. Run one bounded collection workflow, then confirm the scheduled occurrence in the workflow Activity view — a manual run is not a scheduled run.

## Resources IT needs to price (no estimate given)

- 1 container: 0.5 vCPU, 512 MB RAM, read-only rootfs, no persistent volume.
- Outbound HTTPS only, low volume: one request per source document check, 8 MB cap per document. Volume input: verified sources × check frequency (currently 2 verified sources; 14 at daily, 4 at six-hourly would bound it).
- Inbound: one POST per retrieval from the function runtime; `/healthz` every 30 s.
- Optional: log aggregation and a certificate renewal path for the internal TLS name.