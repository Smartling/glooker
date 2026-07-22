/** One row per key, keeping the row with the earliest non-null timestamp.
 *  Rows whose key is null/empty are never collapsed (returned as-is). */
export function dedupByKeyEarliest<T>(rows: T[], keyField: keyof T, tsField: keyof T): T[] {
  const best = new Map<string, T>();
  const passthrough: T[] = [];
  const ms = (r: T): number => {
    const t = r[tsField] as unknown as string | null;
    const n = t ? new Date(t).getTime() : NaN;
    return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n; // null/invalid ts = latest
  };
  for (const r of rows) {
    const k = r[keyField] as unknown as string | null;
    if (k === null || k === undefined || k === '') { passthrough.push(r); continue; }
    const existing = best.get(k);
    if (!existing || ms(r) < ms(existing)) best.set(k, r);
  }
  return [...best.values(), ...passthrough];
}

function periodStartISO(d: Date, period: 'week' | 'month'): string {
  if (period === 'month') {
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  // ISO week: Monday start. getUTCDay(): 0=Sun..6=Sat.
  const day = d.getUTCDay();
  const diff = (day === 0 ? 6 : day - 1); // days since Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff));
  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(monday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Group rows into time buckets (week=Monday start, month=first-of-month), ascending.
 *  Rows with an unparseable timestamp are dropped. */
export function bucketByPeriod<T>(
  rows: T[], tsField: keyof T, period: 'week' | 'month',
): { bucket: string; count: number; rows: T[] }[] {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const raw = r[tsField] as unknown as string | null;
    const d = raw ? new Date(raw) : null;
    if (!d || Number.isNaN(d.getTime())) continue;
    const key = periodStartISO(d, period);
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, bucketRows]) => ({ bucket, count: bucketRows.length, rows: bucketRows }));
}
