// src/app/vulnerabilities/overview-format.ts
// GLOOK-64: the wording and tone of the Overview's "change since the baseline" sentences, in one
// place so the Open tile and the trend header cannot disagree. Pure: no React, no server imports.
import type { DeltaResult, DeltaTeam } from '@/lib/vulnerabilities/aggregate';
import type { Severity } from '@/lib/vulnerabilities/types';
import { displayDate } from './labels';

/** "▲ 2 more than on Sep 29", "▼ 1 fewer than on Sep 29" or "Same as on Sep 29". The date reads through `displayDate`. */
export function changeSentence(delta: number, baselineDate: string, today?: string): string {
  const on = displayDate(baselineDate, today);
  if (delta > 0) return `▲ ${delta} more than on ${on}`;
  if (delta < 0) return `▼ ${-delta} fewer than on ${on}`;
  return `Same as on ${on}`;
}

/**
 * More open alerts is bad: red for critical, orange for high (the severity's own colour). Fewer is
 * green, no change is grey. The arrow in the sentence is the non-colour cue.
 */
export function changeToneClass(delta: number, sev: Severity): string {
  if (delta > 0) return sev === 'high' ? 'text-orange-400' : 'text-red-400';
  if (delta < 0) return 'text-green-400';
  return 'text-gray-500';
}

/**
 * Why there is no change to show. A null baseline means no stored measurement is old enough, so the
 * sentence names no date. A known baseline whose set does not measure this severity (an imported CSV
 * run never measures high) names that date.
 */
export function baselineUnavailableText(d: DeltaResult | null | undefined, today?: string): string {
  return d?.baseline ? `No measurement on or before ${displayDate(d.baseline.takenOn, today)}` : 'No earlier measurement yet';
}

/** The delta's total, only when it can be trusted: available, with a baseline and a total. */
export function usableTotal(d: DeltaResult | null | undefined): DeltaTeam | null {
  return d && d.available && d.baseline && d.total ? d.total : null;
}

export interface OpenChange {
  /** The sentence to show under the open count. */
  text: string;
  /** A Tailwind text colour class. */
  toneClass: string;
  /** True when `text` is a change sentence, false when it explains why there is none. */
  hasChange: boolean;
  /** The change itself, when there is one. */
  delta: number | null;
}

export function openChange(d: DeltaResult | null | undefined, sev: Severity, today?: string): OpenChange {
  const total = usableTotal(d);
  if (total && d?.baseline) {
    return { text: changeSentence(total.deltaOpen, d.baseline.takenOn, today), toneClass: changeToneClass(total.deltaOpen, sev), hasChange: true, delta: total.deltaOpen };
  }
  return { text: baselineUnavailableText(d, today), toneClass: 'text-gray-500', hasChange: false, delta: null };
}
