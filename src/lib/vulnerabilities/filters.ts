// The ONE parameter parser, shared by the API routes and the MCP tools (spec: API › One parameter list).
import { CODEBASE_GROUPS } from './codebase';
import type { AlertFilters, Baseline } from './aggregate';
import type { CodebaseGroup, Severity } from './types';

export type ParsedFilters = AlertFilters & { baseline: Baseline; since?: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function pick(input: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = input[n];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return undefined;
}

/** Only true/false/1/0 (case-insensitive) are accepted; anything else is a validation error rather
 * than silently defaulting to false (a typo like "yes" used to read as "not overdue"). */
function parseBool(name: string, v: string | undefined): { ok: true; value: boolean | undefined } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, value: undefined };
  const lower = v.toLowerCase();
  if (lower === 'true' || lower === '1') return { ok: true, value: true };
  if (lower === 'false' || lower === '0') return { ok: true, value: false };
  return { ok: false, error: `${name} must be true, false, 1 or 0` };
}

/** A real calendar date, not just YYYY-MM-DD shaped — rejects e.g. 2026-02-30, which JS's Date
 * would otherwise silently normalise into a different day. */
function isValidCalendarDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function parseVulnFilters(input: Record<string, unknown>): { ok: true; value: ParsedFilters } | { ok: false; error: string } {
  const codebase = (pick(input, 'codebase') ?? 'backend') as CodebaseGroup;
  if (!CODEBASE_GROUPS.includes(codebase)) return { ok: false, error: `codebase must be one of ${CODEBASE_GROUPS.join(', ')}` };
  const state = (pick(input, 'state') ?? 'open') as ParsedFilters['state'];
  if (!['open', 'resolved', 'all'].includes(state)) return { ok: false, error: 'state must be open, resolved or all' };
  const severity = pick(input, 'severity') as Severity | undefined;
  if (severity && severity !== 'critical' && severity !== 'high') return { ok: false, error: 'severity must be critical or high' };
  const baseline = pick(input, 'baseline') ?? 'last';
  // A YYYY-MM-DD-shaped baseline gets the same calendar round-trip check as
  // due_before/created_since/resolved_since/since below — DATE.test alone would accept 2026-02-30.
  if (!['last', '7d', '30d'].includes(baseline) && !isValidCalendarDate(baseline)) return { ok: false, error: 'baseline must be last, 7d, 30d or YYYY-MM-DD' };
  const dates: Record<string, string | undefined> = {
    due_before: pick(input, 'due_before', 'dueBefore'), created_since: pick(input, 'created_since', 'createdSince'),
    resolved_since: pick(input, 'resolved_since', 'resolvedSince'), since: pick(input, 'since'),
  };
  for (const [k, v] of Object.entries(dates)) if (v && !isValidCalendarDate(v)) return { ok: false, error: `${k} must be YYYY-MM-DD` };
  const limitRaw = pick(input, 'limit');
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) return { ok: false, error: 'limit must be a positive integer' };
  const overdue = parseBool('overdue', pick(input, 'overdue'));
  if (!overdue.ok) return overdue;
  const reopened = parseBool('reopened', pick(input, 'reopened'));
  if (!reopened.ok) return reopened;
  const dueSoon = parseBool('due_soon', pick(input, 'due_soon', 'dueSoon'));
  if (!dueSoon.ok) return dueSoon;
  // C3: overdue and due_soon are disjoint buckets (an alert can't be both past its due date and
  // ≤7 days from it) — asking for both together used to silently return an empty list instead of
  // an error.
  if (overdue.value && dueSoon.value) return { ok: false, error: 'overdue and due_soon are disjoint buckets — use one' };
  return {
    ok: true,
    value: {
      codebase, state, severity, baseline, limit,
      team: pick(input, 'team'), repo: pick(input, 'repo'),
      overdue: overdue.value, reopened: reopened.value, dueSoon: dueSoon.value,
      dueBefore: dates.due_before, createdSince: dates.created_since, resolvedSince: dates.resolved_since, since: dates.since,
      dependencyScope: pick(input, 'dependency_scope', 'dependencyScope'),
      cve: pick(input, 'cve'), ghsa: pick(input, 'ghsa'), packageName: pick(input, 'package', 'packageName'), q: pick(input, 'q'),
    },
  };
}
