# GLOOK-11 Per-Team Current Projects on Team Pulse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-team "Current Projects" card on the Team Pulse page (`/report/[id]/team`), derived from GitHub activity, generated lazily alongside the team pulse and cached in `team_pulse_summaries`.

**Architecture:** Add a second LLM step inside `getTeamPulse()` that clusters team members' commits + Jira issues into named projects. Cache result as JSON column on `team_pulse_summaries`. Extract the existing inline projects card from `llm-findings.tsx` into a reusable `<ProjectsCard>` and render it on both surfaces.

**Tech Stack:** Next.js 15 · TypeScript · Jest + ts-jest · MySQL/SQLite · OpenAI SDK · existing `loadPrompt` template system · existing `promptTag` mock-fixture mechanism

**Source spec:** `docs/superpowers/specs/2026-05-27-glook-11-team-projects-design.md`

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `schema.sql` | modify | Add `team_pulse_summaries` CREATE TABLE (currently missing — table is created at runtime) and the new `projects` JSON column |
| `src/lib/team-pulse/types.ts` | create | `TeamProject` interface (shared by service, generator, UI) |
| `src/lib/team-pulse/data.ts` | modify | Add `extractTeamProjectsData()` — full-report-window commit + jira pull, team-filtered |
| `src/lib/team-pulse/projects.ts` | create | `generateTeamProjects()` — LLM call + validation; pure orchestration |
| `prompts/team-pulse-projects.txt` | create | New LLM prompt template |
| `src/lib/llm-mock.ts` | modify | Add `team-pulse-projects` fixture |
| `src/lib/team-pulse/service.ts` | modify | Wire projects step into `getTeamPulse()`, persist + restore from JSON column |
| `src/components/ProjectsCard.tsx` | create | Extracted reusable card (props-driven) |
| `src/app/llm-findings.tsx` | modify | Swap inline JSX for `<ProjectsCard>` |
| `src/app/report/[id]/team/page.tsx` | modify | Fetch team pulse, render `<ProjectsCard>` between pulse summary and dev table |
| `src/lib/__tests__/unit/team-projects-data.test.ts` | create | Tests for extractor |
| `src/lib/__tests__/unit/team-projects-generator.test.ts` | create | Tests for generator + validation |
| `src/lib/__tests__/unit/team-pulse.test.ts` | modify | Add cache-hit-with-projects + cache-hit-without-projects (legacy) test cases |

---

## Task 1: Schema migration — `team_pulse_summaries` + `projects` column

**Files:**
- Modify: `schema.sql`

The `team_pulse_summaries` table is currently created at runtime in the team-pulse service but is missing from `schema.sql`. This task adds the canonical definition AND the new `projects` column in one shot.

- [ ] **Step 1: Open `schema.sql` and add the table definition** at the end of the file, before the last `;`:

```sql
CREATE TABLE IF NOT EXISTS team_pulse_summaries (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  report_id       VARCHAR(36)  NOT NULL,
  team_name       VARCHAR(255) NOT NULL,
  org             VARCHAR(255) NOT NULL,
  summary_text    TEXT         NOT NULL,
  health_json     JSON         NOT NULL,
  projects        JSON         NULL,
  prompt_version  VARCHAR(50)  NOT NULL,
  generated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_team_version (report_id, team_name, prompt_version)
);
```

- [ ] **Step 2: Add the runtime-migration shim** so existing dev/AWS databases (which already have the table without `projects`) get the new column at next startup. Open `src/lib/db/index.ts` (the DB-init module) and find the existing migration block (search for `ALTER TABLE`). If a migration helper exists, add:

```typescript
// GLOOK-11: add projects column for per-team Current Projects card
await migrate('ALTER TABLE team_pulse_summaries ADD COLUMN projects JSON NULL',
              'team_pulse_summaries', 'projects');
```

If the codebase doesn't have a `migrate()` helper, replace with a manual idempotent block (the pattern below):

```typescript
try {
  await db.execute("ALTER TABLE team_pulse_summaries ADD COLUMN projects JSON NULL");
} catch (e: any) {
  // Column already exists — MySQL 1060, SQLite "duplicate column"
  if (!/duplicate|already exists|1060/i.test(String(e?.message))) throw e;
}
```

- [ ] **Step 3: Verify schema parses on both DBs**

```bash
# SQLite
rm -f /tmp/glook11-test.db
node -e "const Database=require('better-sqlite3'); const db=new Database('/tmp/glook11-test.db'); const fs=require('fs'); db.exec(fs.readFileSync('schema.sql','utf8').replace(/JSON/g,'TEXT').replace(/ON UPDATE CURRENT_TIMESTAMP/g,'').replace(/AUTO_INCREMENT/g,'AUTOINCREMENT').replace(/ENUM\([^)]+\)/g,'TEXT')); console.log('SQLite OK');"
```

Expected: `SQLite OK`. (This is a smoke check that the new `CREATE TABLE` is syntactically valid under translation. The runtime translator handles the JSON/AUTOINCREMENT differences automatically; this command just confirms there's no syntactic gotcha.)

- [ ] **Step 4: Commit**

```bash
git add schema.sql src/lib/db/index.ts
git commit -m "feat(db): team_pulse_summaries.projects column (GLOOK-11)

Adds the canonical team_pulse_summaries CREATE TABLE to schema.sql
(was created at runtime only) plus the new projects JSON column for
per-team Current Projects caching. Idempotent ALTER for existing DBs."
```

---

## Task 2: `TeamProject` type

**Files:**
- Create: `src/lib/team-pulse/types.ts`

- [ ] **Step 1: Create the file** with this exact content:

```typescript
// src/lib/team-pulse/types.ts
//
// Shared types for the team-pulse Current Projects feature (GLOOK-11).
// Lives in its own file so service.ts, projects.ts, and the React
// component can all import without circular deps.

export interface TeamProject {
  /** LLM-generated descriptive name, e.g. "Multi-tenant Jobs UI" */
  name: string;
  /** One-line summary of what the project is about */
  summary: string;
  /** GitHub logins of the team members contributing to the project.
   *  Guaranteed to be a non-empty subset of the team's members. */
  developers: string[];
  /** Distinct Jira issue count attributed to the cluster */
  jira_count: number;
  /** Approximate commit count attributed to the cluster */
  estimated_commits: number;
  /** Approximate PR count attributed to the cluster */
  estimated_prs: number;
  /** ISO date of the most recent commit in the cluster */
  last_activity: string;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3
```

Expected: clean, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/team-pulse/types.ts
git commit -m "feat(team-pulse): TeamProject type (GLOOK-11)"
```

---

## Task 3: `extractTeamProjectsData()` — data extractor (TDD)

**Files:**
- Modify: `src/lib/team-pulse/data.ts`
- Create: `src/lib/__tests__/unit/team-projects-data.test.ts`

The function pulls commits + Jira issues for the team across the full report window. Since `commit_analyses.report_id` and `jira_issues.report_id` are already report-scoped FKs, the "window" filter collapses to a simple `WHERE report_id = ?` — much simpler than the spec implied. Document this in the implementation comment.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/team-projects-data.test.ts`:

```typescript
jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));

import db from '@/lib/db';
import { extractTeamProjectsData, type TeamProjectsInput } from '@/lib/team-pulse/data';

const exec = db.execute as jest.Mock;

beforeEach(() => exec.mockReset());

describe('extractTeamProjectsData', () => {
  it('returns empty input when team has no members', async () => {
    const result = await extractTeamProjectsData('r1', []);
    expect(result.commits).toEqual([]);
    expect(result.jira_issues).toEqual([]);
    expect(result.team_members).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });

  it('filters commits + jira to team members for this report', async () => {
    exec
      .mockResolvedValueOnce([[
        { sha: 'aaa', repo: 'svc', pr_number: 1, message_first_line: 'fix bug', github_login: 'alice', lines: 50, committed_at: '2026-05-20T10:00:00Z' },
        { sha: 'bbb', repo: 'svc', pr_number: null, message_first_line: 'wip', github_login: 'bob', lines: 5, committed_at: '2026-05-21T10:00:00Z' },
      ], []])
      .mockResolvedValueOnce([[
        { issue_key: 'PROJ-1', project_key: 'PROJ', summary: 'Auth bug', github_login: 'alice', type: 'Bug', status: 'Done' },
      ], []]);

    const result = await extractTeamProjectsData('r1', ['alice', 'bob']);

    expect(result.commits).toHaveLength(2);
    expect(result.commits[0].github_login).toBe('alice');
    expect(result.jira_issues).toHaveLength(1);
    expect(result.team_members).toEqual(['alice', 'bob']);

    // Both queries used parameter binding for report_id and team_members
    expect(exec).toHaveBeenCalledTimes(2);
    expect(exec.mock.calls[0][1][0]).toBe('r1');
    expect(exec.mock.calls[0][1].slice(1)).toEqual(['alice', 'bob']);
  });

  it('caps commits at 200 (most recent first)', async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({
      sha: `sha${i}`, repo: 'svc', pr_number: null,
      message_first_line: `c${i}`, github_login: 'alice',
      lines: 1, committed_at: `2026-05-${String(i + 1).padStart(2, '0')}T10:00:00Z`,
    }));
    exec
      .mockResolvedValueOnce([many, []])
      .mockResolvedValueOnce([[], []]);

    const result = await extractTeamProjectsData('r1', ['alice']);
    expect(result.commits).toHaveLength(200);
  });
});
```

- [ ] **Step 2: Run it — confirm failure**

```bash
npm test -- --testPathPatterns="team-projects-data" 2>&1 | tail -10
```

Expected: failure — `extractTeamProjectsData` is not exported from `data.ts`.

- [ ] **Step 3: Implement the extractor**

Open `src/lib/team-pulse/data.ts` and append at the end of the file:

```typescript
// ────────────────────────────────────────────────────────────────────
// GLOOK-11: extractor for the per-team Current Projects card.
// Pulls commits + jira issues filtered to the team across the full
// report window. Window is implicit: report_id FK on commit_analyses
// and jira_issues already scopes to the report's date range.
// ────────────────────────────────────────────────────────────────────

export interface TeamProjectCommit {
  sha: string;
  repo: string;
  pr_number: number | null;
  message_first_line: string;
  github_login: string;
  lines: number;
  committed_at: string;
}

export interface TeamProjectJiraIssue {
  issue_key: string;
  project_key: string;
  summary: string;
  github_login: string;
  type: string | null;
  status: string | null;
}

export interface TeamProjectsInput {
  commits: TeamProjectCommit[];
  jira_issues: TeamProjectJiraIssue[];
  team_members: string[];
}

export async function extractTeamProjectsData(
  reportId: string,
  teamMembers: string[],
): Promise<TeamProjectsInput> {
  if (teamMembers.length === 0) {
    return { commits: [], jira_issues: [], team_members: [] };
  }

  const placeholders = teamMembers.map(() => '?').join(',');

  const [commitRows] = await db.execute(
    `SELECT commit_sha AS sha,
            repo,
            pr_number,
            SUBSTRING_INDEX(commit_message, '\n', 1) AS message_first_line,
            github_login,
            (lines_added + lines_removed) AS lines,
            committed_at
       FROM commit_analyses
      WHERE report_id = ?
        AND github_login IN (${placeholders})
        AND committed_at IS NOT NULL
      ORDER BY committed_at DESC
      LIMIT 200`,
    [reportId, ...teamMembers],
  ) as [any[], any];

  const [jiraRows] = await db.execute(
    `SELECT issue_key, project_key, summary, github_login, issue_type AS type, status
       FROM jira_issues
      WHERE report_id = ?
        AND github_login IN (${placeholders})`,
    [reportId, ...teamMembers],
  ) as [any[], any];

  return {
    commits: commitRows as TeamProjectCommit[],
    jira_issues: jiraRows as TeamProjectJiraIssue[],
    team_members: [...teamMembers],
  };
}
```

- [ ] **Step 4: Run the test — confirm pass**

```bash
npm test -- --testPathPatterns="team-projects-data" 2>&1 | tail -10
```

Expected: 3 tests pass.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/team-pulse/data.ts src/lib/__tests__/unit/team-projects-data.test.ts
git commit -m "feat(team-pulse): extractTeamProjectsData (GLOOK-11)

Pulls commits + jira issues for team members across the full report
window (implicit via report_id FK). Caps commits at 200 most recent."
```

---

## Task 4: Prompt template

**Files:**
- Create: `prompts/team-pulse-projects.txt`

- [ ] **Step 1: Create the prompt template** with this exact content:

```
You are a software project clustering assistant. Group the provided commits and Jira issues into 2-6 named "projects" — coherent threads of work that the team is currently shipping.

RULES:
- ONLY use data provided below. Do NOT infer, hallucinate, or add data not given.
- Each project name MUST be human-readable and descriptive (e.g. "Multi-tenant Jobs UI"), NOT a raw Jira key.
- Each project's `developers` array MUST contain ONLY github logins from {{TEAM_MEMBERS_JSON}}. Reject any other login.
- Drop singleton clusters: every project must have at least 2 commits OR 1 Jira issue.
- `last_activity` MUST be a real ISO-8601 date copied from the most recent committed_at in the cluster.
- Output is a JSON object with a single key "projects" whose value is the array.

OUTPUT JSON SCHEMA (one entry per project):
{
  "projects": [
    {
      "name": "string",
      "summary": "string, one line, max 120 chars",
      "developers": ["github_login", ...],
      "jira_count": 0,
      "estimated_commits": 0,
      "estimated_prs": 0,
      "last_activity": "YYYY-MM-DDTHH:MM:SSZ"
    }
  ]
}

TEAM: {{TEAM_NAME}}
TEAM MEMBERS (github logins): {{TEAM_MEMBERS_JSON}}

COMMITS (most recent first, capped at 200):
{{COMMITS_JSON}}

JIRA ISSUES:
{{JIRA_ISSUES_JSON}}
```

- [ ] **Step 2: Add a snapshot test for it** — append to `src/lib/__tests__/unit/prompts.test.ts` (find the file; if it doesn't exist, create it with the snapshot test wrapper following the analyzer prompt test pattern). Snippet to add:

```typescript
import { loadPrompt, clearPromptCache } from '@/lib/prompt-loader';

describe('team-pulse-projects prompt template', () => {
  beforeEach(() => clearPromptCache());

  it('renders with substituted placeholders', () => {
    const out = loadPrompt('team-pulse-projects.txt', {
      TEAM_NAME: 'Alpha',
      TEAM_MEMBERS_JSON: '["alice","bob"]',
      COMMITS_JSON: '[]',
      JIRA_ISSUES_JSON: '[]',
    });
    expect(out).toMatchSnapshot();
    // Verify no leftover {{...}} placeholders
    expect(out).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});
```

- [ ] **Step 3: Generate the snapshot**

```bash
npm test -- --testPathPatterns="prompts" -u 2>&1 | tail -10
```

Expected: snapshot written, test passes.

- [ ] **Step 4: Commit**

```bash
git add prompts/team-pulse-projects.txt src/lib/__tests__/unit/prompts.test.ts src/lib/__tests__/unit/__snapshots__/
git commit -m "feat(team-pulse): team-pulse-projects prompt template (GLOOK-11)"
```

---

## Task 5: Mock fixture

**Files:**
- Modify: `src/lib/llm-mock.ts`

- [ ] **Step 1: Open `src/lib/llm-mock.ts`** and locate the `FIXTURES` object. Inside it, after the `'team-pulse-system'` entry, add:

```typescript
  'team-pulse-projects': JSON.stringify({
    projects: [
      {
        name: 'Multi-tenant Jobs UI',
        summary: 'Refactor of the jobs list page to support per-tenant filtering',
        developers: ['alice', 'bob'],
        jira_count: 4,
        estimated_commits: 14,
        estimated_prs: 5,
        last_activity: '2026-05-25T14:00:00Z',
      },
      {
        name: 'Auth Token Cleanup',
        summary: 'Migration off legacy session tokens to OIDC-only flow',
        developers: ['alice'],
        jira_count: 2,
        estimated_commits: 6,
        estimated_prs: 2,
        last_activity: '2026-05-22T09:30:00Z',
      },
    ],
  }),
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/llm-mock.ts
git commit -m "feat(llm-mock): team-pulse-projects fixture (GLOOK-11)"
```

---

## Task 6: `generateTeamProjects()` — LLM call + validation (TDD)

**Files:**
- Create: `src/lib/team-pulse/projects.ts`
- Create: `src/lib/__tests__/unit/team-projects-generator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/team-projects-generator.test.ts`:

```typescript
jest.mock('@/lib/llm-provider', () => ({
  __esModule: true,
  getLLMClient: jest.fn(),
  LLM_MODEL: 'mock-model',
  extraBodyProps: () => ({}),
  tokenLimit: () => ({ max_tokens: 1024 }),
  promptTag: (n: string) => ({ __prompt_id: n }),
}));

import { getLLMClient } from '@/lib/llm-provider';
import { generateTeamProjects } from '@/lib/team-pulse/projects';
import type { TeamProjectsInput } from '@/lib/team-pulse/data';

const makeClient = (jsonResponse: string) => ({
  chat: { completions: { create: jest.fn().mockResolvedValue({
    choices: [{ message: { content: jsonResponse } }],
  })}},
});

const mockGetLLMClient = getLLMClient as jest.Mock;

const baseInput = (): TeamProjectsInput => ({
  team_members: ['alice', 'bob'],
  commits: [
    { sha: 'a1', repo: 'r1', pr_number: 1, message_first_line: 'feat: x',
      github_login: 'alice', lines: 10, committed_at: '2026-05-20T10:00:00Z' },
    { sha: 'b1', repo: 'r1', pr_number: 2, message_first_line: 'fix: y',
      github_login: 'bob',   lines: 5,  committed_at: '2026-05-21T11:00:00Z' },
  ],
  jira_issues: [],
});

describe('generateTeamProjects', () => {
  beforeEach(() => mockGetLLMClient.mockReset());

  it('short-circuits to [] when both commits and jira are empty (no LLM call)', async () => {
    const out = await generateTeamProjects({ team_members: ['alice'], commits: [], jira_issues: [] });
    expect(out).toEqual([]);
    expect(mockGetLLMClient).not.toHaveBeenCalled();
  });

  it('returns parsed projects on a well-formed LLM response', async () => {
    mockGetLLMClient.mockResolvedValueOnce(makeClient(JSON.stringify({
      projects: [
        { name: 'P1', summary: 's', developers: ['alice', 'bob'],
          jira_count: 0, estimated_commits: 2, estimated_prs: 2,
          last_activity: '2026-05-21T11:00:00Z' },
      ],
    })));
    const out = await generateTeamProjects(baseInput());
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('P1');
    expect(out[0].developers).toEqual(['alice', 'bob']);
  });

  it('strips hallucinated developers not in team_members', async () => {
    mockGetLLMClient.mockResolvedValueOnce(makeClient(JSON.stringify({
      projects: [
        { name: 'P1', summary: 's',
          developers: ['alice', 'mallory', 'bob'],
          jira_count: 0, estimated_commits: 2, estimated_prs: 2,
          last_activity: '2026-05-21T11:00:00Z' },
      ],
    })));
    const out = await generateTeamProjects(baseInput());
    expect(out[0].developers).toEqual(['alice', 'bob']);
  });

  it('drops projects whose developers list is empty after filtering', async () => {
    mockGetLLMClient.mockResolvedValueOnce(makeClient(JSON.stringify({
      projects: [
        { name: 'BAD', summary: 's', developers: ['mallory'],
          jira_count: 0, estimated_commits: 2, estimated_prs: 2,
          last_activity: '2026-05-21T11:00:00Z' },
        { name: 'OK',  summary: 's', developers: ['alice'],
          jira_count: 0, estimated_commits: 1, estimated_prs: 1,
          last_activity: '2026-05-20T10:00:00Z' },
      ],
    })));
    const out = await generateTeamProjects(baseInput());
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('OK');
  });

  it('overrides last_activity from the actual max committed_at in the cluster', async () => {
    // LLM returns a wrong last_activity; we should overwrite with the real max.
    mockGetLLMClient.mockResolvedValueOnce(makeClient(JSON.stringify({
      projects: [
        { name: 'P1', summary: 's', developers: ['alice', 'bob'],
          jira_count: 0, estimated_commits: 2, estimated_prs: 2,
          last_activity: '2020-01-01T00:00:00Z' },
      ],
    })));
    const out = await generateTeamProjects(baseInput());
    // Max committed_at across the 2 baseInput commits is bob's '2026-05-21T11:00:00Z'
    expect(out[0].last_activity).toBe('2026-05-21T11:00:00Z');
  });

  it('strips ```json fences from the LLM response', async () => {
    mockGetLLMClient.mockResolvedValueOnce(makeClient('```json\n' + JSON.stringify({
      projects: [
        { name: 'P1', summary: 's', developers: ['alice'],
          jira_count: 0, estimated_commits: 1, estimated_prs: 1,
          last_activity: '2026-05-20T10:00:00Z' },
      ],
    }) + '\n```'));
    const out = await generateTeamProjects(baseInput());
    expect(out).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — confirm failure**

```bash
npm test -- --testPathPatterns="team-projects-generator" 2>&1 | tail -10
```

Expected: failure — `generateTeamProjects` not exported.

- [ ] **Step 3: Implement `src/lib/team-pulse/projects.ts`**

```typescript
// src/lib/team-pulse/projects.ts
//
// GLOOK-11: generates the per-team Current Projects list via LLM clustering.
// Validates the output: filters developers to team_members, drops empty
// projects, and overrides last_activity from actual commit data.

import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit, promptTag } from '@/lib/llm-provider';
import { loadPrompt } from '@/lib/prompt-loader';
import type { TeamProject } from './types';
import type { TeamProjectsInput } from './data';

export const PROJECTS_PROMPT_TAG = 'team-pulse-projects';

/**
 * Strip ```json ... ``` fences some providers wrap responses in despite
 * response_format: json_object. Mirrors the analyzer fence-strip behavior.
 */
function stripJsonFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

export async function generateTeamProjects(data: TeamProjectsInput): Promise<TeamProject[]> {
  // Short-circuit: nothing to cluster.
  if (data.commits.length === 0 && data.jira_issues.length === 0) {
    return [];
  }

  // Build a per-PR / per-cluster index of committed_at for last_activity override.
  // Keyed on sha; we'll use it after LLM returns to recompute last_activity
  // for each cluster.
  const commitByLogin = new Map<string, string[]>(); // login -> sorted committed_at[] desc
  for (const c of data.commits) {
    const arr = commitByLogin.get(c.github_login) || [];
    arr.push(c.committed_at);
    commitByLogin.set(c.github_login, arr);
  }
  for (const arr of commitByLogin.values()) arr.sort((a, b) => b.localeCompare(a));

  const systemPrompt = loadPrompt('team-pulse-projects.txt', {
    TEAM_NAME: '',                              // filled in by caller via wrapper; this module is pure
    TEAM_MEMBERS_JSON: JSON.stringify(data.team_members),
    COMMITS_JSON: JSON.stringify(data.commits),
    JIRA_ISSUES_JSON: JSON.stringify(data.jira_issues),
  });

  const client = await getLLMClient();
  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.3,
    ...tokenLimit(1500),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: 'Cluster the commits and Jira issues into projects and return the JSON object described in the system prompt.' },
    ],
    response_format: { type: 'json_object' },
    ...extraBodyProps(),
    ...promptTag(PROJECTS_PROMPT_TAG),
  } as any);

  const raw = response.choices?.[0]?.message?.content ?? '';
  const cleaned = stripJsonFences(Array.isArray(raw) ? raw.join('') : String(raw));

  let parsed: { projects?: any[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  const teamSet = new Set(data.team_members);
  const out: TeamProject[] = [];

  for (const p of parsed.projects ?? []) {
    const developers: string[] = Array.isArray(p.developers)
      ? p.developers.filter((d: unknown) => typeof d === 'string' && teamSet.has(d))
      : [];
    if (developers.length === 0) continue;

    // Override last_activity with the most recent commit by any of the cluster's developers.
    // Best-effort proxy: max committed_at across all commits authored by these developers.
    let lastActivity: string = typeof p.last_activity === 'string' ? p.last_activity : '';
    for (const d of developers) {
      const arr = commitByLogin.get(d);
      if (arr && arr.length && (lastActivity === '' || arr[0] > lastActivity)) {
        lastActivity = arr[0];
      }
    }

    out.push({
      name:              String(p.name ?? '').trim() || 'Untitled project',
      summary:           String(p.summary ?? '').trim(),
      developers,
      jira_count:        Number.isFinite(p.jira_count) ? Number(p.jira_count) : 0,
      estimated_commits: Number.isFinite(p.estimated_commits) ? Number(p.estimated_commits) : 0,
      estimated_prs:     Number.isFinite(p.estimated_prs) ? Number(p.estimated_prs) : 0,
      last_activity:     lastActivity,
    });
  }

  return out;
}
```

- [ ] **Step 4: Run — confirm pass**

```bash
npm test -- --testPathPatterns="team-projects-generator" 2>&1 | tail -10
```

Expected: 6 tests pass.

- [ ] **Step 5: Full type-check + suite**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3
npm test 2>&1 | tail -8
```

Expected: clean; all suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/team-pulse/projects.ts src/lib/__tests__/unit/team-projects-generator.test.ts
git commit -m "feat(team-pulse): generateTeamProjects + validation (GLOOK-11)

LLM-clusters team commits/jira into projects. Validates:
- developers ⊆ team_members (strip hallucinated logins)
- drops projects with empty developers list
- overrides last_activity from actual committed_at
- short-circuits to [] on empty input (no LLM call)"
```

---

## Task 7: Wire projects into `getTeamPulse()`

**Files:**
- Modify: `src/lib/team-pulse/service.ts`
- Modify: `src/lib/__tests__/unit/team-pulse.test.ts`

- [ ] **Step 1: Read the current `getTeamPulse()`** in `src/lib/team-pulse/service.ts` and note: it caches on `(report_id, team_name, prompt_version)`, returns `{ summary, health, generatedAt, cached }`. We're extending the return shape and the cached row.

- [ ] **Step 2: Update the imports + return type**

At the top of `service.ts`, add to the imports:

```typescript
import { extractTeamProjectsData } from './data';
import { generateTeamProjects } from './projects';
import type { TeamProject } from './types';
```

Update the `TeamPulseResult` interface (lines ~9-18) to add `projects`:

```typescript
export interface TeamPulseResult {
  summary: string;
  health: {
    activeRatio: string;
    trending: string;
    trendDirection: 'up' | 'down' | 'stable';
  };
  projects: TeamProject[];      // NEW (GLOOK-11)
  generatedAt: string;
  cached: boolean;
}
```

- [ ] **Step 3: Update the cache-hit branch** to deserialize the new column. Find the existing cache SELECT and replace this block:

```typescript
  // Check cache
  const [cached] = await db.execute(
    `SELECT summary_text, health_json, generated_at FROM team_pulse_summaries WHERE report_id = ? AND team_name = ? AND prompt_version = ?`,
    [reportId, teamName, PROMPT_VERSION],
  ) as [any[], any];

  if (cached.length > 0) {
    const row = cached[0];
    const health = typeof row.health_json === 'string' ? JSON.parse(row.health_json) : row.health_json;
    return {
      summary: row.summary_text,
      health,
      generatedAt: row.generated_at,
      cached: true,
    };
  }
```

with:

```typescript
  // Check cache
  const [cached] = await db.execute(
    `SELECT summary_text, health_json, projects, generated_at FROM team_pulse_summaries WHERE report_id = ? AND team_name = ? AND prompt_version = ?`,
    [reportId, teamName, PROMPT_VERSION],
  ) as [any[], any];

  if (cached.length > 0) {
    const row = cached[0];
    const health = typeof row.health_json === 'string' ? JSON.parse(row.health_json) : row.health_json;
    // projects column is nullable on legacy rows — coerce to [] so the
    // API contract is stable; the card will render empty in that case.
    let projects: TeamProject[] = [];
    if (row.projects) {
      try {
        projects = typeof row.projects === 'string' ? JSON.parse(row.projects) : row.projects;
        if (!Array.isArray(projects)) projects = [];
      } catch {
        projects = [];
      }
    }
    return {
      summary: row.summary_text,
      health,
      projects,
      generatedAt: row.generated_at,
      cached: true,
    };
  }
```

- [ ] **Step 4: Add the projects-generation step + persist** — after the existing pulse `summary` is built (after the `const summary = (Array.isArray(raw) ? ...).trim();` line and after `const health = ...` block), but BEFORE the existing INSERT, add:

```typescript
  // GLOOK-11: generate per-team Current Projects using the full report window.
  let projects: TeamProject[] = [];
  try {
    const projectsInput = await extractTeamProjectsData(reportId, teamMembers);
    projects = await generateTeamProjects(projectsInput);
  } catch (err) {
    // Don't fail the whole pulse if projects gen fails — log and continue with [].
    console.warn(`[team-pulse] projects generation failed for team=${teamName}:`, err);
    projects = [];
  }
```

Then update the cache write to include the new column. Find the existing INSERT and replace with:

```typescript
  // Cache
  await db.execute(
    `INSERT INTO team_pulse_summaries (report_id, team_name, org, summary_text, health_json, projects, prompt_version)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE summary_text = VALUES(summary_text), health_json = VALUES(health_json), projects = VALUES(projects), prompt_version = VALUES(prompt_version), generated_at = NOW()`,
    [reportId, teamName, org, summary, JSON.stringify(health), JSON.stringify(projects), PROMPT_VERSION],
  );

  return { summary, health, projects, generatedAt: new Date().toISOString(), cached: false };
```

- [ ] **Step 5: Extend the existing service test** — open `src/lib/__tests__/unit/team-pulse.test.ts`. Find the test that asserts the cache-hit shape and update it to assert `projects` is returned. Add two new test cases:

```typescript
describe('getTeamPulse — projects field (GLOOK-11)', () => {
  // Use the same test scaffold (db mock, llm mock) as the existing pulse tests in this file.
  // The two cases to lock down:

  it('returns projects: [] when cache row has projects = NULL (legacy row)', async () => {
    // Mock the cache SELECT to return a row with projects: null.
    // Assert: result.projects === [] and result.cached === true.
    // (Implementation detail: follow the existing mocking pattern of this test file.)
  });

  it('deserializes projects from the cache row when present (string JSON)', async () => {
    const cached = JSON.stringify([
      { name: 'P1', summary: 's', developers: ['alice'],
        jira_count: 0, estimated_commits: 1, estimated_prs: 1,
        last_activity: '2026-05-20T10:00:00Z' },
    ]);
    // Mock the cache SELECT to return a row with projects = cached.
    // Assert: result.projects has length 1, result.projects[0].name === 'P1'.
  });
});
```

**Implementer notes for the test setup:**

1. Read `team-pulse.test.ts` first. The existing tests mock `db.execute` via a `jest.mock('@/lib/db', ...)` block at the top of the file. Use the same mock — do not add a second top-level mock.

2. The new SELECT introduced in Task 7 Step 3 returns these columns: `summary_text, health_json, projects, generated_at`. Your `db.execute` mock must return a row shaped like:

```typescript
const cachedRow = {
  summary_text: 'cached summary',
  health_json:  '{"activeRatio":"3/5","trending":"+0%","trendDirection":"stable"}',
  projects:     null,                              // first test: legacy NULL
  // projects:  '[{"name":"P1", ...}]',            // second test: populated
  generated_at: '2026-05-20T10:00:00Z',
};
(db.execute as jest.Mock).mockResolvedValueOnce([[cachedRow], []]);
```

3. For both new test cases, call `getTeamPulse('r1', 'Alpha', 'Smartling', ['alice'])` and assert on the returned `projects` field. Cache-hit path means no further `db.execute` calls or LLM calls are needed for the assertion.

- [ ] **Step 6: Run tests**

```bash
npm test -- --testPathPatterns="team-pulse" 2>&1 | tail -15
```

Expected: existing pulse tests still pass; new projects test cases pass.

- [ ] **Step 7: Type-check + full suite**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -3
npm test 2>&1 | tail -8
```

Expected: clean; all suites pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/team-pulse/service.ts src/lib/__tests__/unit/team-pulse.test.ts
git commit -m "feat(team-pulse): integrate projects into getTeamPulse (GLOOK-11)

Adds projects step + JSON column persistence. Legacy cache rows with
projects = NULL gracefully return []. Projects failure does not crash
the pulse — logged and degraded to []."
```

---

## Task 8: Extract `ProjectsCard` component

**Files:**
- Create: `src/components/ProjectsCard.tsx`
- Modify: `src/app/llm-findings.tsx`

The existing inline projects markup on the home page becomes a reusable component. Behavior on the home page must NOT change (regression-test this manually before committing).

- [ ] **Step 1: Create `src/components/ProjectsCard.tsx`** with this content:

```tsx
'use client';
import type { TeamProject } from '@/lib/team-pulse/types';

/** Older shape used by the home-page LLM project insights — superset of TeamProject.
 *  Allows the same component to serve both surfaces without a refactor of the home payload. */
export interface ProjectsCardItem {
  name: string;
  summary: string;
  developers: string[];
  jira_count: number;
  estimated_commits: number;
  estimated_prs: number;
  last_activity?: string;     // optional: only the team variant sets this
}

export interface ProjectsCardProps {
  projects: ProjectsCardItem[] | TeamProject[];
  loading?: boolean;
  title?: string;                        // default: "Top Projects"
  subtitle?: string;                     // default: empty
  emptyMessage?: string;                 // default: "No active projects in this window."
  /** Optional: link template for developer chips. Receives login, returns href.
   *  If omitted, chips are not links. */
  developerHref?: (login: string) => string;
}

function timeAgo(iso?: string): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1mo ago' : `${months}mo ago`;
}

export default function ProjectsCard({
  projects,
  loading,
  title = 'Top Projects',
  subtitle,
  emptyMessage = 'No active projects in this window.',
  developerHref,
}: ProjectsCardProps) {
  if (loading) {
    return (
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🏗️</span>
          <span className="text-xs font-bold tracking-widest uppercase text-white/40">{title}</span>
        </div>
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Analyzing projects…
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏗️</span>
          <span className="text-xs font-bold tracking-widest uppercase text-white/40">
            {title}{subtitle ? ` · ${subtitle}` : ''}
          </span>
        </div>
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyMessage}</p>
      ) : (
        <div className="space-y-3">
          {projects.map((p, i) => {
            const ago = timeAgo((p as TeamProject).last_activity);
            return (
              <div key={i} className="bg-white/[0.02] rounded-lg p-3">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-gray-600 w-4 shrink-0 text-right">{i + 1}</span>
                    <span className="text-sm font-semibold text-white">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-gray-500">
                    <span>{p.jira_count} jiras</span>
                    <span>~{p.estimated_commits} commits</span>
                    <span>~{p.estimated_prs} PRs</span>
                    {ago && <span className="text-gray-600">· {ago}</span>}
                  </div>
                </div>
                <p className="text-xs text-gray-500 pl-6 mb-1.5">{p.summary}</p>
                <div className="flex gap-1 pl-6 flex-wrap">
                  {p.developers.map(d =>
                    developerHref ? (
                      <a
                        key={d}
                        href={developerHref(d)}
                        className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
                        style={{ color: 'var(--accent-dark)', backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
                      >@{d}</a>
                    ) : (
                      <span
                        key={d}
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ color: 'var(--accent-dark)', backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
                      >@{d}</span>
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Swap inline JSX on the home page** — open `src/app/llm-findings.tsx`. Find the projects block (lines ~137–211). At the top of the file, add:

```typescript
import ProjectsCard from '@/components/ProjectsCard';
```

Replace the entire projects-block JSX (the two outer `{projectsLoading && ...}` and `{!projectsLoading && projects.length > 0 && projectsMeta && ...}` sections) with:

```tsx
{(projectsLoading || (projects.length > 0 && projectsMeta)) && (
  <ProjectsCard
    projects={projects}
    loading={projectsLoading}
    title="Top Projects"
    subtitle={projectsMeta ? `${projectsMeta.org} · ${projectsMeta.periodDays}d · ${formatDate(projectsMeta.createdAt)}` : undefined}
    developerHref={projectsMeta ? (login) => `/report/${projectsMeta.id}/dev/${login}` : undefined}
  />
)}
{/* "Top untracked work" section stays untouched below — keep the existing JSX for the
    untrackedWork rendering as-is. */}
```

**Important:** the **Untracked Work** sub-section that lives within the same outer card on the home page (lines ~190–209) is NOT part of the extracted component. Move it OUTSIDE the new `<ProjectsCard>` invocation — render it as a separate sibling card below `<ProjectsCard>`. Wrap it in its own `<div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">` if needed to match the previous visual.

- [ ] **Step 3: Type-check + tests**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5
npm test 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 4: Manual visual regression** — run `npm run dev:mock`, open the home page, visually confirm the Top Projects card still renders identically (positions, colors, link behavior). The Untracked Work box may render as a separate card now — that's acceptable.

- [ ] **Step 5: Commit**

```bash
git add src/components/ProjectsCard.tsx src/app/llm-findings.tsx
git commit -m "refactor(home): extract <ProjectsCard> from llm-findings (GLOOK-11)

Pulls the inline projects card JSX into src/components/ProjectsCard.tsx
for reuse on the Team Pulse page. Untracked-work block moves to a
sibling card. No behavior change on the home page."
```

---

## Task 9: Wire `<ProjectsCard>` into the Team Pulse page

**Files:**
- Modify: `src/app/report/[id]/team/page.tsx`

- [ ] **Step 1: Add the import** at the top:

```typescript
import ProjectsCard from '@/components/ProjectsCard';
import type { TeamProject } from '@/lib/team-pulse/types';
```

- [ ] **Step 2: Fetch the team pulse with SWR** — locate where `selectedTeamName` is used (search for `selectedTeamName`). Right after the existing SWR hooks block (e.g. after `const { data: teamsData } = useSWR(...)`), add:

```typescript
const pulseUrl = (activeReport && selectedTeamName)
  ? `/api/report/${params.id}/team-pulse?team=${encodeURIComponent(selectedTeamName)}&org=${encodeURIComponent(activeReport.org)}`
  : null;
const { data: teamPulse, isLoading: teamPulseLoading } = useSWR<{
  summary: string;
  health: { activeRatio: string; trending: string; trendDirection: 'up' | 'down' | 'stable' };
  projects: TeamProject[];
  generatedAt: string;
  cached: boolean;
}>(pulseUrl, { revalidateOnFocus: false });
```

- [ ] **Step 3: Render the card** — find where the existing team pulse summary is rendered (search for a component named `TeamPulseCard` or similar; the explorer report identified the insertion point at ~line 354). Right AFTER the existing team-pulse summary block, and BEFORE the `<TeamTable>` or developer-table block, add:

```tsx
{selectedTeamName && activeReport && (
  <ProjectsCard
    projects={teamPulse?.projects ?? []}
    loading={teamPulseLoading && !teamPulse}
    title="Current Projects"
    subtitle={`${selectedTeamName} · ${activeReport.period_days}d`}
    developerHref={(login) => `/report/${params.id}/dev/${login}`}
  />
)}
```

- [ ] **Step 4: Type-check + tests**

```bash
npx tsc --noEmit -p tsconfig.json 2>&1 | tail -5
npm test 2>&1 | tail -5
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/report/[id]/team/page.tsx'
git commit -m "feat(team-page): render <ProjectsCard> between pulse and dev table (GLOOK-11)"
```

---

## Task 10: Local smoke test

Run the app end-to-end with mock data and confirm the card renders.

- [ ] **Step 1: Seed + start mock dev server**

```bash
rm -rf .next
npm run dev:mock
```

- [ ] **Step 2: Open `http://localhost:3000`**, click into any report, then click the Teams tab. Select a team.

- [ ] **Step 3: Verify, in order:**
  - [ ] Team pulse summary renders (existing behavior).
  - [ ] Below the pulse, the **Current Projects** card renders with 2 projects from the mock fixture ("Multi-tenant Jobs UI" and "Auth Token Cleanup").
  - [ ] Developer chips link to `/report/<id>/dev/<login>`.
  - [ ] `last_activity` chip shows ("today", "1d ago", "3d ago", etc.).
  - [ ] Developer table renders below the projects card (existing behavior).
  - [ ] Re-select a different team — the projects card updates with that team's slice (mock returns the same 2-project fixture for all teams — that's expected).

- [ ] **Step 4: Visually confirm the home-page Top Projects is unchanged** — go to the home page, confirm the Top Projects card looks the same as before (the refactor must not regress).

- [ ] **Step 5: Confirm legacy row handling** — open a SQL client to the dev DB (or use the SSM tunnel pattern documented in memory `reference_glooker_aws_deploy.md`) and run:

```sql
UPDATE team_pulse_summaries SET projects = NULL WHERE team_name = 'Inception' LIMIT 1;
```

Reload the team page for Inception. The page should still render (empty projects card or no card on legacy null) without a JS error. **Note:** in dev:mock, the next click will regenerate the row, so to truly observe the legacy state, you may need to inspect the SWR response in DevTools immediately before regen.

- [ ] **Step 6: Stop the dev server.** No commit (smoke only).

---

## Self-review checklist

**Spec coverage:**

| Spec section | Task |
|---|---|
| Architecture diagram (second LLM step inside `getTeamPulse`) | Task 7 |
| `extractTeamProjectsData()` signature + 200-cap | Task 3 |
| `generateTeamProjects()` + validation rules | Task 6 |
| Prompt template `prompts/team-pulse-projects.txt` | Task 4 |
| Schema migration | Task 1 |
| API contract extension (return `projects: TeamProject[]`) | Task 7 |
| `ProjectsCard` extraction + dual consumption | Tasks 8 + 9 |
| Tests (extractor, generator, prompt snapshot, service) | Tasks 3, 6, 4, 7 |
| Mock fixture | Task 5 |
| Edge cases (empty team, legacy row, LLM failure, hallucinated logins, oversized commit list, cross-team projects) | Tasks 3, 6, 7 |
| Local smoke | Task 10 |

**Type consistency:**
- `TeamProject` defined in `src/lib/team-pulse/types.ts` (Task 2). All other tasks import it from there.
- `TeamProjectsInput` defined in `src/lib/team-pulse/data.ts` (Task 3). Used by Task 6's generator and Task 7's service.
- `ProjectsCardItem` in `src/components/ProjectsCard.tsx` (Task 8) is a superset interface that both the home shape and `TeamProject` satisfy.
