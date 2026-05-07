import { readValue, type UrlSchema } from '@/lib/url-state';

describe('readValue', () => {
  describe('enum', () => {
    const schema: UrlSchema<'a' | 'b'> = {
      key: 'tab', type: 'enum', values: ['a', 'b'] as const,
      default: 'a', history: 'push',
    };

    it('returns the URL value when valid', () => {
      expect(readValue(new URLSearchParams('tab=b'), schema)).toBe('b');
    });
    it('returns the default when key is absent', () => {
      expect(readValue(new URLSearchParams(''), schema)).toBe('a');
    });
    it('returns the default when value is not in the allowed list', () => {
      expect(readValue(new URLSearchParams('tab=foo'), schema)).toBe('a');
    });
  });

  describe('string', () => {
    const schema: UrlSchema<string> = {
      key: 'q', type: 'string', default: '', history: 'replace',
    };

    it('returns the URL value', () => {
      expect(readValue(new URLSearchParams('q=hello'), schema)).toBe('hello');
    });
    it('returns the default when key is absent', () => {
      expect(readValue(new URLSearchParams(''), schema)).toBe('');
    });
    it('treats empty string as default', () => {
      expect(readValue(new URLSearchParams('q='), schema)).toBe('');
    });
  });

  describe('string with null default (selectedTeamName-style)', () => {
    const schema: UrlSchema<string | null> = {
      key: 'team', type: 'string', default: null, history: 'replace',
    };

    it('returns the URL value', () => {
      expect(readValue(new URLSearchParams('team=Platform'), schema)).toBe('Platform');
    });
    it('returns null when absent', () => {
      expect(readValue(new URLSearchParams(''), schema)).toBeNull();
    });
  });

  describe('string-set', () => {
    const schema: UrlSchema<Set<string>> = {
      key: 'dev', type: 'string-set', default: new Set(), history: 'replace',
    };

    it('reads repeated keys into a Set', () => {
      const result = readValue(new URLSearchParams('dev=alice&dev=bob'), schema);
      expect(result).toEqual(new Set(['alice', 'bob']));
    });
    it('returns empty set when absent', () => {
      const result = readValue(new URLSearchParams(''), schema);
      expect(result.size).toBe(0);
    });
  });
});
