import type { PageContext, RegistryEntry } from './types';

/**
 * Turn a concrete pathname back into its Next.js route pattern by swapping
 * param VALUES for their [name]. This substitutes by VALUE with no
 * positional awareness: it replaces every segment — literal or dynamic —
 * whose text equals a param's value, wherever that text occurs in the path.
 * A literal segment CAN be wrongly clobbered when it happens to equal a
 * param's value (e.g. a report id of "org" turns the literal "/org"
 * segment into "[id]" too, producing a pattern string no route actually
 * has). It's fine for display/debugging a known, already-resolved
 * pathname, but it must NOT be used for registry lookups — see
 * `findEntry`, which matches structurally and positionally instead and is
 * immune to this collision.
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

function isPlaceholder(segment: string): boolean {
  return segment.startsWith('[') && segment.endsWith(']');
}

/**
 * Matches a pathname's segments against a registered pattern's segments
 * positionally: equal segment counts, and each pattern segment is either
 * identical to the path segment at that position or a `[param]`
 * placeholder (which matches any value at that position). This never
 * consults param values, so a param value that collides with a literal
 * segment elsewhere in the path cannot cause a false miss the way
 * value-based substitution (`routePattern`) can.
 */
function matchesPattern(pathSegments: string[], patternSegments: string[]): boolean {
  if (pathSegments.length !== patternSegments.length) return false;
  return patternSegments.every((p, i) => isPlaceholder(p) || p === pathSegments[i]);
}

/**
 * Look up the registry entry for a pathname by structural, positional
 * match against each entry's `pattern` (see `matchesPattern`). `params` is
 * accepted for interface symmetry with `buildFromRoute` and potential
 * future use, but the match itself is independent of param values —
 * deliberately, since that's what makes it immune to the collision
 * `routePattern` is subject to.
 */
export function findEntry(
  pathname: string,
  params: Record<string, string | string[]>,
): RegistryEntry | null {
  void params;
  const pathSegments = pathname.split('/').filter(Boolean);
  for (const entry of REGISTRY) {
    const patternSegments = entry.pattern.split('/').filter(Boolean);
    if (matchesPattern(pathSegments, patternSegments)) return entry;
  }
  return null;
}

/**
 * Tier 1. Returns null on a registry miss, meaning no chip is shown at all —
 * there is no tier 3 to fall through to (it was built, evaluated against a
 * pre-committed accuracy gate, and removed; see FINDINGS.md). `source:
 * 'inferred'` remains a deliberate extension point in the types for a future
 * reintroduction, but nothing currently produces it.
 */
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
