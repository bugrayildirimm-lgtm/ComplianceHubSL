import { base44 } from "@/api/base44Client";

// Audit events are written server-side; ordinary users can never edit or delete them.
export async function logAudit({ eventType, entityType, entityId, entityLabel, summary, detail }) {
  try {
    await base44.functions.invoke("logAudit", {
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId,
      entity_label: entityLabel,
      summary,
      detail,
    });
  } catch (_error) {
    // Never block the user's change on an audit transport error.
  }
}

export async function callFunction(name, payload = {}) {
  const response = await base44.functions.invoke(name, payload);
  return response.data;
}