// GLOOK-64: wording that more than one component prints, defined once so the surfaces cannot drift
// apart: how a date reads, why a repository is unmeasured, and the unmeasured badge. Pure: no React,
// no server imports.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today's date, YYYY-MM-DD, in UTC. Reads `Date.now()` so a test can pin the clock without fake timers. */
export const utcToday = (): string => new Date(Date.now()).toISOString().slice(0, 10);

/** The browser's own calendar day, YYYY-MM-DD: what a date picker's `max` and a "a week ago" prefill must agree on. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * The one way a date is shown on the page: "Oct 4" within the current year, "Jan 8, 2020" in any other
 * year. `iso` is a YYYY-MM-DD date or an ISO instant, read in UTC; anything unparseable is returned as
 * it came. The ISO form stays only in `title` attributes.
 */
export function displayDate(iso: string, today: string = utcToday()): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const monthDay = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === Number(today.slice(0, 4)) ? monthDay : `${monthDay}, ${d.getUTCFullYear()}`;
}

/** The two facts that say why a repository's open count is unknown (a `RepoRow.unmeasured`, or a coverage row's status and detail). */
export interface UnmeasuredWhy { status: string; detail: string | null }

/**
 * Why a repository is unmeasured, in the coverage drawer's wording: "Dependabot off", else the
 * status check's own detail, else "Status check failed". The Repositories band and the rail upper-case
 * it where their style needs it.
 */
export function unmeasuredReason(u: UnmeasuredWhy): string {
  return u.status === 'dependabot-off' ? 'Dependabot off' : (u.detail ?? 'Status check failed');
}

/** "2 unmeasured repos", "1 unmeasured repo". */
export const unmeasuredCountText = (n: number): string => `${n.toLocaleString('en-US')} unmeasured ${n === 1 ? 'repo' : 'repos'}`;

/** The unmeasured badge's one phrase: the header's coverage line and the Alerts strip print it. */
export const unmeasuredBadgeText = (n: number): string => `▲ ${unmeasuredCountText(n)}`;

/** The short form for a table cell, where "repos" is already the column's subject: "▲ 2 unmeasured". */
export const unmeasuredChipText = (n: number): string => `▲ ${n.toLocaleString('en-US')} unmeasured`;
