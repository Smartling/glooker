# GLOOK-38 Research Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the LanguageAI Research team (Jira project `RND`) on Glooker's `/projects` board with per-team board behaviour, leaving every other team's board bit-for-bit unchanged.

**Architecture:** One nullable `teams.board_config` JSON column carries five per-team settings. `/api/projects` becomes a resolver over a list of *project sources*: the existing global `JIRA_PROJECTS_JQL` (unchanged) plus one source per team that declares Jira project keys. Epics from a team source are attributed to that team by provenance, skipping the `user_mappings` → `team_members` hop that a non-committing team cannot satisfy. `NULL` board_config means today's behaviour exactly.

**Tech Stack:** Next.js 15 App Router, TypeScript, Jest + ts-jest, SWR, SQLite (default) + MySQL (opt-in), Jira REST v3 `/search/jql`.

**Spec:** `docs/superpowers/specs/2026-08-14-glook-38-research-board-design.md`

## Global Constraints

- **Never pin a charset** on a MySQL table (`DEFAULT CHARSET=...`) — causes `ER_FK_INCOMPATIBLE_COLUMNS`, errno 3780. Guarded by `src/lib/__tests__/unit/mysql-schema-fk-charset.test.ts`.
- A new column on a **base table** (`teams`) must be added in **three** places or it silently won't exist: `schema.sql`, the `SCHEMA` literal in `src/lib/db/sqlite.ts`, **and** a guarded `ALTER` in each of `src/lib/db/sqlite.ts` and `src/lib/db/mysql.ts`. `initSchema()` catches and logs DDL failures rather than throwing.
- Every exported handler in `src/app/api/**/route.ts` must be wrapped in `withRequestLog()` from `@/lib/logger` — enforced by `src/lib/__tests__/unit/logger-enforcement.test.ts`.
- Files under `src/app/**/page.tsx` may export **only** `default`. Exporting anything else breaks `npm run build` while `npm test` and `tsc --noEmit` both pass. Shared pieces go in a sibling module.
- Jest `roots: ['<rootDir>/src/lib']`. **All** tests live in `src/lib/__tests__/unit/<name>.test.ts(x)`, flat — including tests for components under `src/app/`.
- Component tests need a `/** @jest-environment jsdom */` docblock on line 1. Precedent: `src/lib/__tests__/unit/profile-self-view.test.tsx`.
- Any test file importing from `github.ts` transitively must `jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }))` **before** the import — `@octokit/rest` is ESM-only.
- Tests that set `SQLITE_PATH` or `DB_TYPE` must restore the prior value in `afterAll`; `process.env` is shared across a Jest worker.
- New JQL uses `statusCategory`, never `status` — RND's `Backlog` maps to category `To Do` and `Rejected` maps to category `Done`.
- **Do not touch** the regex at `src/app/api/projects/route.ts:24-26`. It is fragile and known-broken for the `statusCategory` form, but changing it puts the SPS board at risk for no gain in this ticket. Out of scope.
- `DECIMAL`/`REAL` columns from either dialect may come back as strings — `Number()` before `.toFixed()`.
- Run `npm test` after each task. Mimic CI worker count when reproducing failures: `--maxWorkers=3`.

---

### Task 1: BoardConfig type, parsing and validation

Pure module, no DB and no Jira. Everything downstream depends on these names.

**Files:**
- Create: `src/lib/teams/board-config.ts`
- Test: `src/lib/__tests__/unit/board-config.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `BoardConfig`, `BoardHierarchy`, `BoardMiddleTab`, `BoardRingMode`, `BoardTab`, `DEFAULT_BOARD_CONFIG`, `parseBoardConfig(raw: unknown): BoardConfig`, `validateBoardConfig(input: unknown): BoardConfig`, `BoardConfigError`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/board-config.test.ts`:

```ts
import {
  parseBoardConfig,
  validateBoardConfig,
  DEFAULT_BOARD_CONFIG,
  BoardConfigError,
} from '@/lib/teams/board-config';

describe('parseBoardConfig', () => {
  it('returns defaults for null (a team that has never been configured)', () => {
    expect(parseBoardConfig(null)).toEqual(DEFAULT_BOARD_CONFIG);
  });

  it('returns defaults for undefined', () => {
    expect(parseBoardConfig(undefined)).toEqual(DEFAULT_BOARD_CONFIG);
  });

  it('parses a JSON string (how SQLite stores it)', () => {
    const raw = JSON.stringify({ jiraProjectKeys: ['RND'], hierarchy: 'owner' });
    const cfg = parseBoardConfig(raw);
    expect(cfg.jiraProjectKeys).toEqual(['RND']);
    expect(cfg.hierarchy).toBe('owner');
  });

  it('parses an object (how mysql2 hands back a JSON column)', () => {
    const cfg = parseBoardConfig({ jiraProjectKeys: ['RND'], middleTab: 'Backlog' });
    expect(cfg.jiraProjectKeys).toEqual(['RND']);
    expect(cfg.middleTab).toBe('Backlog');
  });

  it('merges partial config over defaults', () => {
    const cfg = parseBoardConfig({ ringMode: 'jira' });
    expect(cfg.ringMode).toBe('jira');
    expect(cfg.hierarchy).toBe(DEFAULT_BOARD_CONFIG.hierarchy);
    expect(cfg.doneWindowDays).toBe(30);
    expect(cfg.includeRejected).toBe(false);
  });

  it('returns defaults for malformed JSON rather than throwing', () => {
    expect(parseBoardConfig('{not json')).toEqual(DEFAULT_BOARD_CONFIG);
  });

  it('ignores unknown keys when parsing stored data', () => {
    const cfg = parseBoardConfig({ hierarchy: 'owner', legacyKey: 'whatever' });
    expect(cfg.hierarchy).toBe('owner');
    expect(cfg as unknown as Record<string, unknown>).not.toHaveProperty('legacyKey');
  });
});

describe('validateBoardConfig', () => {
  it('accepts a full valid config', () => {
    const input = {
      jiraProjectKeys: ['RND'],
      hierarchy: 'owner',
      middleTab: 'Backlog',
      ringMode: 'jira',
      doneWindowDays: 30,
      includeRejected: true,
    };
    expect(validateBoardConfig(input)).toEqual(input);
  });

  it('accepts an empty object and fills defaults', () => {
    expect(validateBoardConfig({})).toEqual(DEFAULT_BOARD_CONFIG);
  });

  it('rejects an unknown key', () => {
    expect(() => validateBoardConfig({ bogus: 1 })).toThrow(BoardConfigError);
  });

  it('rejects an invalid hierarchy value', () => {
    expect(() => validateBoardConfig({ hierarchy: 'sideways' })).toThrow(/hierarchy/);
  });

  it('rejects an invalid middleTab value', () => {
    expect(() => validateBoardConfig({ middleTab: 'Sideways' })).toThrow(/middleTab/);
  });

  it('rejects an invalid ringMode value', () => {
    expect(() => validateBoardConfig({ ringMode: 'sparkles' })).toThrow(/ringMode/);
  });

  it('rejects doneWindowDays outside 1..365', () => {
    expect(() => validateBoardConfig({ doneWindowDays: 0 })).toThrow(/doneWindowDays/);
    expect(() => validateBoardConfig({ doneWindowDays: 366 })).toThrow(/doneWindowDays/);
    expect(() => validateBoardConfig({ doneWindowDays: 12.5 })).toThrow(/doneWindowDays/);
  });

  it('rejects jiraProjectKeys that is not an array of non-empty strings', () => {
    expect(() => validateBoardConfig({ jiraProjectKeys: 'RND' })).toThrow(/jiraProjectKeys/);
    expect(() => validateBoardConfig({ jiraProjectKeys: [''] })).toThrow(/jiraProjectKeys/);
    expect(() => validateBoardConfig({ jiraProjectKeys: [1] })).toThrow(/jiraProjectKeys/);
  });

  it('rejects a project key containing JQL-hostile characters', () => {
    expect(() => validateBoardConfig({ jiraProjectKeys: ['RND" OR 1=1'] })).toThrow(/jiraProjectKeys/);
  });

  it('trims and uppercases project keys', () => {
    expect(validateBoardConfig({ jiraProjectKeys: [' rnd '] }).jiraProjectKeys).toEqual(['RND']);
  });

  it('rejects a non-object input', () => {
    expect(() => validateBoardConfig('nope')).toThrow(BoardConfigError);
    expect(() => validateBoardConfig(null)).toThrow(BoardConfigError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --testPathPattern="board-config"`
Expected: FAIL — `Cannot find module '@/lib/teams/board-config'`

- [ ] **Step 3: Write the implementation**

Create `src/lib/teams/board-config.ts`:

```ts
/**
 * Per-team board behaviour for the /projects page (GLOOK-38).
 *
 * Stored as one nullable JSON column on `teams`. A NULL column — every team
 * that predates this feature — parses to DEFAULT_BOARD_CONFIG, which is
 * exactly today's behaviour. Keys are individually optional for the same
 * reason: adding a key later must not invalidate stored rows.
 */

export type BoardHierarchy = 'goal-initiative' | 'owner';
export type BoardMiddleTab = 'Rollout' | 'Backlog';
export type BoardRingMode = 'commits' | 'jira';
export type BoardTab = 'In Progress' | 'Rollout' | 'Backlog' | 'Done';

export interface BoardConfig {
  /** Jira project keys owned by this team. Non-empty enables provenance attribution. */
  jiraProjectKeys: string[];
  hierarchy: BoardHierarchy;
  middleTab: BoardMiddleTab;
  ringMode: BoardRingMode;
  doneWindowDays: number;
  includeRejected: boolean;
}

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  jiraProjectKeys: [],
  hierarchy: 'goal-initiative',
  middleTab: 'Rollout',
  ringMode: 'commits',
  doneWindowDays: 30,
  includeRejected: false,
};

const HIERARCHIES: BoardHierarchy[] = ['goal-initiative', 'owner'];
const MIDDLE_TABS: BoardMiddleTab[] = ['Rollout', 'Backlog'];
const RING_MODES: BoardRingMode[] = ['commits', 'jira'];

/** Jira project keys are letters, digits and underscores only. Anything else
 *  could break out of the quoted JQL literal we interpolate them into. */
const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export class BoardConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardConfigError';
  }
}

/**
 * Read a stored value into a complete BoardConfig. Never throws: bad stored
 * data degrades to defaults so one corrupt row cannot take the board down.
 * Accepts a JSON string (SQLite TEXT) or an already-parsed object (mysql2 JSON).
 */
export function parseBoardConfig(raw: unknown): BoardConfig {
  if (raw === null || raw === undefined || raw === '') return { ...DEFAULT_BOARD_CONFIG };

  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_BOARD_CONFIG };
    }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { ...DEFAULT_BOARD_CONFIG };
  }

  const src = obj as Record<string, unknown>;
  const cfg: BoardConfig = { ...DEFAULT_BOARD_CONFIG };

  if (Array.isArray(src.jiraProjectKeys)) {
    cfg.jiraProjectKeys = src.jiraProjectKeys
      .filter((k): k is string => typeof k === 'string' && k.trim() !== '')
      .map(k => k.trim().toUpperCase());
  }
  if (typeof src.hierarchy === 'string' && HIERARCHIES.includes(src.hierarchy as BoardHierarchy)) {
    cfg.hierarchy = src.hierarchy as BoardHierarchy;
  }
  if (typeof src.middleTab === 'string' && MIDDLE_TABS.includes(src.middleTab as BoardMiddleTab)) {
    cfg.middleTab = src.middleTab as BoardMiddleTab;
  }
  if (typeof src.ringMode === 'string' && RING_MODES.includes(src.ringMode as BoardRingMode)) {
    cfg.ringMode = src.ringMode as BoardRingMode;
  }
  if (typeof src.doneWindowDays === 'number' && Number.isInteger(src.doneWindowDays)
      && src.doneWindowDays >= 1 && src.doneWindowDays <= 365) {
    cfg.doneWindowDays = src.doneWindowDays;
  }
  if (typeof src.includeRejected === 'boolean') {
    cfg.includeRejected = src.includeRejected;
  }

  return cfg;
}

/**
 * Validate operator input from the Settings UI / API. Unlike parseBoardConfig
 * this is strict and throws, so a typo is reported instead of silently ignored.
 */
export function validateBoardConfig(input: unknown): BoardConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new BoardConfigError('board_config must be an object');
  }
  const src = input as Record<string, unknown>;

  const allowed = new Set<keyof BoardConfig>([
    'jiraProjectKeys', 'hierarchy', 'middleTab', 'ringMode', 'doneWindowDays', 'includeRejected',
  ]);
  for (const key of Object.keys(src)) {
    if (!allowed.has(key as keyof BoardConfig)) {
      throw new BoardConfigError(`Unknown board_config key: ${key}`);
    }
  }

  const cfg: BoardConfig = { ...DEFAULT_BOARD_CONFIG };

  if (src.jiraProjectKeys !== undefined) {
    if (!Array.isArray(src.jiraProjectKeys)) {
      throw new BoardConfigError('jiraProjectKeys must be an array of project keys');
    }
    cfg.jiraProjectKeys = src.jiraProjectKeys.map(k => {
      if (typeof k !== 'string' || k.trim() === '') {
        throw new BoardConfigError('jiraProjectKeys must contain non-empty strings');
      }
      const key = k.trim().toUpperCase();
      if (!PROJECT_KEY_RE.test(key)) {
        throw new BoardConfigError(`jiraProjectKeys contains an invalid project key: ${k}`);
      }
      return key;
    });
  }

  if (src.hierarchy !== undefined) {
    if (!HIERARCHIES.includes(src.hierarchy as BoardHierarchy)) {
      throw new BoardConfigError(`hierarchy must be one of: ${HIERARCHIES.join(', ')}`);
    }
    cfg.hierarchy = src.hierarchy as BoardHierarchy;
  }

  if (src.middleTab !== undefined) {
    if (!MIDDLE_TABS.includes(src.middleTab as BoardMiddleTab)) {
      throw new BoardConfigError(`middleTab must be one of: ${MIDDLE_TABS.join(', ')}`);
    }
    cfg.middleTab = src.middleTab as BoardMiddleTab;
  }

  if (src.ringMode !== undefined) {
    if (!RING_MODES.includes(src.ringMode as BoardRingMode)) {
      throw new BoardConfigError(`ringMode must be one of: ${RING_MODES.join(', ')}`);
    }
    cfg.ringMode = src.ringMode as BoardRingMode;
  }

  if (src.doneWindowDays !== undefined) {
    const d = src.doneWindowDays;
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 365) {
      throw new BoardConfigError('doneWindowDays must be an integer between 1 and 365');
    }
    cfg.doneWindowDays = d;
  }

  if (src.includeRejected !== undefined) {
    if (typeof src.includeRejected !== 'boolean') {
      throw new BoardConfigError('includeRejected must be a boolean');
    }
    cfg.includeRejected = src.includeRejected;
  }

  return cfg;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --testPathPattern="board-config"`
Expected: PASS, 20 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/teams/board-config.ts src/lib/__tests__/unit/board-config.test.ts
git commit -m "feat(glook-38): add per-team BoardConfig type with parse and validate"
```

---

### Task 2: `teams.board_config` column across all three schema locations

The failure mode this task guards against is real and has bitten this codebase: a base-table column added in only one or two of the three places silently doesn't exist until a query hits it.

**Files:**
- Modify: `schema.sql:127-134`
- Modify: `src/lib/db/sqlite.ts:135-142` (SCHEMA literal) and `src/lib/db/sqlite.ts:306` (after the run_metadata ALTER)
- Modify: `src/lib/db/mysql.ts:318` (after the run_metadata ALTER)
- Modify: `src/lib/teams/service.ts:35-106`
- Test: `src/lib/__tests__/unit/board-config-schema.test.ts`
- Test: `src/lib/__tests__/unit/teams-board-config.test.ts`

**Interfaces:**
- Consumes: `BoardConfig`, `parseBoardConfig`, `validateBoardConfig` from Task 1.
- Produces: `listTeams` rows gain `board_config: BoardConfig`; `TeamInput` and `TeamUpdateInput` gain `boardConfig?: unknown`.

- [ ] **Step 1: Write the failing schema test**

Create `src/lib/__tests__/unit/board-config-schema.test.ts`:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('teams.board_config exists in every schema location', () => {
  it('is in the MySQL base schema (schema.sql teams table)', () => {
    const sql = read('schema.sql');
    const teamsBlock = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS teams ('),
      sql.indexOf('CREATE TABLE IF NOT EXISTS team_members ('),
    );
    expect(teamsBlock).toMatch(/board_config\s+JSON\s+NULL/i);
  });

  it('is in the SQLite SCHEMA literal', () => {
    const src = read('src/lib/db/sqlite.ts');
    const teamsBlock = src.slice(
      src.indexOf('CREATE TABLE IF NOT EXISTS teams ('),
      src.indexOf('CREATE TABLE IF NOT EXISTS team_members ('),
    );
    expect(teamsBlock).toMatch(/board_config\s+TEXT/i);
  });

  it('has a guarded ALTER for existing SQLite databases', () => {
    expect(read('src/lib/db/sqlite.ts'))
      .toMatch(/ALTER TABLE teams ADD COLUMN board_config TEXT/i);
  });

  it('has a guarded ALTER for existing MySQL databases', () => {
    expect(read('src/lib/db/mysql.ts'))
      .toMatch(/ALTER TABLE teams ADD COLUMN board_config JSON NULL/i);
  });

  it('does not pin a charset on the teams table', () => {
    const sql = read('schema.sql');
    const teamsBlock = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS teams ('),
      sql.indexOf('CREATE TABLE IF NOT EXISTS team_members ('),
    );
    expect(teamsBlock).not.toMatch(/DEFAULT CHARSET/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="board-config-schema"`
Expected: FAIL — all four existence assertions fail.

- [ ] **Step 3: Add the column in all three places**

In `schema.sql`, change the `teams` block to:

```sql
CREATE TABLE IF NOT EXISTS teams (
  id          VARCHAR(36)  NOT NULL PRIMARY KEY,
  org         VARCHAR(255) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  color       VARCHAR(7)   NOT NULL DEFAULT '#3B82F6',
  board_config JSON        NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_team (org, name)
);
```

In `src/lib/db/sqlite.ts`, change the `teams` block inside the `SCHEMA` literal to:

```sql
CREATE TABLE IF NOT EXISTS teams (
  id          TEXT    NOT NULL PRIMARY KEY,
  org         TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  color       TEXT    NOT NULL DEFAULT '#3B82F6',
  board_config TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (org, name)
);
```

In `src/lib/db/sqlite.ts`, immediately after the `run_metadata` ALTER on line 306, add:

```ts
  // GLOOK-38: per-team board behaviour for the /projects page
  try { db.exec('ALTER TABLE teams ADD COLUMN board_config TEXT'); } catch (_) {}
```

In `src/lib/db/mysql.ts`, immediately after the `run_metadata` ALTER (line 316-318), add:

```ts
  // GLOOK-38: per-team board behaviour for the /projects page
  await pool.execute('ALTER TABLE teams ADD COLUMN board_config JSON NULL').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add board_config:', err);
  });
```

- [ ] **Step 4: Run the schema test to verify it passes**

Run: `npm test -- --testPathPattern="board-config-schema"`
Expected: PASS, 5 tests

- [ ] **Step 5: Write the failing service test**

Create `src/lib/__tests__/unit/teams-board-config.test.ts`:

```ts
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));

import { listTeams, createTeam, updateTeam } from '@/lib/teams/service';
import { DEFAULT_BOARD_CONFIG } from '@/lib/teams/board-config';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockExecute.mockResolvedValue([[], null]);
});

describe('listTeams board_config', () => {
  it('parses a stored JSON string into a BoardConfig', async () => {
    mockExecute
      .mockResolvedValueOnce([[{
        id: 't1', org: 'o', name: 'Research', color: '#7C3AED',
        board_config: JSON.stringify({ jiraProjectKeys: ['RND'], hierarchy: 'owner' }),
        created_at: '2026-08-01',
      }], null])
      .mockResolvedValueOnce([[], null]); // team_members

    const teams = await listTeams('o');

    expect(teams[0].board_config.jiraProjectKeys).toEqual(['RND']);
    expect(teams[0].board_config.hierarchy).toBe('owner');
  });

  it('yields defaults when the column is NULL', async () => {
    mockExecute
      .mockResolvedValueOnce([[{
        id: 't1', org: 'o', name: 'Platform', color: '#2563EB',
        board_config: null, created_at: '2026-08-01',
      }], null])
      .mockResolvedValueOnce([[], null]);

    const teams = await listTeams('o');

    expect(teams[0].board_config).toEqual(DEFAULT_BOARD_CONFIG);
  });

  it('selects the board_config column', async () => {
    await listTeams('o');
    expect(mockExecute.mock.calls[0][0]).toContain('board_config');
  });
});

describe('createTeam board_config', () => {
  it('persists a validated config as JSON', async () => {
    await createTeam({
      org: 'o', name: 'Research',
      boardConfig: { jiraProjectKeys: ['rnd'], hierarchy: 'owner' },
    });

    const insert = mockExecute.mock.calls.find(c => /INSERT INTO teams/.test(c[0]));
    expect(insert).toBeDefined();
    expect(insert![0]).toContain('board_config');
    const stored = JSON.parse(insert![1][4]);
    expect(stored.jiraProjectKeys).toEqual(['RND']); // uppercased by validation
  });

  it('stores NULL when no config is supplied', async () => {
    await createTeam({ org: 'o', name: 'Platform' });
    const insert = mockExecute.mock.calls.find(c => /INSERT INTO teams/.test(c[0]));
    expect(insert![1][4]).toBeNull();
  });

  it('rejects an invalid config', async () => {
    await expect(
      createTeam({ org: 'o', name: 'Bad', boardConfig: { hierarchy: 'sideways' } }),
    ).rejects.toThrow(/hierarchy/);
  });
});

describe('updateTeam board_config', () => {
  it('updates the column when a config is supplied', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 't1' }], null]); // existence check
    await updateTeam('t1', { boardConfig: { ringMode: 'jira' } });

    const update = mockExecute.mock.calls.find(c => /UPDATE teams SET/.test(c[0]));
    expect(update![0]).toContain('board_config');
    expect(JSON.parse(update![1][0]).ringMode).toBe('jira');
  });

  it('clears the column when boardConfig is null', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 't1' }], null]);
    await updateTeam('t1', { boardConfig: null });

    const update = mockExecute.mock.calls.find(c => /UPDATE teams SET/.test(c[0]));
    expect(update![0]).toContain('board_config = ?');
    expect(update![1][0]).toBeNull();
  });

  it('leaves the column alone when boardConfig is absent', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 't1' }], null]);
    await updateTeam('t1', { name: 'Renamed' });

    const update = mockExecute.mock.calls.find(c => /UPDATE teams SET/.test(c[0]));
    expect(update![0]).not.toContain('board_config');
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm test -- --testPathPattern="teams-board-config"`
Expected: FAIL — `board_config` not selected, `boardConfig` not a known input property.

- [ ] **Step 7: Wire board_config through the team service**

In `src/lib/teams/service.ts`, add the import and extend the two input types:

```ts
import { randomUUID } from 'crypto';
import db from '../db/index';
import { parseBoardConfig, validateBoardConfig, type BoardConfig } from './board-config';

export interface TeamInput {
  org: string;
  name: string;
  color?: string;
  members?: string[];
  /** Raw operator input; validated before persisting. Omit to store NULL. */
  boardConfig?: unknown;
}

export interface TeamUpdateInput {
  name?: string;
  color?: string;
  members?: string[];
  /** `undefined` leaves the column untouched; `null` clears it. */
  boardConfig?: unknown | null;
}
```

Replace `listTeams` (lines 35-50) with:

```ts
export async function listTeams(org: string) {
  const [teams] = await db.execute(
    `SELECT id, org, name, color, board_config, created_at FROM teams WHERE org = ? ORDER BY name`,
    [org],
  ) as [any[], any];

  for (const team of teams) {
    const [members] = await db.execute(
      `SELECT github_login, added_at FROM team_members WHERE team_id = ? ORDER BY added_at`,
      [team.id],
    ) as [any[], any];
    team.members = members.map((m: any) => m.github_login);
    // Stored NULL — every team predating GLOOK-38 — becomes today's defaults.
    team.board_config = parseBoardConfig(team.board_config);
  }

  return teams;
}
```

In `createTeam`, replace the `INSERT INTO teams` block (lines 58-68) with:

```ts
  const boardConfigJson = input.boardConfig === undefined || input.boardConfig === null
    ? null
    : JSON.stringify(validateBoardConfig(input.boardConfig));

  try {
    await db.execute(
      `INSERT INTO teams (id, org, name, color, board_config) VALUES (?, ?, ?, ?, ?)`,
      [id, org, trimmedName, resolvedColor, boardConfigJson],
    );
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY' || err?.message?.includes('UNIQUE')) {
      throw new TeamDuplicateError(trimmedName);
    }
    throw err;
  }
```

and change its return to include the parsed config:

```ts
  return {
    id, org, name: trimmedName, color: resolvedColor,
    members: members || [],
    board_config: parseBoardConfig(boardConfigJson),
  };
```

In `updateTeam`, replace the `if (name || color)` block (lines 88-95) with:

```ts
  const { name, color, members, boardConfig } = input;

  if (name || color || boardConfig !== undefined) {
    const sets: string[] = [];
    const vals: any[] = [];
    if (boardConfig !== undefined) {
      sets.push('board_config = ?');
      vals.push(boardConfig === null ? null : JSON.stringify(validateBoardConfig(boardConfig)));
    }
    if (name) { sets.push('name = ?'); vals.push(name.trim()); }
    if (color) { sets.push('color = ?'); vals.push(color); }
    vals.push(id);
    await db.execute(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`, vals);
  }
```

> `board_config` is pushed **first** so the test's `vals[0]` assertion is stable and so a
> caller updating only the config produces `UPDATE teams SET board_config = ? WHERE id = ?`.

Also re-export from `src/lib/teams/index.ts`:

```ts
export { listTeams, createTeam, updateTeam, deleteTeam, TeamNotFoundError, TeamDuplicateError, type TeamInput, type TeamUpdateInput } from './service';
export { parseBoardConfig, validateBoardConfig, DEFAULT_BOARD_CONFIG, BoardConfigError, type BoardConfig, type BoardTab, type BoardHierarchy, type BoardMiddleTab, type BoardRingMode } from './board-config';
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="teams-board-config|board-config-schema|mysql-schema-fk-charset"`
Expected: PASS

- [ ] **Step 9: Run the full suite — this touched a base table**

Run: `npm test`
Expected: PASS. If `teams`-related tests fail on a column count, they were asserting the old `SELECT` list; update the expected SQL string, not the implementation.

- [ ] **Step 10: Commit**

```bash
git add schema.sql src/lib/db/sqlite.ts src/lib/db/mysql.ts src/lib/teams/service.ts src/lib/teams/index.ts src/lib/__tests__/unit/board-config-schema.test.ts src/lib/__tests__/unit/teams-board-config.test.ts
git commit -m "feat(glook-38): add teams.board_config column in all three schema locations"
```

---

### Task 3: Keep parentless epics, and attribute by provenance

Two changes to `fetchProjectEpics`, plus the honest test updates they force. **An existing test asserts the behaviour we are deliberately removing** — rewrite it, don't delete it.

Measured blast radius: of 46 SPS In-Progress epics, exactly one (`SPS-720`) lacks an Initiative parent, so this adds one row to the SPS board.

**Files:**
- Modify: `src/lib/projects/service.ts:4-13` (type), `:48-67` (filter + mapping)
- Modify: `src/lib/__tests__/unit/projects-service.test.ts:70-88` (rewrite the drop test)
- Test: `src/lib/__tests__/unit/projects-provenance.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: `ProjectEpic` gains `projectKey: string`; `fetchProjectEpics(jql, org, options?)` where `options: { provenanceTeam?: { name: string; color: string } | null }`. The third parameter is optional so all 13 existing call sites keep compiling.

- [ ] **Step 1: Rewrite the existing test that asserts the old behaviour**

In `src/lib/__tests__/unit/projects-service.test.ts`, replace the test at lines 70-88 entirely:

```ts
  it('keeps epics with no Initiative parent, with null initiative and goal', async () => {
    const epics = [
      makeEpic({ key: 'EPIC-1', summary: 'Has no parent', parentKey: null, parentTypeName: null }),
      makeEpic({ key: 'EPIC-2', summary: 'Story parent', parentKey: 'STORY-1', parentTypeName: 'Story' }),
      makeEpic({ key: 'EPIC-3', summary: 'Initiative parent', parentKey: 'INIT-1', parentSummary: 'My Initiative', parentTypeName: 'Initiative' }),
    ];
    const mockSearchEpics = jest.fn()
      .mockResolvedValueOnce(epics)
      .mockResolvedValueOnce([
        makeEpic({ key: 'INIT-1', summary: 'My Initiative', parentKey: 'GOAL-1', parentSummary: 'My Goal', parentTypeName: 'Goal' }),
      ]);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });
    noMappingsDb();

    const result = await fetchProjectEpics('project = FOO', 'my-org');

    // GLOOK-38: parentless epics used to be silently dropped. RND has 25 of them.
    expect(result).toHaveLength(3);
    const byKey = Object.fromEntries(result.map(e => [e.key, e]));

    expect(byKey['EPIC-1'].initiative).toBeNull();
    expect(byKey['EPIC-1'].goal).toBeNull();

    // A non-Initiative parent must not be shown as an initiative.
    expect(byKey['EPIC-2'].initiative).toBeNull();
    expect(byKey['EPIC-2'].goal).toBeNull();

    expect(byKey['EPIC-3'].initiative).toEqual({ key: 'INIT-1', summary: 'My Initiative' });
    expect(byKey['EPIC-3'].goal).toEqual({ key: 'GOAL-1', summary: 'My Goal' });
  });

  it('derives projectKey from the epic key prefix', async () => {
    const mockSearchEpics = jest.fn()
      .mockResolvedValueOnce([makeEpic({ key: 'RND-1181', parentKey: null, parentTypeName: null })]);
    mockGetJiraClient.mockReturnValue({ searchEpics: mockSearchEpics });
    noMappingsDb();

    const result = await fetchProjectEpics('project = RND', 'my-org');

    expect(result[0].projectKey).toBe('RND');
  });
```

- [ ] **Step 2: Write the failing provenance test**

Create `src/lib/__tests__/unit/projects-provenance.test.ts`:

```ts
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/jira/client');
jest.mock('@/lib/db/index', () => ({
  __esModule: true,
  default: { execute: jest.fn().mockResolvedValue([[], null]) },
}));

import { fetchProjectEpics } from '@/lib/projects/service';
import { getJiraClient } from '@/lib/jira/client';
import db from '@/lib/db/index';

const mockGetJiraClient = getJiraClient as jest.Mock;
const mockDbExecute = db.execute as jest.Mock;

function rawEpic(over: Record<string, unknown> = {}) {
  return {
    key: 'RND-1181', summary: 'Style Rules for AI Rule Validation',
    status: 'In Progress', dueDate: '2026-09-18',
    assigneeDisplayName: 'Daria Akselrod', assigneeEmail: 'dakselrod@smartling.com',
    parentKey: null, parentSummary: null, parentTypeName: null,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbExecute.mockResolvedValue([[], null]);
});

const RESEARCH = { name: 'Research', color: '#7C3AED' };

describe('provenance attribution', () => {
  it('attributes every epic to the provenance team, with no user_mappings row', async () => {
    mockGetJiraClient.mockReturnValue({ searchEpics: jest.fn().mockResolvedValue([rawEpic()]) });
    // No user_mappings and no team_members at all.
    mockDbExecute.mockResolvedValueOnce([[], null]).mockResolvedValueOnce([[], null]);

    const result = await fetchProjectEpics('project = RND', 'my-org', { provenanceTeam: RESEARCH });

    expect(result[0].team).toEqual(RESEARCH);
  });

  it('attributes an unassigned epic to the provenance team', async () => {
    mockGetJiraClient.mockReturnValue({
      searchEpics: jest.fn().mockResolvedValue([
        rawEpic({ key: 'RND-1186', assigneeEmail: null, assigneeDisplayName: null }),
      ]),
    });
    mockDbExecute.mockResolvedValueOnce([[], null]).mockResolvedValueOnce([[], null]);

    const result = await fetchProjectEpics('project = RND', 'my-org', { provenanceTeam: RESEARCH });

    expect(result[0].team).toEqual(RESEARCH);
    expect(result[0].assignee).toBeNull();
  });

  it('provenance beats the assignee map when they disagree', async () => {
    mockGetJiraClient.mockReturnValue({ searchEpics: jest.fn().mockResolvedValue([rawEpic()]) });
    mockDbExecute
      .mockResolvedValueOnce([[{ github_login: 'dakselrod-smartling', jira_email: 'dakselrod@smartling.com' }], null])
      .mockResolvedValueOnce([[{ github_login: 'dakselrod-smartling', name: 'Platform', color: '#2563EB' }], null]);

    const result = await fetchProjectEpics('project = RND', 'my-org', { provenanceTeam: RESEARCH });

    expect(result[0].team).toEqual(RESEARCH);
  });

  it('falls back to the assignee map when no provenance team is given', async () => {
    mockGetJiraClient.mockReturnValue({ searchEpics: jest.fn().mockResolvedValue([rawEpic()]) });
    mockDbExecute
      .mockResolvedValueOnce([[{ github_login: 'dakselrod-smartling', jira_email: 'dakselrod@smartling.com' }], null])
      .mockResolvedValueOnce([[{ github_login: 'dakselrod-smartling', name: 'Platform', color: '#2563EB' }], null]);

    const result = await fetchProjectEpics('project = RND', 'my-org');

    expect(result[0].team).toEqual({ name: 'Platform', color: '#2563EB' });
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npm test -- --testPathPattern="projects-provenance|projects-service"`
Expected: FAIL — provenance option unsupported, `projectKey` missing, parentless epics still dropped.

- [ ] **Step 4: Implement**

In `src/lib/projects/service.ts`, extend the type and signature:

```ts
export interface ProjectEpic {
  key: string;
  /** Jira project key, derived from the epic key prefix. Used for provenance. */
  projectKey: string;
  summary: string;
  status: string;
  dueDate: string | null;
  assignee: string | null;
  team: { name: string; color: string } | null;
  initiative: { key: string; summary: string } | null;
  goal: { key: string; summary: string } | null;
}

export interface FetchEpicsOptions {
  /**
   * When set, every epic from this call is attributed to this team regardless of
   * assignee. GLOOK-38: a research team's members may have no GitHub identity, so
   * the user_mappings -> team_members chain cannot attribute their epics.
   */
  provenanceTeam?: { name: string; color: string } | null;
}

export async function fetchProjectEpics(
  jql: string,
  org: string,
  options: FetchEpicsOptions = {},
): Promise<ProjectEpic[]> {
```

Replace the assembly block (lines 48-67) with:

```ts
  // 5. Assemble results.
  //    GLOOK-38: parentless epics are kept. They used to be dropped here, which
  //    is why pointing the board at a flat project (RND: 0 of 25 epics have a
  //    parent) rendered an empty table.
  const epics: ProjectEpic[] = rawEpics.map(epic => {
    const hasInitiative = Boolean(epic.parentKey) && epic.parentTypeName === 'Initiative';
    const initiative = hasInitiative
      ? { key: epic.parentKey as string, summary: epic.parentSummary || '' }
      : null;
    const goal = hasInitiative ? initiativeToGoal.get(epic.parentKey as string) || null : null;
    const team = options.provenanceTeam
      ?? (epic.assigneeEmail ? teamMap.get(epic.assigneeEmail.toLowerCase()) || null : null);

    return {
      key: epic.key,
      projectKey: epic.key.split('-')[0],
      summary: epic.summary,
      status: epic.status,
      dueDate: epic.dueDate,
      assignee: epic.assigneeDisplayName,
      team,
      initiative,
      goal,
    };
  });
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm test -- --testPathPattern="projects-provenance|projects-service"`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/projects/service.ts src/lib/__tests__/unit/projects-service.test.ts src/lib/__tests__/unit/projects-provenance.test.ts
git commit -m "feat(glook-38): keep parentless epics and support provenance team attribution"
```

---

### Task 4: Project source resolution and the team JQL builder

**Files:**
- Create: `src/lib/projects/sources.ts`
- Test: `src/lib/__tests__/unit/project-sources.test.ts`

**Interfaces:**
- Consumes: `BoardConfig`, `BoardTab`, `DEFAULT_BOARD_CONFIG` (Task 1); `listTeams` (Task 2).
- Produces: `ProjectSource`, `buildTeamJql(projectKeys, tab, cfg)`, `resolveProjectSources(org, opts)`, `resolveBoardConfig(org, teamName)`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/project-sources.test.ts`:

```ts
jest.mock('@/lib/teams/service', () => ({ listTeams: jest.fn() }));

import { buildTeamJql, resolveProjectSources, resolveBoardConfig } from '@/lib/projects/sources';
import { DEFAULT_BOARD_CONFIG } from '@/lib/teams/board-config';
import { listTeams } from '@/lib/teams/service';

const mockListTeams = listTeams as jest.Mock;

const cfg = (over: Partial<typeof DEFAULT_BOARD_CONFIG> = {}) => ({ ...DEFAULT_BOARD_CONFIG, ...over });

beforeEach(() => jest.clearAllMocks());

describe('buildTeamJql', () => {
  it('builds the In Progress clause with statusCategory, not status', () => {
    const jql = buildTeamJql(['RND'], 'In Progress', cfg());
    expect(jql).toBe('project in ("RND") AND issuetype = Epic AND statusCategory = "In Progress"');
  });

  it('maps Backlog to the To Do status category', () => {
    expect(buildTeamJql(['RND'], 'Backlog', cfg()))
      .toBe('project in ("RND") AND issuetype = Epic AND statusCategory = "To Do"');
  });

  it('keeps Rollout as a literal status, since it is not a category', () => {
    expect(buildTeamJql(['RND'], 'Rollout', cfg()))
      .toBe('project in ("RND") AND issuetype = Epic AND status = "Rollout"');
  });

  it('uses resolved-only for Done when rejected work is excluded', () => {
    expect(buildTeamJql(['RND'], 'Done', cfg({ doneWindowDays: 30 })))
      .toBe('project in ("RND") AND issuetype = Epic AND statusCategory = "Done" AND resolved >= -30d');
  });

  it('widens Done to updated when rejected work is included', () => {
    // RND-968 is Rejected: statusCategory Done, but resolutiondate is null, so
    // no `resolved >= -Nd` window can ever match it.
    expect(buildTeemJqlSafe(['RND'], 'Done', cfg({ includeRejected: true, doneWindowDays: 30 })))
      .toBe('project in ("RND") AND issuetype = Epic AND statusCategory = "Done" AND (resolved >= -30d OR updated >= -30d)');
  });

  it('honours a custom doneWindowDays', () => {
    expect(buildTeamJql(['RND'], 'Done', cfg({ doneWindowDays: 14 })))
      .toContain('resolved >= -14d');
  });

  it('quotes and joins multiple project keys', () => {
    expect(buildTeamJql(['RND', 'LAB'], 'In Progress', cfg()))
      .toContain('project in ("RND", "LAB")');
  });

  it('throws when given no project keys', () => {
    expect(() => buildTeamJql([], 'In Progress', cfg())).toThrow(/at least one project key/i);
  });
});

describe('resolveProjectSources', () => {
  it('returns only the global source when no team declares project keys', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Platform', color: '#2563EB', board_config: cfg() },
    ]);

    const sources = await resolveProjectSources('o', { globalJql: 'project = SPS' });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toEqual({ kind: 'global', jql: 'project = SPS' });
  });

  it('adds one team source per team with project keys', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Platform', color: '#2563EB', board_config: cfg() },
      { name: 'Research', color: '#7C3AED', board_config: cfg({ jiraProjectKeys: ['RND'] }) },
    ]);

    const sources = await resolveProjectSources('o', { globalJql: 'project = SPS' });

    expect(sources).toHaveLength(2);
    expect(sources[1]).toEqual({
      kind: 'team',
      team: { name: 'Research', color: '#7C3AED' },
      projectKeys: ['RND'],
      config: cfg({ jiraProjectKeys: ['RND'] }),
    });
  });

  it('narrows to a single team source when a team filter is given', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Platform', color: '#2563EB', board_config: cfg() },
      { name: 'Research', color: '#7C3AED', board_config: cfg({ jiraProjectKeys: ['RND'] }) },
    ]);

    const sources = await resolveProjectSources('o', { globalJql: 'project = SPS', team: 'Research' });

    expect(sources).toHaveLength(1);
    expect(sources[0].kind).toBe('team');
  });

  it('keeps the global source when the filtered team has no project keys', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Platform', color: '#2563EB', board_config: cfg() },
    ]);

    const sources = await resolveProjectSources('o', { globalJql: 'project = SPS', team: 'Platform' });

    expect(sources).toEqual([{ kind: 'global', jql: 'project = SPS' }]);
  });

  it('omits the global source when globalJql is absent', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Research', color: '#7C3AED', board_config: cfg({ jiraProjectKeys: ['RND'] }) },
    ]);

    const sources = await resolveProjectSources('o', {});

    expect(sources).toHaveLength(1);
    expect(sources[0].kind).toBe('team');
  });
});

describe('resolveBoardConfig', () => {
  it('returns the config of a single named team that has one', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Research', color: '#7C3AED', board_config: cfg({ jiraProjectKeys: ['RND'], hierarchy: 'owner' }) },
    ]);

    expect((await resolveBoardConfig('o', 'Research'))!.hierarchy).toBe('owner');
  });

  it('returns null when no team is named (the mixed, unfiltered board)', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Research', color: '#7C3AED', board_config: cfg({ jiraProjectKeys: ['RND'] }) },
    ]);

    expect(await resolveBoardConfig('o', null)).toBeNull();
  });

  it('returns null for a team with no project keys', async () => {
    mockListTeams.mockResolvedValue([
      { name: 'Platform', color: '#2563EB', board_config: cfg() },
    ]);

    expect(await resolveBoardConfig('o', 'Platform')).toBeNull();
  });

  it('returns null for an unknown team name', async () => {
    mockListTeams.mockResolvedValue([]);
    expect(await resolveBoardConfig('o', 'Nope')).toBeNull();
  });
});
```

> **Note for the implementer:** the fifth `buildTeamJql` test above deliberately calls a
> misspelled `buildTeemJqlSafe`. That is a typo — change it to `buildTeamJql`. It is left
> in so you notice the assertion rather than pattern-matching past it.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="project-sources"`
Expected: FAIL — `Cannot find module '@/lib/projects/sources'`

- [ ] **Step 3: Implement**

Create `src/lib/projects/sources.ts`:

```ts
import { listTeams } from '@/lib/teams/service';
import { parseBoardConfig, type BoardConfig, type BoardTab } from '@/lib/teams/board-config';

/**
 * Where the Projects board gets its epics.
 *
 * `global` is the long-standing JIRA_PROJECTS_JQL, run and tab-mutated exactly as
 * before. `team` sources are GLOOK-38: a team that declares Jira project keys owns
 * those epics by provenance, so attribution does not depend on who commits.
 */
export type ProjectSource =
  | { kind: 'global'; jql: string }
  | {
      kind: 'team';
      team: { name: string; color: string };
      projectKeys: string[];
      config: BoardConfig;
    };

export interface ResolveSourcesOptions {
  /** JIRA_PROJECTS_JQL, already tab-mutated by the route. Omit to skip the global source. */
  globalJql?: string | null;
  /** Team-filter selection from the UI. */
  team?: string | null;
}

/**
 * Build the JQL for a team source. Uses `statusCategory` rather than `status` so it
 * survives per-project workflow naming: RND's "Backlog" is category "To Do" and its
 * "Rejected" is category "Done".
 */
export function buildTeamJql(projectKeys: string[], tab: BoardTab, config: BoardConfig): string {
  if (projectKeys.length === 0) {
    throw new Error('buildTeamJql requires at least one project key');
  }
  const inList = projectKeys.map(k => `"${k}"`).join(', ');
  const base = `project in (${inList}) AND issuetype = Epic`;

  switch (tab) {
    case 'In Progress':
      return `${base} AND statusCategory = "In Progress"`;
    case 'Backlog':
      return `${base} AND statusCategory = "To Do"`;
    case 'Rollout':
      // Rollout is a status, not a category — there is no "Rollout" statusCategory.
      return `${base} AND status = "Rollout"`;
    case 'Done': {
      const d = config.doneWindowDays;
      // Rejected epics sit in statusCategory Done but carry a null resolutiondate,
      // so `resolved >= -Nd` alone can never match them.
      const window = config.includeRejected
        ? `(resolved >= -${d}d OR updated >= -${d}d)`
        : `resolved >= -${d}d`;
      return `${base} AND statusCategory = "Done" AND ${window}`;
    }
  }
}

export async function resolveProjectSources(
  org: string,
  opts: ResolveSourcesOptions,
): Promise<ProjectSource[]> {
  const teams = await listTeams(org);

  const teamSources: ProjectSource[] = [];
  for (const t of teams) {
    const config = parseBoardConfig(t.board_config);
    if (config.jiraProjectKeys.length === 0) continue;
    if (opts.team && t.name !== opts.team) continue;
    teamSources.push({
      kind: 'team',
      team: { name: t.name, color: t.color },
      projectKeys: config.jiraProjectKeys,
      config,
    });
  }

  // A team filter that selects a configured team means the caller wants that
  // team's board specifically — don't drag the whole global epic set in with it.
  if (opts.team && teamSources.length > 0) return teamSources;

  const sources: ProjectSource[] = [];
  if (opts.globalJql) sources.push({ kind: 'global', jql: opts.globalJql });
  sources.push(...teamSources);
  return sources;
}

/**
 * The board config that should shape the UI, or null when the view is mixed.
 * Per-team layout only makes sense for a single-team view.
 */
export async function resolveBoardConfig(
  org: string,
  teamName: string | null,
): Promise<BoardConfig | null> {
  if (!teamName) return null;
  const teams = await listTeams(org);
  const match = teams.find((t: any) => t.name === teamName);
  if (!match) return null;
  const config = parseBoardConfig(match.board_config);
  return config.jiraProjectKeys.length > 0 ? config : null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --testPathPattern="project-sources"`
Expected: PASS (after fixing the deliberate `buildTeemJqlSafe` typo)

- [ ] **Step 5: Commit**

```bash
git add src/lib/projects/sources.ts src/lib/__tests__/unit/project-sources.test.ts
git commit -m "feat(glook-38): add project source resolution and team JQL builder"
```

---

### Task 5: Wire the API

**Files:**
- Modify: `src/app/api/projects/route.ts`
- Modify: `src/app/api/teams/route.ts`
- Modify: `src/app/api/teams/[id]/route.ts`
- Test: `src/lib/__tests__/unit/projects-api-board.test.ts`

**Interfaces:**
- Consumes: `resolveProjectSources`, `resolveBoardConfig`, `buildTeamJql` (Task 4); `fetchProjectEpics(jql, org, options)` (Task 3); `validateBoardConfig` (Task 1).
- Produces: `GET /api/projects` response `{ epics, jiraHost, boardConfig }`; accepts `?team=` and `?status=Backlog`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/projects-api-board.test.ts`:

```ts
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/projects/service', () => ({ fetchProjectEpics: jest.fn() }));
jest.mock('@/lib/projects/sources', () => ({
  resolveProjectSources: jest.fn(),
  resolveBoardConfig: jest.fn(),
  buildTeamJql: jest.fn(() => 'BUILT_JQL'),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/projects/route';
import { fetchProjectEpics } from '@/lib/projects/service';
import { resolveProjectSources, resolveBoardConfig, buildTeamJql } from '@/lib/projects/sources';
import { DEFAULT_BOARD_CONFIG } from '@/lib/teams/board-config';

const mockFetch = fetchProjectEpics as jest.Mock;
const mockSources = resolveProjectSources as jest.Mock;
const mockCfg = resolveBoardConfig as jest.Mock;
const mockBuild = buildTeamJql as jest.Mock;

const RESEARCH_CFG = { ...DEFAULT_BOARD_CONFIG, jiraProjectKeys: ['RND'], hierarchy: 'owner' as const };

const req = (qs: string) => new NextRequest(`http://localhost/api/projects${qs}`);

let prevEnabled: string | undefined;
let prevJql: string | undefined;

beforeAll(() => {
  prevEnabled = process.env.JIRA_ENABLED;
  prevJql = process.env.JIRA_PROJECTS_JQL;
});

afterAll(() => {
  if (prevEnabled === undefined) delete process.env.JIRA_ENABLED; else process.env.JIRA_ENABLED = prevEnabled;
  if (prevJql === undefined) delete process.env.JIRA_PROJECTS_JQL; else process.env.JIRA_PROJECTS_JQL = prevJql;
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.JIRA_ENABLED = 'true';
  process.env.JIRA_PROJECTS_JQL = 'project = SPS AND issuetype = Epic AND status = "In Progress"';
  mockFetch.mockResolvedValue([]);
  mockSources.mockResolvedValue([{ kind: 'global', jql: 'project = SPS' }]);
  mockCfg.mockResolvedValue(null);
  mockBuild.mockReturnValue('BUILT_JQL');
});

describe('GET /api/projects', () => {
  it('400s without an org', async () => {
    expect((await GET(req(''))).status).toBe(400);
  });

  it('404s when Jira is disabled', async () => {
    process.env.JIRA_ENABLED = 'false';
    expect((await GET(req('?org=o'))).status).toBe(404);
  });

  it('returns boardConfig null for the unfiltered board', async () => {
    const body = await (await GET(req('?org=o'))).json();
    expect(body.boardConfig).toBeNull();
  });

  it('returns the team boardConfig when a configured team is filtered', async () => {
    mockCfg.mockResolvedValue(RESEARCH_CFG);
    const body = await (await GET(req('?org=o&team=Research'))).json();
    expect(body.boardConfig.hierarchy).toBe('owner');
  });

  it('passes the team filter through to source resolution', async () => {
    await GET(req('?org=o&team=Research'));
    expect(mockSources).toHaveBeenCalledWith('o', expect.objectContaining({ team: 'Research' }));
  });

  it('accepts Backlog as a status and passes it as the tab', async () => {
    mockSources.mockResolvedValue([{
      kind: 'team',
      team: { name: 'Research', color: '#7C3AED' },
      projectKeys: ['RND'],
      config: RESEARCH_CFG,
    }]);

    const res = await GET(req('?org=o&team=Research&status=Backlog'));

    expect(res.status).toBe(200);
    expect(mockBuild).toHaveBeenCalledWith(['RND'], 'Backlog', RESEARCH_CFG);
  });

  it('calls fetchProjectEpics with the built JQL and the provenance team', async () => {
    mockSources.mockResolvedValue([{
      kind: 'team',
      team: { name: 'Research', color: '#7C3AED' },
      projectKeys: ['RND'],
      config: RESEARCH_CFG,
    }]);

    await GET(req('?org=o&team=Research'));

    expect(mockFetch).toHaveBeenCalledWith('BUILT_JQL', 'o', {
      provenanceTeam: { name: 'Research', color: '#7C3AED' },
    });
  });

  it('runs the global source with no provenance team', async () => {
    await GET(req('?org=o'));
    expect(mockFetch).toHaveBeenCalledWith('project = SPS', 'o', { provenanceTeam: null });
  });

  it('merges epics from several sources, deduping by key with provenance winning', async () => {
    mockSources.mockResolvedValue([
      { kind: 'global', jql: 'project = SPS' },
      { kind: 'team', team: { name: 'Research', color: '#7C3AED' }, projectKeys: ['RND'], config: RESEARCH_CFG },
    ]);
    mockFetch
      .mockResolvedValueOnce([{ key: 'SPS-1', team: null }, { key: 'RND-1', team: null }])
      .mockResolvedValueOnce([{ key: 'RND-1', team: { name: 'Research', color: '#7C3AED' } }]);

    const body = await (await GET(req('?org=o'))).json();

    expect(body.epics).toHaveLength(2);
    const rnd = body.epics.find((e: any) => e.key === 'RND-1');
    expect(rnd.team).toEqual({ name: 'Research', color: '#7C3AED' });
  });

  it('still 200s when only team sources exist and the global JQL is unset', async () => {
    delete process.env.JIRA_PROJECTS_JQL;
    mockSources.mockResolvedValue([{
      kind: 'team', team: { name: 'Research', color: '#7C3AED' },
      projectKeys: ['RND'], config: RESEARCH_CFG,
    }]);

    expect((await GET(req('?org=o&team=Research'))).status).toBe(200);
  });

  it('404s when neither a global JQL nor any team source exists', async () => {
    delete process.env.JIRA_PROJECTS_JQL;
    mockSources.mockResolvedValue([]);
    expect((await GET(req('?org=o'))).status).toBe(404);
  });

  it('500s with the error message when a source throws', async () => {
    mockFetch.mockRejectedValue(new Error('Jira exploded'));
    const res = await GET(req('?org=o'));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Jira exploded');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="projects-api-board"`
Expected: FAIL — `boardConfig` absent, `Backlog` unhandled.

- [ ] **Step 3: Rewrite the projects route**

Replace `src/app/api/projects/route.ts` entirely:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { fetchProjectEpics, type ProjectEpic } from '@/lib/projects/service';
import { resolveProjectSources, resolveBoardConfig, buildTeamJql } from '@/lib/projects/sources';
import type { BoardTab } from '@/lib/teams/board-config';
import { withRequestLog } from '@/lib/logger';

const TABS: BoardTab[] = ['In Progress', 'Rollout', 'Backlog', 'Done'];

async function getHandler(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  if (!org) {
    return NextResponse.json({ error: 'org query parameter is required' }, { status: 400 });
  }

  if (process.env.JIRA_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Jira integration is not enabled' }, { status: 404 });
  }

  const statusParam = req.nextUrl.searchParams.get('status');
  const tab: BoardTab = TABS.includes(statusParam as BoardTab)
    ? (statusParam as BoardTab)
    : 'In Progress';
  const teamFilter = req.nextUrl.searchParams.get('team');

  // The global source keeps its historical string-surgery behaviour verbatim.
  // Do not "improve" this regex here — see the plan's Global Constraints.
  const baseJql = process.env.JIRA_PROJECTS_JQL;
  let globalJql: string | null = baseJql ?? null;
  if (baseJql) {
    if (tab === 'Rollout') {
      globalJql = baseJql.replace(/status\s*=\s*"[^"]*"/, 'status = "Rollout"');
    } else if (tab === 'Done') {
      globalJql = baseJql.replace(/status\s*=\s*"[^"]*"/, 'statusCategory = "Done"') + ' AND updated >= -30d';
    } else if (tab === 'Backlog') {
      // Backlog is a team-source concept; the global board has no such tab.
      globalJql = null;
    }
  }

  try {
    const sources = await resolveProjectSources(org, { globalJql, team: teamFilter });
    if (sources.length === 0) {
      return NextResponse.json(
        { error: 'No project sources configured. Set JIRA_PROJECTS_JQL or give a team Jira project keys.' },
        { status: 404 },
      );
    }

    const byKey = new Map<string, ProjectEpic>();
    for (const source of sources) {
      const jql = source.kind === 'global'
        ? source.jql
        : buildTeamJql(source.projectKeys, tab, source.config);
      const provenanceTeam = source.kind === 'team' ? source.team : null;
      const epics = await fetchProjectEpics(jql, org, { provenanceTeam });
      for (const epic of epics) {
        // Provenance wins: a team source runs after the global one and overwrites.
        const existing = byKey.get(epic.key);
        if (!existing || provenanceTeam) byKey.set(epic.key, epic);
      }
    }

    const boardConfig = await resolveBoardConfig(org, teamFilter);
    const jiraHost = process.env.JIRA_HOST || null;
    return NextResponse.json({ epics: Array.from(byKey.values()), jiraHost, boardConfig });
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

- [ ] **Step 4: Accept boardConfig on the teams routes**

In `src/app/api/teams/route.ts`, pass `boardConfig` from the POST body into `createTeam`, and return 400 on `BoardConfigError`:

```ts
import { BoardConfigError } from '@/lib/teams/board-config';
```

In the POST handler, extend the `createTeam` call to include `boardConfig: body.boardConfig` and add to its catch:

```ts
    if (err instanceof BoardConfigError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
```

Do the same in `src/app/api/teams/[id]/route.ts` for the PUT handler, passing `boardConfig: body.boardConfig` through to `updateTeam`. Keep `requireAdmin` on both. Keep `withRequestLog` on every export.

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -- --testPathPattern="projects-api-board|logger-enforcement"`
Expected: PASS

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/app/api/projects/route.ts src/app/api/teams/route.ts "src/app/api/teams/[id]/route.ts" src/lib/__tests__/unit/projects-api-board.test.ts
git commit -m "feat(glook-38): resolve project sources in the projects API, accept Backlog tab"
```

---

### Task 6: Mock and seed a research-shaped team

Without this, `npm run dev:mock` cannot exercise the provenance path or the flat hierarchy, and the mock Jira client's `searchEpics` — which **ignores its JQL argument entirely** — would return SPS-shaped fixture epics for a Research source.

**Files:**
- Modify: `scripts/mock-identities.ts:126-147`
- Modify: `scripts/seed-data.ts:305-315`
- Modify: `src/lib/jira/mock-client.ts:33-53`
- Test: `src/lib/__tests__/unit/jira-mock-epics.test.ts`

**Interfaces:**
- Consumes: `BoardConfig` shape (Task 1).
- Produces: `MOCK_TEAMS` entries gain optional `boardConfig`; new `MOCK_RESEARCH_EPICS`; `MockJiraClient.searchEpics` honours a `project in (...)` / `project = X` clause.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/jira-mock-epics.test.ts`:

```ts
import { MockJiraClient } from '@/lib/jira/mock-client';

describe('MockJiraClient.searchEpics project filtering', () => {
  const client = new MockJiraClient();

  it('returns only MOCK epics for a MOCK project clause', async () => {
    const epics = await client.searchEpics('project in ("MOCK") AND issuetype = Epic');
    expect(epics.length).toBeGreaterThan(0);
    expect(epics.every(e => e.key.startsWith('MOCK-'))).toBe(true);
  });

  it('returns only research epics for an RSCH project clause', async () => {
    const epics = await client.searchEpics('project in ("RSCH") AND issuetype = Epic');
    expect(epics.length).toBeGreaterThan(0);
    expect(epics.every(e => e.key.startsWith('RSCH-'))).toBe(true);
  });

  it('handles the `project = X` form as well as `project in (...)`', async () => {
    const epics = await client.searchEpics('project = RSCH AND issuetype = Epic');
    expect(epics.every(e => e.key.startsWith('RSCH-'))).toBe(true);
  });

  it('gives research epics no parent, so the flat-hierarchy path is exercised', async () => {
    const epics = await client.searchEpics('project in ("RSCH")');
    expect(epics.every(e => e.parentKey === null && e.parentTypeName === null)).toBe(true);
  });

  it('gives MOCK epics an Initiative parent, as before', async () => {
    const epics = await client.searchEpics('project in ("MOCK")');
    expect(epics.every(e => e.parentTypeName === 'Initiative')).toBe(true);
  });

  it('returns everything when the JQL names no project (key in (...) batch lookup)', async () => {
    const epics = await client.searchEpics('key in ("MOCK-10","MOCK-20")');
    expect(epics.some(e => e.key.startsWith('MOCK-'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="jira-mock-epics"`
Expected: FAIL — no `RSCH-` epics exist and the JQL is ignored.

- [ ] **Step 3: Add the Research team and its flat epics**

In `scripts/mock-identities.ts`, extend `MockTeam` and `MOCK_TEAMS`:

```ts
export interface MockTeam {
  id: string;
  name: string;
  color: string;
  /** GLOOK-38: per-team board behaviour. Omit for teams that use the default board. */
  boardConfig?: {
    jiraProjectKeys: string[];
    hierarchy: 'goal-initiative' | 'owner';
    middleTab: 'Rollout' | 'Backlog';
    ringMode: 'commits' | 'jira';
    doneWindowDays: number;
    includeRejected: boolean;
  };
}

export const MOCK_TEAMS: MockTeam[] = [
  { id: '00000000-0000-4000-b000-000000000001', name: 'Platform', color: '#2563EB' },
  { id: '00000000-0000-4000-b000-000000000002', name: 'Frontend', color: '#7C3AED' },
  { id: '00000000-0000-4000-b000-000000000003', name: 'Data', color: '#059669' },
  {
    id: '00000000-0000-4000-b000-000000000004',
    name: 'Research',
    color: '#0891B2',
    boardConfig: {
      jiraProjectKeys: ['RSCH'],
      hierarchy: 'owner',
      middleTab: 'Backlog',
      ringMode: 'jira',
      doneWindowDays: 30,
      includeRejected: true,
    },
  },
];
```

Then append a new export — flat epics with no parent, mirroring RND's real shape:

```ts
/**
 * GLOOK-38: research epics are deliberately parentless and span all three
 * board tabs, so the flat-hierarchy and Backlog paths are exercised in mock mode.
 * Assignee emails are intentionally NOT in MOCK_DEVELOPERS: a research team's
 * members may have no GitHub identity, which is exactly what provenance
 * attribution exists to handle.
 */
export interface MockResearchEpic {
  key: string;
  summary: string;
  status: string;
  dueDate: string | null;
  assigneeName: string | null;
  assigneeEmail: string | null;
}

export const MOCK_RESEARCH_EPICS: MockResearchEpic[] = [
  { key: 'RSCH-101', summary: 'Hypothesis: retrieval improves summary faithfulness', status: 'In Progress', dueDate: '2026-05-20', assigneeName: 'Rita Solberg', assigneeEmail: 'rita@mockorg.dev' },
  { key: 'RSCH-102', summary: 'Benchmark small models against the house baseline', status: 'In Progress', dueDate: '2026-05-08', assigneeName: 'Rita Solberg', assigneeEmail: 'rita@mockorg.dev' },
  { key: 'RSCH-103', summary: 'Q2 prompt maintenance sweep', status: 'In Progress', dueDate: null, assigneeName: 'Ivo Brandt', assigneeEmail: 'ivo@mockorg.dev' },
  { key: 'RSCH-201', summary: 'Investigate structured output drift across versions', status: 'Backlog', dueDate: null, assigneeName: 'Ivo Brandt', assigneeEmail: 'ivo@mockorg.dev' },
  { key: 'RSCH-202', summary: 'Edit-nature assessment for post-edit signals', status: 'Backlog', dueDate: null, assigneeName: null, assigneeEmail: null },
  { key: 'RSCH-301', summary: 'Hypothesis: longer context reduces terminology error', status: 'Done', dueDate: '2026-03-31', assigneeName: 'Rita Solberg', assigneeEmail: 'rita@mockorg.dev' },
  { key: 'RSCH-302', summary: 'Fine-tuning is not worth the serving cost', status: 'Rejected', dueDate: '2026-03-15', assigneeName: 'Ivo Brandt', assigneeEmail: 'ivo@mockorg.dev' },
];
```

- [ ] **Step 4: Teach the mock Jira client to honour a project clause**

In `src/lib/jira/mock-client.ts`, replace `searchEpics` (lines 33-53):

```ts
  async searchEpics(jql: string): Promise<Array<{
    key: string; summary: string; status: string; dueDate: string | null;
    assigneeDisplayName: string | null; assigneeEmail: string | null;
    parentKey: string | null; parentSummary: string | null; parentTypeName: string | null;
  }>> {
    const { MOCK_EPICS, MOCK_DEVELOPERS, MOCK_RESEARCH_EPICS } = getIdentities();

    const mockEpics = MOCK_EPICS.map(epic => {
      const dev = MOCK_DEVELOPERS.find(d => d.jiraEmail === epic.assigneeEmail);
      return {
        key: epic.key,
        summary: epic.summary,
        status: 'In Progress',
        dueDate: '2026-05-15' as string | null,
        assigneeDisplayName: dev?.githubName || null,
        assigneeEmail: epic.assigneeEmail as string | null,
        parentKey: epic.initiativeKey as string | null,
        parentSummary: epic.initiativeSummary as string | null,
        parentTypeName: 'Initiative' as string | null,
      };
    });

    // GLOOK-38: parentless research epics, so the flat-hierarchy path has data.
    const researchEpics = MOCK_RESEARCH_EPICS.map(epic => ({
      key: epic.key,
      summary: epic.summary,
      status: epic.status,
      dueDate: epic.dueDate,
      assigneeDisplayName: epic.assigneeName,
      assigneeEmail: epic.assigneeEmail,
      parentKey: null as string | null,
      parentSummary: null as string | null,
      parentTypeName: null as string | null,
    }));

    const all = [...mockEpics, ...researchEpics];

    // Honour a project clause so provenance sources don't cross-contaminate.
    // A JQL with no project clause (the `key in (...)` initiative batch lookup)
    // matches everything, preserving the previous behaviour.
    const keys = extractProjectKeys(jql);
    if (keys.length === 0) return all;
    return all.filter(e => keys.includes(e.key.split('-')[0]));
  }
```

and add this helper above the class:

```ts
/** Pull project keys out of `project in ("A", "B")` or `project = A`. */
function extractProjectKeys(jql: string): string[] {
  const inMatch = jql.match(/project\s+in\s*\(([^)]*)\)/i);
  if (inMatch) {
    return inMatch[1]
      .split(',')
      .map(s => s.trim().replace(/^["']|["']$/g, '').toUpperCase())
      .filter(Boolean);
  }
  const eqMatch = jql.match(/project\s*=\s*["']?([A-Za-z0-9_]+)["']?/i);
  return eqMatch ? [eqMatch[1].toUpperCase()] : [];
}
```

- [ ] **Step 5: Seed the board_config**

In `scripts/seed-data.ts`, replace `seedTeams` (lines 309-315):

```ts
export const seedTeams = MOCK_TEAMS.map(t => ({
  id: t.id,
  org: MOCK_ORG,
  name: t.name,
  color: t.color,
  board_config: t.boardConfig ? JSON.stringify(t.boardConfig) : null,
  created_at: daysAgo(90),
}));
```

> `seed()` derives its column list from `Object.keys(rows[0])`, so **every** row must
> carry the `board_config` key — hence the explicit `: null`, not a conditional spread.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="jira-mock-epics"`
Expected: PASS, 6 tests

- [ ] **Step 7: Verify the mock flow end to end**

```bash
npm run seed:reset
DB_TYPE=sqlite npm run dev:mock
```

`.env.local` sets `DB_TYPE=mysql`, which `dev:mock` does **not** override — without the explicit `DB_TYPE=sqlite` the server reads MySQL while `npm run seed` wrote SQLite, and the board looks empty for reasons unrelated to this change.

Then open `http://localhost:3000/projects?team=Research` and confirm: seven RSCH rows across the three tabs, no Goal/Initiative columns, a Backlog tab, single-arc rings, and every row chipped `Research` despite no `user_mappings` row for Rita or Ivo.

- [ ] **Step 8: Commit**

```bash
git add scripts/mock-identities.ts scripts/seed-data.ts src/lib/jira/mock-client.ts src/lib/__tests__/unit/jira-mock-epics.test.ts
git commit -m "feat(glook-38): mock and seed a research-shaped team with flat epics"
```

---

### Task 7: Extract `ProgressRing` and give it a jira-only mode

`projects-content.tsx` is 1236 lines and `ProgressRing` is an inner component closing over
`maxVolume` and `avgCommitsPerJira` (lines 462-475), which makes it untestable. Extract it
with explicit props. `src/app/projects/progress-ring.tsx` is not a `page.tsx`, so it may
export freely.

**Files:**
- Create: `src/app/projects/progress-ring.tsx`
- Modify: `src/app/projects/projects-content.tsx:604-662` (delete the inner component), `:834-840` (pass new props)
- Test: `src/lib/__tests__/unit/progress-ring.test.tsx`

**Interfaces:**
- Consumes: `BoardRingMode` from `@/lib/teams/board-config` (Task 1).
- Produces: `export interface EpicRingStats`, `export function ProgressRing(props: { stats: EpicRingStats; maxVolume: number; avgCommitsPerJira: number; mode?: BoardRingMode })`. `projects-content.tsx` imports `EpicRingStats` from here rather than re-declaring it.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/progress-ring.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render } from '@testing-library/react';
import { ProgressRing, type EpicRingStats } from '@/app/projects/progress-ring';

const stats = (over: Partial<EpicRingStats> = {}): EpicRingStats => ({
  epicKey: 'RND-1181',
  totalJiras: 6,
  resolvedJiras: 0,
  remainingJiras: 6,
  commitCount: 0,
  devCount: 0,
  linesAdded: 0,
  linesRemoved: 0,
  repos: [],
  cached: false,
  ...over,
});

const MAX_VOLUME = Math.log(31); // RND-1085: 30 child issues

describe('ProgressRing commits mode (unchanged default)', () => {
  it('draws four circles: two tracks and two arcs', () => {
    const { container } = render(
      <ProgressRing stats={stats()} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(4);
  });

  it('shows the developer count in the centre', () => {
    const { getByText } = render(
      <ProgressRing stats={stats({ devCount: 3 })} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />,
    );
    expect(getByText('3')).toBeTruthy();
  });

  it('renders an emerald inner arc', () => {
    const { container } = render(
      <ProgressRing stats={stats()} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />,
    );
    expect(container.querySelector('circle[stroke="#10B981"]')).not.toBeNull();
  });
});

describe('ProgressRing jira mode', () => {
  it('draws only two circles — one track, one amber arc', () => {
    const { container } = render(
      <ProgressRing stats={stats()} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} mode="jira" />,
    );
    expect(container.querySelectorAll('circle')).toHaveLength(2);
    expect(container.querySelector('circle[stroke="#10B981"]')).toBeNull();
    expect(container.querySelector('circle[stroke="#D97706"]')).not.toBeNull();
  });

  it('shows the child-issue count in the centre, not the dev count', () => {
    const { getByText, queryByText } = render(
      <ProgressRing stats={stats({ totalJiras: 6, devCount: 0 })} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} mode="jira" />,
    );
    expect(getByText('6')).toBeTruthy();
    expect(queryByText('0')).toBeNull();
  });

  it('omits commit figures from the tooltip', () => {
    const { container } = render(
      <ProgressRing stats={stats()} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} mode="jira" />,
    );
    expect(container.textContent).toContain('closed');
    expect(container.textContent).not.toContain('of expected');
  });

  it('never shows the AI-speed bolt, since it is lines-per-committer', () => {
    const { container } = render(
      <ProgressRing
        stats={stats({ linesAdded: 46000, devCount: 1 })}
        maxVolume={MAX_VOLUME} avgCommitsPerJira={1} mode="jira"
      />,
    );
    expect(container.textContent).not.toContain('⚡');
  });
});

describe('ProgressRing sizing (identical in both modes)', () => {
  it('renders the largest epic at 48px with a 3px stroke', () => {
    const { container } = render(
      <ProgressRing stats={stats({ totalJiras: 30, resolvedJiras: 30 })} maxVolume={MAX_VOLUME} avgCommitsPerJira={0} mode="jira" />,
    );
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('48');
    expect(container.querySelector('circle')!.getAttribute('stroke-width')).toBe('3');
  });

  it('floors a childless epic at 22px with an 8px stroke', () => {
    const { container } = render(
      <ProgressRing stats={stats({ totalJiras: 0, resolvedJiras: 0 })} maxVolume={MAX_VOLUME} avgCommitsPerJira={0} mode="jira" />,
    );
    expect(container.querySelector('svg')!.getAttribute('width')).toBe('22');
    expect(container.querySelector('circle')!.getAttribute('stroke-width')).toBe('8');
  });

  it('does not divide by zero when maxVolume is 0', () => {
    const { container } = render(
      <ProgressRing stats={stats({ totalJiras: 0 })} maxVolume={0} avgCommitsPerJira={0} mode="jira" />,
    );
    expect(container.querySelector('svg')!.getAttribute('width')).toBe('22');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="progress-ring"`
Expected: FAIL — `Cannot find module '@/app/projects/progress-ring'`

- [ ] **Step 3: Create the extracted component**

Create `src/app/projects/progress-ring.tsx`:

```tsx
'use client';

import type { BoardRingMode } from '@/lib/teams/board-config';

export interface EpicRingStats {
  epicKey: string;
  totalJiras: number;
  resolvedJiras: number;
  remainingJiras: number;
  commitCount: number;
  devCount: number;
  linesAdded: number;
  linesRemoved: number;
  repos: string[];
  cached: boolean;
}

export interface ProgressRingProps {
  stats: EpicRingStats;
  /** Page-wide max of log(commits + jiras + 1), for relative sizing. */
  maxVolume: number;
  /** Page-wide commits-per-jira average, for the inner arc's expected rate. */
  avgCommitsPerJira: number;
  /**
   * 'commits' (default) keeps both arcs. 'jira' drops the commit arc and the
   * developer count — GLOOK-38: a research team's commits mostly reference
   * standalone tasks rather than epic children, so both read as zero and the
   * ring looks broken rather than informative.
   */
  mode?: BoardRingMode;
}

export function ProgressRing({ stats, maxVolume, avgCommitsPerJira, mode = 'commits' }: ProgressRingProps) {
  const jiraOnly = mode === 'jira';

  // Sizing weight = commits + jiras, so jira-only epics still size correctly.
  const volume = Math.log(stats.commitCount + stats.totalJiras + 1);
  const sizePct = maxVolume > 0 ? volume / maxVolume : 0;
  const px = Math.max(22, Math.round(sizePct * 48));

  const jiraPct = stats.totalJiras > 0 ? stats.resolvedJiras / stats.totalJiras : 0;
  const expectedCommits = stats.totalJiras * avgCommitsPerJira;
  const commitPct = expectedCommits > 0 ? Math.min(1, stats.commitCount / expectedCommits) : 0;

  const outerR = 20;
  const innerR = 13;
  const outerCirc = 2 * Math.PI * outerR;
  const innerCirc = 2 * Math.PI * innerR;
  const outerOffset = outerCirc * (1 - jiraPct);
  const innerOffset = innerCirc * (1 - commitPct);

  // Stroke width scales inversely with size for readability
  const stroke = Math.max(3, 8 - sizePct * 5);

  const jiraPctDisplay = Math.round(jiraPct * 100);
  const commitPctDisplay = Math.round(commitPct * 100);

  const totalLines = stats.linesAdded + stats.linesRemoved;
  const linesPerDev = stats.devCount > 0 ? totalLines / stats.devCount : 0;
  const isAiSpeed = !jiraOnly && linesPerDev >= 20000;

  const centre = jiraOnly ? stats.totalJiras : stats.devCount;

  return (
    <div className="relative group" style={{ width: px, height: px }}>
      <svg width={px} height={px} viewBox="0 0 48 48" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="24" cy="24" r={outerR} fill="none" stroke="#1f2937" strokeWidth={stroke} />
        <circle cx="24" cy="24" r={outerR} fill="none" stroke="#D97706" strokeWidth={stroke}
          strokeDasharray={outerCirc} strokeDashoffset={outerOffset} strokeLinecap="round" />
        {!jiraOnly && (
          <>
            <circle cx="24" cy="24" r={innerR} fill="none" stroke="#1f2937" strokeWidth={stroke} />
            <circle cx="24" cy="24" r={innerR} fill="none" stroke="#10B981" strokeWidth={stroke}
              strokeDasharray={innerCirc} strokeDashoffset={innerOffset} strokeLinecap="round" />
          </>
        )}
      </svg>
      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-bold text-gray-200"
        style={{ fontSize: Math.max(7, Math.round(px * 0.28)) }}>
        {centre}
      </span>
      {isAiSpeed && (
        <span className="absolute -top-1 -left-1 text-[10px] leading-none" title="AI speed">⚡</span>
      )}
      {/* Tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20
        bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-xs text-gray-300 whitespace-nowrap shadow-lg">
        Jira: <span className="text-amber-400 font-semibold">{stats.resolvedJiras}/{stats.totalJiras}</span> closed ({jiraPctDisplay}%)
        {!jiraOnly && (
          <>
            {' · '}Commits: <span className="text-emerald-400 font-semibold">{stats.commitCount}</span> ({commitPctDisplay}% of expected)
            {' · '}<span className="text-gray-200 font-semibold">{stats.devCount}</span> dev{stats.devCount !== 1 ? 's' : ''}
          </>
        )}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-700" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Delete the inner component and import the new one**

In `src/app/projects/projects-content.tsx`:
- Delete the `interface EpicRingStats` block at lines 39-50.
- Delete the whole `const ProgressRing = ({ stats }: ...) => { ... };` block at lines 604-662.
- Add to the imports at the top:

```tsx
import { ProgressRing, type EpicRingStats } from './progress-ring';
```

- Replace the ring cell (lines 834-840) with:

```tsx
                        <td className="px-2 py-3 text-center">
                          {ringStats[epic.key] ? (
                            <ProgressRing
                              stats={ringStats[epic.key]}
                              maxVolume={maxVolume}
                              avgCommitsPerJira={avgCommitsPerJira}
                              mode={boardConfig?.ringMode}
                            />
                          ) : (
                            <div className="w-4 h-4 rounded-full bg-gray-800 animate-pulse mx-auto" />
                          )}
                        </td>
```

> `boardConfig` is introduced in Task 8. Until then, pass `mode={undefined}` — the default
> is `'commits'`, i.e. today's rendering — and change it to `boardConfig?.ringMode` in Task 8.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- --testPathPattern="progress-ring"`
Expected: PASS, 10 tests

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Verify the build, since a page-adjacent file changed**

Run: `rm -rf .next && npm run build`
Expected: build succeeds. (`next build` artifacts conflict with `next dev` — always `rm -rf .next` when switching back.)

- [ ] **Step 7: Commit**

```bash
git add src/app/projects/progress-ring.tsx src/app/projects/projects-content.tsx src/lib/__tests__/unit/progress-ring.test.tsx
git commit -m "refactor(glook-38): extract ProgressRing and add a jira-only ring mode"
```

---

### Task 8: Board-config-driven columns, tabs and team-scoped fetching

The largest task. Four coupled changes to one file — they must land together or the table's
column count desynchronises from its `colgroup`.

**Files:**
- Modify: `src/app/projects/projects-content.tsx` — lines 59-60 (tab constants), 72 (tabCache key), 344-386 (SWR + preload + cache), 488-528 (spans), 745-763 (tabs JSX), 769-791 (colgroup + thead), 806-833 (goal/init cells), 991-1054 (Lead cell), 1067-1236 (untracked block)
- Test: `src/lib/__tests__/unit/projects-board-layout.test.ts`

**Interfaces:**
- Consumes: `BoardConfig`, `BoardTab` (Task 1); `boardConfig` from the `/api/projects` response (Task 5); `ProgressRing` (Task 7).
- Produces: `src/app/projects/board-layout.ts` exporting `visibleTabs(config)`, `columnLayout(config)`, `computeSpans(epics, mode)`.

> The pure logic goes in a sibling module so it is unit-testable without jsdom. Only the
> JSX stays in `projects-content.tsx`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/projects-board-layout.test.ts`:

```ts
import { visibleTabs, columnLayout, computeSpans } from '@/app/projects/board-layout';
import { DEFAULT_BOARD_CONFIG } from '@/lib/teams/board-config';

const cfg = (over: Partial<typeof DEFAULT_BOARD_CONFIG> = {}) => ({ ...DEFAULT_BOARD_CONFIG, ...over });

describe('visibleTabs', () => {
  it('shows Rollout for the default board', () => {
    expect(visibleTabs(null)).toEqual(['In Progress', 'Rollout', 'Done']);
  });

  it('shows Rollout when a config leaves middleTab alone', () => {
    expect(visibleTabs(cfg())).toEqual(['In Progress', 'Rollout', 'Done']);
  });

  it('swaps in Backlog when configured', () => {
    expect(visibleTabs(cfg({ middleTab: 'Backlog' }))).toEqual(['In Progress', 'Backlog', 'Done']);
  });
});

describe('columnLayout', () => {
  it('gives the default board seven columns summing to 100%', () => {
    const layout = columnLayout(null);
    expect(layout.headers).toEqual(['Business Goal', 'Initiative', '', 'Epic', 'Due', 'Lead', 'Team']);
    expect(layout.widths).toHaveLength(7);
    expect(layout.widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(layout.showHierarchy).toBe(true);
    expect(layout.showOwnerColumn).toBe(false);
  });

  it('gives owner mode six columns summing to 100%, with Researcher first and Status split out', () => {
    const layout = columnLayout(cfg({ hierarchy: 'owner' }));
    expect(layout.headers).toEqual(['Researcher', '', 'Epic', 'Due', 'Status', 'Team']);
    expect(layout.widths.reduce((a, b) => a + b, 0)).toBe(100);
    expect(layout.showHierarchy).toBe(false);
    expect(layout.showOwnerColumn).toBe(true);
  });

  it('keeps the ring column at 4% in both layouts', () => {
    expect(columnLayout(null).widths[2]).toBe(4);
    expect(columnLayout(cfg({ hierarchy: 'owner' })).widths[1]).toBe(4);
  });
});

type Row = { key: string; assignee: string | null; goal: { summary: string } | null; initiative: { summary: string } | null };

const epic = (key: string, assignee: string | null, goal?: string, init?: string): Row => ({
  key,
  assignee,
  goal: goal ? { summary: goal } : null,
  initiative: init ? { summary: init } : null,
});

describe('computeSpans in goal-initiative mode', () => {
  it('merges consecutive rows sharing a goal and initiative', () => {
    const rows = [
      epic('A', null, 'G1', 'I1'),
      epic('B', null, 'G1', 'I1'),
      epic('C', null, 'G1', 'I2'),
    ];
    const spans = computeSpans(rows, 'goal-initiative');

    expect(spans[0].showPrimary).toBe(true);
    expect(spans[0].primarySpan).toBe(3);   // all three share G1
    expect(spans[0].showSecondary).toBe(true);
    expect(spans[0].secondarySpan).toBe(2); // A and B share I1
    expect(spans[1].showPrimary).toBe(false);
    expect(spans[2].showSecondary).toBe(true);
    expect(spans[2].secondarySpan).toBe(1);
  });

  it('treats a null goal as its own group rather than crashing', () => {
    const spans = computeSpans([epic('A', null), epic('B', null)], 'goal-initiative');
    expect(spans[0].primarySpan).toBe(2);
    expect(spans[1].showPrimary).toBe(false);
  });
});

describe('computeSpans in owner mode', () => {
  it('merges consecutive rows sharing an assignee', () => {
    const rows = [
      epic('A', 'Daria Akselrod'),
      epic('B', 'Daria Akselrod'),
      epic('C', 'Attila Jamilov'),
    ];
    const spans = computeSpans(rows, 'owner');

    expect(spans[0].showPrimary).toBe(true);
    expect(spans[0].primarySpan).toBe(2);
    expect(spans[1].showPrimary).toBe(false);
    expect(spans[2].showPrimary).toBe(true);
    expect(spans[2].primarySpan).toBe(1);
  });

  it('groups unassigned rows together', () => {
    const spans = computeSpans([epic('A', null), epic('B', null)], 'owner');
    expect(spans[0].primarySpan).toBe(2);
  });

  it('never emits a secondary span, since owner mode has no second merged column', () => {
    const spans = computeSpans([epic('A', 'X'), epic('B', 'X')], 'owner');
    expect(spans.every(s => s.showSecondary === false)).toBe(true);
  });

  it('returns one span entry per row', () => {
    const rows = [epic('A', 'X'), epic('B', 'Y'), epic('C', 'Y')];
    expect(computeSpans(rows, 'owner')).toHaveLength(3);
  });

  it('handles an empty list', () => {
    expect(computeSpans([], 'owner')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="projects-board-layout"`
Expected: FAIL — `Cannot find module '@/app/projects/board-layout'`

- [ ] **Step 3: Create the layout module**

Create `src/app/projects/board-layout.ts`:

```ts
import type { BoardConfig, BoardHierarchy, BoardTab } from '@/lib/teams/board-config';

/** Every tab the URL may legally carry, across all board configurations. */
export const ALL_TABS: BoardTab[] = ['In Progress', 'Rollout', 'Backlog', 'Done'];

/**
 * The three tabs a given board shows. The middle slot is Rollout by default;
 * a research board swaps it for Backlog, where its queued hypotheses live.
 */
export function visibleTabs(config: BoardConfig | null): BoardTab[] {
  const middle: BoardTab = config?.middleTab === 'Backlog' ? 'Backlog' : 'Rollout';
  return ['In Progress', middle, 'Done'];
}

export interface ColumnLayout {
  headers: string[];
  widths: number[];
  showHierarchy: boolean;
  showOwnerColumn: boolean;
}

/**
 * Column set for the board. Widths must sum to 100 and headers must have the
 * same length as widths — the table is `table-fixed`, so a mismatch silently
 * misaligns every row.
 */
export function columnLayout(config: BoardConfig | null): ColumnLayout {
  if (config?.hierarchy === 'owner') {
    return {
      headers: ['Researcher', '', 'Epic', 'Due', 'Status', 'Team'],
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

export interface RowSpan {
  primarySpan: number;
  secondarySpan: number;
  showPrimary: boolean;
  showSecondary: boolean;
  primaryGroupId: string;
  secondaryGroupId: string;
}

interface SpannableRow {
  assignee: string | null;
  goal: { summary: string } | null;
  initiative: { summary: string } | null;
}

/**
 * Run-length merging over *consecutive* rows — non-adjacent rows sharing a key
 * are deliberately not merged, matching the existing board's behaviour.
 *
 * In 'goal-initiative' mode primary = goal, secondary = initiative. In 'owner'
 * mode primary = assignee and there is no secondary column.
 */
export function computeSpans<T extends SpannableRow>(rows: T[], mode: BoardHierarchy): RowSpan[] {
  const primaryOf = (r: T) => mode === 'owner'
    ? (r.assignee || '—')
    : (r.goal?.summary || '—');
  const secondaryOf = (r: T) => mode === 'owner'
    ? ''
    : (r.goal?.summary || '—') + '|' + (r.initiative?.summary || '—');

  const result: RowSpan[] = [];
  for (let i = 0; i < rows.length; i++) {
    const pKey = primaryOf(rows[i]);
    const sKey = secondaryOf(rows[i]);

    let primarySpan = 0;
    for (let j = i; j < rows.length; j++) {
      if (primaryOf(rows[j]) === pKey) primarySpan++;
      else break;
    }

    let secondarySpan = 0;
    for (let j = i; j < rows.length; j++) {
      if (secondaryOf(rows[j]) === sKey) secondarySpan++;
      else break;
    }

    const showPrimary = i === 0 || primaryOf(rows[i - 1]) !== pKey;
    const showSecondary = mode === 'owner'
      ? false
      : (i === 0 || secondaryOf(rows[i - 1]) !== sKey);

    result.push({
      primarySpan,
      secondarySpan,
      showPrimary,
      showSecondary,
      primaryGroupId: `p-${pKey}`,
      secondaryGroupId: `s-${sKey}`,
    });
  }
  return result;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --testPathPattern="projects-board-layout"`
Expected: PASS, 14 tests

- [ ] **Step 5: Wire it into the component**

In `src/app/projects/projects-content.tsx`:

Replace lines 59-60:

```tsx
import { ALL_TABS, visibleTabs, columnLayout, computeSpans } from './board-layout';
import type { BoardConfig, BoardTab } from '@/lib/teams/board-config';

type StatusTab = BoardTab;
```

Change the `activeTab` URL state (line 64-70) to validate against every legal tab:

```tsx
  const [activeTab, setActiveTab] = useUrlState<StatusTab>({
    key: 'status',
    type: 'enum',
    values: ALL_TABS,
    default: 'In Progress',
    history: 'push',
  });
```

Add board-config state next to `jiraHost` (line 80):

```tsx
  const [boardConfig, setBoardConfig] = useState<BoardConfig | null>(null);
```

Key the tab cache by tab **and** team — the same tab holds different epics per team
(line 72):

```tsx
  const [tabCache, setTabCache] = useState<Record<string, { epics: ProjectEpic[]; jiraHost: string | null }>>({});
```

Include the team in the SWR key, the cache key and the preload keys (lines 344-386):

```tsx
  const cacheKey = `${activeTab}|${filterTeam}`;
  const tabUrl = org
    ? `/api/projects?org=${encodeURIComponent(org)}&status=${encodeURIComponent(activeTab)}`
      + (filterTeam && filterTeam !== '__none__' ? `&team=${encodeURIComponent(filterTeam)}` : '')
    : null;
  const { data: tabData, isLoading: tabLoading, error: tabError } = useSWR(tabUrl, { revalidateIfStale: false });

  useEffect(() => {
    if (tabData?.epics) {
      const epics = applyPendingTransitions(tabData.epics, activeTab, pendingTransitionsRef.current);
      setTabCache(prev => ({ ...prev, [cacheKey]: { epics, jiraHost: tabData.jiraHost } }));
      setJiraHost(tabData.jiraHost);
      setBoardConfig(tabData.boardConfig ?? null);
    }
  }, [tabData, activeTab, cacheKey]);
```

For the preload effect, make it one-shot per org **and** team, and preload only the tabs
this board actually shows:

```tsx
  const preloadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!org || !tabData) return;
    const key = `${org}|${filterTeam}`;
    if (preloadedKeyRef.current === key) return;
    preloadedKeyRef.current = key;
    const teamParam = filterTeam && filterTeam !== '__none__' ? `&team=${encodeURIComponent(filterTeam)}` : '';
    for (const tab of visibleTabs(tabData.boardConfig ?? null).filter(t => t !== activeTab)) {
      preload(`/api/projects?org=${encodeURIComponent(org)}&status=${encodeURIComponent(tab)}${teamParam}`, fetcher);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot per org+team; re-running would race optimistic mutations
  }, [org, filterTeam, tabData]);

  const epics = useMemo(() => tabCache[cacheKey]?.epics || [], [tabCache, cacheKey]);
```

Guard against a tab that the newly-selected team does not offer — switching from a
Backlog board to a Rollout board while sitting on Backlog would otherwise show a
permanently empty table with no active tab:

```tsx
  const tabs = useMemo(() => visibleTabs(boardConfig), [boardConfig]);
  useEffect(() => {
    if (!tabs.includes(activeTab)) setActiveTab('In Progress');
  }, [tabs, activeTab, setActiveTab]);
```

Replace the `spans` and `epicGroupMap` memos (lines 488-528) with:

```tsx
  const layout = useMemo(() => columnLayout(boardConfig), [boardConfig]);

  // In owner mode the merged column is the assignee, so rows must be ordered by
  // assignee for run-length merging to produce one block per person. The service
  // sorts by goal → initiative → summary, which is meaningless for a flat project.
  const orderedEpics = useMemo(() => {
    if (boardConfig?.hierarchy !== 'owner') return filteredEpics;
    return [...filteredEpics].sort((a, b) => {
      const an = a.assignee || '￿';
      const bn = b.assignee || '￿';
      if (an !== bn) return an.localeCompare(bn);
      return a.summary.localeCompare(b.summary);
    });
  }, [filteredEpics, boardConfig]);

  const spans = useMemo(
    () => computeSpans(orderedEpics, boardConfig?.hierarchy ?? 'goal-initiative'),
    [orderedEpics, boardConfig],
  );

  const epicGroupMap = useMemo(() => {
    const map = new Map<string, { primaryGroupId: string; secondaryGroupId: string }>();
    for (let i = 0; i < orderedEpics.length; i++) {
      map.set(orderedEpics[i].key, {
        primaryGroupId: spans[i].primaryGroupId,
        secondaryGroupId: spans[i].secondaryGroupId,
      });
    }
    return map;
  }, [orderedEpics, spans]);
```

Then, throughout the render, replace every `filteredEpics.map(...)` over table rows with
`orderedEpics.map(...)`, and every `filteredEpics.length === 0` table guard with
`orderedEpics.length === 0`. Leave `filteredEpics` in place for the footer count and the
filter-option derivations.

Replace the tabs JSX (lines 745-763) so it renders the configured tab set and a label that
follows the window:

```tsx
          {/* Status tabs — below filters */}
          <div className="flex border-b border-gray-800 mb-4">
            {tabs.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-xs font-medium transition-colors relative ${
                  activeTab === tab ? 'text-accent-lighter' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab}{tab === 'Done' ? ` (${boardConfig?.doneWindowDays ?? 30}d)` : ''}
                {activeTab === tab && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-light rounded-t" />
                )}
              </button>
            ))}
          </div>

          {epics.length === 0 ? (
            <div className="text-gray-500 py-8">No epics with status &ldquo;{activeTab}&rdquo;{activeTab === 'Done' ? ` in the last ${boardConfig?.doneWindowDays ?? 30} days` : ''}.</div>
          ) : orderedEpics.length === 0 ? (
            <div className="text-gray-500 py-8">No epics match the selected filters.</div>
```

Replace the `<colgroup>` and `<thead>` (lines 772-791) with layout-driven markup:

```tsx
                <colgroup>
                  {layout.widths.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
                </colgroup>
                <thead>
                  <tr className="bg-gray-900/50 text-gray-400 text-left text-xs uppercase tracking-wider">
                    {layout.headers.map((h, i) => (
                      <th key={i} className={h === '' ? 'px-2 py-3 font-medium' : 'px-4 py-3 font-medium'}>{h}</th>
                    ))}
                  </tr>
                </thead>
```

Replace the row-open destructure (line 794-797) and the two merged cells (806-833) with:

```tsx
                  {orderedEpics.map((epic, i) => {
                    const { primarySpan, secondarySpan, showPrimary, showSecondary, primaryGroupId, secondaryGroupId } = spans[i];
                    const hoveredGroups = hoveredEpic ? epicGroupMap.get(hoveredEpic) : null;
                    const isPrimaryHovered = hoveredGroups?.primaryGroupId === primaryGroupId;
                    const isSecondaryHovered = hoveredGroups?.secondaryGroupId === secondaryGroupId;

                    return (
                      <tr
                        key={epic.key}
                        className={`border-b border-gray-800/50 transition-colors ${hoveredEpic === epic.key ? 'bg-gray-800/30' : ''}`}
                        onMouseEnter={() => setHoveredEpic(epic.key)}
                        onMouseLeave={() => setHoveredEpic(null)}
                      >
                        {layout.showOwnerColumn && showPrimary && (
                          <td
                            className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isPrimaryHovered && hoveredEpic !== epic.key ? 'bg-gray-800/30' : ''}`}
                            rowSpan={primarySpan}
                          >
                            {epic.assignee
                              ? <span className="text-gray-300 text-[13px]">{epic.assignee}</span>
                              : <span className="text-gray-600">Unassigned</span>}
                          </td>
                        )}
                        {layout.showHierarchy && showPrimary && (
                          <td
                            className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isPrimaryHovered && hoveredEpic !== epic.key ? 'bg-gray-800/30' : ''}`}
                            rowSpan={primarySpan}
                          >
                            {epic.goal ? (
                              <a href={jiraHost ? `https://${jiraHost}/browse/${epic.goal.key}` : '#'} target="_blank" rel="noopener noreferrer" className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-accent-bg/30 text-accent-lighter hover:text-white transition-colors">
                                {epic.goal.summary}
                              </a>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                        )}
                        {layout.showHierarchy && showSecondary && (
                          <td
                            className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isSecondaryHovered && hoveredEpic !== epic.key ? 'bg-gray-800/30' : ''}`}
                            rowSpan={secondarySpan}
                          >
                            {epic.initiative ? (
                              <a href={jiraHost ? `https://${jiraHost}/browse/${epic.initiative.key}` : '#'} target="_blank" rel="noopener noreferrer" className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:text-white transition-colors">
                                {epic.initiative.summary}
                              </a>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                        )}
```

In the Lead cell (lines 991-1054), the assignee name must disappear in owner mode — it is
already the merged first column. Change line 991-992 to:

```tsx
                        <td className="px-4 py-3 text-gray-300">
                          {!layout.showOwnerColumn && <div>{epic.assignee || '—'}</div>}
                          <div className={layout.showOwnerColumn ? '' : 'mt-0.5'}>
```

Leave the rest of that cell — the interactive status dropdown — exactly as it is. It is the
Status column in owner mode and the status line under the name otherwise.

Finally, suppress the untracked-work block. Its rows (lines 1067-1236) hard-code seven cells
and their own `rowSpan={totalRows}`, so they would misalign against a six-column layout —
and untracked work is commit-derived, which is precisely what a research board should not be
judged on. Wrap the trigger button and the block in `!boardConfig &&`:

```tsx
                  {!boardConfig && untrackedTeams.map(team => (
```

and in the footer bar, gate the "Show work outside projects" button the same way:

```tsx
            {!boardConfig && activeTab === 'In Progress' && untrackedTeams.length === 0 && !untrackedLoading && (
```

- [ ] **Step 6: Run tests, typecheck and build**

Run: `npm test`
Expected: PASS

Run: `npx tsc --noEmit`
Expected: no errors

Run: `rm -rf .next && npm run build`
Expected: build succeeds. `projects-content.tsx` is not a `page.tsx`, so it may export
freely — but `src/app/projects/page.tsx` must still export only `default`.

- [ ] **Step 7: Verify both boards by eye**

```bash
rm -rf .next
npm run seed:reset
DB_TYPE=sqlite npm run dev:mock
```

- `http://localhost:3000/projects` — unchanged: seven columns, Goal/Initiative merged, Rollout tab, `Done (30d)`, two-arc rings, "Show work outside projects" present.
- `http://localhost:3000/projects?team=Research` — six columns led by Researcher, no Goal/Initiative, Backlog tab with two rows, single-arc rings with child counts, no untracked button.
- Switch the team filter from Research back to All teams while on the Backlog tab and confirm it falls back to In Progress rather than showing an empty table.

- [ ] **Step 8: Commit**

```bash
git add src/app/projects/board-layout.ts src/app/projects/projects-content.tsx src/lib/__tests__/unit/projects-board-layout.test.ts
git commit -m "feat(glook-38): drive board columns, tabs and fetching from per-team board config"
```

---

### Task 9: Settings UI for a team's board config

**Files:**
- Modify: `src/app/settings/page.tsx:385-475` (the `TeamsTab`)
- Test: `src/lib/__tests__/unit/teams-board-config-form.test.tsx`

**Interfaces:**
- Consumes: `PUT /api/teams/[id]` accepting `boardConfig` (Task 5); `BoardConfig` (Task 1).
- Produces: no new exports. `src/app/settings/page.tsx` may export only `default` — put any helper in a sibling module if one is needed.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/teams-board-config-form.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { buildBoardConfigPayload } from '@/app/settings/board-config-form';

describe('buildBoardConfigPayload', () => {
  it('returns null when no project keys are given, so the team keeps the default board', () => {
    expect(buildBoardConfigPayload({
      projectKeysRaw: '   ',
      hierarchy: 'owner', middleTab: 'Backlog', ringMode: 'jira',
      doneWindowDays: '30', includeRejected: true,
    })).toBeNull();
  });

  it('splits, trims and uppercases a comma-separated key list', () => {
    const payload = buildBoardConfigPayload({
      projectKeysRaw: ' rnd , lab ',
      hierarchy: 'owner', middleTab: 'Backlog', ringMode: 'jira',
      doneWindowDays: '30', includeRejected: true,
    })!;
    expect(payload.jiraProjectKeys).toEqual(['RND', 'LAB']);
  });

  it('coerces doneWindowDays to a number', () => {
    const payload = buildBoardConfigPayload({
      projectKeysRaw: 'RND',
      hierarchy: 'owner', middleTab: 'Backlog', ringMode: 'jira',
      doneWindowDays: '14', includeRejected: false,
    })!;
    expect(payload.doneWindowDays).toBe(14);
    expect(payload.includeRejected).toBe(false);
  });

  it('drops empty entries from a trailing comma', () => {
    const payload = buildBoardConfigPayload({
      projectKeysRaw: 'RND,',
      hierarchy: 'goal-initiative', middleTab: 'Rollout', ringMode: 'commits',
      doneWindowDays: '30', includeRejected: false,
    })!;
    expect(payload.jiraProjectKeys).toEqual(['RND']);
  });

  it('falls back to 30 for an unparseable window', () => {
    const payload = buildBoardConfigPayload({
      projectKeysRaw: 'RND',
      hierarchy: 'owner', middleTab: 'Backlog', ringMode: 'jira',
      doneWindowDays: 'abc', includeRejected: true,
    })!;
    expect(payload.doneWindowDays).toBe(30);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- --testPathPattern="teams-board-config-form"`
Expected: FAIL — `Cannot find module '@/app/settings/board-config-form'`

- [ ] **Step 3: Create the sibling helper**

Create `src/app/settings/board-config-form.ts`:

```ts
import type { BoardConfig } from '@/lib/teams/board-config';

export interface BoardConfigFormState {
  projectKeysRaw: string;
  hierarchy: BoardConfig['hierarchy'];
  middleTab: BoardConfig['middleTab'];
  ringMode: BoardConfig['ringMode'];
  doneWindowDays: string;
  includeRejected: boolean;
}

/**
 * Turn form state into a PUT payload. Returns null when no Jira project keys are
 * set: without them there is no provenance source, so the team should carry no
 * board_config at all rather than a half-configured one.
 */
export function buildBoardConfigPayload(form: BoardConfigFormState): BoardConfig | null {
  const jiraProjectKeys = form.projectKeysRaw
    .split(',')
    .map(k => k.trim().toUpperCase())
    .filter(Boolean);

  if (jiraProjectKeys.length === 0) return null;

  const parsed = parseInt(form.doneWindowDays, 10);
  return {
    jiraProjectKeys,
    hierarchy: form.hierarchy,
    middleTab: form.middleTab,
    ringMode: form.ringMode,
    doneWindowDays: Number.isFinite(parsed) && parsed >= 1 && parsed <= 365 ? parsed : 30,
    includeRejected: form.includeRejected,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- --testPathPattern="teams-board-config-form"`
Expected: PASS, 5 tests

- [ ] **Step 5: Add form state to TeamsTab**

In `src/app/settings/page.tsx`, add these hooks immediately after `formMembers` (line 395):

```tsx
  const [formProjectKeys, setFormProjectKeys] = useState('');
  const [formHierarchy, setFormHierarchy] = useState<'goal-initiative' | 'owner'>('goal-initiative');
  const [formMiddleTab, setFormMiddleTab] = useState<'Rollout' | 'Backlog'>('Rollout');
  const [formRingMode, setFormRingMode] = useState<'commits' | 'jira'>('commits');
  const [formDoneWindow, setFormDoneWindow] = useState('30');
  const [formIncludeRejected, setFormIncludeRejected] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
```

Add the import at the top of the file:

```tsx
import { buildBoardConfigPayload } from './board-config-form';
```

In `resetForm` (lines 414-421), add before `setEditingTeam(null)`:

```tsx
    setFormProjectKeys('');
    setFormHierarchy('goal-initiative');
    setFormMiddleTab('Rollout');
    setFormRingMode('commits');
    setFormDoneWindow('30');
    setFormIncludeRejected(false);
    setBoardError(null);
```

In `openEdit` (lines 424-432), add before `setShowForm(true)`:

```tsx
    const bc = team.board_config || {};
    setFormProjectKeys((bc.jiraProjectKeys || []).join(', '));
    setFormHierarchy(bc.hierarchy || 'goal-initiative');
    setFormMiddleTab(bc.middleTab || 'Rollout');
    setFormRingMode(bc.ringMode || 'commits');
    setFormDoneWindow(String(bc.doneWindowDays ?? 30));
    setFormIncludeRejected(Boolean(bc.includeRejected));
    setBoardError(null);
```

Replace `save()` (lines 434-448) so it sends the config and surfaces a 400 inline rather
than through `alert`:

```tsx
  async function save() {
    setBoardError(null);
    const boardConfig = buildBoardConfigPayload({
      projectKeysRaw: formProjectKeys,
      hierarchy: formHierarchy,
      middleTab: formMiddleTab,
      ringMode: formRingMode,
      doneWindowDays: formDoneWindow,
      includeRejected: formIncludeRejected,
    });
    const body = { org, name: formName, color: formColor, members: formMembers, boardConfig };
    try {
      const url = editingTeam ? `/api/teams/${editingTeam.id}` : '/api/teams';
      const method = editingTeam ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json();
        // 400 is a board_config validation failure — show it next to the fields.
        if (res.status === 400) setBoardError(d.error || 'Invalid board settings');
        else alert(d.error || 'Failed');
        return;
      }
      loadTeams();
      setShowForm(false);
      resetForm();
    } catch { alert('Network error'); }
  }
```

- [ ] **Step 6: Add the Board fields to the form JSX**

Inside the team form in `TeamsTab`, after the members field and before the Save/Cancel
buttons, insert:

```tsx
          <div className="mt-4 pt-4 border-t border-gray-800">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-2">
              Board
            </div>

            <label className="block text-xs text-gray-400 mb-1">Jira project keys</label>
            <input
              type="text"
              value={formProjectKeys}
              onChange={e => setFormProjectKeys(e.target.value)}
              placeholder="RND"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-accent"
            />
            <p className="text-[11px] text-gray-600 mt-1">
              Comma-separated. Epics in these projects belong to this team regardless of who commits.
              Leave blank to use the standard board.
            </p>

            {formProjectKeys.trim() !== '' && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Group rows by</label>
                  <select
                    value={formHierarchy}
                    onChange={e => setFormHierarchy(e.target.value as 'goal-initiative' | 'owner')}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent cursor-pointer"
                  >
                    <option value="goal-initiative">Goal and initiative</option>
                    <option value="owner">Person</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Middle tab</label>
                  <select
                    value={formMiddleTab}
                    onChange={e => setFormMiddleTab(e.target.value as 'Rollout' | 'Backlog')}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent cursor-pointer"
                  >
                    <option value="Rollout">Rollout</option>
                    <option value="Backlog">Backlog</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Progress ring</label>
                  <select
                    value={formRingMode}
                    onChange={e => setFormRingMode(e.target.value as 'commits' | 'jira')}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent cursor-pointer"
                  >
                    <option value="commits">Jira and commits</option>
                    <option value="jira">Jira only</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Keep finished work</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={365}
                      value={formDoneWindow}
                      onChange={e => setFormDoneWindow(e.target.value)}
                      className="w-20 bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent"
                    />
                    <span className="text-xs text-gray-500">days</span>
                  </div>
                </div>

                <div className="col-span-2">
                  <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formIncludeRejected}
                      onChange={e => setFormIncludeRejected(e.target.checked)}
                      className="accent-amber-600"
                    />
                    Include rejected work
                  </label>
                  <p className="text-[11px] text-gray-600 mt-1">
                    Rejected items carry no resolution date, so this also matches on last updated.
                  </p>
                </div>
              </div>
            )}

            {boardError && (
              <div className="mt-2 text-xs text-red-400">{boardError}</div>
            )}
          </div>
```

- [ ] **Step 7: Verify, typecheck and build**

Run: `npm test && npx tsc --noEmit && rm -rf .next && npm run build`
Expected: all pass

`src/app/settings/page.tsx` may export **only** `default` — the helper lives in
`board-config-form.ts` for exactly this reason. A stray export passes `npm test` and
`tsc --noEmit` and fails only at `npm run build`, so do not skip the build.

Then `DB_TYPE=sqlite npm run dev:mock`, open `http://localhost:3000/settings#teams`, clear
Research's project keys, save, and confirm `/projects?team=Research` reverts to the default
seven-column board. Restore `RSCH` and confirm it flips back.

- [ ] **Step 8: Commit**

```bash
git add src/app/settings/page.tsx src/app/settings/board-config-form.ts src/lib/__tests__/unit/teams-board-config-form.test.tsx
git commit -m "feat(glook-38): configure a team's board from Settings"
```

---

## Deferred, with reasons

- **The `status` vs `statusCategory` regex** at `src/app/api/projects/route.ts` is fragile and
  silently no-ops for the JQL form this codebase's own validation message recommends. Left
  untouched deliberately: fixing it changes what the SPS board returns, which this ticket
  should not risk. Own ticket.
- **`docs/projects-page.md` is stale** — claims a 14-day window where `epic-stats.ts:53-60`
  and `epic-summary.ts` both use 90 days.
- **`team.color` is unused** on the Projects page; every team chip renders the same accent
  amber (`projects-content.tsx:1057`).
- **`/api/projects` and `GET /api/teams` are unauthenticated**, and
  `/api/report/[id]/team-pulse` lacks the `requireAdmin` its spec called for.
- **Cloud-sync duplicate files** (`projects-content 2.tsx`, `team-pulse-data.test 2.ts`, and
  ~30 more) litter `src/app/projects/`, `src/lib/team-pulse/` and `src/lib/__tests__/unit/`.
  They do not run — Jest's `testMatch` requires a `.test.ts` suffix and ` 2.ts` does not
  match — but they are a trap when grepping. Worth a cleanup commit of its own.

## Self-review notes

**Spec coverage.** All four decisions map to tasks: hierarchy → 8, middle tab → 8, Done
window + rejected → 4 (JQL) and 8 (label), ring → 7. `board_config` → 1-2. Provenance → 3-5.
Parentless epics → 3. Mock/seed → 6. Settings → 9.

**One spec correction.** The spec proposed adding a `?team=` query param for deep-linking.
It already exists: `filterTeam` is `useUrlState({ key: 'team' })` at
`projects-content.tsx:83`. What was actually missing is passing the team to the *API*, which
Task 8 does. No separate deep-link task is needed.

**Not covered, deliberately.** `epic-stats`/`epic-summary` still compute commit figures for
research epics even in `ringMode: 'jira'` — the work is wasted but harmless, and skipping it
would mean a second config path through the stats endpoint. Revisit if the extra Jira calls
show up as latency.

