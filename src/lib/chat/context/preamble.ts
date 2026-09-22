import type { KeyFigure, PageContext } from './types';

/** Hard cap so one page cannot blow the preamble budget. */
const MAX_FIGURES = 8;
const MAX_LABEL_LEN = 120;
const MAX_PARAM_LEN = 64;
const MAX_PARAM_ENTRIES = 10;
const MAX_FILTER_ENTRIES = 10;
const MAX_FIGURE_TEXT_LEN = 40;

const VALID_SOURCES = new Set(['route', 'enriched', 'inferred']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Strip control characters (including newlines) so injected text cannot
 * forge prompt structure such as a fake heading, then cap length. Returns
 * '' for anything that isn't a string, so a malformed field is dropped
 * rather than throwing.
 */
function sanitizeText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const flattened = value.replace(/[\x00-\x1F\x7F]+/g, ' ').trim();
  return flattened.slice(0, maxLen);
}

/**
 * Coerce a params/filters-shaped value into a capped, sanitized string map.
 * A non-object input, or an entry whose key/value isn't a usable string, is
 * dropped rather than throwing — this is what lets `buildPreamble` accept
 * raw, unvalidated request JSON.
 */
function sanitizeStringMap(value: unknown, maxEntries: number, maxLen: number): Record<string, string> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (Object.keys(out).length >= maxEntries) break;
    if (typeof val !== 'string') continue;
    const safeKey = sanitizeText(key, maxLen);
    if (!safeKey) continue;
    out[safeKey] = sanitizeText(val, maxLen);
  }
  return out;
}

/** Same treatment as sanitizeStringMap, but for the keyFigures array shape. */
function sanitizeKeyFigures(value: unknown): KeyFigure[] {
  if (!Array.isArray(value)) return [];
  const out: KeyFigure[] = [];
  for (const entry of value) {
    if (out.length >= MAX_FIGURES) break;
    if (!isPlainObject(entry)) continue;
    const label = sanitizeText(entry.label, MAX_FIGURE_TEXT_LEN);
    if (!label) continue;
    if (typeof entry.value !== 'string' && typeof entry.value !== 'number') continue;
    const value_ = sanitizeText(String(entry.value), MAX_FIGURE_TEXT_LEN);
    out.push({ label, value: value_ });
  }
  return out;
}

/**
 * Render the descriptor as a short system-prompt block.
 *
 * Key figures are emitted ONLY when source === 'enriched', i.e. a page
 * explicitly declared them. A route-derived or model-inferred context must
 * never put values into the prompt — every number the agent states has to come
 * back through its tools, which run under the caller's identity and therefore
 * respect cost-visibility.
 *
 * `ctx` is treated as untrusted input, not just `PageContext | null`: it may
 * be raw, unvalidated JSON straight off an HTTP request body (see
 * src/app/api/chat/route.ts). Anything that isn't a plain object is treated
 * as absent; any field of the wrong shape is dropped rather than thrown on.
 * Every interpolated string is length-capped and stripped of control
 * characters (including newlines), so a crafted URL segment or a direct API
 * call cannot plant unbounded or structure-forging text into the system
 * prompt.
 */
export function buildPreamble(ctx: unknown): string {
  if (!isPlainObject(ctx)) return '';

  const label = sanitizeText(ctx.label, MAX_LABEL_LEN);
  const kind = sanitizeText(ctx.kind, MAX_LABEL_LEN);
  if (!label && !kind) return '';

  const source = typeof ctx.source === 'string' && VALID_SOURCES.has(ctx.source)
    ? (ctx.source as PageContext['source'])
    : 'route';

  const lines: string[] = ['', '## What the user is currently viewing', ''];
  lines.push(kind ? `View: ${label} (${kind})` : `View: ${label}`);

  const params = Object.entries(sanitizeStringMap(ctx.params, MAX_PARAM_ENTRIES, MAX_PARAM_LEN))
    .map(([k, v]) => `${k}=${v}`);
  if (params.length) lines.push(`Identifiers: ${params.join(', ')}`);

  const filters = Object.entries(sanitizeStringMap(ctx.filters, MAX_FILTER_ENTRIES, MAX_PARAM_LEN))
    .map(([k, v]) => `${k}=${v}`);
  if (filters.length) lines.push(`Active filters: ${filters.join(', ')}`);

  if (source === 'enriched') {
    const figures = sanitizeKeyFigures(ctx.keyFigures);
    if (figures.length) {
      lines.push(`On screen: ${figures.map(f => `${f.label}: ${f.value}`).join('; ')}`);
    }
  }

  if (source === 'inferred') {
    lines.push('Note: this view was inferred from the page and is unverified. Say so if you rely on it.');
  }

  lines.push(
    '',
    'Resolve vague references ("this developer", "here", "my spend") against this view.',
    'Always confirm figures with your tools; never restate a number without fetching it.',
  );

  return lines.join('\n');
}
