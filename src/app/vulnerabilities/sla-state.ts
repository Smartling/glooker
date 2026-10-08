// src/app/vulnerabilities/sla-state.ts
// GLOOK-64: the one place the four SLA states are decided and worded (spec: "SLA policy per
// severity"). The SLA tile, the alerts strip, the rail, the overdue/due columns and the coverage
// drawer all read it, so they cannot disagree. Pure: no React, no server imports.
import type { Severity } from '@/lib/vulnerabilities/types';
import { displayDate } from './labels';

export type SlaState =
  | { kind: 'active' }
  | { kind: 'pending'; startsOn: string | null }
  | { kind: 'none' }
  | { kind: 'invalid' };

/** The slice of the summary response these helpers read. A SummaryData satisfies it. */
export interface SlaSource {
  slaStatus: Record<Severity, 'pending' | 'active' | 'none'>;
  slaPolicyInvalid: boolean;
  policy: Array<{ severity: string; effectiveFrom: string; pending: boolean }>;
}

export function slaState(sev: Severity, s: SlaSource): SlaState {
  // An invalid VULNERABILITIES_SLA_POLICY parses to an empty policy, so slaStatus reads 'none' for
  // both severities. Check invalid first or it would read as merely empty.
  if (s.slaPolicyInvalid) return { kind: 'invalid' };
  const status = s.slaStatus[sev];
  if (status === 'active') return { kind: 'active' };
  if (status === 'pending') {
    const dates = s.policy.filter(p => p.severity === sev && p.pending).map(p => p.effectiveFrom).sort();
    return { kind: 'pending', startsOn: dates[0] ?? null };
  }
  return { kind: 'none' };
}

export interface SlaLabelOptions {
  /**
   * false: a surface whose header already says "SLA" (the SLA tile): "Starts Feb 1, 2099", "No SLA policy yet",
   * "Policy error". true: a surface with no such context (the Alerts strip, the rail note, the Due
   * sub-line, the toggle hint): "SLA starts Feb 1, 2099", "no SLA policy yet", "SLA policy can't be read".
   */
  withSla: boolean;
  /** YYYY-MM-DD; defaults to today (UTC). Only decides whether the date carries its year. */
  today?: string;
}

/** The user-facing text for a non-active state; null when active (the caller shows figures). The one definition of the state wording. */
export function slaStateLabel(st: SlaState, { withSla, today }: SlaLabelOptions): string | null {
  switch (st.kind) {
    case 'active': return null;
    case 'pending': {
      const when = st.startsOn ? displayDate(st.startsOn, today) : 'later';
      return withSla ? `SLA starts ${when}` : `Starts ${when}`;
    }
    case 'none': return withSla ? 'no SLA policy yet' : 'No SLA policy yet';
    case 'invalid': return withSla ? "SLA policy can't be read" : 'Policy error';
  }
}

/** An overdue column (and a due-soon figure) exists only while this severity's policy is active. */
export function slaActive(sev: Severity, s: SlaSource): boolean {
  return slaState(sev, s).kind === 'active';
}

/** True when at least one severity is active: the "Next due" column, and the Overdue / Due ≤ 7d toggles. */
export function anySlaActive(s: SlaSource): boolean {
  return slaActive('critical', s) || slaActive('high', s);
}
