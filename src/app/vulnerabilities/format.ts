import type { ResolvedSince } from '@/lib/vulnerabilities/types';

export const dash = (v: number | null | undefined, suffix = '') => (v === null || v === undefined ? '—' : `${v.toLocaleString()}${suffix}`);

/**
 * GLOOK-43 Wave P: the one place that turns a `ResolvedSince` (config.ts's parsed
 * VULN_RESOLVED_SINCE) into the caption every "resolved since" figure renders through — TeamPivot,
 * the KPI tile on vulnerabilities-content.tsx, and PolicyPanel. `invalid` wins over `date` (an
 * invalid value never leaves a stale date on screen); `date === null` means the variable is unset,
 * i.e. "count all time".
 */
export function resolvedCaption(r: ResolvedSince): string {
  if (r.invalid) return 'since —';
  return r.date === null ? 'all time' : `since ${r.date}`;
}
export const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);
export const deltaClass = (v: number) => (v > 0 ? 'text-red-400' : v < 0 ? 'text-green-400' : 'text-gray-500');

/**
 * Shared SWR fetcher (GLOOK-43 Wave D / D1, hardened in Wave E / E1): every panel on the
 * Vulnerabilities page and the syncs tab on Report History used a bare
 * `fetch(u).then(r => r.json())`, so an error response body — a route exception's 500
 * `{ error: 'Internal Server Error' }` (`src/lib/logger.ts`), or `withFilters`'s 400 `{ error }`
 * — arrived as SWR **data**, never as SWR `error`. That left AlertsPanel stuck on "Loading…"
 * forever (its `data` prop is derived from `alerts?.rows`, which is never present on an error
 * body) and let the syncs tab overwrite its last good table with the error object. Throwing here
 * on `!r.ok` moves both cases onto SWR's `error` channel, where `keepPreviousData` (or SWR's
 * default revalidation behavior) keeps the last good `data` around and callers can show a banner
 * over it instead of blanking the view.
 *
 * `ok` is read first, then the body is parsed. On the `!res.ok` path the parse is lenient
 * (`.catch(() => null)`) — a load balancer's HTML 502 then throws a plain `HTTP 502` instead of a
 * JSON `SyntaxError` masking the real status. The ok path keeps a strict `res.json()`, so a 200
 * with malformed JSON still fails visibly instead of being swallowed to `null`. The status is
 * carried on `err.status` and the parsed (possibly null) body on `.info`, so a caller that needs
 * more than the message (e.g. `known_teams`), or `shouldRetryVulnFetch` below, still can. `.info`
 * is only ever set on the error path — an ok response returns its body directly.
 *
 * Why not the app-wide `jsonFetcher` (`src/lib/swr-provider.tsx`): it throws a plain `Error` with
 * the message only, dropping the status and the body. The summary's unknown-team page needs
 * `known_teams` from the body, and the retry predicate below needs the status. The message rules
 * otherwise match.
 */
export async function fetcher(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const err: any = new Error(body?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.info = body;
    throw err;
  }
  return res.json();
}

/**
 * SWR 2.4.1 types `shouldRetryOnError` as `boolean | ((err: Error) => boolean)`, so this predicate
 * turns SWR's retry-on-error loop off for a 4xx — a bad filter or an unknown team won't fix itself
 * by retrying the same request — while leaving it on for a 5xx and for a network/parse error that
 * carries no `status` at all (GLOOK-43 Wave E / E1). 408 (Request Timeout) and 429 (Too Many
 * Requests) are the exception: despite being in the 4xx range, both are transient by design, so
 * they're retried like a 5xx (GLOOK-43 Wave F / F2). When this returns `true`, the app-wide
 * `SWRProvider` config still caps retries at `errorRetryCount: 1`, so the saving is one pointless
 * retry per 4xx, not an endless loop.
 */
export function shouldRetryVulnFetch(err: unknown): boolean {
  const status = (err as any)?.status;
  const nonRetryable4xx = typeof status === 'number' && status >= 400 && status <= 499 && status !== 408 && status !== 429;
  return !nonRetryable4xx;
}

export const vulnSwrOptions = { shouldRetryOnError: shouldRetryVulnFetch };

/**
 * Shared by every SWR-backed panel on the Vulnerabilities page and the syncs tab on Report
 * History (GLOOK-43 Wave B / B2): formats an SWR-level error (fetch/parse failure, including one
 * thrown by `fetcher` above for a non-ok response) so a panel never leaves the user stuck on
 * "Loading…" for one.
 *
 * GLOOK-43 Wave E / E3: originally also read a data-level `{ error }` payload off `data`, for a
 * route that returned 200 with an error body. No vulnerability route does that, and `fetcher` now
 * throws on every non-ok response, so that payload can only ever arrive as `err`, never as `data`
 * — the `data` parameter and its branch were dead. Dropped in favor of the single `err` channel.
 */
export function panelError(err: unknown, label: string): string | null {
  if (!err) return null;
  return `Couldn't load ${label}: ${err instanceof Error ? err.message : String(err)}`;
}
