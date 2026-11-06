// Bounded capture of the classification regression set into saved fixtures.
//
// Runs once per fixture refresh (one browser session, one navigation per case). The regression
// harness then runs on these saved captures, so a rule change costs no browser or AI spend.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.56';
import { withBrowser } from '../../shared/managedBrowser.ts';
import { canonicalUrl, substantiveHash } from '../../shared/publicationExtract.ts';
import { profileFor } from '../../shared/extractionProfiles.ts';

const CASES = [
  {
    key: 'uk-news-index',
    label: 'UK news landing page (index)',
    origin: 'Captured as a publication on 2026-11-05 and produced an enforcement alert',
    url: 'https://www.gamblingcommission.gov.uk/news',
    expected_page_type: 'Listing or index',
    expected_retain: [],
    expected_forbid: [],
    expected_alert: 'No alert from this page',
  },
  {
    key: 'uk-news-latest',
    label: 'UK news "latest" index page',
    origin: 'Misclassified as a publication; produced a duplicate enforcement summary alert',
    url: 'https://www.gamblingcommission.gov.uk/news/latest',
    expected_page_type: 'Listing or index',
    expected_retain: [],
    expected_forbid: [],
    expected_alert: 'No alert from this page',
  },
  {
    key: 'uk-news-industry',
    label: 'UK news "industry" index page',
    origin: 'Misclassified as a publication; produced an enforcement alert',
    url: 'https://www.gamblingcommission.gov.uk/news/industry',
    expected_page_type: 'Listing or index',
    expected_retain: [],
    expected_forbid: [],
    expected_alert: 'No alert from this page',
  },
  {
    key: 'uk-news-consumers',
    label: 'UK news "consumers" index page',
    origin: 'Produced the index-page alert ALT-00007',
    url: 'https://www.gamblingcommission.gov.uk/news/consumers',
    expected_page_type: 'Listing or index',
    expected_retain: [],
    expected_forbid: [],
    expected_alert: 'No alert from this page',
  },
  {
    key: 'uk-news-enforcement-action',
    label: 'UK news "enforcement action" index page',
    origin: 'Produced the index-page alert ALT-00009',
    url: 'https://www.gamblingcommission.gov.uk/news/enforcement-action',
    expected_page_type: 'Listing or index',
    expected_retain: [],
    expected_forbid: [],
    expected_alert: 'No alert from this page',
  },
  {
    key: 'mga-home-index',
    label: 'MGA homepage (navigation, not a publication)',
    origin: 'Produced the index-page alert ALT-00001',
    url: 'https://www.mga.org.mt/',
    expected_page_type: 'Listing or index',
    expected_retain: [],
    expected_forbid: [],
    expected_alert: 'No alert from this page',
  },
  {
    key: 'uk-public-statement',
    label: 'Genuine UK public statement under a /public-register/ path',
    origin: 'A broad "register" exclusion rejected genuine statements on such paths',
    url: 'https://www.gamblingcommission.gov.uk/public-register/public-statement/detail/stakelogic-bv-public-statement',
    expected_page_type: 'Individual publication',
    expected_retain: ['RTS', 'public statement'],
    expected_forbid: [],
    expected_alert: 'Alert appropriate',
  },
  {
    key: 'uk-regulatory-actions-register',
    label: 'UK regulatory actions register with substantive records on the listing',
    origin: 'Requirement that a register holding substantive records is read item by item',
    url: 'https://www.gamblingcommission.gov.uk/public-register/regulatory-actions/full',
    expected_page_type: 'Listing or index',
    expected_retain: [],
    expected_forbid: [],
    expected_alert: 'No alert from this page',
    expected_item_records: 3,
  },
  {
    key: 'uk-businesses-register-index',
    label: 'UK public register "businesses" index (actual mismatch)',
    origin: 'Captured on 2026-11-05 and typed "Individual publication" although the page is a register index — recorded here as the actual failure',
    url: 'https://www.gamblingcommission.gov.uk/public-register/businesses',
    expected_page_type: 'Listing or index',
    expected_retain: [],
    expected_forbid: [],
    expected_alert: 'No alert from this page',
  },
  {
    key: 'mga-article-mou',
    label: 'MGA article with footer/other-news links (memorandum of understanding)',
    origin: 'Rejected as a listing because of footer links on 2026-11-05',
    url: 'https://www.mga.org.mt/mga-and-mccaa-sign-memorandum-of-understanding-to-enhance-cooperation-on-player-protection',
    expected_page_type: 'Individual publication',
    expected_retain: ['memorandum of understanding'],
    expected_forbid: [],
    expected_alert: 'Alert appropriate',
  },
  {
    key: 'mga-article-event',
    label: 'MGA article with footer/other-news links (event announcement)',
    origin: 'Rejected as a listing because of footer links on 2026-11-05',
    url: 'https://www.mga.org.mt/make-it-in-malta-heads-to-sigma-world-2026-to-showcase-maltas-gaming-ecosystem',
    expected_page_type: 'Individual publication',
    expected_retain: ['SiGMA'],
    expected_forbid: [],
    expected_alert: 'Alert appropriate',
  },
  {
    key: 'mga-enforcement-register',
    label: 'MGA enforcement register (index that produced an enforcement alert)',
    origin: 'Page that produced the incorrect enforcement alert ALT-00002',
    url: 'https://www.mga.org.mt/licensee-hub/enforcement-register/',
    expected_page_type: 'Listing or index',
    expected_retain: [],
    expected_forbid: [],
    expected_alert: 'No alert from this page',
  },
  {
    key: 'mga-publication',
    label: 'MGA individual publication (consultation outcome)',
    origin: 'Real individual publication used for the unchanged-repeat case',
    url: 'https://www.mga.org.mt/mga-concludes-consultation-on-proposed-updates-to-recognition-notice-framework',
    expected_page_type: 'Individual publication',
    expected_retain: ['Recognition Notice'],
    expected_forbid: [],
    expected_alert: 'Alert appropriate',
  },
];

const MAX_TEXT = 9000;

// The structural snapshot and the region text are stored in separate fields: a single field
// holding both exceeded the field limit and was silently truncated, which left the UK cases
// unreadable (found by run CLS-2026-11-05-38CC3C). Every field stays well under the limit.
function packStructure(structure) {
  if (!structure) return JSON.stringify(null);
  const { regionText, ...rest } = structure;
  return JSON.stringify({
    ...rest,
    regionText: '',
    cardLinks: (rest.cardLinks || []).slice(0, 30).map((link) => ({ href: link.href, label: String(link.label || '').slice(0, 110) })),
    headings: (rest.headings || []).slice(0, 8),
    meta: (rest.meta || []).slice(0, 6),
    times: (rest.times || []).slice(0, 5),
  }).slice(0, MAX_TEXT);
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch((e) => (e.status === 401 ? null : Promise.reject(e)));
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const E = base44.asServiceRole.entities;
    const saved = [];

    await withBrowser(base44, async ({ capture }) => {
      for (const testCase of CASES) {
        const profile = profileFor(testCase.url);
        const shot = await capture(testCase.url, { waitMs: 1500, regionSelectors: profile.regionSelectors });
        if (!shot || !shot.text) {
          saved.push({ case_key: testCase.key, captured: false, reason: shot && shot.navigationError ? shot.navigationError : `HTTP ${shot && shot.httpStatus}` });
          continue;
        }
        const fields = {
          case_key: testCase.key,
          label: testCase.label,
          origin: testCase.origin,
          url: canonicalUrl(shot.finalUrl || testCase.url),
          profile: profile.id,
          expected_page_type: testCase.expected_page_type,
          expected_retain: testCase.expected_retain || [],
          expected_forbid: testCase.expected_forbid || [],
          expected_alert: testCase.expected_alert,
          expected_item_records: testCase.expected_item_records || 0,
          structure_json: packStructure(shot.structure),
          region_text: String(shot.structure?.regionText || '').slice(0, MAX_TEXT),
          text: String(shot.text).slice(0, MAX_TEXT),
          content_hash: await substantiveHash(shot.text),
          captured_at: shot.capturedAt,
          is_fixture: true,
          notes: `HTTP ${shot.httpStatus}; profile ${profile.id}.`,
        };
        const existing = await E.ClassificationFixture.filter({ case_key: testCase.key }, { limit: 5 });
        const record = existing.items && existing.items.length
          ? await E.ClassificationFixture.update(existing.items[0].id, fields)
          : await E.ClassificationFixture.create(fields);
        saved.push({ case_key: testCase.key, captured: true, id: record.id, pageTitle: shot.title });

        // Unchanged repeat: the same publication captured again, later in the same session.
        if (testCase.key === 'mga-publication') {
          const repeat = await capture(testCase.url, { waitMs: 1200, regionSelectors: profile.regionSelectors });
          const repeatFields = {
            ...fields,
            case_key: 'mga-publication-repeat',
            label: 'Same MGA publication captured again, unchanged',
            origin: 'Unchanged repeat capture of a real publication',
            expected_change_type: 'Unchanged',
            // Page type alone justifies an alert here: what stops a new alert is the comparison
            // reporting the capture as unchanged, which is checked separately.
            expected_alert: 'Alert appropriate',
            structure_json: packStructure(repeat.structure),
            region_text: String(repeat.structure?.regionText || '').slice(0, MAX_TEXT),
            text: String(repeat.text).slice(0, MAX_TEXT),
            content_hash: await substantiveHash(repeat.text),
            captured_at: repeat.capturedAt,
            notes: 'repeat_of:mga-publication',
          };
          const priorRepeat = await E.ClassificationFixture.filter({ case_key: 'mga-publication-repeat' }, { limit: 5 });
          if (priorRepeat.items && priorRepeat.items.length) await E.ClassificationFixture.update(priorRepeat.items[0].id, repeatFields);
          else await E.ClassificationFixture.create(repeatFields);

          // Clearly labelled synthetic amendment built on the saved real capture. No invented
          // document: one added paragraph, marked as a fixture everywhere it is stored.
          const structure = JSON.parse(fields.structure_json || 'null');
          if (structure && fields.region_text) {
            const amended = {
              ...structure,
              regionText: `${fields.region_text}\nThe Authority has amended paragraph 4 of the Recognition Notice with effect from 1 December 2026 to require licensees to submit amended control system documentation for review.`,
            };
            const amendmentFields = {
              ...fields,
              case_key: 'fixture-amendment',
              label: 'Labelled fixture: genuine substantive amendment to the same publication',
              origin: 'Synthetic amendment applied to a saved real capture, clearly labelled as a fixture',
              url: `${fields.url}#fixture-amendment`,
              expected_change_type: 'Amended',
              expected_retain: ['amended paragraph 4'],
              structure_json: packStructure(amended),
              region_text: amended.regionText.slice(0, MAX_TEXT),
              text: `${fields.text}\nThe Authority has amended paragraph 4 of the Recognition Notice with effect from 1 December 2026 to require licensees to submit amended control system documentation for review.`,
              is_fixture: true,
              notes: 'Synthetic amendment on a saved real capture; never a live publication.',
            };
            const priorAmendment = await E.ClassificationFixture.filter({ case_key: 'fixture-amendment' }, { limit: 5 });
            if (priorAmendment.items && priorAmendment.items.length) await E.ClassificationFixture.update(priorAmendment.items[0].id, amendmentFields);
            else await E.ClassificationFixture.create(amendmentFields);
          }
        }
      }
    });

    return Response.json({ ok: true, cases: saved.length, saved });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}