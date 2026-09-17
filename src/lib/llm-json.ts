// src/lib/llm-json.ts
//
// GLOOK-54: parsing JSON that a model produced, as opposed to JSON.
//
// Providers emit artifacts even under `response_format: { type: 'json_object' }`.
// On 2026-09-16 the Top Projects card had been broken for weeks by a single
// trailing comma at character 2318 of an otherwise perfect 14,268-char
// response: the model closed a `jira_keys` array, emitted `,`, then `}`.
// JSON.parse reports that as "Expected double-quoted property name", because
// it is looking for the next key.
//
// Every model-JSON call site should parse through here, so an artifact fixed
// once is fixed everywhere.

/** Raised when the text cannot be parsed even after repair. */
export class ModelJsonError extends Error {
  /**
   * V8's own message. Logs only — NEVER interpolate into `message`.
   *
   * V8 has two SyntaxError shapes and only one is content-free:
   *
   *   Expected double-quoted property name in JSON at position 35
   *   Unexpected token 'I', "INTERNAL-COMMIT-TEXT" is not valid JSON
   *
   * The second embeds the input. Interpolating it into `message` sent model
   * bytes to the browser, because route handlers serialise `err.message` into
   * 5xx bodies and this payload carries commit messages and Jira summaries.
   */
  readonly detail: string;
  /** The parse position V8 reported, or -1 for the shape that gives none. */
  readonly position: number;
  /** Context around the failure, for logging. NEVER put this in `message`. */
  readonly window: string;
  readonly head: string;
  readonly tail: string;

  constructor(cause: unknown, text: string) {
    // Fixed, content-free, and safe to serialise to a client.
    super('model JSON unparseable after repair');
    this.name = 'ModelJsonError';
    this.detail = cause instanceof Error ? cause.message : String(cause);

    const at = Number(/position (\d+)/.exec(this.detail)?.[1] ?? -1);
    this.position = Number.isFinite(at) ? at : -1;

    const W = 300;
    // The `Unexpected token` shape carries no position, and that is exactly
    // the prose-preamble case the window logging exists for — so fall back to
    // the start of the document rather than leaving the window empty.
    this.window = this.position >= 0
      ? text.slice(Math.max(0, this.position - W), this.position + W)
      : text.slice(0, 2 * W);
    this.head = text.slice(0, 200);
    this.tail = text.slice(-200);
  }
}

/**
 * Strip ```json … ``` fences, which several providers add despite being asked
 * for a JSON object.
 */
export function stripJsonFences(s: string): string {
  return s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
}

/**
 * Remove commas that sit immediately before `}` or `]`.
 *
 * Scans string literals rather than pattern-matching, because this payload is
 * full of Jira summaries and commit messages that can legitimately contain
 * `, }` — a bare `replace(/,\s*([}\]])/g, '$1')` would silently corrupt them.
 * Same hazard as GLOOK-41's `outsideStringLiterals` in db/sqlite.ts, but JSON
 * escapes a quote with a backslash where SQL doubles it, so the scanner
 * tracks backslash escapes instead.
 */
export function stripTrailingCommas(s: string): string {
  let out = '';
  let i = 0;
  let inString = false;

  while (i < s.length) {
    const ch = s[i];

    if (inString) {
      out += ch;
      if (ch === '\\') {
        // Escape sequence: copy the escaped character verbatim so a `\"` does
        // not read as the end of the literal.
        i++;
        if (i < s.length) out += s[i];
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }

    if (ch === '"') { inString = true; out += ch; i++; continue; }

    if (ch === ',') {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j])) j++;
      if (s[j] === '}' || s[j] === ']') {
        i++;       // drop the comma; the whitespace is re-emitted below
        continue;
      }
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Parse model output, repairing the artifacts providers actually emit.
 *
 * Repair is attempted only after a clean parse has failed, so well-formed
 * output is never touched. `repaired` lets the caller log that an artifact was
 * present — silently fixing it forever would hide a drift in model behaviour.
 */
export function parseModelJson<T = unknown>(raw: string): { value: T; repaired: boolean } {
  const cleaned = stripJsonFences(raw);

  try {
    return { value: JSON.parse(cleaned) as T, repaired: false };
  } catch (first) {
    const repaired = stripTrailingCommas(cleaned);
    if (repaired !== cleaned) {
      try {
        return { value: JSON.parse(repaired) as T, repaired: true };
      } catch {
        // Repair did not help — report the ORIGINAL failure, whose position
        // refers to the text the caller can actually log.
      }
    }
    throw new ModelJsonError(first, cleaned);
  }
}
