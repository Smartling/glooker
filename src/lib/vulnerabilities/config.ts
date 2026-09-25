import type { CodebaseGroups, CodebaseGroupName, ConfigError, PropertyKeys, SlaEntry, VulnConfig } from './types';

export const VULN_DEFAULT_CRON = '0 6 * * *';
export const VULN_DEFAULT_TZ = 'America/New_York';

export function getVulnerabilitiesOrg(): string | null {
  const v = process.env.VULNERABILITIES_ORG?.trim();
  return v ? v : null;
}
export function isVulnerabilitiesEnabled(): boolean {
  return getVulnerabilitiesOrg() !== null;
}
export function getSyncSchedule(): { cron: string; tz: string } {
  return {
    cron: process.env.VULN_SYNC_CRON?.trim() || VULN_DEFAULT_CRON,
    tz: process.env.VULN_SYNC_TZ?.trim() || VULN_DEFAULT_TZ,
  };
}

// --- Deployment configuration (GLOOK-43 Wave P) ---
export const DEFAULT_PROPERTY_KEYS: PropertyKeys = { team: 'team', tier: 'service_tier', codebase: 'codebase_type' };
export const DEFAULT_TIER_IN_SCOPE = 'production';
export const DEFAULT_CODEBASE_GROUPS: CodebaseGroups = { backend: ['backend'], frontend: ['frontend'], shared: ['shared'] };
const GROUP_NAMES: readonly CodebaseGroupName[] = ['backend', 'frontend', 'shared'];

/** Every variable this module reads. Anything else starting with VULN_/VULNERABILITIES_ is reported as misspelled. */
export const KNOWN_VULN_ENV_VARS: ReadonlySet<string> = new Set([
  'VULNERABILITIES_ORG', 'VULN_SYNC_CRON', 'VULN_SYNC_TZ', 'VULNERABILITIES_SLA_POLICY', 'VULN_RESOLVED_SINCE',
  'VULN_TEAM_PROPERTY', 'VULN_TIER_PROPERTY', 'VULN_TIER_IN_SCOPE', 'VULN_CODEBASE_PROPERTY', 'VULN_CODEBASE_GROUPS',
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^(critical|high)-\d{4}-(0[1-9]|1[0-2])$/;
// GitHub custom property names: letters, digits, _, -, $, # (at most 75 characters).
const PROPERTY_RE = /^[A-Za-z0-9_$#-]{1,75}$/;

function isCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// Messages never contain a configured value. See the spec's "Messages never echo a value".
function validatePolicy(parsed: unknown, err: (rule: string) => void): SlaEntry[] | null {
  const V = 'VULNERABILITIES_SLA_POLICY';
  if (!Array.isArray(parsed)) { err(`${V}: must be a JSON array of entries`); return null; }
  let bad = false;
  const fail = (rule: string) => { bad = true; err(rule); };
  const firstIndexById = new Map<string, number>();
  const lastFromBySeverity = new Map<string, string>();
  parsed.forEach((raw, i) => {
    const n = i + 1;
    const x = (raw ?? {}) as Record<string, unknown>;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) { fail(`${V}: entry ${n}: must be an object`); return; }
    const sevOk = x.severity === 'critical' || x.severity === 'high';
    if (!sevOk) fail(`${V}: entry ${n}: severity must be critical or high`);
    if (typeof x.id !== 'string' || !ID_RE.test(x.id)) fail(`${V}: entry ${n}: id must match <severity>-<YYYY-MM>`);
    else if (sevOk && !x.id.startsWith(`${x.severity}-`)) fail(`${V}: entry ${n}: id must start with its severity`);
    if (typeof x.effectiveFrom !== 'string' || !isCalendarDate(x.effectiveFrom)) fail(`${V}: entry ${n}: effectiveFrom must be a valid YYYY-MM-DD date`);
    if (typeof x.days !== 'number' || !Number.isInteger(x.days)) fail(`${V}: entry ${n}: days must be a positive integer`);
    else if (x.days <= 0) fail(`${V}: entry ${n}: days must be > 0`);
    if (typeof x.id === 'string') {
      const prev = firstIndexById.get(x.id);
      if (prev !== undefined) fail(`${V}: entries ${prev} and ${n}: duplicate id`); else firstIndexById.set(x.id, n);
    }
    if (sevOk && typeof x.effectiveFrom === 'string' && isCalendarDate(x.effectiveFrom)) {
      const last = lastFromBySeverity.get(x.severity as string);
      if (last !== undefined && x.effectiveFrom <= last) fail(`${V}: entry ${n}: effectiveFrom must be later than the previous ${x.severity} entry`);
      lastFromBySeverity.set(x.severity as string, x.effectiveFrom);
    }
  });
  return bad ? null : (parsed as SlaEntry[]).map(x => ({ id: x.id, severity: x.severity, effectiveFrom: x.effectiveFrom, days: x.days }));
}

function validateGroups(parsed: unknown, err: (rule: string) => void): CodebaseGroups | null {
  const V = 'VULN_CODEBASE_GROUPS';
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) { err(`${V}: must be a JSON object`); return null; }
  const obj = parsed as Record<string, unknown>;
  let bad = false;
  if (Object.keys(obj).some(k => !(GROUP_NAMES as readonly string[]).includes(k))) { bad = true; err(`${V}: unknown group (allowed: backend, frontend, shared)`); }
  const out: CodebaseGroups = { backend: [], frontend: [], shared: [] };
  // Owning group per value, across groups already processed — the rule is only "no value under
  // more than one group"; a value repeated within the SAME group is fine and simply collapses to
  // one entry (below), not a cross-group duplicate.
  const owner = new Map<string, CodebaseGroupName>();
  let dup = false;
  for (const g of GROUP_NAMES) {
    const v = obj[g];
    if (v === undefined) continue;
    if (!Array.isArray(v) || v.some(s => typeof s !== 'string' || s.trim() === '')) { bad = true; err(`${V}: each group must be a list of non-empty strings`); continue; }
    // Emptiness is checked before trimming (above); trim here before de-duplicating and storing,
    // so " api" and "api" are one value.
    const trimmed = (v as string[]).map(s => s.trim());
    const deduped: string[] = [];
    const seenInGroup = new Set<string>();
    for (const s of trimmed) {
      if (seenInGroup.has(s)) continue; // within-group repeat: de-duplicated silently, not an error
      seenInGroup.add(s);
      deduped.push(s);
      if (owner.has(s)) dup = true; else owner.set(s, g);
    }
    out[g] = deduped;
  }
  if (dup) { bad = true; err(`${V}: a value appears under more than one group`); }
  return bad ? null : out;
}

function copyGroups(d: CodebaseGroups): CodebaseGroups {
  return { backend: [...d.backend], frontend: [...d.frontend], shared: [...d.shared] };
}

export function parseVulnConfig(env: Record<string, string | undefined> = process.env): VulnConfig {
  const errors: ConfigError[] = [];
  const errFor = (variable: string) => (rule: string) => errors.push({ source: 'startup', variable, rule });

  let slaPolicy: SlaEntry[] = [];
  let slaPolicyInvalid = false;
  const rawPolicy = env.VULNERABILITIES_SLA_POLICY?.trim();
  if (rawPolicy) {
    let parsed: unknown;
    let jsonOk = true;
    try { parsed = JSON.parse(rawPolicy); } catch { jsonOk = false; }
    if (!jsonOk) { errFor('VULNERABILITIES_SLA_POLICY')('Invalid JSON in VULNERABILITIES_SLA_POLICY env var'); slaPolicyInvalid = true; }
    else {
      const v = validatePolicy(parsed, errFor('VULNERABILITIES_SLA_POLICY'));
      if (v) slaPolicy = v; else slaPolicyInvalid = true;
    }
  }

  let resolvedSince: string | null = null;
  let resolvedSinceInvalid = false;
  const rawSince = env.VULN_RESOLVED_SINCE?.trim();
  if (rawSince) {
    if (isCalendarDate(rawSince)) resolvedSince = rawSince;
    else { resolvedSinceInvalid = true; errFor('VULN_RESOLVED_SINCE')('VULN_RESOLVED_SINCE: must be a valid YYYY-MM-DD date'); }
  }

  const key = (variable: string, fallback: string): string => {
    const raw = env[variable]?.trim();
    if (!raw) return fallback;
    if (!PROPERTY_RE.test(raw)) { errFor(variable)(`${variable}: not a valid custom property name`); return fallback; }
    return raw;
  };
  const keys: PropertyKeys = {
    team: key('VULN_TEAM_PROPERTY', DEFAULT_PROPERTY_KEYS.team),
    tier: key('VULN_TIER_PROPERTY', DEFAULT_PROPERTY_KEYS.tier),
    codebase: key('VULN_CODEBASE_PROPERTY', DEFAULT_PROPERTY_KEYS.codebase),
  };
  const tierInScope = env.VULN_TIER_IN_SCOPE?.trim() || DEFAULT_TIER_IN_SCOPE;

  let codebaseGroups: CodebaseGroups = copyGroups(DEFAULT_CODEBASE_GROUPS);
  const rawGroups = env.VULN_CODEBASE_GROUPS?.trim();
  if (rawGroups) {
    let parsed: unknown;
    let jsonOk = true;
    try { parsed = JSON.parse(rawGroups); } catch { jsonOk = false; }
    if (!jsonOk) errFor('VULN_CODEBASE_GROUPS')('Invalid JSON in VULN_CODEBASE_GROUPS env var');
    else codebaseGroups = validateGroups(parsed, errFor('VULN_CODEBASE_GROUPS')) ?? copyGroups(DEFAULT_CODEBASE_GROUPS);
  }

  for (const name of Object.keys(env)) {
    if ((name.startsWith('VULN_') || name.startsWith('VULNERABILITIES_')) && !KNOWN_VULN_ENV_VARS.has(name)) {
      errFor(name)(`${name}: unrecognised variable (a misspelled name is ignored)`);
    }
  }

  return { slaPolicy, slaPolicyInvalid, resolvedSince, resolvedSinceInvalid, keys, tierInScope, codebaseGroups, errors };
}

let cachedConfig: VulnConfig | null = null;
/** Parsed once per process. Deployments restart to pick up a change. */
export function getVulnConfig(): VulnConfig {
  if (!cachedConfig) cachedConfig = parseVulnConfig(process.env);
  return cachedConfig;
}
/** Test-only: forces the next getVulnConfig() to re-read process.env. */
export function __clearVulnConfigCache(): void { cachedConfig = null; }
