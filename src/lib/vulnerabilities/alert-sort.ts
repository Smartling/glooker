// Client-safe (no imports): the alert list's sort contract, shared by the parser, the aggregation
// and the page, so the page can build `sort=<key>:<dir>` without pulling in server-only config.
export const ALERT_SORT_KEYS = ['severity', 'advisory', 'repo', 'age', 'due', 'state'] as const;
export type AlertSortKey = (typeof ALERT_SORT_KEYS)[number];
export type AlertSortDir = 'asc' | 'desc';
/** The one wire format: `<key>:<asc|desc>`, e.g. `due:asc`. */
export type AlertSortSpec = `${AlertSortKey}:${AlertSortDir}`;

/** A successfully parsed `<key>:<dir>` sort. */
export type ParsedAlertSort = { key: AlertSortKey; dir: AlertSortDir };

export function parseAlertSort(raw: string): ParsedAlertSort | null {
  const m = /^([a-z]+):(asc|desc)$/.exec(raw);
  if (!m || !(ALERT_SORT_KEYS as readonly string[]).includes(m[1])) return null;
  return { key: m[1] as AlertSortKey, dir: m[2] as AlertSortDir };
}
