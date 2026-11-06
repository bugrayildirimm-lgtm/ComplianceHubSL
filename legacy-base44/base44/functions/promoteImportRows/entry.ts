import { createClientFromRequest } from 'npm:@base44/sdk@0.8.54';
import { resolveActor, logAudit, nextRef, json } from '../../shared/compliance.ts';

function splitFlags(flags) {
  return String(flags || '')
    .split(';')
    .map((f) => f.trim())
    .filter(Boolean);
}

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveActor(base44);
    if (!actor.user) return json({ error: 'Sign-in required' }, 401);
    if (!actor.canWrite) return json({ error: 'Your access role is read-only' }, 403);

    const body = await req.json().catch(() => ({}));
    const batchId = body.batch_id;
    if (!batchId) return json({ error: 'batch_id is required' }, 400);

    const rows = await base44.asServiceRole.entities.ImportRow.filter({ batch_id: batchId });
    if (!rows.length) return json({ error: 'No staged rows found for this batch' }, 404);

    const selectedKeys = Array.isArray(body.row_keys) && body.row_keys.length ? new Set(body.row_keys) : null;
    const promotable = rows.filter((row) => {
      if (row.promoted_jurisdiction_id) return false;
      if (row.validation_status === 'Invalid' || row.validation_status === 'Already imported') return false;
      if (selectedKeys) return selectedKeys.has(row.import_row_key);
      return row.review_decision === 'Approved for promotion';
    });

    if (!promotable.length) {
      return json({
        error: 'Nothing approved for promotion. Approve the rows you want to promote (or select rows explicitly) — promotion is a controlled step.',
      }, 400);
    }

    const existing = await base44.asServiceRole.entities.Jurisdiction.filter({});
    const byRowKey = new Map(existing.map((j) => [j.import_row_key, j]));
    let maxId = 0;
    for (const j of existing) {
      const m = typeof j.jurisdiction_id === 'string' ? j.jurisdiction_id.match(/(\d+)$/) : null;
      if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
    }

    const created = [];
    const updated = [];
    const newRecords = [];
    const existingUpdates = [];
    const rowUpdates = [];
    for (const row of promotable) {
      const flags = splitFlags(row.migration_flags);
      const parentMatch = (row.jurisdiction_name_trimmed || '').match(/\(([^)]+)\)/);
      let territoryScope = 'Country';
      if (/preserve named subnational scope/i.test(row.migration_flags || '')) territoryScope = 'Subnational state or province';
      else if (/confirm precise territorial scope/i.test(row.migration_flags || '')) territoryScope = 'Unconfirmed';
      else if (/rest of|other territories|others/i.test(row.jurisdiction_name_trimmed || '')) territoryScope = 'Aggregate or region';
      else if (parentMatch) territoryScope = 'Subnational state or province';

      const licensed = row.proposed_internal_status === 'Licensed Jurisdiction';
      // Licensed markets default to Regulatory Compliance. Certificate-based activity is
      // never inferred from the internal classification, so everything else stays unassigned
      // until a person confirms it.
      const ownerTeam = licensed ? 'Regulatory Compliance' : 'Unassigned';
      const ownershipStatus = licensed ? 'Pending confirmation' : 'Ownership review';

      const payload = {
        name: row.jurisdiction_name_trimmed,
        name_raw: row.jurisdiction_name_raw,
        territory_scope: territoryScope,
        parent_jurisdiction: parentMatch ? parentMatch[1].trim() : '',
        internal_classification: row.proposed_internal_status || 'Unknown',
        classification_basis: 'Imported internal classification — not a legal determination',
        legal_verification_status: 'Not verified',
        product_scope_status: 'Not established',
        primary_owner_team: ownerTeam,
        primary_owner_user: '',
        collaborating_teams: licensed ? ['Technical Compliance'] : [],
        ownership_status: ownershipStatus,
        certificate_activity_confirmed: false,
        review_flags: flags,
        duplicate_group: row.duplicate_review_group || '',
        possible_duplicate_of: row.duplicate_of_row_key || '',
        import_row_key: row.import_row_key,
        source_row: row.source_row,
        source_file: row.source_file,
        source_period: row.source_period,
        monitoring_status: 'No sources configured',
      };

      const prior = byRowKey.get(row.import_row_key);
      let jurisdictionId = '';
      if (prior) {
        jurisdictionId = prior.jurisdiction_id;
        updated.push(jurisdictionId);
        existingUpdates.push({ id: prior.id, ...payload });
      } else {
        maxId += 1;
        jurisdictionId = `JUR-${String(maxId).padStart(4, '0')}`;
        created.push(jurisdictionId);
        newRecords.push({ ...payload, jurisdiction_id: jurisdictionId });
      }

      rowUpdates.push({
        id: row.id,
        promoted_jurisdiction_id: jurisdictionId,
        promoted_jurisdiction_name: row.jurisdiction_name_trimmed,
        review_decision: 'Approved for promotion',
      });
    }

    if (newRecords.length) await base44.asServiceRole.entities.Jurisdiction.bulkCreate(newRecords);
    if (existingUpdates.length) await base44.asServiceRole.entities.Jurisdiction.bulkUpdate(existingUpdates);
    if (rowUpdates.length) await base44.asServiceRole.entities.ImportRow.bulkUpdate(rowUpdates);

    const remaining = await base44.asServiceRole.entities.ImportRow.filter({ batch_id: batchId });
    const promotedCount = remaining.filter((r) => r.promoted_jurisdiction_id).length;
    const batch = await base44.asServiceRole.entities.ImportBatch.get(batchId).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (batch) {
      await base44.asServiceRole.entities.ImportBatch.update(batchId, {
        promoted_count: promotedCount,
        status: promotedCount >= remaining.length ? 'Promoted' : promotedCount > 0 ? 'Partially promoted' : 'Preview',
      });
    }

    await logAudit(base44, actor, {
      event_type: 'Import rows promoted',
      entity_type: 'ImportBatch',
      entity_id: batchId,
      entity_label: batch?.batch_ref || batchId,
      summary: `Promoted ${created.length + updated.length} staged rows into the master register (${created.length} new, ${updated.length} updated).`,
      detail: `Master IDs: ${[...created, ...updated].join(', ')}`,
      recorded_by: 'promoteImportRows',
    });

    return json({ promoted: created.length + updated.length, created, updated, promoted_count: promotedCount });
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}