/** What the client scrapes from the rendered page. No page instrumentation required. */
export interface PageExtract {
  path: string;
  title: string;
  heading: string;
  text: string;
}

export const MAX_TEXT = 4000;
const MAX_SHORT = 200;

const squash = (v: unknown) => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();

/**
 * Normalise an untrusted extract from the request body.
 * Returns null for anything unusable so callers degrade instead of throwing.
 */
export function clampExtract(raw: unknown): PageExtract | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const out: PageExtract = {
    path: squash(r.path).slice(0, MAX_SHORT),
    title: squash(r.title).slice(0, MAX_SHORT),
    heading: squash(r.heading).slice(0, MAX_SHORT),
    text: squash(r.text).slice(0, MAX_TEXT),
  };

  // Nothing worth reading — treat as absent rather than sending an empty page to the model.
  // Only fires when the caller actually supplied a content field and it resolved to
  // nothing; a payload that never included title/heading/text at all (e.g. just a path)
  // is tolerated rather than discarded.
  const suppliedContentField = 'title' in r || 'heading' in r || 'text' in r;
  if (suppliedContentField && !out.title && !out.heading && !out.text) return null;
  return out;
}
