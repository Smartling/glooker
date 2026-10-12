// src/app/vulnerabilities/api-types.ts
// GLOOK-64: the response shapes the page reads, derived from the query functions themselves so
// the page cannot drift from the API. Type-only imports: queries.ts reads the database and
// process.env, and must never reach the client bundle.
import type { getSummary, getRepos, getCoverage, getAlerts, getTrend, Unavailable } from '@/lib/vulnerabilities/queries';

type Ok<F extends (...args: any[]) => Promise<unknown>> = Extract<Awaited<ReturnType<F>>, { available: true }>;

export type SummaryData = Ok<typeof getSummary>;
export type ReposData = Ok<typeof getRepos>;
export type CoverageData = Ok<typeof getCoverage>;
export type AlertsData = Ok<typeof getAlerts>;
export type TrendData = Ok<typeof getTrend>;
/** The 200 "not available yet" envelope every data route can return (no sync yet, feature off). */
export type UnavailableData = Unavailable;

/** One data slot as `useSecurityData` (Task 2.7) returns it. Defined here so the test fixtures can
 * type `slot()` without importing a module a later task creates; `use-security-data.ts` re-exports it. */
export interface Slot<T> {
  /** The available:true payload, or undefined. While the key loads this is the previous key's payload
   * (`stale: true`); once the key has failed it is undefined unless the key has data of its own, so an
   * error never sits next to another key's figures. */
  data: T | undefined;
  unavailable: UnavailableData | undefined;
  error: unknown;
  /** panelError(error, label): "Couldn't load <label>: <message>", or null. */
  errorText: string | null;
  /** The key has never resolved and there is nothing to show. */
  loading: boolean;
  /** The previous key's data is on screen while the new key loads (isLoading with data in hand). A
   * revalidation failure on a key that has its own data keeps that data and leaves this false. */
  stale: boolean;
}
