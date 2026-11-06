// Classification regression harness. Runs the production classifier over the saved fixture set
// and reports, per case: expected result → actual result → pass/fail. No browser, no AI spend.
// The regression gate on MonitoringConfig is set from the outcome: while it is not Passing,
// automated classification and notifications are held for the affected source templates.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.56';
import { classifyPage, CLASSIFIER_VERSION, PAGE_TYPES } from '../../shared/pageType.ts';
import { PROFILE_VERSION } from '../../shared/extractionProfiles.ts';
import { sha256Hex } from '../../shared/managedBrowser.ts';

function textOf(value) {
  return String(value || '').replace(/\s+/g, ' ').toLowerCase();
}

function contains(haystack, needle) {
  return textOf(haystack).includes(textOf(needle));
}

function alertVerdict(classification) {
  if (classification.pageTypeCode === 'individual') return 'Alert appropriate';
  if (classification.pageTypeCode === 'listing') return 'No alert from this page';
  return 'Review required, no alert';
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const E = base44.asServiceRole.entities;
    const fixtures = (await E.ClassificationFixture.filter({ is_fixture: true }, { limit: 50 })).items || [];
    if (!fixtures.length) return Response.json({ error: 'No saved fixtures; capture the regression set first.' }, { status: 400 });

    const startedAt = new Date().toISOString();
    const computed = new Map();
    for (const fixture of fixtures) {
      let structure = null;
      try {
        structure = JSON.parse(fixture.structure_json || 'null');
      } catch (eParse) {
        structure = null;
      }
      // The region text is stored beside the snapshot to stay inside the field limit; the
      // classifier sees exactly the same shape the live capture produces.
      if (structure && fixture.region_text) structure = { ...structure, regionText: fixture.region_text };
      const classification = classifyPage({
        url: fixture.url,
        title: fixture.label,
        text: fixture.text,
        structure,
      });
      classification.substantiveHash = await sha256Hex(classification.substantiveText || '');
      computed.set(fixture.case_key, { fixture, classification });
    }

    const base = computed.get('mga-publication') || null;
    const results = [];

    for (const fixture of fixtures) {
      const entry = computed.get(fixture.case_key);
      const c = entry.classification;
      const checks = [];

      checks.push({
        check: 'page type',
        expected: fixture.expected_page_type,
        actual: c.pageType,
        pass: c.pageType === fixture.expected_page_type,
      });

      for (const needed of fixture.expected_retain || []) {
        const present = contains(c.substantiveText, needed) || (c.itemRecords || []).some((r) => contains(r.label, needed));
        checks.push({ check: `retains "${needed}"`, expected: 'present in substantive content', actual: present ? 'present' : 'missing', pass: present });
      }

      for (const forbidden of fixture.expected_forbid || []) {
        const present = contains(c.substantiveText, forbidden);
        checks.push({ check: `excludes "${forbidden}"`, expected: 'absent from substantive content', actual: present ? 'present' : 'absent', pass: !present });
      }

      const verdict = alertVerdict(c);
      checks.push({
        check: 'draft assessment / alert',
        expected: fixture.expected_alert,
        actual: verdict,
        pass: verdict === fixture.expected_alert
          || (fixture.expected_alert === 'Review required, no alert' && c.pageTypeCode === 'ambiguous'),
      });

      if (Number(fixture.expected_item_records) > 0) {
        const count = (c.itemRecords || []).length;
        checks.push({
          check: 'item-level records from the listing',
          expected: `at least ${fixture.expected_item_records}`,
          actual: String(count),
          pass: count >= Number(fixture.expected_item_records),
        });
      }

      if (fixture.expected_change_type && base) {
        const sameText = c.substantiveHash === base.classification.substantiveHash;
        const actualChange = sameText ? 'Unchanged' : 'Amended';
        checks.push({ check: 'substantive comparison', expected: fixture.expected_change_type, actual: actualChange, pass: actualChange === fixture.expected_change_type });
        if (fixture.expected_change_type === 'Unchanged') {
          checks.push({
            check: 'repeat capture is not an amendment',
            expected: 'identical substantive hash to the base capture',
            actual: sameText ? 'identical' : 'different',
            pass: sameText,
          });
        }
      }

      const passed = checks.every((check) => check.pass);
      results.push({
        case_key: fixture.case_key,
        label: fixture.label,
        origin: fixture.origin,
        url: fixture.url,
        expected_page_type: fixture.expected_page_type,
        actual_page_type: c.pageType,
        expected_summary: `${fixture.expected_page_type} / ${fixture.expected_alert}`,
        actual_summary: `${c.pageType} / ${verdict}`,
        basis: c.basis,
        retained_metadata: c.retainedMetadata,
        substantive_chars: (c.substantiveText || '').length,
        item_records: (c.itemRecords || []).length,
        checks,
        pass: passed,
        status: passed ? 'PASS' : 'FAIL',
      });
    }

    const failed = results.filter((r) => !r.pass);
    const status = failed.length ? 'Failing' : 'Passing';
    const version = `${CLASSIFIER_VERSION} + ${PROFILE_VERSION}`;
    const finishedAt = new Date().toISOString();
    const runRef = `CLS-${finishedAt.slice(0, 10)}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

    await E.ClassificationRegressionRun.create({
      run_ref: runRef,
      classifier_version: version,
      profile_version: PROFILE_VERSION,
      status,
      cases_total: results.length,
      cases_passed: results.length - failed.length,
      cases_failed: failed.length,
      results_json: JSON.stringify(results.map((r) => ({
        case_key: r.case_key,
        expected: r.expected_summary,
        actual: r.actual_summary,
        status: r.status,
        failed_checks: r.checks.filter((x) => !x.pass).map((x) => `${x.check}: expected ${x.expected}, got ${x.actual}`),
      }))).slice(0, 60000),
      started_at: startedAt,
      finished_at: finishedAt,
      notes: failed.length ? `Failing cases: ${failed.map((f) => f.case_key).join(', ')}` : 'All cases pass; the classification gate is open.',
    });

    const configPage = await E.MonitoringConfig.list({ limit: 1 });
    const config = (configPage.items || [])[0];
    const gateFields = {
      classification_gate_status: status,
      classification_gate_version: version,
      classification_gate_run_at: finishedAt,
      classification_gate_failures: failed.length,
      classification_gate_note: failed.length
        ? `${failed.length} of ${results.length} cases fail (${failed.map((f) => f.case_key).join(', ')}). Automated classification and notifications are held for the UK and MGA templates; captures are still recorded and marked for review.`
        : `All ${results.length} cases pass. UK and MGA automated classification is enabled.`,
      classification_hold_profiles: failed.length ? ['uk-gc', 'mga'] : [],
    };
    if (config) await E.MonitoringConfig.update(config.id, gateFields);

    return Response.json({
      ok: true,
      run_ref: runRef,
      status,
      classifier_version: version,
      cases_total: results.length,
      cases_passed: results.length - failed.length,
      cases_failed: failed.length,
      table: results.map((r) => ({
        case: r.case_key,
        expected: r.expected_summary,
        actual: r.actual_summary,
        status: r.status,
        failed_checks: r.checks.filter((x) => !x.pass),
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}