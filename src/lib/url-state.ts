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
