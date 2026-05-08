'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

type BatchPending = {
  params: URLSearchParams;
  pathname: string;
  usePush: boolean;
};
// Module-level singleton. Safe because batch() and setters are only ever called
// from event handlers / effects, never during render. JS single-threaded
// semantics + the synchronous nature of the batch callback guarantee no two
// batches can be in-flight at the same time.
let batchPending: BatchPending | null = null;

// Same-tick coalescing overlay: when consecutive setters fire in the same
// React event without an explicit useUrlBatch, each setter reads the same
// stale `searchParams` from its closure and would otherwise overwrite the
// prior setter's write. The overlay carries forward each setter's params
// so the next setter's router call includes all prior writes from this tick.
// Cleared on the next microtask, by which time React has re-rendered
// (or will shortly) with fresh `searchParams`.
type AppliedOverlay = { params: URLSearchParams; baseSearch: string };
let appliedOverlay: AppliedOverlay | null = null;

// Hoisted singleton for the empty-set common case (referential stability for
// downstream useMemo/useEffect/React.memo consumers across URL navs).
const EMPTY_STRING_SET: ReadonlySet<string> = new Set<string>();

// Module-level identity cache for populated string-sets, keyed by
// "<schema.key> <sorted-values-joined>". Prevents fresh-Set identity
// rotation when the URL changes for an unrelated key.
const stringSetCache = new Map<string, Set<string>>();

export type UrlSchema<T> =
  | {
      key: string;
      type: 'enum';
      values: readonly T[];
      default: T;
      history: 'push' | 'replace';
    }
  | {
      key: string;
      type: 'string';
      default: T extends string | null ? T : never;
      history: 'push' | 'replace';
    }
  | {
      /**
       * Note: the Set returned by `useUrlState`/`readValue` for `string-set`
       * schemas should be treated as read-only. The reader caches Set
       * instances by sorted contents for referential stability across URL
       * navs — mutating it directly would corrupt the cache. Always pass a
       * fresh `new Set(...)` to the setter.
       */
      key: string;
      type: 'string-set';
      default: Set<string>;
      history: 'push' | 'replace';
    };

export function readValue<T>(params: URLSearchParams, schema: UrlSchema<T>): T {
  switch (schema.type) {
    case 'enum': {
      const v = params.get(schema.key);
      if (v != null && (schema.values as readonly unknown[]).includes(v)) {
        return v as T;
      }
      return schema.default;
    }
    case 'string': {
      const v = params.get(schema.key);
      if (v != null && v !== '') return v as T;
      return schema.default as T;
    }
    case 'string-set': {
      const all = params.getAll(schema.key);
      if (all.length === 0) return EMPTY_STRING_SET as unknown as T;
      const sorted = [...all].sort();
      // Use \0 as separator so commas in values don't collide
      const cacheKey = `${schema.key}\0${sorted.join('\0')}`;
      const cached = stringSetCache.get(cacheKey);
      if (cached) return cached as unknown as T;
      const fresh = new Set(all);
      stringSetCache.set(cacheKey, fresh);
      // Trim cache if it grows large (defensive — common usage stays small)
      if (stringSetCache.size > 64) {
        const firstKey = stringSetCache.keys().next().value;
        if (firstKey) stringSetCache.delete(firstKey);
      }
      return fresh as unknown as T;
    }
  }
}

export function writeValueIntoParams<T>(
  params: URLSearchParams,
  value: T,
  schema: UrlSchema<T>,
): void {
  switch (schema.type) {
    case 'enum': {
      if (value === schema.default) {
        params.delete(schema.key);
      } else {
        params.set(schema.key, String(value));
      }
      return;
    }
    case 'string': {
      const isDefault = value === schema.default;
      const isEmptyish = value == null || value === '';
      if (isDefault || isEmptyish) {
        params.delete(schema.key);
      } else {
        params.set(schema.key, String(value));
      }
      return;
    }
    case 'string-set': {
      params.delete(schema.key);
      const set = value as Set<string>;
      if (set.size === 0) return;
      for (const v of set) params.append(schema.key, v);
      return;
    }
  }
}

export function useUrlState<T>(schema: UrlSchema<T>): [T, (next: T) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = useMemo(
    () => readValue(searchParams, schema),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- schema fields are stable per call site
    [searchParams, schema.key, schema.type],
  );

  const setter = useCallback(
    (next: T) => {
      if (batchPending) {
        writeValueIntoParams(batchPending.params, next, schema);
        if (schema.history === 'push') batchPending.usePush = true;
        return;
      }
      const baseSearch = searchParams.toString();
      let params: URLSearchParams;
      if (appliedOverlay && appliedOverlay.baseSearch === baseSearch) {
        // Same-tick prior write — extend it.
        params = appliedOverlay.params;
      } else {
        // Fresh tick (or first call) — start a new overlay rooted in this snapshot.
        params = new URLSearchParams(baseSearch);
        appliedOverlay = { params, baseSearch };
        // Clear the overlay at end of microtask; by then React has scheduled
        // a re-render with fresh searchParams (or will).
        queueMicrotask(() => {
          if (appliedOverlay && appliedOverlay.baseSearch === baseSearch) {
            appliedOverlay = null;
          }
        });
      }
      writeValueIntoParams(params, next, schema);
      const queryStr = params.toString();
      const newUrl = queryStr ? `${pathname}?${queryStr}` : pathname;
      if (schema.history === 'push') {
        router.push(newUrl);
      } else {
        router.replace(newUrl);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- schema fields are stable per call site
    [router, pathname, searchParams, schema.key, schema.type, schema.history],
  );

  return [value, setter];
}

/**
 * Atomic multi-key URL writes. Setters called inside `fn` accumulate into
 * one URLSearchParams and flush as a single router.push/replace.
 *
 * @param fn MUST be synchronous. Calling an async function (one that returns
 *   a Promise) will throw — the synchronous-callback invariant is required
 *   because the module-level singleton is cleared in `finally`, and any
 *   awaited setter calls would silently fall through to non-batched writes
 *   against stale params. Use sequential explicit `batch` calls instead.
 *
 * Push wins: if any setter inside the batch has `history: 'push'`, the
 * combined flush uses `router.push`; otherwise `router.replace`.
 *
 * Nested calls: an inner `batch(fn)` runs `fn` inline and inherits the
 * outer accumulator (no separate flush).
 */
export function useUrlBatch(): (fn: () => void) => void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (fn: () => void) => {
      if (batchPending) {
        // Already batching (nested) — run inline; the outer call flushes.
        const result = fn() as unknown;
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          throw new TypeError('useUrlBatch: callback must be synchronous (got a Promise)');
        }
        return;
      }
      batchPending = {
        params: new URLSearchParams(searchParams.toString()),
        pathname,
        usePush: false,
      };
      try {
        const result = fn() as unknown;
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          throw new TypeError('useUrlBatch: callback must be synchronous (got a Promise)');
        }
        const queryStr = batchPending.params.toString();
        const newUrl = queryStr ? `${pathname}?${queryStr}` : pathname;
        const usePush = batchPending.usePush;
        if (usePush) router.push(newUrl);
        else router.replace(newUrl);
      } finally {
        batchPending = null;
      }
    },
    [router, pathname, searchParams],
  );
}
