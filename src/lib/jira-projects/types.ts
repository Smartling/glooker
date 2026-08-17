/**
 * A Jira project selectable on the /projects board (GLOOK-38).
 *
 * Each project names its own tab statuses rather than inferring them from
 * status categories. Measured on live Jira: SPS has 46 epics at
 * `status = "In Progress"` but 71 at `statusCategory = "In Progress"`, the
 * extra 25 being Discovery, Rollout, Specs & Design and Ready for Dev — so
 * category inference would double-list Rollout epics and surface
 * pre-development work the board deliberately excludes.
 */

export type BoardHierarchy = 'goal-initiative' | 'owner';

/** Which of a project's three tabs is being requested. */
export type BoardTabKind = 'active' | 'middle' | 'done';

export interface JiraProjectInput {
  projectKey: string;
  displayName: string;
  activeStatus: string;
  /** null means this project has no middle tab — a two-tab board. */
  middleStatus: string | null;
  hierarchy: BoardHierarchy;
  position: number;
}

export interface JiraProject extends JiraProjectInput {
  id: string;
  org: string;
}

/**
 * JiraProject as returned by GET /api/projects: adds a per-request derived
 * flag naming whether this is the project the legacy JIRA_PROJECTS_JQL var
 * configures. Never stored — `position` is admin-editable (create uses
 * `position: projects.length`, so delete-and-re-add reorders it), so it is
 * not a stable enough signal for the client to infer this from list order.
 */
export interface JiraProjectWithLegacyFlag extends JiraProject {
  isLegacy: boolean;
}

/** Project keys are letters, digits and underscores, leading letter. Anything
 *  else could break out of the quoted JQL literal we interpolate them into. */
export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

const HIERARCHIES: BoardHierarchy[] = ['goal-initiative', 'owner'];

export class JiraProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JiraProjectError';
  }
}

/** Status names are interpolated into quoted JQL literals. A backslash or
 *  double quote would let a name break out of the string: a trailing backslash
 *  escapes the closing quote, and a double quote closes it early. A literal
 *  newline or carriage return doesn't escape the literal, but it does produce
 *  JQL Jira rejects outright — a status containing one would otherwise pass
 *  validation and only fail as a 500 from the board. These four characters
 *  are the ones that need rejection for JQL double-quoted literals. */
function checkStatus(field: string, value: string): string {
  if (value.includes('"') || value.includes('\\') || value.includes('\n') || value.includes('\r')) {
    throw new JiraProjectError(`${field} must not contain a backslash, double quote, or newline`);
  }
  return value;
}

export function validateJiraProject(input: unknown): JiraProjectInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new JiraProjectError('project must be an object');
  }
  const src = input as Record<string, unknown>;

  const allowed = new Set(['projectKey', 'displayName', 'activeStatus', 'middleStatus', 'hierarchy', 'position']);
  for (const key of Object.keys(src)) {
    if (!allowed.has(key)) throw new JiraProjectError(`Unknown project field: ${key}`);
  }

  if (typeof src.projectKey !== 'string' || src.projectKey.trim() === '') {
    throw new JiraProjectError('projectKey is required');
  }
  const projectKey = src.projectKey.trim().toUpperCase();
  if (!PROJECT_KEY_RE.test(projectKey)) {
    throw new JiraProjectError(`projectKey is not a valid Jira project key: ${src.projectKey}`);
  }

  if (typeof src.activeStatus !== 'string' || src.activeStatus.trim() === '') {
    throw new JiraProjectError('activeStatus is required');
  }
  const activeStatus = checkStatus('activeStatus', src.activeStatus.trim());

  let middleStatus: string | null = null;
  if (src.middleStatus !== undefined && src.middleStatus !== null) {
    if (typeof src.middleStatus !== 'string') {
      throw new JiraProjectError('middleStatus must be a string or null');
    }
    const trimmed = src.middleStatus.trim();
    middleStatus = trimmed === '' ? null : checkStatus('middleStatus', trimmed);
  }

  let hierarchy: BoardHierarchy = 'goal-initiative';
  if (src.hierarchy !== undefined) {
    if (!HIERARCHIES.includes(src.hierarchy as BoardHierarchy)) {
      throw new JiraProjectError(`hierarchy must be one of: ${HIERARCHIES.join(', ')}`);
    }
    hierarchy = src.hierarchy as BoardHierarchy;
  }

  let position = 0;
  if (src.position !== undefined) {
    if (typeof src.position !== 'number' || !Number.isInteger(src.position) || src.position < 0) {
      throw new JiraProjectError('position must be a non-negative integer');
    }
    position = src.position;
  }

  const displayNameRaw = typeof src.displayName === 'string' ? src.displayName.trim() : '';
  const displayName = displayNameRaw === '' ? projectKey : displayNameRaw;

  return { projectKey, displayName, activeStatus, middleStatus, hierarchy, position };
}
