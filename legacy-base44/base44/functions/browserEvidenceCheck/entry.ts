// Bounded single-page capture check. Keeps the proven managed-browser integration and
// is honest about what a listing page is: a homepage or index capture is NOT an individual
// regulatory publication. Collection itself lives in collectManaged.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.56';
import { rosterFor } from '../../shared/admission.ts';
import { evaluateRoster } from '../../shared/accessPolicy.ts';
import { reserveUsage } from '../../shared/usageBudget.ts';
import { withBrowser, sha256Hex, normalizeWhite } from '../../shared/managedBrowser.ts';
import { EXTRACTOR_VERSION, extractSubstantive, legalStageFrom, publicationDateFrom } from '../../shared/publicationExtract.ts';
import { previewText, retainCapturedText } from '../../shared/evidenceStorage.ts';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const roster = await rosterFor(base44, user.email);
    const decision = evaluateRoster(roster, user);
    if (!decision || decision.admitted !== true) {
      return Response.json({ error: 'Not admitted by the compliance roster' }, { status: 403 });
    }
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: a metered browser session requires the app-admin role' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const sourceId = String(body?.source_id || '').trim();
    if (!sourceId) return Response.json({ error: 'source_id is required' }, { status: 400 });

    const source = await base44.asServiceRole.entities.Source
      .get(sourceId)
      .catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!source) return Response.json({ error: 'Source not found' }, { status: 404 });
    if (source.verification_status !== 'Verified') {
      return Response.json({ error: 'Only a human-verified source may be opened' }, { status: 400 });
    }
    const targetUrl = String(source.url || '').trim();
    if (!/^https:\/\//i.test(targetUrl)) {
      return Response.json({ error: 'Verified source has no https URL' }, { status: 400 });
    }

    const allowance = await reserveUsage(base44, 1);
    if (!allowance.ok) {
      return Response.json({ capability: 'managed browser', available: null, blocked: allowance.reason }, { status: 429 });
    }

    const requestedAt = new Date().toISOString();
    try {
      return await withBrowser(base44, async ({ capture }) => {
        const page = await capture(targetUrl, { waitMs: 2500 });
        const extract = extractSubstantive(page.text);
        const rawHash = page.text ? await sha256Hex(page.text) : null;
        const publicationDate = publicationDateFrom(extract.text);
        const observedAt = new Date().toISOString();

        let record = null;
        if (page.text) {
          const evidence = await retainCapturedText(base44, {
            text: page.text,
            documentRef: `DOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
            url: page.finalUrl || targetUrl,
            fetchedAt: observedAt,
            scope: 'Homepage or listing page captured in a capability check; page body as the browser exposed it',
          });
          record = await base44.asServiceRole.entities.DocumentRecord.create({
            document_ref: `DOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
            source_id: source.id,
            jurisdiction_name: source.jurisdiction_name,
            authority: source.authority,
            title: page.title || source.authority,
            document_url: page.finalUrl || targetUrl,
            requested_url: targetUrl,
            final_url: page.finalUrl || targetUrl,
            document_type: 'Homepage / listing page captured by the managed browser',
            capture_scope: 'Listing page (homepage) — NOT an individual regulatory publication',
            capture_trigger: 'manual capability check',
            language: source.language,
            content_hash: rawHash,
            extractor_version: EXTRACTOR_VERSION,
            excerpt: previewText(page.text, 4000),
            size_bytes: page.text.length,
            ...evidence,
            fetched_at: observedAt,
            first_seen_at: observedAt,
            change_type: 'New',
            extraction_status: extract.keptChars > 200 ? 'Complete' : 'Partial',
            extraction_note: `Listing capture only, ${extract.keptLines}/${extract.inputLines} lines kept by ${EXTRACTOR_VERSION}. Hash covers captured text only; not a publisher version.`,
            completeness: 'Listing only — not an individual publication',
            legal_stage_evidenced: legalStageFrom(extract.text),
            publication_date_evidenced: publicationDate || 'No date stated',
            collection_mode: 'Managed browser capability check',
            analysis_state: 'Listing captured; not assessed as a publication',
          });
        }

        await base44.asServiceRole.entities.AuditEvent.create({
          event_type: 'managed_browser_capability_check',
          entity_type: 'DocumentRecord',
          entity_id: record ? record.id : '',
          entity_label: page.title || source.authority,
          summary: page.text
            ? `Managed browser opened ${page.finalUrl || targetUrl} and captured ${page.text.length} characters of listing page text.`
            : `Managed browser reached ${page.finalUrl || targetUrl} but captured no text.`,
          detail: JSON.stringify({ capture_method: page.captureMethod, http_status: page.httpStatus, navigation_error: page.navigationError, hash_scope: 'captured text only' }),
          actor_email: user.email,
          actor_name: user.full_name || '',
          actor_role: 'app admin (roster admitted)',
          recorded_by: 'server:managed_browser_capability_check',
          occurred_at: observedAt,
          actor_user_id: user.id,
          app_role: user.role,
          evidence_class: page.text ? 'browser_captured_content' : 'browser_session_no_content',
        });

        return Response.json({
          capability: 'managed browser driven from this app\'s backend (Stagehand on the app AI gateway)',
          available: Boolean(page.text),
          listing_capture: true,
          browser_evidence: {
            source_id: source.id,
            source_authority: source.authority,
            requested_url: targetUrl,
            final_url: page.finalUrl,
            http_status: page.httpStatus,
            navigation_error: page.navigationError,
            page_title: page.title,
            capture_method: page.captureMethod,
            captured_characters: page.text.length,
            substantive_characters: extract.keptChars,
            content_hash_sha256: rawHash,
            hash_scope: 'SHA-256 of the captured text at the observed time. Not a publisher version.',
            requested_at: requestedAt,
            observed_at: observedAt,
            captured_excerpt: normalizeWhite(page.text).slice(0, 4000),
          },
          model_summary: null,
          model_summary_note: 'No model summarisation used; the excerpt is captured page text.',
          saved_evidence: record ? { document_record_id: record.id, document_ref: record.document_ref } : null,
          classification_note: 'A homepage or index page is a listing capture. Publication-level evidence is produced by collectManaged.',
          verification_effect: 'none',
          monitoring_effect: 'none',
        });
      });
    } catch (error) {
      const capacity = error?.code === 'BROWSER_CAPACITY';
      return Response.json(
        { capability: 'managed browser', available: false, observed_reason: String(error?.message || 'browser run failed'), capacity_limited: capacity },
        { status: capacity ? 429 : 503 }
      );
    }
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}