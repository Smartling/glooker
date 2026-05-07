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
      if (all.length === 0) return schema.default as T;
      return new Set(all) as T;
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
      const params = new URLSearchParams(searchParams.toString());
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

export function useUrlBatch(): (fn: () => void) => void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (fn: () => void) => {
      if (batchPending) {
        // Already batching (nested) — run inline; the outer call flushes.
        fn();
        return;
      }
      batchPending = {
        params: new URLSearchParams(searchParams.toString()),
        pathname,
        usePush: false,
      };
      try {
        fn();
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
