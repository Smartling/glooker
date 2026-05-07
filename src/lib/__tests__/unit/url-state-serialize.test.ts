import { readValue, writeValueIntoParams, type UrlSchema } from '@/lib/url-state';

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

describe('writeValueIntoParams', () => {
  it('enum: deletes key when value equals default', () => {
    const params = new URLSearchParams('tab=b&other=keep');
    writeValueIntoParams(params, 'a', {
      key: 'tab', type: 'enum', values: ['a', 'b'] as const,
      default: 'a', history: 'push',
    });
    expect(params.toString()).toBe('other=keep');
  });

  it('enum: sets key when value is non-default', () => {
    const params = new URLSearchParams('other=keep');
    writeValueIntoParams(params, 'b', {
      key: 'tab', type: 'enum', values: ['a', 'b'] as const,
      default: 'a', history: 'push',
    });
    expect(params.get('tab')).toBe('b');
    expect(params.get('other')).toBe('keep');
  });

  it('string: deletes key when value equals default', () => {
    const params = new URLSearchParams('q=hi&other=keep');
    writeValueIntoParams(params, '', {
      key: 'q', type: 'string', default: '', history: 'replace',
    });
    expect(params.has('q')).toBe(false);
    expect(params.get('other')).toBe('keep');
  });

  it('string: sets key when value is non-default', () => {
    const params = new URLSearchParams();
    writeValueIntoParams(params, 'hello', {
      key: 'q', type: 'string', default: '', history: 'replace',
    });
    expect(params.get('q')).toBe('hello');
  });

  it('string with null default: deletes when value is null', () => {
    const params = new URLSearchParams('team=Platform');
    writeValueIntoParams(params, null, {
      key: 'team', type: 'string', default: null, history: 'replace',
    });
    expect(params.has('team')).toBe(false);
  });

  it('string with null default: deletes when value is empty string', () => {
    const params = new URLSearchParams('team=Platform');
    writeValueIntoParams(params, '', {
      key: 'team', type: 'string', default: null, history: 'replace',
    });
    expect(params.has('team')).toBe(false);
  });

  it('string-set: deletes key when set is empty', () => {
    const params = new URLSearchParams('dev=alice&other=keep');
    writeValueIntoParams(params, new Set<string>(), {
      key: 'dev', type: 'string-set', default: new Set(), history: 'replace',
    });
    expect(params.has('dev')).toBe(false);
    expect(params.get('other')).toBe('keep');
  });

  it('string-set: writes one entry per element via append', () => {
    const params = new URLSearchParams();
    writeValueIntoParams(params, new Set(['alice', 'bob']), {
      key: 'dev', type: 'string-set', default: new Set(), history: 'replace',
    });
    expect(params.getAll('dev').sort()).toEqual(['alice', 'bob']);
  });

  it('string-set: replaces previous entries when called twice', () => {
    const params = new URLSearchParams('dev=alice&dev=bob');
    writeValueIntoParams(params, new Set(['carol']), {
      key: 'dev', type: 'string-set', default: new Set(), history: 'replace',
    });
    expect(params.getAll('dev')).toEqual(['carol']);
  });

  it('preserves unrelated keys across all variants', () => {
    const params = new URLSearchParams('keep=yes&dev=alice');
    writeValueIntoParams(params, new Set(), {
      key: 'dev', type: 'string-set', default: new Set(), history: 'replace',
    });
    expect(params.get('keep')).toBe('yes');
  });
});
