import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, nextRef, json } from '../../shared/compliance.ts';

const KNOWN_STATUS = [
  'Licensed Jurisdiction',
  'Conditionally Permitted',
  'Prohibited Territory',
  'Not on RTL / Under Consideration',
];

function mapStatus(rawStatus, proposedStatus) {
  const raw = (rawStatus || '').trim();
  const proposed = (proposedStatus || '').trim();
  if (KNOWN_STATUS.includes(proposed)) return { status: proposed, note: null };
  if (KNOWN_STATUS.includes(raw)) return { status: raw, note: null };
  if (/^not on rtl/i.test(raw) || /^not on rtl/i.test(proposed) || /under review/i.test(proposed)) {
    return { status: 'Not on RTL / Under Consideration', note: `Raw status "${raw || proposed}" mapped to "Not on RTL / Under Consideration" — no permission is inferred.` };
  }
  return { status: 'Unknown', note: `Unrecognised status "${raw || proposed}" kept as Unknown rather than guessed.` };
}

function normalizeKey(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z]/g, '');
}

function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

function inferScope(name, flags) {
  const parentMatch = name.match(/\(([^)]+)\)/);
  const parent = parentMatch ? parentMatch[1].trim() : '';
  if (/preserve named subnational scope/i.test(flags)) {
    return { scope: 'Subnational state or province', parent, warning: `Named subnational scope preserved as a separate jurisdiction${parent ? ` under ${parent}` : ''}.` };
  }
  if (/confirm precise territorial scope/i.test(flags)) {
    return { scope: 'Unconfirmed', parent, warning: 'Aggregate or ambiguous territory — precise scope must be clarified before product profiles are created.' };
  }
  if (parentMatch) {
    return { scope: 'Subnational state or province', parent, warning: `Scope read from name parenthesis (${parent}) — confirm before creating market profiles.` };
  }
  return { scope: 'Country', parent: '', warning: null };
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canWrite) return json({ error: 'Your access role is read-only' }, 403);

    const body = await req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return json({ error: 'No rows received. Load the Import_Staging sheet or a CSV export.' }, 400);
    if (rows.length > 500) return json({ error: 'Batch limit is 500 rows per import preview.' }, 400);

    const existingRows = await base44.asServiceRole.entities.ImportRow.filter({});
    const existingJurisdictions = await base44.asServiceRole.entities.Jurisdiction.filter({});
    const seenKeys = new Set(existingRows.map((r) => r.import_row_key));
    const seenNames = new Map(existingJurisdictions.map((j) => [normalizeKey(j.name), j.name]));

    const batchRef = await nextRef(base44, 'ImportBatch', 'batch_ref', 'IMP', 4);
    const batch = await base44.asServiceRole.entities.ImportBatch.create({
      batch_ref: batchRef,
      file_name: body.file_name || 'Stakelogic_Jurisdiction_Import_Seed.xlsx',
      sheet_name: body.sheet_name || 'Import_Staging',
      source_period: rows[0]?.source_period || '',
      row_count: rows.length,
      status: 'Preview',
      imported_by: actor.email,
      notes: 'Import preview only — no master jurisdiction has been created from this batch yet.',
    });

    const staged = [];
    const batchNames = [];

    for (const raw of rows) {
      const nameRaw = String(raw.jurisdiction_name_raw ?? raw.jurisdiction_name_trimmed ?? '').trim();
      const nameTrimmed = String(raw.jurisdiction_name_trimmed ?? nameRaw).trim();
      const rowKey = String(raw.import_row_key || '').trim() || `GEN-${batchRef}-${staged.length + 1}`;
      const flags = String(raw.migration_flags || '').trim();
      const notes = [];

      let validationStatus = 'Valid';
      let duplicateOf = '';

      if (!nameTrimmed) {
        validationStatus = 'Invalid';
        notes.push('Jurisdiction name is empty — row cannot be promoted.');
      }
      if (seenKeys.has(rowKey)) {
        validationStatus = 'Already imported';
        notes.push('import_row_key already exists — repeat import of the same source row is blocked.');
      }
      if (String(raw.jurisdiction_name_raw || '') !== nameTrimmed && nameRaw) {
        notes.push('Leading or trailing whitespace removed from the jurisdiction name; original preserved.');
      }

      const status = mapStatus(raw.internal_status_raw, raw.proposed_internal_status);
      if (status.note) notes.push(status.note);

      const scope = inferScope(nameTrimmed, flags);
      if (scope.warning) notes.push(scope.warning);

      if (raw.duplicate_review_group) {
        notes.push(`Marked as a possible duplicate group "${raw.duplicate_review_group}" — rows are not merged automatically.`);
        if (validationStatus === 'Valid') validationStatus = 'Possible duplicate';
      }

      const key = normalizeKey(nameTrimmed);
      const prior = seenNames.get(key);
      if (prior && prior !== nameTrimmed) {
        notes.push(`Possible duplicate of existing jurisdiction "${prior}".`);
        if (validationStatus === 'Valid') validationStatus = 'Possible duplicate';
      } else if (!prior) {
        for (const [otherKey, otherName] of batchNames) {
          if (otherKey.length > 5 && key.length > 5 && editDistance(otherKey, key) <= 1 && otherKey !== key) {
            notes.push(`Possible duplicate: "${otherName}" differs by one character or letter substitution. Do not merge without approval.`);
            duplicateOf = otherName;
            if (validationStatus === 'Valid') validationStatus = 'Possible duplicate';
          }
        }
      }

      if (flags && validationStatus !== 'Invalid') {
        if (validationStatus === 'Valid' && /confirm precise territorial scope|do not merge|internal decision required/i.test(flags)) {
          validationStatus = 'Warning';
        }
      }

      batchNames.push([key, nameTrimmed]);
      staged.push({
        batch_id: batch.id,
        import_row_key: rowKey,
        source_file: String(raw.source_file || ''),
        source_sheet: String(raw.source_sheet || ''),
        source_row: String(raw.source_row || ''),
        source_period: String(raw.source_period || ''),
        jurisdiction_name_raw: nameRaw,
        jurisdiction_name_trimmed: nameTrimmed,
        internal_status_raw: String(raw.internal_status_raw || ''),
        proposed_internal_status: status.status,
        proposed_owner_team: String(raw.proposed_owner_team || 'Ownership review'),
        owner_validation: String(raw.owner_validation || 'Pending confirmation'),
        legal_verification_status: String(raw.legal_verification_status || 'Not verified'),
        product_scope_status: String(raw.product_scope_status || 'Not established'),
        import_review_status: String(raw.import_review_status || 'Pending human review'),
        duplicate_review_group: String(raw.duplicate_review_group || ''),
        migration_flags: flags,
        validation_status: validationStatus,
        validation_notes: notes,
        duplicate_of_row_key: duplicateOf,
        review_decision: 'Pending review',
      });
    }

    const created = await base44.asServiceRole.entities.ImportRow.bulkCreate(staged);

    const counts = created.reduce((acc, row) => {
      acc.total += 1;
      if (row.validation_status === 'Valid') acc.valid += 1;
      else if (row.validation_status === 'Warning') acc.warning += 1;
      else if (row.validation_status === 'Possible duplicate') acc.duplicate += 1;
      else if (row.validation_status === 'Invalid') acc.invalid += 1;
      else if (row.validation_status === 'Already imported') acc.already += 1;
      return acc;
    }, { total: 0, valid: 0, warning: 0, duplicate: 0, invalid: 0, already: 0 });

    await base44.asServiceRole.entities.ImportBatch.update(batch.id, {
      valid_count: counts.valid,
      warning_count: counts.warning,
      duplicate_count: counts.duplicate,
      invalid_count: counts.invalid,
      already_imported_count: counts.already,
    });

    await logAudit(base44, actor, {
      event_type: 'Import preview created',
      entity_type: 'ImportBatch',
      entity_id: batch.id,
      entity_label: batchRef,
      summary: `Import preview ${batchRef}: ${counts.total} source rows staged, ${counts.duplicate} possible duplicates, ${counts.warning} flagged, ${counts.already} already imported.`,
      detail: `Sheet ${body.sheet_name || 'Import_Staging'} from ${body.file_name || 'seed workbook'}. No master records created.`,
      recorded_by: 'importStaging',
    });

    return json({ batch_id: batch.id, batch_ref: batchRef, counts, rows: created });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}