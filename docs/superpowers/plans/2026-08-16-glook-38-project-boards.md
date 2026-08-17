# GLOOK-38 Per-Project Boards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-team board configuration with a per-Jira-project one, so `/projects` shows any configured project rather than treating Research as a special team.

**Architecture:** A `jira_projects` table holds one row per selectable project, each naming its own tab statuses and row grouping. `/api/projects` loads one project row, generates its JQL, and fetches once — no source merging, no provenance. Rings, the Done window and attribution all unify to what SPS already does.

**Tech Stack:** Next.js 15 App Router, TypeScript, Jest + ts-jest, SWR, SQLite (default) + MySQL (opt-in), Jira REST v3 `/search/jql`.

**Spec:** `docs/superpowers/specs/2026-08-16-glook-38-project-boards-design.md`

## Global Constraints

### git is partly broken in this repo — read this before your first commit

A cloud-sync layer makes any git command that stats the working tree hang **forever**. Measured on this checkout:

| Safe (6–11ms) | Hangs indefinitely |
|---|---|
| `git rev-parse`, `git log`, `git show`, `git ls-files`, `git cat-file` | `git status` |
| `git diff --cached`, `git diff <A>..<B>` | `git commit` (any form, `-m` included) |
| `git add <explicit path>` | `git update-index --refresh` |
| `git write-tree`, `git commit-tree`, `git update-ref` | `git diff` (unstaged), `git add -A`, `git add .` |

**Never run `git status`, `git commit`, `git add -A` or bare `git diff`.** If you do, the process wedges holding `.git/index.lock` and someone has to kill it.

**Commit with plumbing instead.** This is the required recipe for every task:

```bash
git add path/to/file-one.ts path/to/file-two.test.ts   # explicit paths only
printf '%s\n' "feat(glook-38): your subject line" "" "Optional body line." > /private/tmp/glook38-msg.txt
TREE=$(git write-tree)
NEW=$(git commit-tree "$TREE" -p "$(git rev-parse HEAD)" -F /private/tmp/glook38-msg.txt)
git update-ref HEAD "$NEW"
git log --oneline -1    # verify it landed
```

To delete a file, `git rm path/to/file` works (it does not walk the tree). To see what you have staged, `git diff --cached --name-status`.

### Everything else

- A new table needs adding in **both** `src/lib/db/sqlite.ts` (creates everything) and `src/lib/db/mysql.ts` (creates only the newer tables), plus `schema.sql` for parity.
- **Never pin a charset** on a MySQL table (`DEFAULT CHARSET=...`) — `ER_FK_INCOMPATIBLE_COLUMNS`, errno 3780. Guarded by `src/lib/__tests__/unit/mysql-schema-fk-charset.test.ts`.
- Every exported handler in `src/app/api/**/route.ts` must be wrapped in `withRequestLog()` — enforced by `logger-enforcement.test.ts`. Mutating handlers keep `requireAdmin`.
- Files under `src/app/**/page.tsx` may export **only** `default`. Violations pass `npm test` and `tsc --noEmit` and fail only at `npm run build`.
- Jest `roots: ['<rootDir>/src/lib']` — **all** tests live flat in `src/lib/__tests__/unit/`, including tests for code under `src/app/`.
- Component tests need `/** @jest-environment jsdom */` on line 1. `@testing-library/jest-dom` is **not** installed — plain Jest matchers only.
- Any test importing from `github.ts` transitively must `jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }))` before the import.
- Tests that mutate `process.env` must restore prior values in `afterAll` — the env is shared across a Jest worker.
- Run `rm -rf .next` **before** `npm run build`; dev and build artifacts conflict.
- **Baseline before Task 1: 115 suites / 1062 tests / 9 snapshots, all green.** `tsc --noEmit` reports 6 pre-existing errors in three **untracked** files named `team-projects-generator.test 2.ts`, ` 3.ts`, ` 4.ts` — known local debris. Your bar: no NEW tsc errors.
- Jira status names are interpolated into quoted JQL literals. Project keys must match `/^[A-Z][A-Z0-9_]*$/`; status names must not contain `"`.

---

### Task 1: JiraProject types and validation

Pure module, no DB and no Jira. Everything downstream depends on these names.

**Files:**
- Create: `src/lib/jira-projects/types.ts`
- Test: `src/lib/__tests__/unit/jira-project-types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `JiraProject`, `JiraProjectInput`, `BoardHierarchy`, `BoardTabKind`, `PROJECT_KEY_RE`, `JiraProjectError`, `validateJiraProject(input: unknown): JiraProjectInput`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/jira-project-types.test.ts`:

```ts
import { validateJiraProject, JiraProjectError } from '@/lib/jira-projects/types';

const valid = {
  projectKey: 'RND',
  displayName: 'LanguageAI Research',
  activeStatus: 'In Progress',
  middleStatus: 'Backlog',
  hierarchy: 'owner' as const,
  position: 1,
};

describe('validateJiraProject', () => {
  it('accepts a fully specified project', () => {
    expect(validateJiraProject(valid)).toEqual(valid);
  });

  it('uppercases and trims the project key', () => {
    expect(validateJiraProject({ ...valid, projectKey: ' rnd ' }).projectKey).toBe('RND');
  });

  it('defaults displayName to the project key when blank', () => {
    expect(validateJiraProject({ ...valid, displayName: '  ' }).displayName).toBe('RND');
  });

  it('defaults hierarchy and position when omitted', () => {
    const out = validateJiraProject({ projectKey: 'SPS', activeStatus: 'In Progress' });
    expect(out.hierarchy).toBe('goal-initiative');
    expect(out.position).toBe(0);
    expect(out.middleStatus).toBeNull();
  });

  it('treats a blank middleStatus as null, meaning a two-tab board', () => {
    expect(validateJiraProject({ ...valid, middleStatus: '   ' }).middleStatus).toBeNull();
  });

  it('rejects a project key with JQL-hostile characters', () => {
    expect(() => validateJiraProject({ ...valid, projectKey: 'RND" OR key = "X' })).toThrow(/projectKey/);
  });

  it('rejects a project key that does not start with a letter', () => {
    expect(() => validateJiraProject({ ...valid, projectKey: '1ND' })).toThrow(/projectKey/);
  });

  it('rejects a missing project key', () => {
    expect(() => validateJiraProject({ activeStatus: 'In Progress' })).toThrow(JiraProjectError);
  });

  it('rejects a missing activeStatus', () => {
    expect(() => validateJiraProject({ projectKey: 'SPS' })).toThrow(/activeStatus/);
  });

  it('rejects a status name containing a double quote', () => {
    expect(() => validateJiraProject({ ...valid, activeStatus: 'In "Progress"' })).toThrow(/activeStatus/);
    expect(() => validateJiraProject({ ...valid, middleStatus: 'Roll"out' })).toThrow(/middleStatus/);
  });

  it('rejects an invalid hierarchy', () => {
    expect(() => validateJiraProject({ ...valid, hierarchy: 'sideways' })).toThrow(/hierarchy/);
  });

  it('rejects a non-integer position', () => {
    expect(() => validateJiraProject({ ...valid, position: 1.5 })).toThrow(/position/);
  });

  it('rejects an unknown key', () => {
    expect(() => validateJiraProject({ ...valid, ringMode: 'jira' })).toThrow(/Unknown/);
  });

  it('rejects a non-object', () => {
    expect(() => validateJiraProject('nope')).toThrow(JiraProjectError);
    expect(() => validateJiraProject(null)).toThrow(JiraProjectError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="jira-project-types"`
Expected: FAIL — `Cannot find module '@/lib/jira-projects/types'`

- [ ] **Step 3: Implement**

Create `src/lib/jira-projects/types.ts`:

```ts
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

/** Status names are interpolated into quoted JQL literals, so a double quote
 *  would let a name break out of the string. */
function checkStatus(field: string, value: string): string {
  if (value.includes('"')) {
    throw new JiraProjectError(`${field} must not contain a double quote`);
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- --testPathPattern="jira-project-types"`
Expected: PASS, 14 tests

- [ ] **Step 5: Commit** (use the plumbing recipe from Global Constraints)

Subject: `feat(glook-38): add JiraProject types and validation`
Paths: `src/lib/jira-projects/types.ts src/lib/__tests__/unit/jira-project-types.test.ts`

---

### Task 2: `jira_projects` table and service

**Files:**
- Modify: `schema.sql`, `src/lib/db/sqlite.ts`, `src/lib/db/mysql.ts`
- Create: `src/lib/jira-projects/service.ts`
- Test: `src/lib/__tests__/unit/jira-projects-schema.test.ts`, `src/lib/__tests__/unit/jira-projects-service.test.ts`

**Interfaces:**
- Consumes: `JiraProject`, `JiraProjectInput`, `validateJiraProject`, `JiraProjectError` (Task 1).
- Produces: `listJiraProjects(org): Promise<JiraProject[]>`, `getJiraProject(org, projectKey): Promise<JiraProject | null>`, `createJiraProject(org, input): Promise<JiraProject>`, `updateJiraProject(id, input): Promise<void>`, `deleteJiraProject(id): Promise<void>`, `JiraProjectNotFoundError`, `JiraProjectDuplicateError`.

- [ ] **Step 1: Write the failing schema test**

Create `src/lib/__tests__/unit/jira-projects-schema.test.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('jira_projects exists in every schema location', () => {
  it('is in the MySQL base schema', () => {
    expect(read('schema.sql')).toMatch(/CREATE TABLE IF NOT EXISTS jira_projects/i);
  });

  it('is created by the SQLite schema', () => {
    expect(read('src/lib/db/sqlite.ts')).toMatch(/CREATE TABLE IF NOT EXISTS jira_projects/i);
  });

  it('is created by the MySQL migration path', () => {
    expect(read('src/lib/db/mysql.ts')).toMatch(/CREATE TABLE IF NOT EXISTS jira_projects/i);
  });

  it('does not pin a charset on jira_projects', () => {
    const sql = read('schema.sql');
    const block = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS jira_projects'));
    expect(block.slice(0, block.indexOf(');'))).not.toMatch(/DEFAULT CHARSET/i);
  });

  it('drops the superseded teams.board_config column in both dialects', () => {
    expect(read('src/lib/db/sqlite.ts')).toMatch(/ALTER TABLE teams DROP COLUMN board_config/i);
    expect(read('src/lib/db/mysql.ts')).toMatch(/ALTER TABLE teams DROP COLUMN board_config/i);
  });

  it('no longer declares board_config on the teams table', () => {
    const sql = read('schema.sql');
    const teams = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS teams ('),
      sql.indexOf('CREATE TABLE IF NOT EXISTS team_members ('),
    );
    expect(teams).not.toMatch(/board_config/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="jira-projects-schema"`
Expected: FAIL — table absent in all three locations.

- [ ] **Step 3: Add the table and drop the old column**

In `schema.sql`, remove the `board_config JSON NULL,` line from the `teams` block, and add after `team_members`:

```sql
CREATE TABLE IF NOT EXISTS jira_projects (
  id            VARCHAR(36)  NOT NULL PRIMARY KEY,
  org           VARCHAR(255) NOT NULL,
  project_key   VARCHAR(64)  NOT NULL,
  display_name  VARCHAR(255) NOT NULL,
  active_status VARCHAR(255) NOT NULL,
  middle_status VARCHAR(255) NULL,
  hierarchy     VARCHAR(32)  NOT NULL DEFAULT 'goal-initiative',
  position      INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_project (org, project_key)
);
```

In `src/lib/db/sqlite.ts`, remove `board_config TEXT,` from the `teams` block in the `SCHEMA` literal, add to the same literal:

```sql
CREATE TABLE IF NOT EXISTS jira_projects (
  id            TEXT NOT NULL PRIMARY KEY,
  org           TEXT NOT NULL,
  project_key   TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  active_status TEXT NOT NULL,
  middle_status TEXT,
  hierarchy     TEXT NOT NULL DEFAULT 'goal-initiative',
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (org, project_key)
);
```

and replace the GLOOK-38 `ADD COLUMN board_config` migration line with:

```ts
  // GLOOK-38: board config moved from teams to the jira_projects table
  try { db.exec('ALTER TABLE teams DROP COLUMN board_config'); } catch (_) {}
```

In `src/lib/db/mysql.ts`, replace the `ADD COLUMN board_config` migration with:

```ts
  // GLOOK-38: board config moved from teams to the jira_projects table
  await pool.execute('ALTER TABLE teams DROP COLUMN board_config').catch(() => {});
  await pool.execute(`CREATE TABLE IF NOT EXISTS jira_projects (
    id            VARCHAR(36)  NOT NULL PRIMARY KEY,
    org           VARCHAR(255) NOT NULL,
    project_key   VARCHAR(64)  NOT NULL,
    display_name  VARCHAR(255) NOT NULL,
    active_status VARCHAR(255) NOT NULL,
    middle_status VARCHAR(255) NULL,
    hierarchy     VARCHAR(32)  NOT NULL DEFAULT 'goal-initiative',
    position      INT          NOT NULL DEFAULT 0,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_org_project (org, project_key)
  )`).catch((err) => {
    console.error('[db/mysql] Failed to create jira_projects:', err);
  });
```

> The DROP swallows all errors, not just one code: it must be a no-op both on a
> database that never had the column and on one where it was already dropped.

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `npm test -- --testPathPattern="jira-projects-schema|mysql-schema-fk-charset"`
Expected: PASS

- [ ] **Step 5: Write the failing service test**

Create `src/lib/__tests__/unit/jira-projects-service.test.ts`:

```ts
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));

import {
  listJiraProjects, getJiraProject, createJiraProject, updateJiraProject, deleteJiraProject,
  JiraProjectDuplicateError,
} from '@/lib/jira-projects/service';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;

const row = {
  id: 'p1', org: 'o', project_key: 'RND', display_name: 'LanguageAI Research',
  active_status: 'In Progress', middle_status: 'Backlog', hierarchy: 'owner', position: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockExecute.mockResolvedValue([[], null]);
});

describe('listJiraProjects', () => {
  it('maps snake_case rows onto the JiraProject shape', async () => {
    mockExecute.mockResolvedValueOnce([[row], null]);
    const [p] = await listJiraProjects('o');
    expect(p).toEqual({
      id: 'p1', org: 'o', projectKey: 'RND', displayName: 'LanguageAI Research',
      activeStatus: 'In Progress', middleStatus: 'Backlog', hierarchy: 'owner', position: 1,
    });
  });

  it('orders by position', async () => {
    await listJiraProjects('o');
    expect(mockExecute.mock.calls[0][0]).toMatch(/ORDER BY position/i);
  });

  it('returns an empty array when nothing is configured', async () => {
    expect(await listJiraProjects('o')).toEqual([]);
  });

  it('normalises a null middle_status to null', async () => {
    mockExecute.mockResolvedValueOnce([[{ ...row, middle_status: null }], null]);
    expect((await listJiraProjects('o'))[0].middleStatus).toBeNull();
  });
});

describe('getJiraProject', () => {
  it('returns the matching project', async () => {
    mockExecute.mockResolvedValueOnce([[row], null]);
    expect((await getJiraProject('o', 'RND'))!.projectKey).toBe('RND');
  });

  it('is case-insensitive on the key', async () => {
    mockExecute.mockResolvedValueOnce([[row], null]);
    await getJiraProject('o', 'rnd');
    expect(mockExecute.mock.calls[0][1]).toEqual(['o', 'RND']);
  });

  it('returns null when absent', async () => {
    expect(await getJiraProject('o', 'NOPE')).toBeNull();
  });
});

describe('createJiraProject', () => {
  it('validates before inserting', async () => {
    await expect(createJiraProject('o', { projectKey: 'bad key!', activeStatus: 'In Progress' }))
      .rejects.toThrow(/projectKey/);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('inserts the validated row and returns it', async () => {
    const p = await createJiraProject('o', {
      projectKey: 'rnd', activeStatus: 'In Progress', middleStatus: 'Backlog', hierarchy: 'owner',
    });
    expect(p.projectKey).toBe('RND');
    expect(p.displayName).toBe('RND');
    expect(mockExecute.mock.calls[0][0]).toMatch(/INSERT INTO jira_projects/i);
  });

  it('maps a unique violation to JiraProjectDuplicateError', async () => {
    mockExecute.mockRejectedValueOnce({ code: 'ER_DUP_ENTRY' });
    await expect(createJiraProject('o', { projectKey: 'RND', activeStatus: 'In Progress' }))
      .rejects.toThrow(JiraProjectDuplicateError);
  });
});

describe('updateJiraProject', () => {
  it('validates and writes every field', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 'p1' }], null]);
    await updateJiraProject('p1', {
      projectKey: 'RND', activeStatus: 'In Progress', middleStatus: null, hierarchy: 'owner', position: 2,
    });
    const update = mockExecute.mock.calls.find(c => /UPDATE jira_projects/i.test(c[0]));
    expect(update).toBeDefined();
    expect(update![1]).toContain('RND');
    expect(update![1]).toContain(null);
  });

  it('rejects an invalid payload before touching the DB', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 'p1' }], null]);
    await expect(updateJiraProject('p1', { projectKey: 'RND', activeStatus: 'a"b' }))
      .rejects.toThrow(/activeStatus/);
  });
});

describe('deleteJiraProject', () => {
  it('deletes by id', async () => {
    await deleteJiraProject('p1');
    expect(mockExecute.mock.calls[0][0]).toMatch(/DELETE FROM jira_projects/i);
    expect(mockExecute.mock.calls[0][1]).toEqual(['p1']);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- --testPathPattern="jira-projects-service"`
Expected: FAIL — `Cannot find module '@/lib/jira-projects/service'`

- [ ] **Step 7: Implement the service**

Create `src/lib/jira-projects/service.ts`:

```ts
import { randomUUID } from 'crypto';
import db from '../db/index';
import { validateJiraProject, type JiraProject } from './types';

export class JiraProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Jira project not found: ${id}`);
    this.name = 'JiraProjectNotFoundError';
  }
}

export class JiraProjectDuplicateError extends Error {
  constructor(key: string) {
    super(`Jira project "${key}" is already configured for this org`);
    this.name = 'JiraProjectDuplicateError';
  }
}

function toProject(r: any): JiraProject {
  return {
    id: r.id,
    org: r.org,
    projectKey: r.project_key,
    displayName: r.display_name,
    activeStatus: r.active_status,
    middleStatus: r.middle_status ?? null,
    hierarchy: r.hierarchy,
    position: Number(r.position),
  };
}

const COLUMNS = 'id, org, project_key, display_name, active_status, middle_status, hierarchy, position';

export async function listJiraProjects(org: string): Promise<JiraProject[]> {
  const [rows] = await db.execute(
    `SELECT ${COLUMNS} FROM jira_projects WHERE org = ? ORDER BY position, project_key`,
    [org],
  ) as [any[], any];
  return rows.map(toProject);
}

export async function getJiraProject(org: string, projectKey: string): Promise<JiraProject | null> {
  const [rows] = await db.execute(
    `SELECT ${COLUMNS} FROM jira_projects WHERE org = ? AND project_key = ?`,
    [org, projectKey.trim().toUpperCase()],
  ) as [any[], any];
  return rows.length > 0 ? toProject(rows[0]) : null;
}

export async function createJiraProject(org: string, input: unknown): Promise<JiraProject> {
  const v = validateJiraProject(input);
  const id = randomUUID();
  try {
    await db.execute(
      `INSERT INTO jira_projects (id, org, project_key, display_name, active_status, middle_status, hierarchy, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, org, v.projectKey, v.displayName, v.activeStatus, v.middleStatus, v.hierarchy, v.position],
    );
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY' || err?.message?.includes('UNIQUE')) {
      throw new JiraProjectDuplicateError(v.projectKey);
    }
    throw err;
  }
  return { id, org, ...v };
}

export async function updateJiraProject(id: string, input: unknown): Promise<void> {
  const [existing] = await db.execute(`SELECT id FROM jira_projects WHERE id = ?`, [id]) as [any[], any];
  if (existing.length === 0) throw new JiraProjectNotFoundError(id);

  const v = validateJiraProject(input);
  try {
    await db.execute(
      `UPDATE jira_projects
         SET project_key = ?, display_name = ?, active_status = ?, middle_status = ?, hierarchy = ?, position = ?
       WHERE id = ?`,
      [v.projectKey, v.displayName, v.activeStatus, v.middleStatus, v.hierarchy, v.position, id],
    );
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY' || err?.message?.includes('UNIQUE')) {
      throw new JiraProjectDuplicateError(v.projectKey);
    }
    throw err;
  }
}

export async function deleteJiraProject(id: string): Promise<void> {
  await db.execute(`DELETE FROM jira_projects WHERE id = ?`, [id]);
}
```

- [ ] **Step 8: Run tests, then the full suite**

Run: `npm test -- --testPathPattern="jira-projects"`
Expected: PASS

Run: `npm test`
Expected: PASS. **Existing `teams` tests will fail** — `teams-board-config.test.ts` and `board-config-schema.test.ts` assert the column you just dropped. Delete both files; they test a feature this plan removes. Report that you deleted them.

- [ ] **Step 9: Commit**

Subject: `feat(glook-38): add jira_projects table and service, drop teams.board_config`
Paths: `schema.sql src/lib/db/sqlite.ts src/lib/db/mysql.ts src/lib/jira-projects/service.ts src/lib/__tests__/unit/jira-projects-schema.test.ts src/lib/__tests__/unit/jira-projects-service.test.ts`
Also `git rm src/lib/__tests__/unit/teams-board-config.test.ts src/lib/__tests__/unit/board-config-schema.test.ts`

---

### Task 3: `buildProjectJql`

The single most important test in this plan lives here: the SPS clause pin.

**Files:**
- Create: `src/lib/jira-projects/jql.ts`
- Test: `src/lib/__tests__/unit/jira-project-jql.test.ts`

**Interfaces:**
- Consumes: `JiraProject`, `BoardTabKind`, `PROJECT_KEY_RE`, `JiraProjectError` (Task 1).
- Produces: `buildProjectJql(project: JiraProject, tab: BoardTabKind): string`, `DONE_WINDOW_DAYS = 30`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/jira-project-jql.test.ts`:

```ts
import { buildProjectJql, DONE_WINDOW_DAYS } from '@/lib/jira-projects/jql';
import type { JiraProject } from '@/lib/jira-projects/types';

const SPS: JiraProject = {
  id: 'a', org: 'o', projectKey: 'SPS', displayName: 'Smartling Platform',
  activeStatus: 'In Progress', middleStatus: 'Rollout', hierarchy: 'goal-initiative', position: 0,
};
const RND: JiraProject = {
  id: 'b', org: 'o', projectKey: 'RND', displayName: 'LanguageAI Research',
  activeStatus: 'In Progress', middleStatus: 'Backlog', hierarchy: 'owner', position: 1,
};

describe('SPS clause pin — regression guard', () => {
  // Measured on live Jira 2026-08-16: `status = "In Progress"` returns 46 SPS
  // epics, `statusCategory = "In Progress"` returns 71. The extra 25 are
  // Discovery, Rollout, Specs & Design and Ready for Dev — using the category
  // would double-list Rollout epics and surface pre-development work.
  it('uses status, never statusCategory, for the active tab', () => {
    const jql = buildProjectJql(SPS, 'active');
    expect(jql).toBe('project = "SPS" AND issuetype = Epic AND status = "In Progress"');
    expect(jql).not.toContain('statusCategory');
  });

  it('uses status for the middle tab', () => {
    expect(buildProjectJql(SPS, 'middle'))
      .toBe('project = "SPS" AND issuetype = Epic AND status = "Rollout"');
  });

  it('uses the Done category with a last-updated window for the done tab', () => {
    expect(buildProjectJql(SPS, 'done'))
      .toBe('project = "SPS" AND issuetype = Epic AND statusCategory = "Done" AND updated >= -30d');
  });
});

describe('buildProjectJql for other projects', () => {
  it('builds RND tabs from its own status names', () => {
    expect(buildProjectJql(RND, 'active'))
      .toBe('project = "RND" AND issuetype = Epic AND status = "In Progress"');
    expect(buildProjectJql(RND, 'middle'))
      .toBe('project = "RND" AND issuetype = Epic AND status = "Backlog"');
  });

  it('uses the same Done clause for every project', () => {
    expect(buildProjectJql(RND, 'done'))
      .toBe('project = "RND" AND issuetype = Epic AND statusCategory = "Done" AND updated >= -30d');
  });

  it('throws for the middle tab when the project has none', () => {
    expect(() => buildProjectJql({ ...RND, middleStatus: null }, 'middle'))
      .toThrow(/no middle tab/i);
  });

  it('exports the window as a named constant so the label can match', () => {
    expect(DONE_WINDOW_DAYS).toBe(30);
  });
});

describe('injection defence at the point of use', () => {
  it('rejects a project key that did not come through validation', () => {
    expect(() => buildProjectJql({ ...RND, projectKey: 'RND" OR key = "X' }, 'active'))
      .toThrow(/projectKey/);
  });

  it('rejects a status name containing a double quote', () => {
    expect(() => buildProjectJql({ ...RND, activeStatus: 'a"b' }, 'active')).toThrow(/activeStatus/);
    expect(() => buildProjectJql({ ...RND, middleStatus: 'a"b' }, 'middle')).toThrow(/middleStatus/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="jira-project-jql"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/jira-projects/jql.ts`:

```ts
import { PROJECT_KEY_RE, JiraProjectError, type JiraProject, type BoardTabKind } from './types';

/** One Done semantic for every project: filtering on last-updated rather than
 *  resolution date also catches rejected work, which carries no resolved date. */
export const DONE_WINDOW_DAYS = 30;

export function buildProjectJql(project: JiraProject, tab: BoardTabKind): string {
  if (!PROJECT_KEY_RE.test(project.projectKey)) {
    throw new JiraProjectError(`buildProjectJql received an invalid projectKey: ${project.projectKey}`);
  }
  const base = `project = "${project.projectKey}" AND issuetype = Epic`;

  switch (tab) {
    case 'active': {
      if (project.activeStatus.includes('"')) {
        throw new JiraProjectError(`buildProjectJql received an invalid activeStatus: ${project.activeStatus}`);
      }
      return `${base} AND status = "${project.activeStatus}"`;
    }
    case 'middle': {
      if (!project.middleStatus) {
        throw new JiraProjectError(`Project ${project.projectKey} has no middle tab`);
      }
      if (project.middleStatus.includes('"')) {
        throw new JiraProjectError(`buildProjectJql received an invalid middleStatus: ${project.middleStatus}`);
      }
      return `${base} AND status = "${project.middleStatus}"`;
    }
    case 'done':
      return `${base} AND statusCategory = "Done" AND updated >= -${DONE_WINDOW_DAYS}d`;
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- --testPathPattern="jira-project-jql"`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

Subject: `feat(glook-38): generate per-project JQL from named statuses`
Paths: `src/lib/jira-projects/jql.ts src/lib/__tests__/unit/jira-project-jql.test.ts`

---

### Task 4: Self-migration from `JIRA_PROJECTS_JQL`

An existing deployment must keep working with no operator action.

**Files:**
- Create: `src/lib/jira-projects/seed.ts`
- Test: `src/lib/__tests__/unit/jira-projects-seed.test.ts`

**Interfaces:**
- Consumes: `listJiraProjects`, `createJiraProject` (Task 2).
- Produces: `parseLegacyJql(jql: string): { projectKey: string; activeStatus: string } | null`, `ensureSeedProject(org: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/jira-projects-seed.test.ts`:

```ts
jest.mock('@/lib/jira-projects/service', () => ({
  listJiraProjects: jest.fn(),
  createJiraProject: jest.fn(),
}));

import { parseLegacyJql, ensureSeedProject } from '@/lib/jira-projects/seed';
import { listJiraProjects, createJiraProject } from '@/lib/jira-projects/service';

const mockList = listJiraProjects as jest.Mock;
const mockCreate = createJiraProject as jest.Mock;

let prev: string | undefined;
beforeAll(() => { prev = process.env.JIRA_PROJECTS_JQL; });
afterAll(() => {
  if (prev === undefined) delete process.env.JIRA_PROJECTS_JQL;
  else process.env.JIRA_PROJECTS_JQL = prev;
});

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue([]);
});

describe('parseLegacyJql', () => {
  it('extracts the key and status from the shipped SPS form', () => {
    expect(parseLegacyJql('project = SPS AND issuetype = Epic AND status = "In Progress"'))
      .toEqual({ projectKey: 'SPS', activeStatus: 'In Progress' });
  });

  it('handles a quoted project key', () => {
    expect(parseLegacyJql('project = "SPS" AND status = "In Progress"')!.projectKey).toBe('SPS');
  });

  it('returns null when there is no project clause', () => {
    expect(parseLegacyJql('issuetype = Epic AND status = "In Progress"')).toBeNull();
  });

  it('returns null when there is no status clause', () => {
    expect(parseLegacyJql('project = SPS AND issuetype = Epic')).toBeNull();
  });

  it('returns null for a statusCategory-only form it cannot map', () => {
    expect(parseLegacyJql('project = SPS AND statusCategory = "In Progress"')).toBeNull();
  });
});

describe('ensureSeedProject', () => {
  it('seeds one project from the legacy JQL when the table is empty', async () => {
    process.env.JIRA_PROJECTS_JQL = 'project = SPS AND issuetype = Epic AND status = "In Progress"';
    await ensureSeedProject('o');
    expect(mockCreate).toHaveBeenCalledWith('o', {
      projectKey: 'SPS',
      displayName: 'SPS',
      activeStatus: 'In Progress',
      middleStatus: 'Rollout',
      hierarchy: 'goal-initiative',
      position: 0,
    });
  });

  it('does nothing when projects already exist', async () => {
    process.env.JIRA_PROJECTS_JQL = 'project = SPS AND status = "In Progress"';
    mockList.mockResolvedValue([{ id: 'p1' }]);
    await ensureSeedProject('o');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does nothing when the env var is unset', async () => {
    delete process.env.JIRA_PROJECTS_JQL;
    await ensureSeedProject('o');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('does nothing when the JQL cannot be parsed', async () => {
    process.env.JIRA_PROJECTS_JQL = 'issuetype = Epic';
    await ensureSeedProject('o');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('swallows a create failure rather than breaking the page', async () => {
    process.env.JIRA_PROJECTS_JQL = 'project = SPS AND status = "In Progress"';
    mockCreate.mockRejectedValue(new Error('db down'));
    await expect(ensureSeedProject('o')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="jira-projects-seed"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/jira-projects/seed.ts`:

```ts
import { listJiraProjects, createJiraProject } from './service';

/**
 * Parse the legacy JIRA_PROJECTS_JQL into the fields a jira_projects row needs.
 * Returns null when either clause is missing — a half-parsed row is worse than
 * none, because the operator gets a board that silently shows the wrong epics.
 */
export function parseLegacyJql(jql: string): { projectKey: string; activeStatus: string } | null {
  const key = jql.match(/project\s*=\s*"?([A-Za-z][A-Za-z0-9_]*)"?/);
  // Deliberately anchored on `status`, not `statusCategory`: the two mean
  // different things and we cannot map a category onto a status name.
  const status = jql.match(/(?:^|\s)status\s*=\s*"([^"]+)"/);
  if (!key || !status) return null;
  return { projectKey: key[1].toUpperCase(), activeStatus: status[1] };
}

/**
 * Seed one project from the legacy env var when nothing is configured, so an
 * existing deployment keeps its board without operator action. Never throws:
 * a failure here must not take the Projects page down.
 */
export async function ensureSeedProject(org: string): Promise<void> {
  try {
    const existing = await listJiraProjects(org);
    if (existing.length > 0) return;

    const raw = process.env.JIRA_PROJECTS_JQL;
    if (!raw) return;

    const parsed = parseLegacyJql(raw);
    if (!parsed) return;

    await createJiraProject(org, {
      projectKey: parsed.projectKey,
      displayName: parsed.projectKey,
      activeStatus: parsed.activeStatus,
      middleStatus: 'Rollout',
      hierarchy: 'goal-initiative',
      position: 0,
    });
  } catch (err) {
    console.error('[jira-projects] seed failed:', err);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- --testPathPattern="jira-projects-seed"`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

Subject: `feat(glook-38): seed a project row from the legacy JIRA_PROJECTS_JQL`
Paths: `src/lib/jira-projects/seed.ts src/lib/__tests__/unit/jira-projects-seed.test.ts`

---

### Task 5: Remove provenance attribution

**Files:**
- Modify: `src/lib/projects/service.ts`
- Delete: `src/lib/__tests__/unit/projects-provenance.test.ts`
- Test: `src/lib/__tests__/unit/projects-service.test.ts` (existing, add one case)

**Interfaces:**
- Consumes: nothing.
- Produces: `fetchProjectEpics(jql: string, org: string): Promise<ProjectEpic[]>` — back to two parameters. `FetchEpicsOptions` and `provenanceTeam` cease to exist.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/__tests__/unit/projects-service.test.ts`, inside the existing `describe('fetchProjectEpics', …)`:

```ts
  it('resolves team from the assignee map only', async () => {
    const epics = [
      makeEpic({ key: 'RND-1', assigneeEmail: 'daria@smartling.com', parentKey: null, parentTypeName: null }),
      makeEpic({ key: 'RND-2', assigneeEmail: 'alex@smartling.com', parentKey: null, parentTypeName: null }),
    ];
    const mockSearchEpics = jest.fn().mockResolvedValueOnce(epics);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });

    mockDbExecute.mockResolvedValueOnce([
      [{ github_login: 'daria-gh', jira_email: 'daria@smartling.com' }], null,
    ]);
    mockDbExecute.mockResolvedValueOnce([
      [{ github_login: 'daria-gh', name: 'Research', color: '#0891B2' }], null,
    ]);

    const result = await fetchProjectEpics('project = "RND"', 'my-org');

    const byKey = Object.fromEntries(result.map(e => [e.key, e]));
    expect(byKey['RND-1'].team).toEqual({ name: 'Research', color: '#0891B2' });
    // GLOOK-38: no provenance fallback. An assignee with no user_mappings row
    // yields null, which the UI renders as an em-dash.
    expect(byKey['RND-2'].team).toBeNull();
  });
```

- [ ] **Step 2: Run it — this one passes immediately, and that is expected**

Run: `npm test -- --testPathPattern="projects-service"`
Expected: PASS.

This is deliberately **not** a red-green step, and you should not try to make it fail. Removing an optional parameter changes nothing at runtime for callers that never passed it, so there is no honest failing test for the deletion itself. The test you just added pins the behaviour that must *survive* the deletion — assignee mapping resolving one epic and yielding `null` for the other. The removal is verified two other ways: `tsc` failing at the route in Step 4 (proving the parameter is genuinely gone from the signature), and the deletion of the provenance test file (proving no test still depends on the behaviour).

- [ ] **Step 3: Remove the option**

In `src/lib/projects/service.ts`: delete the `FetchEpicsOptions` interface, change the signature back to `fetchProjectEpics(jql: string, org: string)`, and replace the team line in the map with:

```ts
    const team = epic.assigneeEmail ? teamMap.get(epic.assigneeEmail.toLowerCase()) || null : null;
```

Delete `src/lib/__tests__/unit/projects-provenance.test.ts` — every case in it asserts provenance, which no longer exists.

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern="projects-service"`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: errors in `src/app/api/projects/route.ts` (it still passes `{ provenanceTeam }`). That is expected and Task 6 fixes it. Note it in your report; do not fix the route here.

- [ ] **Step 5: Commit**

Subject: `refactor(glook-38): drop provenance attribution, assignee mapping only`
Paths: `src/lib/projects/service.ts src/lib/__tests__/unit/projects-service.test.ts`
Also `git rm src/lib/__tests__/unit/projects-provenance.test.ts`

---

### Task 6: Rewrite `/api/projects` for a single project

**Files:**
- Modify: `src/app/api/projects/route.ts` (full rewrite)
- Delete: `src/lib/projects/sources.ts`, `src/lib/__tests__/unit/project-sources.test.ts`
- Test: `src/lib/__tests__/unit/projects-api-board.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `listJiraProjects`, `getJiraProject` (Task 2); `buildProjectJql`, `DONE_WINDOW_DAYS` (Task 3); `ensureSeedProject` (Task 4); `fetchProjectEpics(jql, org)` (Task 5).
- Produces: `GET /api/projects?org=&project=&status=` → `{ epics, jiraHost, project }` where `project` is the full `JiraProject` row or `null`.

- [ ] **Step 1: Write the failing test**

Replace `src/lib/__tests__/unit/projects-api-board.test.ts` entirely:

```ts
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/projects/service', () => ({ fetchProjectEpics: jest.fn() }));
jest.mock('@/lib/jira-projects/service', () => ({
  listJiraProjects: jest.fn(),
  getJiraProject: jest.fn(),
}));
jest.mock('@/lib/jira-projects/seed', () => ({ ensureSeedProject: jest.fn() }));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/projects/route';
import { fetchProjectEpics } from '@/lib/projects/service';
import { listJiraProjects, getJiraProject } from '@/lib/jira-projects/service';
import { ensureSeedProject } from '@/lib/jira-projects/seed';
import type { JiraProject } from '@/lib/jira-projects/types';

const mockFetch = fetchProjectEpics as jest.Mock;
const mockList = listJiraProjects as jest.Mock;
const mockGet = getJiraProject as jest.Mock;
const mockSeed = ensureSeedProject as jest.Mock;

const SPS: JiraProject = {
  id: 'a', org: 'o', projectKey: 'SPS', displayName: 'Smartling Platform',
  activeStatus: 'In Progress', middleStatus: 'Rollout', hierarchy: 'goal-initiative', position: 0,
};
const RND: JiraProject = {
  id: 'b', org: 'o', projectKey: 'RND', displayName: 'LanguageAI Research',
  activeStatus: 'In Progress', middleStatus: 'Backlog', hierarchy: 'owner', position: 1,
};

const req = (qs: string) => new NextRequest(`http://localhost/api/projects${qs}`);

let prevEnabled: string | undefined;
beforeAll(() => { prevEnabled = process.env.JIRA_ENABLED; });
afterAll(() => {
  if (prevEnabled === undefined) delete process.env.JIRA_ENABLED;
  else process.env.JIRA_ENABLED = prevEnabled;
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JIRA_ENABLED = 'true';
  mockFetch.mockResolvedValue([]);
  mockList.mockResolvedValue([SPS, RND]);
  mockGet.mockResolvedValue(SPS);
  mockSeed.mockResolvedValue(undefined);
});

describe('GET /api/projects', () => {
  it('400s without an org', async () => {
    expect((await GET(req(''))).status).toBe(400);
  });

  it('404s when Jira is disabled', async () => {
    process.env.JIRA_ENABLED = 'false';
    expect((await GET(req('?org=o'))).status).toBe(404);
  });

  it('runs the self-migration seed before reading the list', async () => {
    await GET(req('?org=o'));
    expect(mockSeed).toHaveBeenCalledWith('o');
  });

  it('404s when no projects are configured', async () => {
    mockList.mockResolvedValue([]);
    const res = await GET(req('?org=o'));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/no jira projects/i);
  });

  it('defaults to the lowest-position project when none is named', async () => {
    await GET(req('?org=o'));
    expect(mockFetch).toHaveBeenCalledWith(
      'project = "SPS" AND issuetype = Epic AND status = "In Progress"', 'o',
    );
  });

  it('404s for an unknown project key', async () => {
    mockGet.mockResolvedValue(null);
    expect((await GET(req('?org=o&project=NOPE'))).status).toBe(404);
  });

  it('builds the named project active tab', async () => {
    mockGet.mockResolvedValue(RND);
    await GET(req('?org=o&project=RND&status=active'));
    expect(mockFetch).toHaveBeenCalledWith(
      'project = "RND" AND issuetype = Epic AND status = "In Progress"', 'o',
    );
  });

  it('builds the middle tab from the project middle status', async () => {
    mockGet.mockResolvedValue(RND);
    await GET(req('?org=o&project=RND&status=middle'));
    expect(mockFetch).toHaveBeenCalledWith(
      'project = "RND" AND issuetype = Epic AND status = "Backlog"', 'o',
    );
  });

  it('builds the done tab identically for every project', async () => {
    await GET(req('?org=o&project=SPS&status=done'));
    expect(mockFetch).toHaveBeenCalledWith(
      'project = "SPS" AND issuetype = Epic AND statusCategory = "Done" AND updated >= -30d', 'o',
    );
  });

  it('returns an empty list rather than 500 when the middle tab is not configured', async () => {
    mockGet.mockResolvedValue({ ...RND, middleStatus: null });
    const res = await GET(req('?org=o&project=RND&status=middle'));
    expect(res.status).toBe(200);
    expect((await res.json()).epics).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns the project row alongside the epics', async () => {
    mockGet.mockResolvedValue(RND);
    const body = await (await GET(req('?org=o&project=RND'))).json();
    expect(body.project.projectKey).toBe('RND');
    expect(body.project.hierarchy).toBe('owner');
  });

  it('calls fetchProjectEpics with exactly two arguments', async () => {
    await GET(req('?org=o'));
    expect(mockFetch.mock.calls[0]).toHaveLength(2);
  });

  it('500s with the error message when the fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error('Jira exploded'));
    const res = await GET(req('?org=o'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Jira exploded');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="projects-api-board"`
Expected: FAIL — the route still resolves sources and passes a third argument.

- [ ] **Step 3: Rewrite the route**

Replace `src/app/api/projects/route.ts` entirely:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchProjectEpics } from '@/lib/projects/service';
import { listJiraProjects, getJiraProject } from '@/lib/jira-projects/service';
import { ensureSeedProject } from '@/lib/jira-projects/seed';
import { buildProjectJql } from '@/lib/jira-projects/jql';
import type { BoardTabKind } from '@/lib/jira-projects/types';
import { withRequestLog } from '@/lib/logger';

const TABS: BoardTabKind[] = ['active', 'middle', 'done'];

async function getHandler(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  if (!org) {
    return NextResponse.json({ error: 'org query parameter is required' }, { status: 400 });
  }

  if (process.env.JIRA_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Jira integration is not enabled' }, { status: 404 });
  }

  const statusParam = req.nextUrl.searchParams.get('status');
  const tab: BoardTabKind = TABS.includes(statusParam as BoardTabKind)
    ? (statusParam as BoardTabKind)
    : 'active';
  const projectKey = req.nextUrl.searchParams.get('project');

  try {
    // Migrates an existing deployment on first request; no-op thereafter.
    await ensureSeedProject(org);

    const configured = await listJiraProjects(org);
    if (configured.length === 0) {
      return NextResponse.json(
        { error: 'No Jira projects configured. Add one in Settings → Projects.' },
        { status: 404 },
      );
    }

    const project = projectKey
      ? await getJiraProject(org, projectKey)
      : configured[0];

    if (!project) {
      return NextResponse.json({ error: `Unknown Jira project: ${projectKey}` }, { status: 404 });
    }

    const jiraHost = process.env.JIRA_HOST || null;

    // A project with no middle status has a two-tab board; asking for its
    // middle tab is a legal URL that simply has nothing behind it.
    if (tab === 'middle' && !project.middleStatus) {
      return NextResponse.json({ epics: [], jiraHost, project });
    }

    const epics = await fetchProjectEpics(buildProjectJql(project, tab), org);
    return NextResponse.json({ epics, jiraHost, project });
  } catch (err) {
    console.error('[projects] Error fetching epics:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch projects' },
      { status: 500 },
    );
  }
}

export const GET = withRequestLog(getHandler);
```

Delete `src/lib/projects/sources.ts` and `src/lib/__tests__/unit/project-sources.test.ts`.

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern="projects-api-board|logger-enforcement"`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: errors remain only in files Tasks 7-9 will touch (`board-layout.ts`, `projects-content.tsx`, `progress-ring.tsx`, `settings/page.tsx`). No errors in `src/lib/`.

- [ ] **Step 5: Commit**

Subject: `feat(glook-38): serve one Jira project per request from the projects API`
Paths: `src/app/api/projects/route.ts src/lib/__tests__/unit/projects-api-board.test.ts`
Also `git rm src/lib/projects/sources.ts src/lib/__tests__/unit/project-sources.test.ts`

---

### Task 7: `/api/jira-projects` CRUD

**Files:**
- Create: `src/app/api/jira-projects/route.ts`, `src/app/api/jira-projects/[id]/route.ts`
- Test: `src/lib/__tests__/unit/jira-projects-api.test.ts`

**Interfaces:**
- Consumes: the Task 2 service and its error classes; `JiraProjectError` (Task 1).
- Produces: `GET /api/jira-projects?org=` → `JiraProject[]`; `POST` → the created row; `PUT /api/jira-projects/[id]` → `{ updated: true }`; `DELETE` → `{ deleted: true }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/jira-projects-api.test.ts`:

```ts
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/jira-projects/service', () => {
  const actual = jest.requireActual('@/lib/jira-projects/service');
  return {
    ...actual,
    listJiraProjects: jest.fn(),
    createJiraProject: jest.fn(),
    updateJiraProject: jest.fn(),
    deleteJiraProject: jest.fn(),
  };
});

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/jira-projects/route';
import { PUT, DELETE } from '@/app/api/jira-projects/[id]/route';
import {
  listJiraProjects, createJiraProject, updateJiraProject, deleteJiraProject,
  JiraProjectDuplicateError, JiraProjectNotFoundError,
} from '@/lib/jira-projects/service';
import { JiraProjectError } from '@/lib/jira-projects/types';

const mockList = listJiraProjects as jest.Mock;
const mockCreate = createJiraProject as jest.Mock;
const mockUpdate = updateJiraProject as jest.Mock;
const mockDelete = deleteJiraProject as jest.Mock;

const post = (body: unknown) => new NextRequest('http://localhost/api/jira-projects', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});
const put = (body: unknown) => new NextRequest('http://localhost/api/jira-projects/p1', {
  method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
});
const ctx = { params: Promise.resolve({ id: 'p1' }) };

beforeEach(() => jest.clearAllMocks());

describe('GET /api/jira-projects', () => {
  it('400s without an org', async () => {
    expect((await GET(new NextRequest('http://localhost/api/jira-projects'))).status).toBe(400);
  });

  it('returns the configured list', async () => {
    mockList.mockResolvedValue([{ projectKey: 'SPS' }]);
    const res = await GET(new NextRequest('http://localhost/api/jira-projects?org=o'));
    expect((await res.json())[0].projectKey).toBe('SPS');
  });
});

describe('POST /api/jira-projects', () => {
  it('creates and returns the row', async () => {
    mockCreate.mockResolvedValue({ id: 'p1', projectKey: 'RND' });
    const res = await POST(post({ org: 'o', projectKey: 'RND', activeStatus: 'In Progress' }));
    expect(res.status).toBe(200);
    expect((await res.json()).projectKey).toBe('RND');
  });

  it('400s on a validation failure, carrying the message', async () => {
    mockCreate.mockRejectedValue(new JiraProjectError('projectKey is not a valid Jira project key: b d'));
    const res = await POST(post({ org: 'o', projectKey: 'b d', activeStatus: 'x' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/projectKey/);
  });

  it('409s on a duplicate key', async () => {
    mockCreate.mockRejectedValue(new JiraProjectDuplicateError('RND'));
    expect((await POST(post({ org: 'o', projectKey: 'RND', activeStatus: 'x' }))).status).toBe(409);
  });

  it('400s without an org', async () => {
    expect((await POST(post({ projectKey: 'RND', activeStatus: 'x' }))).status).toBe(400);
  });
});

describe('PUT /api/jira-projects/[id]', () => {
  it('updates', async () => {
    mockUpdate.mockResolvedValue(undefined);
    const res = await PUT(put({ projectKey: 'RND', activeStatus: 'In Progress' }), ctx);
    expect((await res.json())).toEqual({ updated: true });
  });

  it('400s on a validation failure', async () => {
    mockUpdate.mockRejectedValue(new JiraProjectError('activeStatus must not contain a double quote'));
    expect((await PUT(put({ projectKey: 'RND', activeStatus: 'a"b' }), ctx)).status).toBe(400);
  });

  it('404s when the row is gone', async () => {
    mockUpdate.mockRejectedValue(new JiraProjectNotFoundError('p1'));
    expect((await PUT(put({ projectKey: 'RND', activeStatus: 'x' }), ctx)).status).toBe(404);
  });
});

describe('DELETE /api/jira-projects/[id]', () => {
  it('deletes', async () => {
    mockDelete.mockResolvedValue(undefined);
    const res = await DELETE(new NextRequest('http://localhost/api/jira-projects/p1', { method: 'DELETE' }), ctx);
    expect((await res.json())).toEqual({ deleted: true });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="jira-projects-api"`
Expected: FAIL — routes do not exist.

- [ ] **Step 3: Implement both routes**

Look at `src/app/api/teams/route.ts` first and mirror its structure exactly — the `requireAdmin` call shape, how it reads the body, and how it returns errors. Then create `src/app/api/jira-projects/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { listJiraProjects, createJiraProject, JiraProjectDuplicateError } from '@/lib/jira-projects/service';
import { JiraProjectError } from '@/lib/jira-projects/types';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  if (!org) return NextResponse.json({ error: 'org query parameter is required' }, { status: 400 });
  return NextResponse.json(await listJiraProjects(org));
}

async function postHandler(req: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const body = await req.json();
  const { org, ...input } = body ?? {};
  if (!org) return NextResponse.json({ error: 'org is required' }, { status: 400 });

  try {
    return NextResponse.json(await createJiraProject(org, input));
  } catch (err) {
    if (err instanceof JiraProjectError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof JiraProjectDuplicateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

export const GET = withRequestLog(getHandler);
export const POST = withRequestLog(postHandler);
```

Create `src/app/api/jira-projects/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import {
  updateJiraProject, deleteJiraProject,
  JiraProjectNotFoundError, JiraProjectDuplicateError,
} from '@/lib/jira-projects/service';
import { JiraProjectError } from '@/lib/jira-projects/types';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function putHandler(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await ctx.params;
  const body = await req.json();

  try {
    await updateJiraProject(id, body);
    return NextResponse.json({ updated: true });
  } catch (err) {
    if (err instanceof JiraProjectNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof JiraProjectError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof JiraProjectDuplicateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

async function deleteHandler(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await ctx.params;
  await deleteJiraProject(id);
  return NextResponse.json({ deleted: true });
}

export const PUT = withRequestLog(putHandler);
export const DELETE = withRequestLog(deleteHandler);
```

> If `requireAdmin`'s real signature or return shape differs from what is shown,
> follow the real one from `src/app/api/teams/route.ts` and adjust the test's
> mock to match. Say so in your report.

- [ ] **Step 4: Run tests**

Run: `npm test -- --testPathPattern="jira-projects-api|logger-enforcement"`
Expected: PASS

- [ ] **Step 5: Commit**

Subject: `feat(glook-38): add jira-projects CRUD API`
Paths: `src/app/api/jira-projects/route.ts "src/app/api/jira-projects/[id]/route.ts" src/lib/__tests__/unit/jira-projects-api.test.ts`

---

### Task 8: Retype the layout module and delete the ring mode

**Files:**
- Modify: `src/app/projects/board-layout.ts`, `src/app/projects/progress-ring.tsx`
- Test: `src/lib/__tests__/unit/projects-board-layout.test.ts` (update), `src/lib/__tests__/unit/progress-ring.test.tsx` (update)

**Interfaces:**
- Consumes: `JiraProject`, `BoardHierarchy`, `BoardTabKind` (Task 1); `DONE_WINDOW_DAYS` (Task 3).
- Produces: `visibleTabs(project: JiraProject | null): BoardTabKind[]`, `tabLabel(project, tab): string`, `columnLayout(project: JiraProject | null): ColumnLayout`, `computeSpans` unchanged. `ProgressRing` no longer accepts `mode`.

- [ ] **Step 1: Update the layout test**

In `src/lib/__tests__/unit/projects-board-layout.test.ts`, replace the `visibleTabs` and `columnLayout` describes:

```ts
import { visibleTabs, tabLabel, columnLayout, computeSpans } from '@/app/projects/board-layout';
import type { JiraProject } from '@/lib/jira-projects/types';

const SPS: JiraProject = {
  id: 'a', org: 'o', projectKey: 'SPS', displayName: 'Smartling Platform',
  activeStatus: 'In Progress', middleStatus: 'Rollout', hierarchy: 'goal-initiative', position: 0,
};
const RND: JiraProject = { ...SPS, id: 'b', projectKey: 'RND', middleStatus: 'Backlog', hierarchy: 'owner' };

describe('visibleTabs', () => {
  it('gives a three-tab board when the project has a middle status', () => {
    expect(visibleTabs(SPS)).toEqual(['active', 'middle', 'done']);
  });

  it('gives a two-tab board when it does not', () => {
    expect(visibleTabs({ ...SPS, middleStatus: null })).toEqual(['active', 'done']);
  });

  it('falls back to a two-tab board with no project', () => {
    expect(visibleTabs(null)).toEqual(['active', 'done']);
  });
});

describe('tabLabel', () => {
  it('labels the active and middle tabs with the project status names', () => {
    expect(tabLabel(SPS, 'active')).toBe('In Progress');
    expect(tabLabel(SPS, 'middle')).toBe('Rollout');
    expect(tabLabel(RND, 'middle')).toBe('Backlog');
  });

  it('labels done with the fixed window', () => {
    expect(tabLabel(SPS, 'done')).toBe('Done (30d)');
  });

  it('is safe with no project', () => {
    expect(tabLabel(null, 'active')).toBe('In Progress');
  });
});

describe('columnLayout', () => {
  it('gives seven columns for goal-initiative, summing to 100', () => {
    const l = columnLayout(SPS);
    expect(l.headers).toEqual(['Business Goal', 'Initiative', '', 'Epic', 'Due', 'Lead', 'Team']);
    expect(l.widths).toHaveLength(l.headers.length);
    expect(l.widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(l.showHierarchy).toBe(true);
    expect(l.showOwnerColumn).toBe(false);
  });

  it('gives six columns for owner, summing to 100', () => {
    const l = columnLayout(RND);
    expect(l.headers).toEqual(['Owner', '', 'Epic', 'Due', 'Status', 'Team']);
    expect(l.widths).toHaveLength(l.headers.length);
    expect(l.widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(l.showHierarchy).toBe(false);
    expect(l.showOwnerColumn).toBe(true);
  });

  it('defaults to the seven-column layout with no project', () => {
    expect(columnLayout(null).headers).toHaveLength(7);
  });
});
```

Keep the existing `computeSpans` describes exactly as they are — that function is unchanged.

> Note the header rename: `Researcher` becomes `Owner`, because the column is no
> longer research-specific.

- [ ] **Step 2: Update the ring test**

In `src/lib/__tests__/unit/progress-ring.test.tsx`, delete the whole `describe('ProgressRing jira mode', …)` block, and remove `mode="jira"` from the two sizing tests that pass it. Add:

```tsx
describe('ProgressRing has no mode', () => {
  it('always draws four circles — two tracks and two arcs', () => {
    const { container } = render(
      <ProgressRing stats={stats()} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(4);
    expect(container.querySelector('circle[stroke="#10B981"]')).not.toBeNull();
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npm test -- --testPathPattern="projects-board-layout|progress-ring"`
Expected: FAIL — `tabLabel` missing, `visibleTabs` takes a `BoardConfig`.

- [ ] **Step 4: Implement**

Replace the top of `src/app/projects/board-layout.ts` down to and including `columnLayout`:

```ts
import type { JiraProject, BoardHierarchy, BoardTabKind } from '@/lib/jira-projects/types';
import { DONE_WINDOW_DAYS } from '@/lib/jira-projects/jql';

/** Every tab kind the URL may legally carry. */
export const ALL_TABS: BoardTabKind[] = ['active', 'middle', 'done'];

/**
 * The tabs a given project shows. A project with no middle status has a
 * two-tab board — there is no third status worth a permanently empty tab.
 */
export function visibleTabs(project: JiraProject | null): BoardTabKind[] {
  return project?.middleStatus
    ? ['active', 'middle', 'done']
    : ['active', 'done'];
}

/** Tabs are labelled with the project's own status names, so a board reads in
 *  the vocabulary of its Jira workflow rather than SPS's. */
export function tabLabel(project: JiraProject | null, tab: BoardTabKind): string {
  if (tab === 'done') return `Done (${DONE_WINDOW_DAYS}d)`;
  if (tab === 'middle') return project?.middleStatus || 'Middle';
  return project?.activeStatus || 'In Progress';
}

export interface ColumnLayout {
  headers: string[];
  widths: number[];
  showHierarchy: boolean;
  showOwnerColumn: boolean;
}

export function columnLayout(project: JiraProject | null): ColumnLayout {
  if (project?.hierarchy === 'owner') {
    return {
      headers: ['Owner', '', 'Epic', 'Due', 'Status', 'Team'],
      widths: [18, 4, 43, 11, 11, 13],
      showHierarchy: false,
      showOwnerColumn: true,
    };
  }
  return {
    headers: ['Business Goal', 'Initiative', '', 'Epic', 'Due', 'Lead', 'Team'],
    widths: [14, 14, 4, 34, 10, 13, 11],
    showHierarchy: true,
    showOwnerColumn: false,
  };
}
```

Leave `RowSpan`, `SpannableRow` and `computeSpans` untouched, but change the `computeSpans` signature's import so it takes `BoardHierarchy` from the new module.

In `src/app/projects/progress-ring.tsx`: remove the `BoardRingMode` import, the `mode` prop from `ProgressRingProps`, the `mode = 'commits'` default, the `jiraOnly` local, and every `jiraOnly` / `!jiraOnly` conditional — restoring the unconditional two-arc render, the `devCount` centre, the AI-speed bolt guarded only by its threshold, and the full tooltip.

- [ ] **Step 5: Run tests**

Run: `npm test -- --testPathPattern="projects-board-layout|progress-ring"`
Expected: PASS

- [ ] **Step 6: Commit**

Subject: `refactor(glook-38): drive layout from JiraProject, remove the jira ring mode`
Paths: `src/app/projects/board-layout.ts src/app/projects/progress-ring.tsx src/lib/__tests__/unit/projects-board-layout.test.ts src/lib/__tests__/unit/progress-ring.test.tsx`

---

### Task 9: Project selector on the board

**Files:**
- Modify: `src/app/projects/projects-content.tsx`

**Interfaces:**
- Consumes: `visibleTabs`, `tabLabel`, `columnLayout`, `computeSpans`, `ALL_TABS` (Task 8); `JiraProject`, `BoardTabKind` (Task 1); `GET /api/projects` returning `{ epics, jiraHost, project }` (Task 6); `GET /api/jira-projects?org=` (Task 7).

The file is 1210 lines. **Locate every edit by the quoted code, not by line number** — earlier edits shift everything below them.

- [ ] **Step 1: Swap the imports and types**

Replace:

```tsx
import { ALL_TABS, visibleTabs, columnLayout, computeSpans } from './board-layout';
import type { BoardConfig, BoardTab } from '@/lib/teams/board-config';
```

with:

```tsx
import { ALL_TABS, visibleTabs, tabLabel, columnLayout, computeSpans } from './board-layout';
import type { JiraProject, BoardTabKind } from '@/lib/jira-projects/types';
```

Replace `type StatusTab = BoardTab;` with `type StatusTab = BoardTabKind;`.

**Also change the `activeTab` URL state's default**, which is currently the string `'In Progress'` — no longer one of the legal values. `ALL_TABS` is now `['active', 'middle', 'done']`, so:

```tsx
  const [activeTab, setActiveTab] = useUrlState<StatusTab>({
    key: 'status',
    type: 'enum',
    values: ALL_TABS,
    default: 'active',
    history: 'push',
  });
```

Leaving the old default in place would make every legacy `?status=In Progress` bookmark resolve to an invalid tab. With this change they fall back to `active`, which is the right landing.

- [ ] **Step 2: Replace the board-config state with project state**

Replace:

```tsx
  // Non-null only when the filter names exactly one configured team; a mixed
  // board has no single config to honour and keeps the historical layout.
  const [boardConfig, setBoardConfig] = useState<BoardConfig | null>(null);
```

with:

```tsx
  // The project row the board is currently showing. Drives the tab set, the
  // tab labels and the column layout.
  const [project, setProject] = useState<JiraProject | null>(null);
  // The configured list, for the selector.
  const [projectList, setProjectList] = useState<JiraProject[]>([]);
```

Add a `filterProject` URL state next to the other `useUrlState` calls, immediately after the `org` one:

```tsx
  const [selectedProject, setSelectedProject] = useUrlState<string>({
    key: 'project',
    type: 'string',
    default: '',
    history: 'replace',
  });
```

Add an effect to load the list, next to the other data effects:

```tsx
  useEffect(() => {
    if (!org) return;
    fetch(`/api/jira-projects?org=${encodeURIComponent(org)}`)
      .then(r => r.json())
      .then((list: JiraProject[]) => setProjectList(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [org]);
```

- [ ] **Step 3: Rekey the cache and the fetch on project instead of team**

Replace the `cacheKey` / `tabUrl` block:

```tsx
  const cacheKey = `${activeTab}|${selectedProject}`;
  const tabUrl = org
    ? `/api/projects?org=${encodeURIComponent(org)}&status=${encodeURIComponent(activeTab)}`
      + (selectedProject ? `&project=${encodeURIComponent(selectedProject)}` : '')
    : null;
```

In the populate effect, replace `setBoardConfig(tabData.boardConfig ?? null);` with `setProject(tabData.project ?? null);`.

In the preload effect, replace the ref key and the loop:

```tsx
    const key = `${org}|${selectedProject}`;
    if (preloadedKeyRef.current === key) return;
    preloadedKeyRef.current = key;
    const projectParam = selectedProject ? `&project=${encodeURIComponent(selectedProject)}` : '';
    for (const tab of visibleTabs(tabData.project ?? null).filter(t => t !== activeTab)) {
      preload(`/api/projects?org=${encodeURIComponent(org)}&status=${encodeURIComponent(tab)}${projectParam}`, fetcher);
    }
```

and its dependency array from `[org, filterTeam, tabData]` to `[org, selectedProject, tabData]`.

- [ ] **Step 4: Point the tab machinery at the project**

Replace `const tabs = useMemo(() => visibleTabs(boardConfig), [boardConfig]);` with `const tabs = useMemo(() => visibleTabs(project), [project]);`.

In the tab-fallback effect, replace both `visibleTabs(...)` arguments: the `tabError` branch keeps `visibleTabs(null)`, and the other becomes `visibleTabs(tabData.project ?? null)`. Replace both `setActiveTab('In Progress')` calls with `setActiveTab('active')`.

Replace the three layout memos' dependencies:

```tsx
  const layout = useMemo(() => columnLayout(project), [project]);

  const orderedEpics = useMemo(() => {
    if (project?.hierarchy !== 'owner') return filteredEpics;
    return [...filteredEpics].sort((a, b) => {
      const an = a.assignee || '￿';
      const bn = b.assignee || '￿';
      if (an !== bn) return an.localeCompare(bn);
      return a.summary.localeCompare(b.summary);
    });
  }, [filteredEpics, project]);

  const spans = useMemo(
    () => computeSpans(orderedEpics, project?.hierarchy ?? 'goal-initiative'),
    [orderedEpics, project],
  );
```

- [ ] **Step 5: Add the selector and relabel the tabs**

Immediately before the `<select value={filterGoal}` element, insert:

```tsx
            <select
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent cursor-pointer"
            >
              {projectList.map(p => (
                <option key={p.projectKey} value={p.projectKey}>{p.displayName}</option>
              ))}
            </select>
```

Replace the tab button label expression:

```tsx
                {tabLabel(project, tab)}
```

Replace the two empty-state strings that reference the old config:

```tsx
            <div className="text-gray-500 py-8">No epics on the {tabLabel(project, activeTab)} tab.</div>
```

- [ ] **Step 6: Remove the ring mode and ungate untracked work**

Delete the `mode={boardConfig?.ringMode}` line from the `<ProgressRing />` call.

The untracked block now keys off the project rather than a board config. Replace the three `!boardConfig` guards:
- the rows IIFE guard becomes `{isLegacyProject && activeTab === 'active' && (() => {`
- the footer count clause becomes `{isLegacyProject && untrackedTeams.length > 0 && …}`
- the button guard becomes `{isLegacyProject && activeTab === 'active' && untrackedTeams.length === 0 && !untrackedLoading && (`

and add this memo next to the other derived values:

```tsx
  // Untracked work is computed against JIRA_PROJECTS_JQL, so it is only
  // meaningful on the project that variable names. Everywhere else it would be
  // showing one project's leftovers on another project's board.
  const isLegacyProject = useMemo(
    () => !!project && projectList.length > 0 && project.projectKey === projectList[0].projectKey,
    [project, projectList],
  );
```

- [ ] **Step 7: Typecheck, test and build**

Run: `npx tsc --noEmit`
Expected: no errors outside the known untracked debris and `src/app/settings/page.tsx` (Task 10).

Run: `npm test`
Expected: PASS

Run: `rm -rf .next && npm run build`
Expected: `✓ Compiled successfully`

- [ ] **Step 8: Commit**

Subject: `feat(glook-38): select the board's Jira project from a dropdown`
Paths: `src/app/projects/projects-content.tsx`

---

### Task 10: Settings → Projects, and delete the dead board config

**Files:**
- Create: `src/app/settings/projects-tab.tsx`
- Modify: `src/app/settings/page.tsx`
- Delete: `src/app/settings/board-config-form.ts`, `src/lib/teams/board-config.ts`, `src/lib/__tests__/unit/teams-board-config-form.test.tsx`, `src/lib/__tests__/unit/board-config.test.ts`
- Test: `src/lib/__tests__/unit/settings-projects-tab.test.tsx`

**Interfaces:**
- Consumes: `/api/jira-projects` (Task 7); `JiraProject` (Task 1).
- Produces: `ProjectsTab` default export from `src/app/settings/projects-tab.tsx`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/settings-projects-tab.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProjectsTab from '@/app/settings/projects-tab';

const list = [
  { id: 'a', org: 'o', projectKey: 'SPS', displayName: 'Smartling Platform', activeStatus: 'In Progress', middleStatus: 'Rollout', hierarchy: 'goal-initiative', position: 0 },
  { id: 'b', org: 'o', projectKey: 'RND', displayName: 'LanguageAI Research', activeStatus: 'In Progress', middleStatus: 'Backlog', hierarchy: 'owner', position: 1 },
];

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => list }) as any;
});

describe('ProjectsTab', () => {
  it('lists the configured projects', async () => {
    render(<ProjectsTab org="o" />);
    expect(await screen.findByText('Smartling Platform')).toBeTruthy();
    expect(screen.getByText('LanguageAI Research')).toBeTruthy();
  });

  it('shows each project key and its tab statuses', async () => {
    render(<ProjectsTab org="o" />);
    expect(await screen.findByText('RND')).toBeTruthy();
    expect(screen.getAllByText('Backlog').length).toBeGreaterThan(0);
  });

  it('loads from the jira-projects API scoped to the org', async () => {
    render(<ProjectsTab org="o" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('/api/jira-projects?org=o');
  });

  it('opens an empty form when adding a project', async () => {
    render(<ProjectsTab org="o" />);
    fireEvent.click(await screen.findByText(/add project/i));
    const key = screen.getByLabelText(/project key/i) as HTMLInputElement;
    expect(key.value).toBe('');
  });

  it('surfaces a 400 message inline instead of throwing', async () => {
    render(<ProjectsTab org="o" />);
    fireEvent.click(await screen.findByText(/add project/i));
    fireEvent.change(screen.getByLabelText(/project key/i), { target: { value: 'bad key' } });
    fireEvent.change(screen.getByLabelText(/active status/i), { target: { value: 'In Progress' } });
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false, status: 400, json: async () => ({ error: 'projectKey is not a valid Jira project key: bad key' }),
    });
    fireEvent.click(screen.getByText(/^save$/i));
    expect(await screen.findByText(/not a valid Jira project key/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="settings-projects-tab"`
Expected: FAIL — module not found.

- [ ] **Step 3: Build the tab**

Create `src/app/settings/projects-tab.tsx`:

```tsx
'use client';

import { useState, useEffect } from 'react';
import type { JiraProject, BoardHierarchy } from '@/lib/jira-projects/types';

const HIERARCHY_LABEL: Record<BoardHierarchy, string> = {
  'goal-initiative': 'Goal and initiative',
  owner: 'Person',
};

export default function ProjectsTab({ org }: { org: string }) {
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<JiraProject | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [active, setActive] = useState('');
  const [middle, setMiddle] = useState('');
  const [hierarchy, setHierarchy] = useState<BoardHierarchy>('goal-initiative');

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [org]);

  function load() {
    fetch(`/api/jira-projects?org=${encodeURIComponent(org)}`)
      .then(r => r.json())
      .then((list: JiraProject[]) => setProjects(Array.isArray(list) ? list : []))
      .catch(() => {});
  }

  function reset() {
    setKey(''); setName(''); setActive(''); setMiddle('');
    setHierarchy('goal-initiative'); setEditing(null); setError(null);
  }

  function openNew() { reset(); setShowForm(true); }

  function openEdit(p: JiraProject) {
    setEditing(p);
    setKey(p.projectKey);
    setName(p.displayName);
    setActive(p.activeStatus);
    setMiddle(p.middleStatus ?? '');
    setHierarchy(p.hierarchy);
    setError(null);
    setShowForm(true);
  }

  async function save() {
    setError(null);
    const fields = {
      projectKey: key,
      displayName: name,
      activeStatus: active,
      middleStatus: middle.trim() === '' ? null : middle,
      hierarchy,
      position: editing ? editing.position : projects.length,
    };
    const url = editing ? `/api/jira-projects/${editing.id}` : '/api/jira-projects';
    const method = editing ? 'PUT' : 'POST';
    const body = editing ? fields : { org, ...fields };
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || 'Failed to save project');
        return;
      }
      load();
      setShowForm(false);
      reset();
    } catch {
      setError('Network error');
    }
  }

  async function del(id: string) {
    await fetch(`/api/jira-projects/${id}`, { method: 'DELETE' }).catch(() => {});
    setDeletingId(null);
    if (editing?.id === id) { setShowForm(false); reset(); }
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-400">
          Jira projects available on the Projects board. Each one names the statuses its tabs show.
        </p>
        <button
          onClick={openNew}
          className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
        >
          Add project
        </button>
      </div>

      <div className="rounded-lg border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-900/50 text-gray-400 text-left text-xs uppercase tracking-wider">
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 font-medium">Key</th>
              <th className="px-4 py-3 font-medium">Active tab</th>
              <th className="px-4 py-3 font-medium">Middle tab</th>
              <th className="px-4 py-3 font-medium">Group by</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {projects.map(p => (
              <tr key={p.id} className="border-b border-gray-800/50">
                <td className="px-4 py-3 text-white">{p.displayName}</td>
                <td className="px-4 py-3 text-gray-400 font-mono text-xs">{p.projectKey}</td>
                <td className="px-4 py-3 text-gray-300">{p.activeStatus}</td>
                <td className="px-4 py-3 text-gray-300">
                  {p.middleStatus ?? <span className="text-gray-600">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-300">{HIERARCHY_LABEL[p.hierarchy]}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(p)} className="text-xs text-gray-500 hover:text-gray-300">
                    Edit
                  </button>
                </td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-gray-500 text-sm">
                  No Jira projects configured yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="mt-6 rounded-lg border border-gray-800 p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="jp-key" className="block text-xs text-gray-400 mb-1">Project key</label>
              <input
                id="jp-key" type="text" value={key} onChange={e => setKey(e.target.value)}
                placeholder="RND"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label htmlFor="jp-name" className="block text-xs text-gray-400 mb-1">Display name</label>
              <input
                id="jp-name" type="text" value={name} onChange={e => setName(e.target.value)}
                placeholder="LanguageAI Research"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label htmlFor="jp-active" className="block text-xs text-gray-400 mb-1">Active status</label>
              <input
                id="jp-active" type="text" value={active} onChange={e => setActive(e.target.value)}
                placeholder="In Progress"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent"
              />
              <p className="text-[11px] text-gray-600 mt-1">
                The exact Jira status name, not a status category.
              </p>
            </div>
            <div>
              <label htmlFor="jp-middle" className="block text-xs text-gray-400 mb-1">Middle status</label>
              <input
                id="jp-middle" type="text" value={middle} onChange={e => setMiddle(e.target.value)}
                placeholder="Rollout"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent"
              />
              <p className="text-[11px] text-gray-600 mt-1">Leave blank for a two-tab board.</p>
            </div>
            <div>
              <label htmlFor="jp-hierarchy" className="block text-xs text-gray-400 mb-1">Group rows by</label>
              <select
                id="jp-hierarchy" value={hierarchy}
                onChange={e => setHierarchy(e.target.value as BoardHierarchy)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent cursor-pointer"
              >
                <option value="goal-initiative">Goal and initiative</option>
                <option value="owner">Person</option>
              </select>
            </div>
          </div>

          {error && <div className="mt-3 text-xs text-red-400">{error}</div>}

          <div className="flex gap-3 mt-5">
            <button
              onClick={save}
              className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg text-sm font-medium transition-colors"
            >
              Save
            </button>
            <button
              onClick={() => { setShowForm(false); reset(); }}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            {editing && deletingId !== editing.id && (
              <button
                onClick={() => setDeletingId(editing.id)}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                Delete
              </button>
            )}
          </div>

          {editing && deletingId === editing.id && (
            <div className="mt-3 px-3 py-2.5 rounded-lg bg-red-950 border border-red-800">
              <p className="text-red-300 text-xs mb-2">Remove this project from the board?</p>
              <div className="flex gap-2">
                <button onClick={() => del(editing.id)} className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded">Delete</button>
                <button onClick={() => setDeletingId(null)} className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the tab into the settings page**

In `src/app/settings/page.tsx`, five edits:

1. Add `'projects'` to the `Tab` union on line 9.
2. Add `'projects'` to the `adminTabs` array.
3. Add `'projects'` to the hash-whitelist array.
4. Add `{ id: 'projects' as Tab, label: 'Projects', icon: '📋', adminOnly: true },` to the tab-object array, immediately after the `teams` entry.
5. Add `{activeTab === 'projects' && selectedOrg && <ProjectsTab org={selectedOrg} />}` to the mount list, and `import ProjectsTab from './projects-tab';` at the top.

- [ ] **Step 5: Delete the superseded board config**

From `src/app/settings/page.tsx`:
- Remove `import { buildBoardConfigPayload } from './board-config-form';`.
- Remove the seven board-related `useState` declarations (`formProjectKeys`, `formHierarchy`, `formMiddleTab`, `formRingMode`, `formDoneWindow`, `formIncludeRejected`, `boardError`).
- Remove the seven matching lines from `resetForm`.
- Remove the `const bc = team.board_config;` line and the six `setForm*` lines that follow it in `openEdit`.
- In `save`, remove the `setBoardError(null)` line, the whole `buildBoardConfigPayload({...})` call, and `boardConfig` from the request body; restore the 400 branch to `alert(d.error || 'Failed')` like the other errors.
- Delete the entire Board section JSX — the `{/* Board */}` comment through its closing `</div>`, which sits between the members block and the `{/* Actions */}` comment.

Then delete these files:
- `src/app/settings/board-config-form.ts`
- `src/lib/teams/board-config.ts`
- `src/lib/__tests__/unit/teams-board-config-form.test.tsx`
- `src/lib/__tests__/unit/board-config.test.ts`

Also remove the `board-config` re-exports from `src/lib/teams/index.ts`.

- [ ] **Step 6: Typecheck, test, build**

Run: `npx tsc --noEmit`
Expected: only the 6 known untracked-debris errors. Nothing should still import `@/lib/teams/board-config` — if something does, the import is the bug, not the deletion.

Run: `npm test`
Expected: PASS

Run: `rm -rf .next && npm run build`
Expected: `✓ Compiled successfully`. This is the step that catches a stray export from `page.tsx`.

- [ ] **Step 7: Commit**

Subject: `feat(glook-38): configure Jira projects from Settings, delete the team board config`
Paths: `src/app/settings/projects-tab.tsx src/app/settings/page.tsx src/lib/teams/index.ts src/lib/__tests__/unit/settings-projects-tab.test.tsx`
Also `git rm src/app/settings/board-config-form.ts src/lib/teams/board-config.ts src/lib/__tests__/unit/teams-board-config-form.test.tsx src/lib/__tests__/unit/board-config.test.ts`

---

### Task 11: Mock and seed data

**Files:**
- Modify: `scripts/mock-identities.ts`, `scripts/seed-data.ts`, `scripts/seed.ts`, `src/lib/jira/mock-client.ts`
- Test: `src/lib/__tests__/unit/jira-mock-epics.test.ts` (update)

**Interfaces:**
- Consumes: the `jira_projects` table (Task 2).
- Produces: `MOCK_JIRA_PROJECTS` in `scripts/mock-identities.ts`; `seedJiraProjects` in `scripts/seed-data.ts`.

- [ ] **Step 1: Replace the team board config with project rows**

In `scripts/mock-identities.ts`: remove `boardConfig` from `MockTeam` and from the Research entry in `MOCK_TEAMS` (keep the team itself). Add:

```ts
export interface MockJiraProject {
  id: string;
  projectKey: string;
  displayName: string;
  activeStatus: string;
  middleStatus: string | null;
  hierarchy: 'goal-initiative' | 'owner';
  position: number;
}

export const MOCK_JIRA_PROJECTS: MockJiraProject[] = [
  {
    id: '00000000-0000-4000-e000-000000000001',
    projectKey: 'MOCK', displayName: 'Mock Platform',
    activeStatus: 'In Progress', middleStatus: 'Rollout',
    hierarchy: 'goal-initiative', position: 0,
  },
  {
    id: '00000000-0000-4000-e000-000000000002',
    projectKey: 'RSCH', displayName: 'Mock Research',
    activeStatus: 'In Progress', middleStatus: 'Backlog',
    hierarchy: 'owner', position: 1,
  },
];
```

- [ ] **Step 2: Seed them**

In `scripts/seed-data.ts`, remove `board_config` from `seedTeams`, and add a new numbered section:

```ts
// ---------------------------------------------------------------------------
// 15. seedJiraProjects
// ---------------------------------------------------------------------------

export const seedJiraProjects = MOCK_JIRA_PROJECTS.map(p => ({
  id: p.id,
  org: MOCK_ORG,
  project_key: p.projectKey,
  display_name: p.displayName,
  active_status: p.activeStatus,
  middle_status: p.middleStatus,
  hierarchy: p.hierarchy,
  position: p.position,
  created_at: daysAgo(90),
}));
```

Import `MOCK_JIRA_PROJECTS` alongside the other identities. In `scripts/seed.ts`, add `await seed('jira_projects', data.seedJiraProjects);` after the `teams` call.

- [ ] **Step 3: Update the mock Jira client's status filter**

`MockJiraClient.searchEpics` already filters by project key and by status. The generated JQL now uses `status = "X"` for the active and middle tabs and `statusCategory = "Done"` for done, which the existing `extractStatusFilter` already handles. The only change needed: `RSCH`'s middle tab is `Backlog`, and its fixtures already carry that status, so no fixture change is required.

Update `src/lib/__tests__/unit/jira-mock-epics.test.ts` to use the new JQL shapes:

```ts
  it('filters the RSCH active tab by its status name', async () => {
    const epics = await client.searchEpics('project = "RSCH" AND issuetype = Epic AND status = "In Progress"');
    expect(epics.map(e => e.key).sort()).toEqual(['RSCH-101', 'RSCH-102', 'RSCH-103']);
  });

  it('filters the RSCH middle tab by Backlog', async () => {
    const epics = await client.searchEpics('project = "RSCH" AND issuetype = Epic AND status = "Backlog"');
    expect(epics.map(e => e.key).sort()).toEqual(['RSCH-201', 'RSCH-202']);
  });

  it('still returns rejected epics on the Done category', async () => {
    const epics = await client.searchEpics('project = "RSCH" AND issuetype = Epic AND statusCategory = "Done" AND updated >= -30d');
    expect(epics.map(e => e.key).sort()).toEqual(['RSCH-301', 'RSCH-302']);
  });
```

Keep every other test in that file. Note `extractProjectKeys` must still handle the `project = "KEY"` form as well as `project in (...)` — verify it does, and extend it if not.

- [ ] **Step 4: Run tests and verify the seed**

Run: `npm test`
Expected: PASS

Run: `rm -f /tmp/verify-seed.db && SQLITE_PATH=/tmp/verify-seed.db npx tsx scripts/seed.ts`
Then confirm two rows landed:

```bash
node -e "const D=require('better-sqlite3');const d=new D('/tmp/verify-seed.db',{readonly:true});console.log(d.prepare('SELECT project_key, hierarchy, middle_status FROM jira_projects ORDER BY position').all());"
```
Expected: `MOCK/goal-initiative/Rollout` and `RSCH/owner/Backlog`.

- [ ] **Step 5: Commit**

Subject: `feat(glook-38): seed mock jira_projects rows`
Paths: `scripts/mock-identities.ts scripts/seed-data.ts scripts/seed.ts src/lib/jira/mock-client.ts src/lib/__tests__/unit/jira-mock-epics.test.ts`

---

## Deferred, with reasons

- **Untracked work still reads `JIRA_PROJECTS_JQL`** and renders only on the first-position project. Repointing it per project means reworking its 90-day windows and caching; own ticket.
- **`active_status` / `middle_status` are free text.** A typo yields a silently empty tab. Validating against `/rest/api/3/project/{key}/statuses` would prevent it.
- **Team membership by Jira identity** — the root fix for the em-dash on non-committers.
- **The `history: 'push'` Back-button loop** on the corrective `setActiveTab`, inherited from the superseded implementation.
- **The mockup at `mockups/glook-38-research-board.html`** shows the superseded design; the controller regenerates it after implementation.

## Self-review notes

**Spec coverage.** `jira_projects` table → Tasks 1-2. JQL from named statuses → Task 3. Self-migration → Task 4. Assignee-only attribution → Task 5. One project per request, regex deleted → Task 6. CRUD API → Task 7. Rings unified, layout retyped → Task 8. Selector → Task 9. Settings + deletions → Task 10. Mock/seed → Task 11.

**Deletions are explicit.** Every file this plan removes is named in a task's commit step with `git rm`, and the tests that assert removed behaviour are deleted alongside, not left failing.

**One naming change to note:** the owner-layout header becomes `Owner` rather than `Researcher`, since the column is no longer research-specific. Task 8's test asserts the new string.
