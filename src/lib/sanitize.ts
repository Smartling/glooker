/**
 * Strip characters that are invisible to humans but visible to an LLM —
 * the carriers used by prompt-injection vectors PI-05 (invisible chars in
 * file diffs) and PI-07 (invisible chars in prompt template files).
 *
 * Preserves: all printable characters (ASCII and non-ASCII), plus
 * whitespace \t \n \r.
 * Removes:
 *   - Unicode tag characters   U+E0020-U+E007F
 *   - Zero-width / bidi        U+200B-U+200F, U+202A-U+202E, U+2060, U+FEFF
 *   - C0 control chars         U+0001-U+001F  (except \t \n \r)
 */
const INVISIBLE_RE = /[\u{E0020}-\u{E007F}\u{200B}-\u{200F}\u{202A}-\u{202E}\u{2060}\u{FEFF}\u{0001}-\u{0008}\u{000B}\u{000C}\u{000E}-\u{001F}]/gu;
export function stripInvisible(s: string): string {
  if (s == null) return '';
  return String(s).replace(INVISIBLE_RE, '');
}

/**
 * Sanitize a value that may come from a malicious git config (PI-06).
 * Keeps printable ASCII (0x20-0x7E) only, then caps length.
 *
 * The LLM does not need the original name to assess a diff — it just needs
 * something to label the author by. Worst-case legitimate impact: an
 * accented or non-Latin name renders as ASCII letters or empty.
 */
export function sanitizeAuthorName(s: string, maxLen = 80): string {
  if (s == null) return '';
  return String(s).replace(/[^\x20-\x7E]/g, '').slice(0, maxLen);
}
