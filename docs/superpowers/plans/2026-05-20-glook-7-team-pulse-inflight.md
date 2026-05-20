# GLOOK-7 Team Pulse: in-flight work — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Team Pulse AI summary to also describe what a team is currently working on (open PRs + unmerged branches), woven into the existing narrative.

**Architecture:** Pure data extension — add a new aggregation inside `src/lib/team-pulse/data.ts` against existing snapshot tables (`unmerged_prs`, `unmerged_commits`). Extended input flows through the unchanged prompt builder + LLM call. Cache invalidated via a `prompt_version` column on `team_pulse_summaries`.

**Tech Stack:** Next.js 15, TypeScript, Jest + ts-jest, MySQL/SQLite (the app supports both via the existing wrapper at `src/lib/db/`).

**Source spec:** `docs/superpowers/specs/2026-05-20-glook-7-team-pulse-inflight-design.md`

---

## File map

- **Modify** `src/lib/team-pulse/data.ts` — add the `Inflight` shape on `TeamPulseData`, a pure `aggregateInflight(prRows, commitRows)` helper, and a `fetchInflight(reportId, teamMembers)` SQL helper. Wire them into the existing `extractTeamPulseData()` return.
- **Modify** `src/lib/team-pulse/prompt.ts` — extend the JSON variables map with eight new placeholders.
- **Modify** `prompts/team-pulse-system.txt` — add the IN-FLIGHT WORK context block and one new rule.
- **Modify** `src/lib/team-pulse/service.ts` — add a `PROMPT_VERSION` constant; include it in the cache SELECT lookup and INSERT.
- **Modify** `src/lib/db/mysql.ts` — `ALTER TABLE team_pulse_summaries ADD COLUMN prompt_version VARCHAR(16) NOT NULL DEFAULT 'v1'` migration.
- **Modify** `src/lib/db/sqlite.ts` — add the same column to the inline schema + a `try { db.exec('ALTER TABLE …') } catch (_) {}` migration line.
- **New** `src/lib/__tests__/unit/team-pulse-inflight.test.ts` — tests for `aggregateInflight()` (pure) and `buildTeamPulsePrompt()` with the new fields.

## Conventions

- TDD for the two pure pieces (`aggregateInflight` and the new prompt-builder branch). The SQL helper is exercised via the live container at the end (no DB-mock framework in this repo).
- One small commit per task. Run `npx tsc --noEmit -p tsconfig.json` and `npm test` before each commit.

---

## Task 1: Schema migration — add `prompt_version` column

**Files:**
- Modify: `src/lib/db/mysql.ts` (migrations section, around line 244+)
- Modify: `src/lib/db/sqlite.ts` (CREATE TABLE block at line 203 and migrations block around line 274+)

- [ ] **Step 1: MySQL migration**

Append to the migrations block in `src/lib/db/mysql.ts` (after the last existing `await pool.execute('ALTER TABLE …')` line — see lines 244–250 for the surrounding pattern):

```ts
await pool.execute("ALTER TABLE team_pulse_summaries ADD COLUMN prompt_version VARCHAR(16) NOT NULL DEFAULT 'v1'").catch((err) => {
  if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add prompt_version:', err);
});
```

- [ ] **Step 2: SQLite — extend the inline CREATE TABLE**

In `src/lib/db/sqlite.ts`, edit the `CREATE TABLE IF NOT EXISTS team_pulse_summaries (...)` block at lines 203–213. Add the new column right before `FOREIGN KEY`:

```sql
CREATE TABLE IF NOT EXISTS team_pulse_summaries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id    TEXT    NOT NULL,
  team_name    TEXT    NOT NULL,
  org          TEXT    NOT NULL,
  summary_text TEXT    NOT NULL,
  health_json  TEXT    NOT NULL,
  prompt_version TEXT  NOT NULL DEFAULT 'v1',
  generated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, team_name)
);
```

- [ ] **Step 3: SQLite — add the migration line for already-existing dev DBs**

In `src/lib/db/sqlite.ts`, in the migrations block (around lines 270–276), append:

```ts
try { db.exec("ALTER TABLE team_pulse_summaries ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'v1'"); } catch (_) {}
```

- [ ] **Step 4: Type check + restart container to apply migration**

```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: no output.

The container picks up the schema change on next restart (Tasks below run before container restart — final smoke task handles the rebuild).

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/mysql.ts src/lib/db/sqlite.ts
git commit -m "feat(db): add prompt_version column to team_pulse_summaries (GLOOK-7)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Add `Inflight` shape on `TeamPulseData`

**Files:**
- Modify: `src/lib/team-pulse/data.ts` (lines 11–22, the `TeamPulseData` interface; and line 150, the return statement)

- [ ] **Step 1: Extend the interface and default value**

In `src/lib/team-pulse/data.ts`, edit the `TeamPulseData` interface (currently lines 11–22). Append two new exported types **above** `TeamPulseData`, and add the `inflight` field to `TeamPulseData`:

```ts
export interface InflightOpenPrs {
  total: number;
  draft: number;
  ready: number;
  by_author: { login: string; count: number }[];   // top 5 desc
  by_repo:   { repo: string;  count: number }[];   // top 3 desc
  oldest_days: number;        // max(now - updated_at) across open PRs; 0 if none
  lines_added: number;
  lines_removed: number;
}

export interface InflightBranches {
  total_branches: number;
  total_commits: number;
}

export interface Inflight {
  open_prs: InflightOpenPrs;
  unmerged_branches: InflightBranches;
}

export interface TeamPulseData {
  teamName: string;
  members: Map<string, MemberWindowData>;
  currentDays: string[];
  priorDays: string[];
  teamAvgCommits: number;
  teamAvgPrs: number;
  activeCount: number;
  totalCount: number;
  trendingPct: number;
  trendDirection: 'up' | 'down' | 'stable';
  inflight: Inflight;
}
```

- [ ] **Step 2: Add a `EMPTY_INFLIGHT` constant for the no-data case**

In `src/lib/team-pulse/data.ts`, just below the new `Inflight` interface, add:

```ts
const EMPTY_INFLIGHT: Inflight = {
  open_prs: {
    total: 0, draft: 0, ready: 0,
    by_author: [], by_repo: [],
    oldest_days: 0, lines_added: 0, lines_removed: 0,
  },
  unmerged_branches: { total_branches: 0, total_commits: 0 },
};
```

- [ ] **Step 3: Make the existing return include `inflight`**

Change the `return { teamName: '', members, ... };` at the end of `extractTeamPulseData()` (currently line 150) to:

```ts
return { teamName: '', members, currentDays, priorDays, teamAvgCommits, teamAvgPrs, activeCount, totalCount, trendingPct, trendDirection, inflight: EMPTY_INFLIGHT };
```

(Real aggregation is added in Task 4; this step just makes the existing tests + types compile.)

- [ ] **Step 4: Type check + existing tests still pass**

```bash
npx tsc --noEmit -p tsconfig.json
npm test -- --testPathPatterns="team-pulse"
```
Expected: clean; existing team-pulse tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/team-pulse/data.ts
git commit -m "feat(team-pulse): add Inflight type to TeamPulseData (GLOOK-7)

Defaults to an empty struct so the existing pipeline keeps compiling.
Real aggregation lands in the next commit.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Pure `aggregateInflight()` helper + tests (TDD)

**Files:**
- Modify: `src/lib/team-pulse/data.ts` (add a new exported function)
- Create: `src/lib/__tests__/unit/team-pulse-inflight.test.ts`

The pure helper takes already-fetched rows (from `unmerged_prs` and `unmerged_commits`) and returns an `Inflight` struct. Querying happens in Task 4.

- [ ] **Step 1: Write failing tests**

Create `src/lib/__tests__/unit/team-pulse-inflight.test.ts`:

```ts
import { aggregateInflight, type Inflight } from '@/lib/team-pulse/data';

interface PrRow {
  github_login: string;
  repo: string;
  is_draft: 0 | 1 | boolean | null;
  pr_additions: number | null;
  pr_deletions: number | null;
  pr_updated_at: string | Date | null;
}

interface CommitRow {
  github_login: string;
  repo: string;
  branch: string | null;
}

const NOW = new Date('2026-05-20T12:00:00Z');

describe('aggregateInflight', () => {
  it('returns the empty struct for empty inputs', () => {
    const out = aggregateInflight([], [], NOW);
    expect(out.open_prs.total).toBe(0);
    expect(out.open_prs.draft).toBe(0);
    expect(out.open_prs.ready).toBe(0);
    expect(out.open_prs.by_author).toEqual([]);
    expect(out.open_prs.by_repo).toEqual([]);
    expect(out.open_prs.oldest_days).toBe(0);
    expect(out.open_prs.lines_added).toBe(0);
    expect(out.open_prs.lines_removed).toBe(0);
    expect(out.unmerged_branches.total_branches).toBe(0);
    expect(out.unmerged_branches.total_commits).toBe(0);
  });

  it('counts open PRs total / draft / ready', () => {
    const prs: PrRow[] = [
      { github_login: 'alice', repo: 'frontend', is_draft: false, pr_additions: 10, pr_deletions: 2, pr_updated_at: '2026-05-19T00:00:00Z' },
      { github_login: 'bob',   repo: 'frontend', is_draft: true,  pr_additions: 5,  pr_deletions: 1, pr_updated_at: '2026-05-18T00:00:00Z' },
      { github_login: 'alice', repo: 'api',      is_draft: false, pr_additions: 3,  pr_deletions: 0, pr_updated_at: '2026-05-19T00:00:00Z' },
    ];
    const out = aggregateInflight(prs, [], NOW);
    expect(out.open_prs.total).toBe(3);
    expect(out.open_prs.draft).toBe(1);
    expect(out.open_prs.ready).toBe(2);
    expect(out.open_prs.lines_added).toBe(18);
    expect(out.open_prs.lines_removed).toBe(3);
  });

  it('computes by_author top 5 descending, alphabetical tie-break', () => {
    const prs: PrRow[] = [
      { github_login: 'a', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'b', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'c', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'd', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'e', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'f', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
    ];
    const out = aggregateInflight(prs, [], NOW);
    expect(out.open_prs.by_author).toEqual([
      { login: 'a', count: 2 },
      { login: 'b', count: 1 },
      { login: 'c', count: 1 },
      { login: 'd', count: 1 },
      { login: 'e', count: 1 },
    ]);
  });

  it('computes by_repo top 3 descending', () => {
    const prs: PrRow[] = [
      { github_login: 'a', repo: 'r3', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r3', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r3', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r2', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r2', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
      { github_login: 'a', repo: 'r4', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: null },
    ];
    const out = aggregateInflight(prs, [], NOW);
    expect(out.open_prs.by_repo).toEqual([
      { repo: 'r3', count: 3 },
      { repo: 'r2', count: 2 },
      { repo: 'r1', count: 1 },  // alphabetical before r4
    ]);
  });

  it('computes oldest_days as floor((now - max-age updated_at) / day)', () => {
    const prs: PrRow[] = [
      { github_login: 'a', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: '2026-05-15T12:00:00Z' }, // 5 days
      { github_login: 'a', repo: 'r1', is_draft: false, pr_additions: 0, pr_deletions: 0, pr_updated_at: '2026-05-18T12:00:00Z' }, // 2 days
    ];
    const out = aggregateInflight(prs, [], NOW);
    expect(out.open_prs.oldest_days).toBe(5);
  });

  it('counts unmerged branches and commits', () => {
    const commits: CommitRow[] = [
      { github_login: 'alice', repo: 'frontend', branch: 'feature/x' },
      { github_login: 'alice', repo: 'frontend', branch: 'feature/x' },
      { github_login: 'alice', repo: 'frontend', branch: 'feature/y' },
      { github_login: 'bob',   repo: 'api',      branch: 'fix/z' },
      { github_login: 'bob',   repo: 'api',      branch: null },   // branchless commit counts as its own branch (one per row)
    ];
    const out = aggregateInflight([], commits, NOW);
    expect(out.unmerged_branches.total_commits).toBe(5);
    // distinct (repo, branch) pairs: (frontend, feature/x), (frontend, feature/y), (api, fix/z), (api, null) → 4
    expect(out.unmerged_branches.total_branches).toBe(4);
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test -- --testPathPatterns="team-pulse-inflight"
```
Expected: failures — `aggregateInflight` not defined.

- [ ] **Step 3: Implement `aggregateInflight()` in `src/lib/team-pulse/data.ts`**

Add this exported function below `EMPTY_INFLIGHT`:

```ts
interface InflightPrRow {
  github_login: string;
  repo: string;
  is_draft: 0 | 1 | boolean | null;
  pr_additions: number | null;
  pr_deletions: number | null;
  pr_updated_at: string | Date | null;
}

interface InflightCommitRow {
  github_login: string;
  repo: string;
  branch: string | null;
}

export function aggregateInflight(
  prRows: InflightPrRow[],
  commitRows: InflightCommitRow[],
  now: Date,
): Inflight {
  if (prRows.length === 0 && commitRows.length === 0) return EMPTY_INFLIGHT;

  // Open PRs
  let draft = 0;
  let ready = 0;
  let lines_added = 0;
  let lines_removed = 0;
  let oldest_ms = 0;
  const prByAuthor = new Map<string, number>();
  const prByRepo   = new Map<string, number>();

  for (const r of prRows) {
    if (r.is_draft === true || r.is_draft === 1) draft++;
    else ready++;
    lines_added   += Number(r.pr_additions ?? 0);
    lines_removed += Number(r.pr_deletions ?? 0);
    if (r.pr_updated_at) {
      const t = new Date(r.pr_updated_at).getTime();
      const age = now.getTime() - t;
      if (age > oldest_ms) oldest_ms = age;
    }
    prByAuthor.set(r.github_login, (prByAuthor.get(r.github_login) ?? 0) + 1);
    prByRepo.set(r.repo, (prByRepo.get(r.repo) ?? 0) + 1);
  }

  const oldest_days = oldest_ms > 0 ? Math.floor(oldest_ms / 86_400_000) : 0;

  const sortDesc = <T extends { count: number }>(items: T[], tieKey: (x: T) => string) =>
    items.sort((a, b) => b.count - a.count || tieKey(a).localeCompare(tieKey(b)));

  const by_author = sortDesc(
    [...prByAuthor].map(([login, count]) => ({ login, count })),
    x => x.login,
  ).slice(0, 5);

  const by_repo = sortDesc(
    [...prByRepo].map(([repo, count]) => ({ repo, count })),
    x => x.repo,
  ).slice(0, 3);

  // Unmerged commits/branches
  const branchKeys = new Set<string>();
  for (const c of commitRows) branchKeys.add(`${c.repo} ${c.branch ?? ''}`);

  return {
    open_prs: {
      total: prRows.length,
      draft, ready,
      by_author, by_repo,
      oldest_days, lines_added, lines_removed,
    },
    unmerged_branches: {
      total_branches: branchKeys.size,
      total_commits: commitRows.length,
    },
  };
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- --testPathPatterns="team-pulse-inflight"
```
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/team-pulse/data.ts src/lib/__tests__/unit/team-pulse-inflight.test.ts
git commit -m "feat(team-pulse): aggregateInflight pure helper (GLOOK-7)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: SQL `fetchInflight()` + wire into `extractTeamPulseData()`

**Files:**
- Modify: `src/lib/team-pulse/data.ts`

This task does the live DB query and feeds rows into `aggregateInflight`. No unit test — the repo doesn't mock DB calls for team-pulse; the SQL is exercised at smoke time.

- [ ] **Step 1: Add `fetchInflight()` SQL helper**

In `src/lib/team-pulse/data.ts`, below `aggregateInflight`, add:

```ts
async function fetchInflight(reportId: string, teamMembers: string[]): Promise<Inflight> {
  if (teamMembers.length === 0) return EMPTY_INFLIGHT;
  const memberPlaceholders = teamMembers.map(() => '?').join(',');

  const [prRows] = await db.execute(
    `SELECT github_login, repo, is_draft, pr_additions, pr_deletions, pr_updated_at
       FROM unmerged_prs
      WHERE report_id = ? AND github_login IN (${memberPlaceholders})`,
    [reportId, ...teamMembers],
  ) as [any[], any];

  const [commitRows] = await db.execute(
    `SELECT github_login, repo, branch
       FROM unmerged_commits
      WHERE report_id = ? AND github_login IN (${memberPlaceholders})`,
    [reportId, ...teamMembers],
  ) as [any[], any];

  return aggregateInflight(prRows, commitRows, new Date());
}
```

- [ ] **Step 2: Call it from `extractTeamPulseData()`**

At the end of `extractTeamPulseData()` (currently line 150), add the `await fetchInflight(...)` and pass into the return:

```ts
const inflight = await fetchInflight(reportId, teamMembers);

return { teamName: '', members, currentDays, priorDays, teamAvgCommits, teamAvgPrs, activeCount, totalCount, trendingPct, trendDirection, inflight };
```

- [ ] **Step 3: Type check + run all tests**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```
Expected: clean; all tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/team-pulse/data.ts
git commit -m "feat(team-pulse): fetchInflight wires DB rows into the aggregator (GLOOK-7)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Update the prompt template

**Files:**
- Modify: `prompts/team-pulse-system.txt`

- [ ] **Step 1: Edit the template**

Open `prompts/team-pulse-system.txt`. Append to the bottom (after the existing `PER-MEMBER DATA:` line):

```
{{INFLIGHT_BLOCK}}
```

(We use a single placeholder that the builder renders to either the formatted block or empty string, so we never leave a literal `{{X}}` in the rendered prompt when in-flight is empty.)

Add ONE new line inside the existing `RULES:` block (right before the line `- Keep under 350 words total.`):

```
- Use IN-FLIGHT WORK to enrich Team Focus (what they're currently working on alongside what shipped) and Alerts (flag PRs open >5 days, large in-flight diffs needing review). Do NOT add a new heading; integrate naturally into the existing sections.
```

After saving, the final template should look like (only added lines marked):

```diff
 You are a concise engineering team lead assistant generating a daily pulse summary.

 RULES:
 - ONLY use data provided below. Do NOT infer, hallucinate, or add any data not explicitly given.
 - Use @handles for developers.
 - Be direct and scannable — short bullets, no fluff, no emoji.
 - Compare individuals against their own prior-window baseline AND the team average where relevant.
 - Flag anything >2x or <0.5x baseline.
+- Use IN-FLIGHT WORK to enrich Team Focus (what they're currently working on alongside what shipped) and Alerts (flag PRs open >5 days, large in-flight diffs needing review). Do NOT add a new heading; integrate naturally into the existing sections.
 - Keep under 350 words total.

 OUTPUT STRUCTURE (use these exact headings):
 ...

 TEAM: {{TEAM_NAME}}
 WINDOW: {{CURRENT_WINDOW}} (current) vs {{PRIOR_WINDOW}} (prior)
 TEAM AVERAGES (current window): {{TEAM_AVG_COMMITS}} commits, {{TEAM_AVG_PRS}} PRs per active member ({{ACTIVE_COUNT}} of {{TOTAL_COUNT}} active)

 PER-MEMBER DATA:
 {{MEMBER_DATA}}
+{{INFLIGHT_BLOCK}}
```

- [ ] **Step 2: Commit**

```bash
git add prompts/team-pulse-system.txt
git commit -m "feat(prompts): add in-flight block + rule to team-pulse prompt (GLOOK-7)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Update prompt builder to emit `INFLIGHT_BLOCK` (TDD)

**Files:**
- Modify: `src/lib/team-pulse/prompt.ts`
- Modify: `src/lib/__tests__/unit/team-pulse-inflight.test.ts`

- [ ] **Step 1: Write failing tests for the prompt builder**

Append to `src/lib/__tests__/unit/team-pulse-inflight.test.ts`:

```ts
import { buildTeamPulsePrompt } from '@/lib/team-pulse/prompt';
import type { TeamPulseData } from '@/lib/team-pulse/data';

function makeData(inflight: Inflight): TeamPulseData {
  return {
    teamName: 'X',
    members: new Map(),
    currentDays: ['2026-05-19', '2026-05-20'],
    priorDays:   ['2026-05-15', '2026-05-16'],
    teamAvgCommits: 0, teamAvgPrs: 0,
    activeCount: 0, totalCount: 0,
    trendingPct: 0, trendDirection: 'stable',
    inflight,
  };
}

describe('buildTeamPulsePrompt — inflight', () => {
  it('renders an empty block (literal "(none)") when in-flight is empty', () => {
    const json = JSON.parse(buildTeamPulsePrompt(makeData(aggregateInflight([], [], NOW))));
    expect(json.INFLIGHT_BLOCK).toBe('IN-FLIGHT WORK (snapshot at report time): (none)');
  });

  it('renders the structured block when in-flight is populated', () => {
    const inflight: Inflight = {
      open_prs: {
        total: 6, draft: 2, ready: 4,
        by_author: [{ login: 'alice', count: 3 }, { login: 'bob', count: 2 }],
        by_repo:   [{ repo: 'frontend', count: 4 }, { repo: 'api', count: 2 }],
        oldest_days: 7, lines_added: 250, lines_removed: 40,
      },
      unmerged_branches: { total_branches: 5, total_commits: 18 },
    };
    const json = JSON.parse(buildTeamPulsePrompt(makeData(inflight)));
    expect(json.INFLIGHT_BLOCK).toBe(
      'IN-FLIGHT WORK (snapshot at report time):\n' +
      '- Open PRs: 6 (2 draft, 4 ready); oldest 7d; +250/-40 lines\n' +
      '- Unmerged branches: 5 branches, 18 commits\n' +
      '- In-flight by repo:   frontend (4), api (2)\n' +
      '- In-flight by author: @alice (3), @bob (2)'
    );
  });
});
```

- [ ] **Step 2: Run, verify failure**

```bash
npm test -- --testPathPatterns="team-pulse-inflight"
```
Expected: the two new tests fail — `INFLIGHT_BLOCK` is `undefined`.

- [ ] **Step 3: Update `buildTeamPulsePrompt()` to emit `INFLIGHT_BLOCK`**

In `src/lib/team-pulse/prompt.ts`, modify the return statement (currently lines 43–53) to include the new placeholder. Add a helper above the `return JSON.stringify(...)`:

```ts
function renderInflightBlock(i: { open_prs: { total: number; draft: number; ready: number; oldest_days: number; lines_added: number; lines_removed: number; by_author: { login: string; count: number }[]; by_repo: { repo: string; count: number }[] }; unmerged_branches: { total_branches: number; total_commits: number } }): string {
  if (i.open_prs.total === 0 && i.unmerged_branches.total_commits === 0) {
    return 'IN-FLIGHT WORK (snapshot at report time): (none)';
  }
  const byRepo   = i.open_prs.by_repo.length === 0   ? '(none)' : i.open_prs.by_repo.map(r => `${r.repo} (${r.count})`).join(', ');
  const byAuthor = i.open_prs.by_author.length === 0 ? '(none)' : i.open_prs.by_author.map(a => `@${a.login} (${a.count})`).join(', ');
  return [
    'IN-FLIGHT WORK (snapshot at report time):',
    `- Open PRs: ${i.open_prs.total} (${i.open_prs.draft} draft, ${i.open_prs.ready} ready); oldest ${i.open_prs.oldest_days}d; +${i.open_prs.lines_added}/-${i.open_prs.lines_removed} lines`,
    `- Unmerged branches: ${i.unmerged_branches.total_branches} branches, ${i.unmerged_branches.total_commits} commits`,
    `- In-flight by repo:   ${byRepo}`,
    `- In-flight by author: ${byAuthor}`,
  ].join('\n');
}
```

Then extend the JSON object in the return:

```ts
return JSON.stringify({
  TEAM_NAME: data.teamName,
  CURRENT_WINDOW: formatDays(data.currentDays),
  PRIOR_WINDOW: formatDays(data.priorDays),
  TEAM_AVG_COMMITS: String(data.teamAvgCommits),
  TEAM_AVG_PRS: String(data.teamAvgPrs),
  ACTIVE_COUNT: String(data.activeCount),
  TOTAL_COUNT: String(data.totalCount),
  MEMBER_DATA: lines.join('\n'),
  INFLIGHT_BLOCK: renderInflightBlock(data.inflight),
});
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- --testPathPatterns="team-pulse-inflight"
```
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/team-pulse/prompt.ts src/lib/__tests__/unit/team-pulse-inflight.test.ts
git commit -m "feat(team-pulse): prompt builder emits INFLIGHT_BLOCK (GLOOK-7)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: `PROMPT_VERSION` constant + cache invalidation

**Files:**
- Modify: `src/lib/team-pulse/service.ts`

- [ ] **Step 1: Add the constant + use in cache SELECT/INSERT**

At the top of `src/lib/team-pulse/service.ts`, below the imports, add:

```ts
const PROMPT_VERSION = 'v2-inflight';
```

Change the cache SELECT (currently lines 25–28) from:

```ts
const [cached] = await db.execute(
  `SELECT summary_text, health_json, generated_at FROM team_pulse_summaries WHERE report_id = ? AND team_name = ?`,
  [reportId, teamName],
) as [any[], any];
```

to:

```ts
const [cached] = await db.execute(
  `SELECT summary_text, health_json, generated_at FROM team_pulse_summaries WHERE report_id = ? AND team_name = ? AND prompt_version = ?`,
  [reportId, teamName, PROMPT_VERSION],
) as [any[], any];
```

Change the cache INSERT (currently lines 82–87) from:

```ts
await db.execute(
  `INSERT INTO team_pulse_summaries (report_id, team_name, org, summary_text, health_json)
   VALUES (?, ?, ?, ?, ?)
   ON DUPLICATE KEY UPDATE summary_text = VALUES(summary_text), health_json = VALUES(health_json), generated_at = NOW()`,
  [reportId, teamName, org, summary, JSON.stringify(health)],
);
```

to:

```ts
await db.execute(
  `INSERT INTO team_pulse_summaries (report_id, team_name, org, summary_text, health_json, prompt_version)
   VALUES (?, ?, ?, ?, ?, ?)
   ON DUPLICATE KEY UPDATE summary_text = VALUES(summary_text), health_json = VALUES(health_json), prompt_version = VALUES(prompt_version), generated_at = NOW()`,
  [reportId, teamName, org, summary, JSON.stringify(health), PROMPT_VERSION],
);
```

- [ ] **Step 2: Type check + tests**

```bash
npx tsc --noEmit -p tsconfig.json
npm test
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/team-pulse/service.ts
git commit -m "feat(team-pulse): PROMPT_VERSION cache key for invalidation (GLOOK-7)

Old cached summaries (prompt_version='v1') are silently bypassed by the
new SELECT and regenerate with the in-flight-aware prompt.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Local smoke test

- [ ] **Step 1: Rebuild and replace the container (via /tmp workaround per repo memory)**

```bash
rsync -a --delete \
  --exclude=node_modules --exclude=.next --exclude=.git --exclude='*.log' \
  --exclude=glooker.db --exclude='.env*' --exclude='.superpowers' \
  /Users/msogin/Desktop/claudecode/glooker/ /tmp/glooker-build/
podman build -f /tmp/glooker-build/Dockerfile -t localhost/glooker_app:latest /tmp/glooker-build/
podman stop glooker_app_1 || true
podman rm   glooker_app_1 || true
podman-compose up -d --no-build app
until curl -sf http://localhost:3000/api/health > /dev/null; do sleep 2; done
echo "Server ready"
```

- [ ] **Step 2: Verify the schema migration applied**

```bash
podman exec glooker_mysql_1 mysql -uglooker -pglooker glooker -e "DESCRIBE team_pulse_summaries"
```
Expected: the column `prompt_version` is present with type `varchar(16)`, `Not Null`, default `'v1'`.

- [ ] **Step 3: Generate a fresh team-pulse summary**

Open the latest report's team page in the browser, e.g.:

`http://localhost:3000/report/<id>/team` — pick a team filter that has known team members with open PRs and unmerged commits in the DB. The TeamPulseCard should render a fresh summary (a small loading spinner first, then markdown content).

- [ ] **Step 4: Visual verification of the summary**

- The Markdown headings stay as they were (`Activity Changes`, `Silent Members`, `Team Focus`, `Alerts`) — no new heading.
- The narrative in `Team Focus` or `Alerts` should now mention in-flight work where appropriate (e.g. "team has N open PRs in frontend, oldest 7 days").
- If the team has zero in-flight (e.g., everything merged), the LLM should produce a sensible summary without contriving in-flight content.

- [ ] **Step 5: Verify cache is being written with the new prompt_version**

```bash
podman exec glooker_mysql_1 mysql -uglooker -pglooker glooker -e \
  "SELECT report_id, team_name, prompt_version, LEFT(summary_text, 80) AS preview FROM team_pulse_summaries ORDER BY generated_at DESC LIMIT 5"
```
Expected: most recent row's `prompt_version` is `v2-inflight`.

- [ ] **Step 6: Final commit (only if smoke surfaced any tweak)**

If you adjusted anything during smoke:

```bash
git add -p
git commit -m "fix(team-pulse): smoke-test adjustments (GLOOK-7)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

If no changes were needed, skip.

---

## Self-review notes

**Spec coverage:**
- ✓ Inflight data shape — Task 2 + Task 3
- ✓ Top-N (5 authors, 3 repos) with alphabetical tiebreak — Task 3 test
- ✓ Empty case renders `(none)` — Task 6 test
- ✓ Prompt rule integration — Task 5
- ✓ Cache invalidation via prompt_version — Tasks 1 and 7
- ✓ Files touched list — all addressed
- ✓ Test coverage — Tasks 3 and 6 cover the pure pieces

**Open question (carried from spec):** `oldest_days` derived from `pr_updated_at` (last activity), not `pr_created_at`. The plan and tests follow the spec recommendation; trivial to swap later by changing one column name in the SELECT and one field in the test fixtures.
