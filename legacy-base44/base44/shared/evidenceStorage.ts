// Retains the complete text the managed browser captured as stored evidence.
//
// The interface preview field (excerpt) stays bounded so pages and selected AI input remain
// bounded. It is a preview only: the full captured text is written to private app storage and
// referenced from the document record, with the source URL, retrieval time and extraction scope
// recorded alongside it. Nothing is summarised, re-ordered or reconstructed.
export const PREVIEW_CHARS = 8000;

// Preview for the interface and selected AI input. Never the evidence itself.
export function previewText(raw, max = PREVIEW_CHARS) {
  const text = String(raw ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// Scope statement that never overstates what a page-body capture contains.
export function retentionScope(scope) {
  return `${scope}. Page-body text only: attachments the viewer did not expose, and content hidden behind interaction or scripts, are not included in this capture.`;
}

// Saves the full capture as a private text file and returns the record fields that describe it.
// On failure it says so plainly instead of letting the excerpt pass as the whole capture.
export async function retainCapturedText(base44, { text, documentRef, url, fetchedAt, scope }) {
  const full = String(text ?? '');
  const capturedChars = full.length;
  if (!capturedChars) {
    return {
      evidence_file_uri: '',
      captured_chars: 0,
      retained_chars: 0,
      evidence_stored_at: '',
      evidence_storage_note: 'No page text was captured by the browser, so no evidence text was stored.',
    };
  }
  const previewChars = Math.min(capturedChars, PREVIEW_CHARS);
  try {
    const file = new File([full], `${documentRef || 'capture'}.txt`, { type: 'text/plain;charset=utf-8' });
    const uploaded = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file });
    const uri = uploaded?.file_uri || '';
    if (!uri) throw new Error('storage returned no file reference');
    return {
      evidence_file_uri: uri,
      captured_chars: capturedChars,
      retained_chars: capturedChars,
      evidence_stored_at: fetchedAt || new Date().toISOString(),
      evidence_storage_note: `Complete captured text retained (${capturedChars} characters) as a private evidence file. Captured ${fetchedAt || 'at retrieval'} from ${url}. ${retentionScope(scope)} The ${previewChars}-character excerpt above is a preview of this file, not the limit of the evidence.`,
    };
  } catch (error) {
    const reason = String((error && error.message) || 'storage unavailable').slice(0, 200);
    return {
      evidence_file_uri: '',
      captured_chars: capturedChars,
      retained_chars: previewChars,
      evidence_stored_at: '',
      evidence_storage_note: `Storage incomplete: the browser captured ${capturedChars} characters from ${url} at ${fetchedAt || 'retrieval time'}, but the evidence file could not be saved (${reason}). Only the ${previewChars}-character excerpt is retained, so the remainder of this capture is not stored evidence.`,
    };
  }
}