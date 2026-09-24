import type { SlaEntry } from './types';
import { getVulnConfig } from './config';
import { addDays, diffDays, utcDate, toIsoSecond } from './time';
import type { Severity } from './types';

export interface DueInput {
  severity: Severity;
  createdAt: string;
  severityChangedAt: string | null;
}

export interface DueInfo {
  clockStart: string; // instant
  dueDate: string;    // YYYY-MM-DD, due at end of that UTC day
  policyId: string;
  days: number;
}

function entriesFor(severity: Severity, policy: readonly SlaEntry[]): SlaEntry[] {
  return policy.filter(e => e.severity === severity).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

export function computeDue(alert: DueInput, policy: readonly SlaEntry[] = getVulnConfig().slaPolicy): DueInfo | null {
  const entries = entriesFor(alert.severity, policy);
  if (entries.length === 0) return null;
  const firstStart = toIsoSecond(entries[0].effectiveFrom);
  const candidates = [alert.createdAt, firstStart];
  // Upward re-rating (high → critical): the critical clock starts when it became critical.
  // With two severities, "changed and now critical" means upward.
  if (alert.severity === 'critical' && alert.severityChangedAt) candidates.push(alert.severityChangedAt);
  const clockStart = candidates.reduce((a, b) => (b > a ? b : a));
  const clockDate = utcDate(clockStart);
  const entry = [...entries].reverse().find(e => e.effectiveFrom <= clockDate)!;
  return { clockStart, dueDate: addDays(clockDate, entry.days), policyId: entry.id, days: entry.days };
}

export function daysRemaining(dueDate: string, now: Date): number {
  return diffDays(dueDate, now.toISOString().slice(0, 10));
}

export function slaStatus(
  severity: Severity, now: Date, policy: readonly SlaEntry[] = getVulnConfig().slaPolicy,
): 'none' | 'pending' | 'active' {
  const entries = entriesFor(severity, policy);
  if (entries.length === 0) return 'none';
  return now.toISOString().slice(0, 10) >= entries[0].effectiveFrom ? 'active' : 'pending';
}

export function resolvedTiming(dueDate: string, resolvedAt: string): { onTime: boolean; daysLate: number } {
  const late = diffDays(utcDate(resolvedAt), dueDate);
  return late <= 0 ? { onTime: true, daysLate: 0 } : { onTime: false, daysLate: late };
}

/** Each entry with its derived window, for the policy panel and MCP. */
export function policyWindows(policy: readonly SlaEntry[] = getVulnConfig().slaPolicy, now: Date = new Date()) {
  const today = now.toISOString().slice(0, 10);
  return (['critical', 'high'] as const).flatMap(sev => {
    const es = entriesFor(sev, policy);
    return es.map((e, i) => ({
      ...e,
      until: es[i + 1] ? addDays(es[i + 1].effectiveFrom, -1) : null, // null = open-ended
      pending: e.effectiveFrom > today,
    }));
  });
}
