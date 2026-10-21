/**
 * Competition ranking ("1224"): items with equal values share the place of the
 * first of them, and the next distinct value skips the places taken by the tie
 * (1, 1, 1, 4). Pure – safe for server and client.
 *
 * `items` must already be ordered best-first. Values are compared with Number(),
 * since DECIMAL columns may come back as strings.
 */
export function competitionRanks<T>(
  items: readonly T[],
  getValue: (item: T) => unknown | readonly unknown[],
): number[] {
  // A key may be a tuple (primary, secondary, ...): items tie only when every part is equal.
  const keyOf = (item: T): number[] => {
    const k = getValue(item);
    return (Array.isArray(k) ? k : [k]).map(x => Number(x ?? 0));
  };
  const ranks: number[] = [];
  let prev: number[] | null = null;
  items.forEach((item, i) => {
    const key = keyOf(item);
    const tied = prev !== null && key.length === prev.length && key.every((v, j) => v === prev![j]);
    ranks.push(tied ? ranks[i - 1] : i + 1);
    prev = key;
  });
  return ranks;
}

/** Place of a value in a list: 1 + the number of items strictly better (higher). */
export function rankOfValue(values: readonly unknown[], value: unknown): number {
  const v = Number(value ?? 0);
  return 1 + values.filter(x => Number(x ?? 0) > v).length;
}
