const DAY_MS = 86_400_000;

/** The ONLY way to produce a stored instant: second-precision UTC ISO, e.g. 2026-09-22T10:04:11Z. */
export function toIsoSecond(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error(`toIsoSecond: invalid date ${String(input)}`);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function utcDate(iso: string): string {
  return iso.slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** a − b in whole UTC calendar days. */
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS);
}
