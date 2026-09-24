export type Severity = 'critical' | 'high';
export const SEVERITIES: readonly Severity[] = ['critical', 'high'];
export type AlertState = 'open' | 'fixed' | 'dismissed' | 'auto_dismissed';
export type CodebaseGroup = 'backend' | 'frontend' | 'shared' | 'other' | 'all';
export type DependabotStatus = 'ok' | 'archived' | 'error' | 'dependabot-off';
export type SyncStatus = 'running' | 'succeeded' | 'partial' | 'failed';
export type TriggerKind = 'schedule' | 'manual';

/** A repo as listed by GET /orgs/{org}/repos. */
export interface FetchedRepo {
  repoId: number;
  fullName: string;
  archived: boolean;
}

/** Custom property values for one repo, from GET /orgs/{org}/properties/values. */
export interface FetchedRepoProperties {
  repoId: number;
  fullName: string;
  team: string | null;
  serviceTier: string | null;
  codebaseType: string | null;
}

/** One repo's raw custom-property values, before the configured keys are applied. */
export interface RawPropertyRow {
  repoId: number;
  fullName: string;
  properties: Array<{ property_name: string; value: unknown }>;
}
export interface FetchedPropertiesResult {
  rows: FetchedRepoProperties[];
  /** Whether each configured key appeared on at least one property row this sweep (for the taxonomy guard). */
  keysSeen: { team: boolean; tier: boolean; codebase: boolean };
}

/** One Dependabot alert from GET /orgs/{org}/dependabot/alerts, normalised. All instants via toIsoSecond. */
export interface FetchedAlert {
  repoId: number;
  repoFullName: string;
  number: number;
  htmlUrl: string;
  state: AlertState;
  severity: Severity;
  ghsaId: string | null;
  cveId: string | null;
  summary: string | null;
  cvssScore: number | null;
  epssPercentage: number | null;
  advisoryWithdrawnAt: string | null;
  packageName: string | null;
  ecosystem: string | null;
  manifestPath: string | null;
  relationship: string | null;
  scope: string | null;
  firstPatchedVersion: string | null;
  createdAt: string;
  updatedAt: string | null;
  fixedAt: string | null;
  dismissedAt: string | null;
  autoDismissedAt: string | null;
  dismissedReason: string | null;
}

export type RepoAlertStatus =
  | { status: 'ok' }
  | { status: 'archived' }
  | { status: 'error'; detail: string }
  | { status: 'dependabot-off'; detail: string };

/** GLOOK-43: how many string values a fetch call sanitized (bmpOnly) or clipped
 * (column-length truncation) this call, so the sync can roll them up into one informational issue. */
export type DataNoticeKind = 'sanitized' | 'clipped';
export type OnDataNotice = (kind: DataNoticeKind, count: number) => void;

/** The GitHub calls the vulnerability module needs. Implemented in github.ts and github-mock.ts. */
export interface VulnerabilitySource {
  listOrgReposForVulns(org: string, log?: (msg: string) => void, onDataNotice?: OnDataNotice): Promise<FetchedRepo[]>;
  listOrgRepoProperties(org: string, keys: PropertyKeys, log?: (msg: string) => void, onDataNotice?: OnDataNotice): Promise<FetchedPropertiesResult>;
  listOrgDependabotAlerts(org: string, log?: (msg: string) => void, onDataNotice?: OnDataNotice): Promise<FetchedAlert[]>;
  getRepoDependabotStatus(fullName: string, log?: (msg: string) => void): Promise<RepoAlertStatus>;
}

/** An alert row as the aggregation layer sees it (DB row mapped by db-helpers.rowToAlertFact). */
export interface AlertFact {
  repoId: number;
  number: number;
  htmlUrl: string;
  state: AlertState;
  severity: Severity;
  severityChangedAt: string | null;
  ghsaId: string | null;
  cveId: string | null;
  summary: string | null;
  cvssScore: number | null;
  epssPercentage: number | null;
  withdrawn: boolean;
  packageName: string | null;
  ecosystem: string | null;
  manifestPath: string | null;
  relationship: string | null;
  scope: string | null;
  createdAt: string;
  /** fixed_at ?? dismissed_at ?? auto_dismissed_at; null when open */
  resolvedAt: string | null;
  dismissedReason: string | null;
  reopenedCount: number;
  lastReopenedAt: string | null;
  missing: boolean;
}

export interface RepoFact {
  repoId: number;
  fullName: string;
  team: string | null;
  serviceTier: string | null;
  codebaseType: string | null;
  archived: boolean;
  dependabotStatus: DependabotStatus;
  dependabotStatusDetail: string | null;
  /**
   * The resolved-critical count carried over from the latest imported CSV snapshot, for an
   * archived repo Glooker never synced any alerts for (see queries.ts's carried-resolved query).
   * Defaults to 0 — a repo that doesn't qualify (not archived, has stored alerts, or has no CSV
   * snapshot) never gets a nonzero value here. There is no high counterpart: the CSVs never
   * measured high.
   */
  carriedResolvedCritical: number;
}

/** One snapshot row (vulnerability_repo_snapshots). */
export interface SnapshotRow {
  source: 'sync' | 'csv-import';
  syncId: number | null;
  sourceFile: string | null;
  takenOn: string;
  measuredAt: string;
  repoId: number;
  openCritical: number;
  openHigh: number | null;
}

// --- Deployment configuration (GLOOK-43 Wave P) ---
export interface SlaEntry {
  id: string;            // <severity>-<YYYY-MM>
  severity: Severity;
  effectiveFrom: string; // YYYY-MM-DD
  days: number;          // calendar days, positive integer
}
export interface PropertyKeys { team: string; tier: string; codebase: string }
export type CodebaseGroupName = 'backend' | 'frontend' | 'shared';
export type CodebaseGroups = Record<CodebaseGroupName, string[]>;
/** One configuration problem. There is no value field, so the no-echo rule holds by construction. */
export interface ConfigError { source: 'startup' | 'sync'; variable: string; rule: string; at?: string }
/** The "resolved since" figure as the UI needs to render it: a configured date, `null` for
 * "all time" (VULN_RESOLVED_SINCE unset), or `invalid` when the configured value couldn't be
 * parsed — the caption then reads "since —" instead of a wrong date. See format.ts's resolvedCaption. */
export interface ResolvedSince { date: string | null; invalid: boolean }
export interface VulnConfig {
  slaPolicy: readonly SlaEntry[];
  slaPolicyInvalid: boolean;
  resolvedSince: string | null;
  resolvedSinceInvalid: boolean;
  keys: PropertyKeys;
  tierInScope: string;
  codebaseGroups: CodebaseGroups;
  errors: ConfigError[];
}
