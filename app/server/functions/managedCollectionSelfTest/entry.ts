// Isolated fixture tests for duplicate prevention and amendment detection.
// No network, no browser, no live evidence touched: fixtures are labelled strings only.
// Results are recorded as a fixture-classed audit event, never as a regulatory change.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.56';
import { rosterFor } from '../../shared/admission.ts';
import { evaluateRoster } from '../../shared/accessPolicy.ts';
import {
  EXTRACTOR_VERSION,
  extractSubstantive,
  substantiveHash,
  compareSubstantive,
  noveltyFrom,
  canonicalUrl,
  pickPublicationLinks,
} from '../../shared/publicationExtract.ts';

const FIXTURE_BODY = `Home
News
Guidance
Contact
The Authority has published updated technical standards for online casino games. Licence holders must ensure that random number generators are independently certified before deployment. Certification must be renewed annually and evidence retained for inspection.
The Authority will accept comments on the proposed amendments until 15 December 2026. The amendments are expected to come into force on 1 March 2027.`;

const FIXTURE_AMENDED = `Home
News
Guidance
Contact
The Authority has published updated technical standards for online casino games. Licence holders must ensure that random number generators are independently certified before deployment. Certification must be renewed every six months and evidence retained for seven years.
The Authority will accept comments on the proposed amendments until 15 December 2026. The amendments are expected to come into force on 1 March 2027.`;

const FIXTURE_NAV_ONLY_CHANGE = `Home
News
Publications
Guidance
Careers
Contact
The Authority has published updated technical standards for online casino games. Licence holders must ensure that random number generators are independently certified before deployment. Certification must be renewed annually and evidence retained for inspection.
The Authority will accept comments on the proposed amendments until 15 December 2026. The amendments are expected to come into force on 1 March 2027.`;

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Sign-in required' }, { status: 401 });

    const decision = evaluateRoster(await rosterFor(base44, user.email), user) || {};
    if (decision.admitted !== true || decision.canWrite !== true) {
      return Response.json({ error: 'Roster writer access required' }, { status: 403 });
    }

    const base = extractSubstantive(FIXTURE_BODY);
    const amended = extractSubstantive(FIXTURE_AMENDED);
    const navOnly = extractSubstantive(FIXTURE_NAV_ONLY_CHANGE);
    const baseHash = await substantiveHash(base.text);

    const results = [];
    const check = (name, passed, detail) => results.push({ name, passed, detail });

    check('navigation and listing order changes do not alter substantive text',
      navOnly.text === base.text,
      navOnly.text === base.text ? 'Identical substantive text after menu lines were added.' : 'Extraction retained menu text.');

    check('no duplicate version on unchanged substantive content',
      compareSubstantive({ substantiveHash: baseHash, extractorVersion: EXTRACTOR_VERSION }, { substantiveHash: baseHash, extractorVersion: EXTRACTOR_VERSION }) === 'Unchanged',
      'Repeated capture of the same substantive text compares as Unchanged.');

    check('genuine amendment is detected',
      compareSubstantive({ substantiveHash: baseHash, extractorVersion: EXTRACTOR_VERSION }, { substantiveHash: await substantiveHash(amended.text), extractorVersion: EXTRACTOR_VERSION }) === 'Amended',
      'Changed obligation wording compares as Amended.');

    check('extractor version change is not mistaken for an amendment',
      compareSubstantive({ substantiveHash: baseHash, extractorVersion: 'publication-extract/0' }, { substantiveHash: baseHash, extractorVersion: EXTRACTOR_VERSION }) === 'Extractor version changed — not comparable',
      'Different extractor versions are reported as not comparable rather than as a publisher change.');

    const historicalDate = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
    const noveltyHistorical = noveltyFrom(historicalDate, new Date().toISOString());
    const noveltyRecent = noveltyFrom(new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), new Date().toISOString());
    check('historical material is not classified as newly published',
      noveltyHistorical.classification === 'Previously untracked / historical' && noveltyRecent.classification === 'Newly published',
      `${historicalDate} → ${noveltyHistorical.classification}; recent date → ${noveltyRecent.classification}.`);
    check('missing publication date is never guessed',
      noveltyFrom('', new Date().toISOString()).classification.startsWith('Unknown'),
      'No date in content yields an unknown classification, not a detection-time guess.');

    check('tracking parameters do not create a second document identity',
      canonicalUrl('https://example.org/news/item?utm_source=x#top') === canonicalUrl('https://example.org/news/item'),
      'Same document URL after stripping campaign parameters and fragments.');

    const links = pickPublicationLinks(
      [
        { href: 'https://example.org/news/item-one', label: 'Authority publishes updated technical standards' },
        { href: 'https://other.example/news/item-two', label: 'External coverage of the same standards' },
        { href: 'https://example.org/contact', label: 'Contact us' },
        { href: 'https://example.org/app/uploads/notice.pdf', label: 'Notice PDF' },
      ],
      'https://example.org/'
    );
    check('only on-site publication links are offered as candidates',
      links.length === 1 && links[0].url === 'https://example.org/news/item-one',
      `Candidates: ${links.map((l) => l.url).join(', ') || 'none'}.`);

    check('distinct documents stay distinct even with matching wording',
      canonicalUrl('https://example.org/news/item-one') !== canonicalUrl('https://example.org/news/item-two'),
      'Two different publication URLs remain separate document identities.');

    const passed = results.filter((r) => r.passed).length;

    await base44.asServiceRole.entities.AuditEvent.create({
      event_type: 'managed_collection_fixture_test',
      entity_type: 'CollectionJob',
      entity_id: 'FIXTURE-TEST',
      entity_label: 'Duplicate prevention and amendment fixture test',
      summary: `${passed}/${results.length} fixture checks passed. Isolated fixtures only; no live evidence or alert was changed.`,
      detail: JSON.stringify({ extractor_version: EXTRACTOR_VERSION, results }),
      actor_email: user.email,
      actor_name: user.full_name || '',
      actor_role: 'roster writer',
      recorded_by: 'server:managedCollectionSelfTest',
      occurred_at: new Date().toISOString(),
      actor_user_id: user.id,
      app_role: user.role,
      evidence_class: 'fixture_test',
    });

    return Response.json({
      extractor_version: EXTRACTOR_VERSION,
      total: results.length,
      passed,
      failed: results.length - passed,
      results,
      scope: 'Local fixture strings only. No browser session, no network request, no live record modified, no alert created.',
      evidence_class: 'fixture_test',
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}