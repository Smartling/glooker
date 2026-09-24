import { parseVulnConfig, getVulnConfig, __clearVulnConfigCache, DEFAULT_CODEBASE_GROUPS } from '@/lib/vulnerabilities/config';

const SLA = 'VULNERABILITIES_SLA_POLICY';
const e = (entries: unknown) => ({ [SLA]: JSON.stringify(entries) });
const ok = { id: 'critical-2099-01', severity: 'critical', effectiveFrom: '2099-01-07', days: 7 };
const rules = (env: Record<string, string>) => parseVulnConfig(env).errors.map(x => x.rule);

describe('defaults', () => {
  it('everything unset gives the neutral defaults and no errors', () => {
    const c = parseVulnConfig({});
    expect(c).toMatchObject({
      slaPolicy: [], slaPolicyInvalid: false, resolvedSince: null, resolvedSinceInvalid: false,
      keys: { team: 'team', tier: 'service_tier', codebase: 'codebase_type' }, tierInScope: 'production',
      codebaseGroups: DEFAULT_CODEBASE_GROUPS, errors: [],
    });
  });
});

describe('VULNERABILITIES_SLA_POLICY', () => {
  it('parses a valid policy', () => {
    const c = parseVulnConfig(e([ok, { id: 'high-2099-02', severity: 'high', effectiveFrom: '2099-02-04', days: 9 }]));
    expect(c.slaPolicy).toEqual([ok, { id: 'high-2099-02', severity: 'high', effectiveFrom: '2099-02-04', days: 9 }]);
    expect(c.slaPolicyInvalid).toBe(false);
  });
  it('invalid JSON → exact message, no policy applied', () => {
    const c = parseVulnConfig({ [SLA]: '[{"id": oops' });
    expect(c.errors).toEqual([{ source: 'startup', variable: SLA, rule: 'Invalid JSON in VULNERABILITIES_SLA_POLICY env var' }]);
    expect(c.slaPolicy).toEqual([]);
    expect(c.slaPolicyInvalid).toBe(true);
  });
  // Each case below produces exactly one violation for this entry — asserted with toEqual([rule]),
  // not toContain, so a second, unintended violation on the same entry would fail the test.
  it.each([
    [{ ...ok, days: 0 }, 'VULNERABILITIES_SLA_POLICY: entry 1: days must be > 0'],
    [{ ...ok, days: 2.5 }, 'VULNERABILITIES_SLA_POLICY: entry 1: days must be a positive integer'],
    [{ ...ok, severity: 'medium' }, 'VULNERABILITIES_SLA_POLICY: entry 1: severity must be critical or high'],
    [{ ...ok, effectiveFrom: '2099-02-30' }, 'VULNERABILITIES_SLA_POLICY: entry 1: effectiveFrom must be a valid YYYY-MM-DD date'],
    [{ ...ok, id: 'crit-1' }, 'VULNERABILITIES_SLA_POLICY: entry 1: id must match <severity>-<YYYY-MM>'],
    [{ ...ok, id: 'high-2099-01' }, 'VULNERABILITIES_SLA_POLICY: entry 1: id must start with its severity'],
  ])('rule violation %#', (entry, rule) => {
    expect(rules(e([entry]))).toEqual([rule]);
  });
  it('not an array', () => {
    expect(rules({ [SLA]: '{}' })).toEqual(['VULNERABILITIES_SLA_POLICY: must be a JSON array of entries']);
  });
  it('duplicate id names both indices', () => {
    expect(rules(e([ok, { ...ok, effectiveFrom: '2099-03-04' }]))).toContain('VULNERABILITIES_SLA_POLICY: entries 1 and 2: duplicate id');
  });
  it('effectiveFrom must strictly increase per severity in array order', () => {
    const later = { id: 'critical-2099-03', severity: 'critical', effectiveFrom: '2099-03-04', days: 7 };
    expect(rules(e([later, ok]))).toContain('VULNERABILITIES_SLA_POLICY: entry 2: effectiveFrom must be later than the previous critical entry');
  });
  it('any rule violation → no SLA applied', () => {
    const c = parseVulnConfig(e([{ ...ok, days: 0 }]));
    expect(c.slaPolicy).toEqual([]);
    expect(c.slaPolicyInvalid).toBe(true);
  });
});

describe('VULN_RESOLVED_SINCE', () => {
  it('valid date is used', () => { expect(parseVulnConfig({ VULN_RESOLVED_SINCE: '2099-01-01' }).resolvedSince).toBe('2099-01-01'); });
  it('invalid → null + invalid flag + error', () => {
    const c = parseVulnConfig({ VULN_RESOLVED_SINCE: '2099-13-01' });
    expect(c).toMatchObject({ resolvedSince: null, resolvedSinceInvalid: true });
    expect(c.errors.map(x => x.rule)).toEqual(['VULN_RESOLVED_SINCE: must be a valid YYYY-MM-DD date']);
  });
});

describe('taxonomy', () => {
  it('keys and in-scope value are read and trimmed', () => {
    const c = parseVulnConfig({ VULN_TEAM_PROPERTY: ' owner ', VULN_TIER_PROPERTY: 'tier', VULN_TIER_IN_SCOPE: 'live', VULN_CODEBASE_PROPERTY: 'kind' });
    expect(c.keys).toEqual({ team: 'owner', tier: 'tier', codebase: 'kind' });
    expect(c.tierInScope).toBe('live');
  });
  it('an invalid property name is rejected, default kept', () => {
    const c = parseVulnConfig({ VULN_TIER_PROPERTY: 'has space' });
    expect(c.keys.tier).toBe('service_tier');
    expect(c.errors.map(x => x.rule)).toEqual(['VULN_TIER_PROPERTY: not a valid custom property name']);
  });
  it('groups: valid multi-value mapping', () => {
    const c = parseVulnConfig({ VULN_CODEBASE_GROUPS: '{"backend":["service","api"],"frontend":["web"],"shared":["library"]}' });
    expect(c.codebaseGroups).toEqual({ backend: ['service', 'api'], frontend: ['web'], shared: ['library'] });
  });
  it.each([
    ['{"backend":["x"],"middleware":["y"]}', 'VULN_CODEBASE_GROUPS: unknown group (allowed: backend, frontend, shared)'],
    ['{"backend":["x"],"frontend":["x"]}', 'VULN_CODEBASE_GROUPS: a value appears under more than one group'],
    ['{"backend":"x"}', 'VULN_CODEBASE_GROUPS: each group must be a list of non-empty strings'],
    ['[1]', 'VULN_CODEBASE_GROUPS: must be a JSON object'],
    ['{oops', 'Invalid JSON in VULN_CODEBASE_GROUPS env var'],
  ])('invalid groups %# → default mapping + error', (raw, rule) => {
    const c = parseVulnConfig({ VULN_CODEBASE_GROUPS: raw });
    expect(c.codebaseGroups).toEqual(DEFAULT_CODEBASE_GROUPS);
    expect(c.errors.map(x => x.rule)).toContain(rule);
  });
  it('a group omitted from the object maps to no values', () => {
    expect(parseVulnConfig({ VULN_CODEBASE_GROUPS: '{"backend":["x"]}' }).codebaseGroups).toEqual({ backend: ['x'], frontend: [], shared: [] });
  });
  it('a group value is trimmed before it is stored', () => {
    const c = parseVulnConfig({ VULN_CODEBASE_GROUPS: '{"backend":[" api "]}' });
    expect(c.codebaseGroups.backend).toEqual(['api']);
  });
  it('a value repeated within one group is accepted and de-duplicated (the rule is only "no value under more than one group")', () => {
    const c = parseVulnConfig({ VULN_CODEBASE_GROUPS: '{"backend":["api","api"]}' });
    expect(c.codebaseGroups).toEqual({ backend: ['api'], frontend: [], shared: [] });
    expect(c.errors).toEqual([]);
  });
  it('values that only differ by whitespace are the same value for the cross-group check', () => {
    const c = parseVulnConfig({ VULN_CODEBASE_GROUPS: '{"backend":["api"],"frontend":[" api"]}' });
    expect(c.errors.map(x => x.rule)).toContain('VULN_CODEBASE_GROUPS: a value appears under more than one group');
  });
});

describe('codebaseGroups defaults are not shared by reference', () => {
  it('mutating a parsed default group does not change DEFAULT_CODEBASE_GROUPS', () => {
    const c = parseVulnConfig({});
    c.codebaseGroups.backend.push('mutated');
    expect(DEFAULT_CODEBASE_GROUPS.backend).toEqual(['backend']);
  });
});

describe('unrecognised variables', () => {
  it('a misspelled VULN_/VULNERABILITIES_ name is reported by name', () => {
    expect(rules({ VULN_SLA_POLICY: '[]' })).toEqual(['VULN_SLA_POLICY: unrecognised variable (a misspelled name is ignored)']);
  });
});

describe('no value is ever echoed', () => {
  it('no message contains any configured value', () => {
    const secretDate = '2099-12-15', secretKey = 'quuxProperty', secretId = 'critical-2099-12';
    const env = {
      [SLA]: JSON.stringify([{ id: secretId, severity: 'critical', effectiveFrom: secretDate, days: 0 }, { id: secretId, severity: 'critical', effectiveFrom: secretDate, days: 7 }]),
      VULN_TIER_PROPERTY: `${secretKey} bad`, VULN_RESOLVED_SINCE: `${secretDate}x`,
      VULN_CODEBASE_GROUPS: `{"backend":["${secretKey}"],"frontend":["${secretKey}"]}`,
    };
    const all = JSON.stringify(parseVulnConfig(env).errors);
    for (const v of [secretDate, secretKey, secretId]) expect(all).not.toContain(v);
    const bad = parseVulnConfig({ [SLA]: `[{"id":"${secretId}" oops` }).errors;
    expect(JSON.stringify(bad)).not.toContain(secretId);
  });
});

describe('memo', () => {
  const prior = process.env[SLA];
  afterEach(() => { if (prior === undefined) delete process.env[SLA]; else process.env[SLA] = prior; __clearVulnConfigCache(); });
  it('getVulnConfig is memoized until __clearVulnConfigCache', () => {
    process.env[SLA] = JSON.stringify([ok]);
    __clearVulnConfigCache();
    expect(getVulnConfig().slaPolicy).toHaveLength(1);
    process.env[SLA] = '[]';
    expect(getVulnConfig().slaPolicy).toHaveLength(1);
    __clearVulnConfigCache();
    expect(getVulnConfig().slaPolicy).toHaveLength(0);
  });
});
