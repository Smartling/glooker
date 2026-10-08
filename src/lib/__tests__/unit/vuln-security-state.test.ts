// src/lib/__tests__/unit/vuln-security-state.test.ts
import { readValue } from '@/lib/url-state';
import {
  VIEW_SCHEMA, OWN_SCHEMA, CODEBASE_SCHEMA, TEAM_SCHEMA, REPO_SCHEMA, SEVERITY_SCHEMA, BASELINE_SCHEMA, RANGE_SCHEMA,
  kSev, codebaseOptionCount, scopeOpenCount, trendSince, sparklineSince, sanitiseBaseline, keepTopDelta,
  DEFAULT_ALERT_LIST, sanitiseAlertList, alertsQueryString, ALERT_SORT_KEYS, ALERT_SORT_FIRST_DIR, type AlertListState,
} from '@/app/vulnerabilities/security-state';
import { ALERT_SORT_KEYS as SERVER_SORT_KEYS, parseAlertSort } from '@/lib/vulnerabilities/alert-sort';
import { repoRow, cell } from '../support/security-fixtures';

const SCHEMAS = [VIEW_SCHEMA, OWN_SCHEMA, CODEBASE_SCHEMA, TEAM_SCHEMA, REPO_SCHEMA, SEVERITY_SCHEMA, BASELINE_SCHEMA, RANGE_SCHEMA];

describe('URL schemas (spec section 5)', () => {
  it.each([
    ['view', VIEW_SCHEMA, 'overview', 'push'],
    ['own', OWN_SCHEMA, 'teams', 'push'],
    ['codebase', CODEBASE_SCHEMA, 'backend', 'replace'],
    ['team', TEAM_SCHEMA, null, 'replace'],
    ['repo', REPO_SCHEMA, null, 'replace'],
    ['severity', SEVERITY_SCHEMA, 'both', 'replace'],
    ['baseline', BASELINE_SCHEMA, 'last', 'replace'],
    ['range', RANGE_SCHEMA, 'all', 'replace'],
  ] as const)('%s: default %s, history %s', (key, schema, def, history) => {
    expect(schema.key).toBe(key);
    expect(schema.default).toBe(def);
    expect(schema.history).toBe(history);
  });

  it('every key is declared scroll:false', () => {
    for (const s of SCHEMAS) expect(s.scroll).toBe(false);
  });

  it('no schema reads the retired `sev` key, and an old ?sev=high link reads as the default severity', () => {
    expect(SCHEMAS.map(s => s.key)).not.toContain('sev');
    expect(readValue(new URLSearchParams('sev=high'), SEVERITY_SCHEMA)).toBe('both');
    expect(kSev(readValue(new URLSearchParams('sev=high'), SEVERITY_SCHEMA))).toBe('critical');
  });

  it('enum keys fall back to their default for a hand-edited value', () => {
    expect(readValue(new URLSearchParams('view=bogus'), VIEW_SCHEMA)).toBe('overview');
    expect(readValue(new URLSearchParams('own=bogus'), OWN_SCHEMA)).toBe('teams');
    expect(readValue(new URLSearchParams('codebase=bogus'), CODEBASE_SCHEMA)).toBe('backend');
    expect(readValue(new URLSearchParams('severity=bogus'), SEVERITY_SCHEMA)).toBe('both');
    expect(readValue(new URLSearchParams('range=bogus'), RANGE_SCHEMA)).toBe('all');
  });
});

describe('kSev', () => {
  it('is critical unless Severity is "High only"', () => {
    expect(kSev('both')).toBe('critical');
    expect(kSev('critical')).toBe('critical');
    expect(kSev('high')).toBe('high');
  });
});

describe('sanitiseBaseline', () => {
  it.each(['last', '7d', '30d', '2026-09-15'])('keeps %s', v => expect(sanitiseBaseline(v)).toBe(v));
  it.each(['garbage', '', '2026-02-30', '2026-9-1', '14d', '2026-09-15T00:00:00Z'])('maps %j to last', v => expect(sanitiseBaseline(v)).toBe('last'));
});

describe('trendSince and sparklineSince (UTC day arithmetic)', () => {
  const now = new Date('2026-09-23T12:34:56Z');
  it('trendSince: all is null; 30d/90d/1y are today minus 30/90/365 days', () => {
    expect(trendSince('all', now)).toBeNull();
    expect(trendSince('30d', now)).toBe('2026-08-24');
    expect(trendSince('90d', now)).toBe('2026-06-25');
    expect(trendSince('1y', now)).toBe('2025-09-23');
  });
  it('sparklineSince is always today minus 90 days', () => {
    expect(sparklineSince(now)).toBe('2026-06-25');
  });
});

describe('codebaseOptionCount is the kSev count (the number shown on each Codebase option, next to the KPI tile it matches)', () => {
  const counts = {
    backend: { critical: 5, high: 3 }, frontend: { critical: 2, high: 0 }, shared: { critical: 0, high: 0 },
    other: { critical: 1, high: 1 }, all: { critical: 8, high: 4 },
  };
  it('both and critical-only read the critical count; high-only reads the high count', () => {
    expect(codebaseOptionCount(counts, 'backend', 'both')).toBe(5);
    expect(codebaseOptionCount(counts, 'backend', 'critical')).toBe(5);
    expect(codebaseOptionCount(counts, 'backend', 'high')).toBe(3);
    expect(codebaseOptionCount(counts, 'all', 'both')).toBe(8);
    expect(codebaseOptionCount(counts, 'all', 'high')).toBe(4);
  });
  it('is null while the counts have not loaded', () => {
    expect(codebaseOptionCount(undefined, 'backend', 'both')).toBeNull();
  });
});

describe('scopeOpenCount (the Alerts tab count)', () => {
  const rows = [
    repoRow('acme/checkout-api', 'Payments', { critical: cell({ open: 3 }), high: cell({ open: 1 }) }),
    repoRow('acme/ledger', 'Payments', { critical: cell({ open: 2 }), high: cell({ open: 0 }) }),
    // Unmeasured: its stored count still appears in the alert list, so it must count here too.
    repoRow('acme/legacy-batch', 'Platform', { critical: cell({ open: 4 }), high: cell({ open: 2 }), unmeasured: { status: 'error', detail: 'x' } }),
  ];
  it('sums open counts under Severity, including an unmeasured row\'s stored count', () => {
    expect(scopeOpenCount(rows, 'both', null)).toBe(12);
    expect(scopeOpenCount(rows, 'critical', null)).toBe(9);
    expect(scopeOpenCount(rows, 'high', null)).toBe(3);
  });
  it('narrows to the selected repository', () => {
    expect(scopeOpenCount(rows, 'both', 'acme/checkout-api')).toBe(4);
    expect(scopeOpenCount(rows, 'critical', 'acme/legacy-batch')).toBe(4);
  });
});

describe('sort keys and first directions (Wave 1 owns the keys; the page owns where each header starts)', () => {
  it('ALERT_SORT_KEYS is the very array the server validates against, not a copy', () => {
    expect(ALERT_SORT_KEYS).toBe(SERVER_SORT_KEYS);
  });
  it('every key has a first direction; Age starts descending (oldest first) and the rest ascending', () => {
    expect(Object.keys(ALERT_SORT_FIRST_DIR).sort()).toEqual([...ALERT_SORT_KEYS].sort());
    expect(ALERT_SORT_FIRST_DIR).toEqual({ severity: 'asc', advisory: 'asc', repo: 'asc', age: 'desc', due: 'asc', state: 'asc' });
  });
  it('the sort value alertsQueryString puts on the wire is one the server parser accepts, for every key and direction', () => {
    const base = { codebase: 'backend' as const, team: null, repo: null, severity: 'both' as const, anySlaActive: true };
    for (const key of ALERT_SORT_KEYS) {
      for (const dir of ['asc', 'desc'] as const) {
        const wire = new URLSearchParams(alertsQueryString({ ...base, list: { ...DEFAULT_ALERT_LIST, sort: { key, dir } } })).get('sort');
        expect(parseAlertSort(wire as string)).toEqual({ key, dir });
      }
    }
  });
  it('no sort in the list state sends no sort parameter (the server default order)', () => {
    const base = { codebase: 'backend' as const, team: null, repo: null, severity: 'both' as const, anySlaActive: true };
    expect(new URLSearchParams(alertsQueryString({ ...base, list: DEFAULT_ALERT_LIST })).has('sort')).toBe(false);
  });
});

describe('keepTopDelta (scroll up only)', () => {
  it('scrolls up just enough that the content starts at the bar bottom', () => {
    expect(keepTopDelta(20, 84)).toBe(-64);
  });
  it('never scrolls down: content already below the bar gives 0', () => {
    expect(keepTopDelta(84, 84)).toBe(0);
    expect(keepTopDelta(300, 84)).toBe(0);
  });
});

describe('sanitiseAlertList', () => {
  const on: AlertListState = { ...DEFAULT_ALERT_LIST, overdue: true, dueSoon: true };
  it('keeps only Overdue when both time toggles are set (they are mutually exclusive)', () => {
    const out = sanitiseAlertList(on, { anySlaActive: true });
    expect(out.overdue).toBe(true);
    expect(out.dueSoon).toBe(false);
  });
  it('Resolved status clears both time toggles', () => {
    const out = sanitiseAlertList({ ...on, status: 'resolved' }, { anySlaActive: true });
    expect([out.overdue, out.dueSoon]).toEqual([false, false]);
  });
  it('Open + resolved keeps the toggles', () => {
    expect(sanitiseAlertList({ ...on, status: 'all' }, { anySlaActive: true }).overdue).toBe(true);
  });
  it('clears both toggles when no SLA is active', () => {
    const out = sanitiseAlertList(on, { anySlaActive: false });
    expect([out.overdue, out.dueSoon]).toEqual([false, false]);
  });
  it('clamps the page to a positive integer', () => {
    expect(sanitiseAlertList({ ...DEFAULT_ALERT_LIST, page: 0 }, { anySlaActive: true }).page).toBe(1);
    expect(sanitiseAlertList({ ...DEFAULT_ALERT_LIST, page: 2.7 }, { anySlaActive: true }).page).toBe(2);
  });
});

describe('alertsQueryString', () => {
  const base = { codebase: 'backend' as const, team: null, repo: null, severity: 'both' as const, list: DEFAULT_ALERT_LIST, anySlaActive: true };
  it('default scope: no severity, no team, first page of 10', () => {
    expect(alertsQueryString(base)).toBe('codebase=backend&state=open&limit=10&offset=0');
  });
  it('omits severity for "both" and never sends the text "both"', () => {
    expect(alertsQueryString(base)).not.toContain('severity');
    expect(alertsQueryString(base)).not.toContain('both');
  });
  it('sends a single severity as is', () => {
    expect(new URLSearchParams(alertsQueryString({ ...base, severity: 'high' })).get('severity')).toBe('high');
  });
  it('offset is (page - 1) x 10', () => {
    const p = new URLSearchParams(alertsQueryString({ ...base, list: { ...DEFAULT_ALERT_LIST, page: 3 } }));
    expect(p.get('limit')).toBe('10');
    expect(p.get('offset')).toBe('20');
  });
  it('maps every list filter to the API parameter names', () => {
    const p = new URLSearchParams(alertsQueryString({
      ...base, codebase: 'frontend', team: 'Search & Co', repo: 'acme/search-index', severity: 'critical',
      list: { ...DEFAULT_ALERT_LIST, status: 'all', overdue: true, reopened: true, runtimeOnly: true, q: 'lodash', sort: { key: 'due', dir: 'desc' } },
    }));
    expect(Object.fromEntries(p.entries())).toEqual({
      codebase: 'frontend', team: 'Search & Co', repo: 'acme/search-index', severity: 'critical', state: 'all',
      overdue: 'true', reopened: 'true', dependency_scope: 'runtime', q: 'lodash', limit: '10', offset: '0', sort: 'due:desc',
    });
  });
  it('uses due_soon for the Due ≤ 7d toggle', () => {
    const p = new URLSearchParams(alertsQueryString({ ...base, list: { ...DEFAULT_ALERT_LIST, dueSoon: true } }));
    expect(p.get('due_soon')).toBe('true');
    expect(p.has('overdue')).toBe(false);
  });
  it('sanitises at build time: both toggles never reach the request, Resolved and no-SLA drop them', () => {
    const both = { ...DEFAULT_ALERT_LIST, overdue: true, dueSoon: true };
    const p1 = new URLSearchParams(alertsQueryString({ ...base, list: both }));
    expect([p1.get('overdue'), p1.has('due_soon')]).toEqual(['true', false]);
    const p2 = new URLSearchParams(alertsQueryString({ ...base, list: { ...both, status: 'resolved' } }));
    expect([p2.has('overdue'), p2.has('due_soon')]).toEqual([false, false]);
    const p3 = new URLSearchParams(alertsQueryString({ ...base, anySlaActive: false, list: both }));
    expect([p3.has('overdue'), p3.has('due_soon')]).toEqual([false, false]);
  });
});
