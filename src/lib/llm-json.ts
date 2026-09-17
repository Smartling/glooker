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
  /** The parse position V8 reported, or -1 when it gave none. */
  readonly position: number;
  /** Context around the failure, for logging. NEVER put this in `message`. */
  readonly window: string;
  readonly head: string;
  readonly tail: string;

  constructor(cause: unknown, text: string) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    // `message` is deliberately free of model output: route handlers serialise
    // err.message into 5xx response bodies, and this payload carries commit
    // messages and Jira summaries.
    super(`model JSON unparseable after repair: ${detail}`);
    this.name = 'ModelJsonError';

    const at = Number(/position (\d+)/.exec(detail)?.[1] ?? -1);
    this.position = Number.isFinite(at) ? at : -1;
    const W = 300;
    this.window = this.position >= 0
      ? text.slice(Math.max(0, this.position - W), this.position + W)
      : '';
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
