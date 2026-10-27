/**
 * Competition ranking ("1224"): items with equal values share the place of the
 * first of them, and the next distinct value skips the places taken by the tie
 * (1, 1, 1, 4). Pure – safe for server and client.
 *
 * `items` must already be ordered best-first. Values are compared with Number(),
 * since DECIMAL columns may come back as strings.
 */
export function competitionRanks<T>(items: readonly T[], getValue: (item: T) => unknown): number[] {
  const ranks: number[] = [];
  items.forEach((item, i) => {
    const v = Number(getValue(item) ?? 0);
    ranks.push(i > 0 && v === Number(getValue(items[i - 1]) ?? 0) ? ranks[i - 1] : i + 1);
  });
  return ranks;
}

/** Place of a value in a list: 1 + the number of items strictly better (higher). */
export function rankOfValue(values: readonly unknown[], value: unknown): number {
  const v = Number(value ?? 0);
  return 1 + values.filter(x => Number(x ?? 0) > v).length;
}
