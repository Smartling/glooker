import { routePattern, buildFromRoute } from '@/lib/chat/context/registry';

describe('routePattern', () => {
  it('returns / for the root path', () => {
    expect(routePattern('/', {})).toBe('/');
  });

  it('substitutes dynamic segments back into their pattern form', () => {
    expect(routePattern('/report/abc123/org', { id: 'abc123' })).toBe('/report/[id]/org');
    expect(routePattern('/report/abc123/dev/junky', { id: 'abc123', login: 'junky' }))
      .toBe('/report/[id]/dev/[login]');
  });

  it('only substitutes exact whole segments', () => {
    // 'org' is a param value here; the literal '/org' segment must survive.
    expect(routePattern('/report/org/org', { id: 'org' })).toBe('/report/[id]/[id]');
  });

  it('leaves static paths untouched', () => {
    expect(routePattern('/settings', {})).toBe('/settings');
  });
});

describe('buildFromRoute', () => {
  it('builds a descriptor for the org report', () => {
    const ctx = buildFromRoute('/report/abc123/org', { id: 'abc123' }, new URLSearchParams());
    expect(ctx).toEqual({
      kind: 'org-report',
      label: 'Org report · abc123',
      params: { reportId: 'abc123' },
      source: 'route',
    });
  });

  it('builds a descriptor for a developer page', () => {
    const ctx = buildFromRoute(
      '/report/abc123/dev/junky', { id: 'abc123', login: 'junky' }, new URLSearchParams());
    expect(ctx?.kind).toBe('developer-report');
    expect(ctx?.label).toBe('Developer · @junky');
    expect(ctx?.params).toEqual({ reportId: 'abc123', login: 'junky' });
  });

  it('carries only allowlisted search params', () => {
    const search = new URLSearchParams({ team: 'Integrations', secret: 'nope' });
    const ctx = buildFromRoute('/report/abc123/team', { id: 'abc123' }, search);
    expect(ctx?.filters).toEqual({ team: 'Integrations' });
  });

  it('omits filters entirely when no allowlisted params are present', () => {
    const ctx = buildFromRoute('/report/abc123/org', { id: 'abc123' }, new URLSearchParams());
    expect(ctx?.filters).toBeUndefined();
  });

  it('returns null for an unregistered route', () => {
    expect(buildFromRoute('/experiments/new', {}, new URLSearchParams())).toBeNull();
  });

  it.each([
    ['/', 'home'],
    ['/reports', 'reports-list'],
    ['/projects', 'projects'],
    ['/profile', 'profile'],
    ['/settings', 'settings'],
    ['/debug/headers', 'debug'],
  ])('registers %s as kind %s', (path, kind) => {
    expect(buildFromRoute(path, {}, new URLSearchParams())?.kind).toBe(kind);
  });
});
