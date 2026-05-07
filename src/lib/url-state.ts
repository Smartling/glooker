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
