import type { PageExtract } from './page-extract';

/**
 * Hands a page extract from the `providePage` request to the suspended tool body.
 *
 * Keyed by Mastra's runId, which IS present in a tool's execute context (verified);
 * `resumeData` is NOT, which is why the handoff goes through here. Uses globalThis
 * for the same reason the progress and stop-signal stores do — it survives Next's
 * HMR module reloads in dev.
 *
 * Known limitation: per-process. The providePage request must reach the same replica
 * that suspended the run. Dev runs a single task, so this holds today; the durable
 * fix is persisting alongside the run snapshot.
 */
const KEY = '__glookerPageExtracts__';
type Store = Map<string, { extract: PageExtract; at: number }>;

const store: Store = ((globalThis as any)[KEY] ??= new Map());

/** Entries older than this are swept so an abandoned run cannot leak memory. */
const TTL_MS = 5 * 60 * 1000;

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of store) if (v.at < cutoff) store.delete(k);
}

export function putPageExtract(runId: string, extract: PageExtract): void {
  sweep();
  store.set(runId, { extract, at: Date.now() });
}

/** Single-use: reading removes it, so a stale extract cannot serve a later run. */
export function takePageExtract(runId: string): PageExtract | undefined {
  const hit = store.get(runId);
  if (!hit) return undefined;
  store.delete(runId);
  return hit.extract;
}

/** Test helper. */
export function _resetPageStore(): void {
  store.clear();
}
