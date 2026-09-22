import type { PageContext, RegistryEntry } from './types';

/**
 * Turn a concrete pathname back into its Next.js route pattern by swapping
 * param VALUES for their [name]. Matches whole segments only, so a literal
 * segment that happens to equal a param value is not clobbered.
 */
export function routePattern(
  pathname: string,
  params: Record<string, string | string[]>,
): string {
  const bySegment = new Map<string, string>();
  for (const [key, val] of Object.entries(params)) {
    if (typeof val === 'string') bySegment.set(val, `[${key}]`);
  }
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  return '/' + segments.map(s => bySegment.get(s) ?? s).join('/');
}

export const REGISTRY: RegistryEntry[] = [
  {
    pattern: '/',
    kind: 'home',
    label: () => 'Latest report',
    suggestions: ['Who are the top 5 performers?', 'What is our AI adoption rate?'],
  },
  {
    pattern: '/report/[id]/org',
    kind: 'org-report',
    label: p => `Org report · ${p.reportId}`,
    paramMap: { id: 'reportId' },
    suggestions: ['Compare to the previous report', 'Who regressed?', 'Which team led?'],
  },
  {
    pattern: '/report/[id]/team',
    kind: 'team-report',
    label: p => `Team report · ${p.reportId}`,
    paramMap: { id: 'reportId' },
    filterKeys: ['team'],
    suggestions: ['How did this team do?', 'Who contributed most?'],
  },
  {
    pattern: '/report/[id]/dev/[login]',
    kind: 'developer-report',
    label: p => `Developer · @${p.login}`,
    paramMap: { id: 'reportId', login: 'login' },
    suggestions: ['Why did spend change?', 'What did they ship?', 'Compare to their team'],
  },
  {
    pattern: '/reports',
    kind: 'reports-list',
    label: () => 'All reports',
    suggestions: ['Which report covers last month?', 'How many reports are there?'],
  },
  {
    pattern: '/projects',
    kind: 'projects',
    label: () => 'Project board',
    suggestions: ['Which projects are active?', 'What is at risk?'],
  },
  {
    pattern: '/profile',
    kind: 'profile',
    label: () => 'My profile',
    suggestions: ['How did I do this period?'],
  },
  {
    pattern: '/settings',
    kind: 'settings',
    label: () => 'Settings',
    suggestions: ['Who is on the skip allowlist?'],
  },
  {
    pattern: '/debug/headers',
    kind: 'debug',
    label: () => 'Debug headers',
    suggestions: [],
  },
];

const BY_PATTERN = new Map(REGISTRY.map(e => [e.pattern, e]));

export function findEntry(pathname: string, params: Record<string, string | string[]>) {
  return BY_PATTERN.get(routePattern(pathname, params)) ?? null;
}

/** Tier 1. Returns null on a registry miss so the caller can fall through to tier 3. */
export function buildFromRoute(
  pathname: string,
  params: Record<string, string | string[]>,
  search: URLSearchParams,
): PageContext | null {
  const entry = findEntry(pathname, params);
  if (!entry) return null;

  const mapped: Record<string, string> = {};
  for (const [key, val] of Object.entries(params)) {
    if (typeof val !== 'string') continue;
    const name = entry.paramMap?.[key];
    if (name) mapped[name] = val;
  }

  const filters: Record<string, string> = {};
  for (const key of entry.filterKeys ?? []) {
    const val = search.get(key);
    if (val) filters[key] = val;
  }

  const ctx: PageContext = {
    kind: entry.kind,
    label: entry.label(mapped),
    params: mapped,
    source: 'route',
  };
  if (Object.keys(filters).length > 0) ctx.filters = filters;
  return ctx;
}
