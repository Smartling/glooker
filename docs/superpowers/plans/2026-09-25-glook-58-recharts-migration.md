# GLOOK-58 Recharts v3 Chart Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every hand-rolled SVG chart with Recharts v3 components that live outside `page.tsx`, read all colors from theme-aware CSS tokens, and have behavioral tests.

**Architecture:** A ported shadcn `chart.tsx` wrapper sits on Recharts 3.10. Pure helpers (`chart-format.ts`, `commit-types.ts`) and a hatch-pattern hook (`hatch.tsx`) sit under it. Five chart components sit on top in `src/components/charts/`, and `TrendChart` and `ProgressRing` are rewritten in place. Every color is a `--chart-*` CSS variable defined for dark under `:root` and for light under `[data-theme-mode="light"]`. Three guard tests stop literal colors, missing tokens and contrast regressions from coming back.

**Tech Stack:** Next.js 15 App Router, React 19.2, TypeScript, Tailwind CSS 3.4, Recharts 3.10.1, clsx 2, tailwind-merge 2.6, Jest 30 + ts-jest + jsdom 26, @testing-library/react 16.

**Spec:** `docs/superpowers/specs/2026-09-25-glook-58-recharts-migration-design.md`. Read it fully before Task 1. The plan argues from it, and where the two disagree the plan says so and says why.

## Global Constraints

- **Run every node command through Node 24.** The machine default (Node 26) breaks `better-sqlite3`. Always use this form from the worktree root, with one plain command inside the quotes: no `$VARS`, no `&&`, no pipes. The harness refuses compound payloads.
  `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c '<one command>'`
- **Worktree:** `/Users/maes/Documents/1macmount/code/glooker/.claude/worktrees/GLOOK-58-recharts`. Work only here. Git works normally in this worktree (`git status` returns instantly). Use `git add <explicit paths>`, never `git add -A` or `git add .`.
- **Test baseline:** 169 suites / 1669 tests green. Single file: `npx jest <path>`. Full suite: `npx jest --maxWorkers=3`.
- **Commit messages** start with `GLOOK-58: ` and end with a blank line followed by `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Write each message with a heredoc: `git commit -F - <<'EOF' ... EOF`.
- **Dependency versions (spec Decision 2):** `recharts@^3.10`, `clsx@^2.1`, `tailwind-merge@^2.6`. Do **not** use tailwind-merge 3.x, which supports Tailwind v4 only. Also add `react-is@^19.2` (see Task 2 for why).
- **`src/app/**/page.tsx` may export only `default`.** An extra export passes `npm test` and `tsc` and fails only at `npm run build`. Charts and their helpers live in `src/components/charts/`.
- **Tests live flat in `src/lib/__tests__/unit/`** (Jest `roots` is `src/lib`). Component tests start with `/** @jest-environment jsdom */` on line 1. `@testing-library/jest-dom` is **not** installed, so use plain Jest matchers (`toBe`, `toBeTruthy`, `toBeNull`, `toEqual`).
- **Tests check behavior a user sees:** rendered values, fills, ARIA, legend and tooltip text, counts of marks. They never assert tick counts, tick positions or label placement, because jsdom has no SVG text layout.
- **Numeric inputs pass through `toNum()`** (from `chart-format.ts`). `DECIMAL`/`REAL` columns can arrive as strings. Charts never throw, and `NaN` renders as 0.
- **No literal colors in chart modules** (spec Decision 5). No hex color, no `fill-gray-*` or `stroke-gray-*` class. That covers `src/components/charts/*`, `src/app/vulnerabilities/trend-chart.tsx`, `src/app/vulnerabilities/team-colors.ts` and `src/app/projects/progress-ring.tsx`. Do not write `#` followed by three or more hex digits in those files' comments either, for example an issue reference like `#6806`: the guard in Task 10 reads it as a color.
- **Every `--chart-*` token value is a 6-digit hex** (`#rrggbb`) in both blocks. The contrast guard only parses that form.
- **Text in charts uses chrome tokens** (`text-chart-axis`, `text-chart-tooltip-text`, `fill-chart-axis`), never a series color.
- **Every Recharts series sets `isAnimationActive={false}`.** Two reasons:
  1. The org page has a Download PDF button, and `window.print()` would capture bars mid-animation.
  2. jsdom has no `matchMedia`, so Recharts' `'auto'` animation stays on in tests. A bar's first frame has zero height, and a zero-height `Rectangle` renders nothing.
- **The repo is public OSS.** No company-internal names (teams, repos, people, org structure) in code, tests, fixtures, docs or commit messages. Use generic names: `acme`, `TeamA`, `team.alpha`.
- **Find edits by the quoted code, not by line number.** Line numbers are as of the start of the plan (commit `acad605`). An earlier step in the same task, such as an added import, shifts them.
- **Do not touch unrelated code.** Each task lists its files. If a change seems to need a file that isn't listed, stop and ask.

## Review Focus

1. **Week keys that are not Mondays.** `weekKeyForDate()` (`src/lib/report/timeline.ts:24-29`) sets the date to Monday in local time but keeps the commit's time of day, then formats the result in UTC. A commit on Monday at 21:00 in New York gets a **Tuesday** key, and in a UTC+ zone a Sunday key is possible. One real week can then arrive as two buckets. If the week domain matched keys exactly, those weeks would render as false zeros, silently losing data. `snapWeekKey()` snaps every key to its nearest Monday and merges the rows. Pinned in Task 3 (`chart-format.test.ts`) and Task 4 (a Tuesday-keyed row still draws a bar).
2. **Numbers that arrive as strings.** A `"12.50"` or `""` from a DECIMAL column must render as 12.5 or 0, never as `NaN` or string concatenation. Pinned in Task 3 (`toNum`) and Task 4 (a string-valued ratio renders its header value).
3. **All-zero and zero-total inputs.** These must show an explicit empty state, not an empty frame or `NaN%`:
   - A donut total of 0, or `"0"`.
   - A lines chart whose weeks are all zero.
   - A timeline with no data in 90 days.
   - A ring with `maxVolume = 0`.

   Pinned in Tasks 4, 5 and 8.
4. **Team names containing `.` or spaces.** Recharts treats a string `dataKey` as a lodash-style path, so a team named `team.alpha` would read `row.team.alpha` and draw nothing. `TrendChart` uses a function `dataKey`. Pinned in Task 7.
5. **In-flight values larger than the week's total.** If the overlay claims more in-flight commits than the week has, shipped would go negative and the stack would draw below zero. The timeline clamps in-flight to `[0, total]`. Pinned in Task 4.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/app/globals.css` | `--chart-*` tokens for both modes, plus light and print rules for type-badge classes | 1, 6 |
| `tailwind.config.ts` | `chart.*` color namespace | 1 |
| `src/lib/cn.ts` | `cn()` class merger | 2 |
| `src/lib/__tests__/setup/resize-observer.ts` | jsdom-only `ResizeObserver` stub (`setupFiles`) | 2 |
| `src/lib/__tests__/setup/chart-size.ts` | `fixChartSize()` test helper | 2 |
| `jest.config.ts` | `setupFiles` entry | 2 |
| `src/components/charts/chart.tsx` | Ported shadcn wrapper | 2 |
| `src/components/charts/chart-format.ts` | `toNum`, week domain, snapping, filling, formatters, `isTopOfStack` | 3 |
| `src/components/charts/commit-types.ts` | Type order, color and background-class maps, `foldTypes` | 3 |
| `src/components/charts/hatch.tsx` | `useHatch()`, `HatchSwatch` | 3 |
| `src/components/charts/timeline-chart.tsx` | `TimelineChart`, `TimelineTooltip` | 4 |
| `src/components/charts/stacked-types-chart.tsx` | `StackedTypesChart`, `StackedTypesTooltip` | 5 |
| `src/components/charts/lines-changed-chart.tsx` | `LinesChangedChart`, `LinesTooltip` | 5 |
| `src/components/charts/commit-type-donut.tsx` | `CommitTypeDonut` | 5 |
| `src/app/report/[id]/org/page.tsx` | Wiring only | 4, 5 |
| `src/app/report/[id]/dev/[login]/page.tsx` | Wiring only | 4, 6 |
| `src/app/report/[id]/team/dev-table.tsx` | Type badges read `commit-types.ts` | 6 |
| `src/app/vulnerabilities/team-colors.ts` | `assignTeamColors`, `OTHER_TEAM_COLOR` | 7 |
| `src/app/vulnerabilities/trend-chart.tsx` | Rewritten `TrendChart` | 7 |
| `src/app/vulnerabilities/vulnerabilities-content.tsx` | Passes `colorByTeam` | 7 |
| `src/app/projects/progress-ring.tsx` | Rewritten `ProgressRing`, `ringGeometry` | 8 |
| `src/components/ProjectsCard.tsx`, `src/app/reports/page.tsx`, `src/app/reports/vulnerability-syncs-tab.tsx` | Colors only | 9 |

**Two deliberate additions to the spec's interfaces, both needed by its own requirements:**

1. **Every page-grid chart takes a `weeks: string[]` prop.** The page computes it once with `recentWeekDomain(new Date())`. Decision 10 says every chart on a page shares the same week array, because `syncId` matches on index. Computing the domain once per page render guarantees that, even across midnight.
2. **`fillWeeks()` and `groupByWeek()` sit next to `buildWeekDomain()`.** `buildWeekDomain()` only lists Mondays. Filling per `kind`, snapping off-Monday keys and merging split weeks are separate, testable steps.

---

### Task 1: Palette and tokens (gate)

Every later task depends on this one. Its values are produced here, not in the plan: the plan gives the starting hexes, the exact commands and the acceptance criteria.

**Files:**
- Modify: `src/app/globals.css` (`:root` block, lines 6-32; bare `[data-theme-mode="light"]` block, lines 62-89)
- Modify: `tailwind.config.ts`
- Modify: `docs/superpowers/specs/2026-09-25-glook-58-recharts-migration-design.md` (the `### Palette` section only)
- Create: `src/lib/__tests__/unit/chart-tokens-css.test.ts` (spec guard test 2)
- Create: `src/lib/__tests__/unit/chart-contrast.test.ts` (spec guard test 3)

**Interfaces:**
- Consumes: `THEMES` from `src/app/themes.ts`.
- Produces:
  - **CSS custom properties** in both blocks:
    - `--chart-grid`, `--chart-axis`, `--chart-cursor`, `--chart-tooltip-bg`, `--chart-tooltip-border`, `--chart-tooltip-text`, `--chart-track`, `--chart-surface`
    - `--chart-type-feature`, `--chart-type-bug`, `--chart-type-refactor`, `--chart-type-infra`, `--chart-type-docs`, `--chart-type-test`, `--chart-type-other`, `--chart-type-in-flight`
    - `--chart-lines-added`, `--chart-lines-removed`
    - `--chart-ring-jira`, `--chart-ring-commits`
    - `--chart-volume-prs`, `--chart-volume-jiras`, `--chart-volume-commits`
  - **Tailwind classes:**
    - Chrome: `bg-/text-/fill-/stroke-/border-` + `chart-grid`, `chart-axis`, `chart-cursor`, `chart-tooltip-bg`, `chart-tooltip-border`, `chart-tooltip-text`, `chart-track`, `chart-surface`
    - Types: `bg-chart-type-feature` … `bg-chart-type-in-flight`

**Why `--chart-volume-*` exists.** It is not in the spec's token list. The spec does say the `ProjectsCard` volume bar's colors "move to tokens" (Non-goals), and that bar uses three colors no other token covers: cyan PRs, purple Jiras and a faint white "commits" remainder. The white remainder is invisible on a light card today. `prs` and `jiras` get the same 3:1 contrast gate as the other fixed palettes. `commits` is a deliberately de-emphasized remainder, so it is exempt from the gate, and it only has to differ from `--chart-track`.

- [ ] **Step 1: Write guard test 2 (tokens in both modes)**

Create `src/lib/__tests__/unit/chart-tokens-css.test.ts`:

```ts
// src/lib/__tests__/unit/chart-tokens-css.test.ts
// GLOOK-58 guard test 2: every --chart-* token is defined for dark (:root) AND light (the bare
// [data-theme-mode="light"] block), as a 6-digit hex, and every var(--chart-*) that chart code or
// the Tailwind config references actually exists. A token missing from the light block would fall
// back to the dark value and put dark internals inside a light card, the bug this ticket fixes.
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '../../../..');
const css = fs.readFileSync(path.join(root, 'src/app/globals.css'), 'utf8');

function extractBlock(source: string, selectorLine: RegExp): string {
  const lines = source.split('\n');
  const start = lines.findIndex(l => selectorLine.test(l.trim()));
  if (start === -1) throw new Error(`selector not found: ${selectorLine}`);
  let depth = 0;
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    out.push(lines[i]);
    depth += (lines[i].match(/{/g) || []).length;
    depth -= (lines[i].match(/}/g) || []).length;
    if (i > start && depth <= 0) break;
  }
  return out.join('\n');
}

function chartTokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--(chart-[a-z0-9-]+):\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out[m[1]] = m[2].trim();
  return out;
}

const dark = chartTokens(extractBlock(css, /^:root\s*{$/));
// Match the bare selector exactly, not one of the many `[data-theme-mode="light"] .foo {` rules.
const light = chartTokens(extractBlock(css, /^\[data-theme-mode="light"\]\s*{$/));

const REQUIRED = [
  'chart-grid', 'chart-axis', 'chart-cursor', 'chart-tooltip-bg', 'chart-tooltip-border',
  'chart-tooltip-text', 'chart-track', 'chart-surface',
  'chart-type-feature', 'chart-type-bug', 'chart-type-refactor', 'chart-type-infra',
  'chart-type-docs', 'chart-type-test', 'chart-type-other', 'chart-type-in-flight',
  'chart-lines-added', 'chart-lines-removed',
  'chart-ring-jira', 'chart-ring-commits',
  'chart-volume-prs', 'chart-volume-jiras', 'chart-volume-commits',
];

// Files whose var(--chart-*) references must resolve. Missing files are skipped, so this test can
// land before the chart modules exist and tightens as they arrive.
const REFERENCING_FILES = [
  'tailwind.config.ts',
  'src/app/vulnerabilities/trend-chart.tsx',
  'src/app/projects/progress-ring.tsx',
  'src/components/ProjectsCard.tsx',
];
const CHART_DIR = path.join(root, 'src/components/charts');

function referencedTokens(): Array<{ file: string; token: string }> {
  const files = [...REFERENCING_FILES.map(f => path.join(root, f))];
  if (fs.existsSync(CHART_DIR)) {
    for (const f of fs.readdirSync(CHART_DIR)) files.push(path.join(CHART_DIR, f));
  }
  const out: Array<{ file: string; token: string }> = [];
  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/var\(--(chart-[a-z0-9-]+)\)/g)) out.push({ file: path.relative(root, file), token: m[1] });
  }
  return out;
}

it('defines every required --chart-* token under :root (dark)', () => {
  expect(REQUIRED.filter(t => !(t in dark))).toEqual([]);
});

it('defines exactly the same --chart-* tokens under the bare light block as under :root', () => {
  expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort());
});

it('every --chart-* value in both modes is a 6-digit hex (the contrast guard only parses that form)', () => {
  const bad = [
    ...Object.entries(dark).filter(([, v]) => !/^#[0-9a-fA-F]{6}$/.test(v)).map(([k, v]) => `dark --${k}: ${v}`),
    ...Object.entries(light).filter(([, v]) => !/^#[0-9a-fA-F]{6}$/.test(v)).map(([k, v]) => `light --${k}: ${v}`),
  ];
  expect(bad).toEqual([]);
});

it('every var(--chart-*) referenced by chart code or the Tailwind config is defined', () => {
  const missing = referencedTokens().filter(r => !(r.token in dark)).map(r => `${r.file}: --${r.token}`);
  expect(missing).toEqual([]);
});
```

- [ ] **Step 2: Write guard test 3 (contrast)**

Create `src/lib/__tests__/unit/chart-contrast.test.ts`:

```ts
// src/lib/__tests__/unit/chart-contrast.test.ts
// GLOOK-58 guard test 3: every contrast threshold in spec Decision 14, in both modes.
//   - Fixed palettes (commit types, lines, ring, volume prs/jiras) >= 3:1 against the card surface.
//   - Ring colours >= 3:1 against --chart-track, the surface they are drawn over.
//   - All ten theme accents >= 3:1 against their own mode's card surface (single-metric timelines
//     are drawn in var(--accent)).
//   - --chart-axis >= 4.5:1 against the card; --chart-tooltip-text >= 4.5:1 against --chart-tooltip-bg.
//   - --chart-grid >= 3:1 against the card; --chart-tooltip-border >= 3:1 against --chart-tooltip-bg.
// Colour-blind separation is checked by the dataviz validator in the palette task and recorded in
// the spec's Palette section; it is not recomputed here.
import fs from 'fs';
import path from 'path';
import { THEMES } from '@/app/themes';

const css = fs.readFileSync(path.join(__dirname, '../../../app/globals.css'), 'utf8');

function extractBlock(source: string, selectorLine: RegExp): string {
  const lines = source.split('\n');
  const start = lines.findIndex(l => selectorLine.test(l.trim()));
  if (start === -1) throw new Error(`selector not found: ${selectorLine}`);
  let depth = 0;
  const out: string[] = [];
  for (let i = start; i < lines.length; i++) {
    out.push(lines[i]);
    depth += (lines[i].match(/{/g) || []).length;
    depth -= (lines[i].match(/}/g) || []).length;
    if (i > start && depth <= 0) break;
  }
  return out.join('\n');
}

function parseHexVars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /--(chart-[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out[m[1]] = m[2].toLowerCase();
  return out;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
// WCAG relative luminance: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const modes = {
  dark: parseHexVars(extractBlock(css, /^:root\s*{$/)),
  light: parseHexVars(extractBlock(css, /^\[data-theme-mode="light"\]\s*{$/)),
} as const;

const FIXED = [
  'chart-type-feature', 'chart-type-bug', 'chart-type-refactor', 'chart-type-infra',
  'chart-type-docs', 'chart-type-test', 'chart-type-other', 'chart-type-in-flight',
  'chart-lines-added', 'chart-lines-removed',
  'chart-ring-jira', 'chart-ring-commits',
  'chart-volume-prs', 'chart-volume-jiras',
];

function check(pairs: Array<[string, string, string, number]>): string[] {
  return pairs
    .filter(([, a, b, min]) => contrast(a, b) < min)
    .map(([label, a, b, min]) => `${label}: ${a} vs ${b} = ${contrast(a, b).toFixed(2)} (< ${min})`);
}

describe.each(['dark', 'light'] as const)('%s mode chart contrast', mode => {
  const v = modes[mode];

  it('--chart-surface is the card colour charts sit on (dark bg-gray-900 #111827, light card #ffffff)', () => {
    expect(v['chart-surface']).toBe(mode === 'dark' ? '#111827' : '#ffffff');
  });

  it('fixed palettes clear 3:1 against the card surface', () => {
    expect(check(FIXED.map(t => [`--${t}`, v[t], v['chart-surface'], 3] as [string, string, string, number]))).toEqual([]);
  });

  it('ring colours clear 3:1 against --chart-track', () => {
    expect(check([
      ['--chart-ring-jira vs track', v['chart-ring-jira'], v['chart-track'], 3],
      ['--chart-ring-commits vs track', v['chart-ring-commits'], v['chart-track'], 3],
    ])).toEqual([]);
  });

  it('every theme accent in this mode clears 3:1 against the card surface', () => {
    const accents = THEMES.filter(t => t.mode === mode);
    expect(accents.length).toBeGreaterThan(0);
    expect(check(accents.map(t => [`${t.id} accent`, t.accent.toLowerCase(), v['chart-surface'], 3] as [string, string, string, number]))).toEqual([]);
  });

  it('chrome text clears 4.5:1 and chrome lines clear 3:1 against their own backgrounds', () => {
    expect(check([
      ['--chart-axis vs surface', v['chart-axis'], v['chart-surface'], 4.5],
      ['--chart-tooltip-text vs tooltip-bg', v['chart-tooltip-text'], v['chart-tooltip-bg'], 4.5],
      ['--chart-grid vs surface', v['chart-grid'], v['chart-surface'], 3],
      ['--chart-tooltip-border vs tooltip-bg', v['chart-tooltip-border'], v['chart-tooltip-bg'], 3],
    ])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run both guards and confirm they fail**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/chart-tokens-css.test.ts src/lib/__tests__/unit/chart-contrast.test.ts'`

Expected: FAIL. The tokens test lists all 23 required tokens as missing. The contrast test fails with `undefined`-valued comparisons, or with the `--chart-surface` assertion.

- [ ] **Step 4: Run the dataviz validator on the starting palettes**

The validator lives at `/private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js`. If that path is gone, find it with `ls /private/tmp/claude-501/bundled-skills` and use the `dataviz/scripts/validate_palette.js` under the newest version directory.

Starting values:

| Palette (in stack/adjacency order) | Dark (surface `#111827`) | Light (surface `#ffffff`) |
|---|---|---|
| Commit types (feature, bug, refactor, infra, docs, test, other, in_flight) | `#3B82F6,#EF4444,#A855F7,#EAB308,#6B7280,#22C55E,#9CA3AF,#06B6D4` | `#2563EB,#DC2626,#9333EA,#A16207,#6B7280,#15803D,#4B5563,#0E7490` |
| Lines (added, in-flight, removed) | `#10B981,#06B6D4,#EF4444` | `#047857,#0E7490,#DC2626` |
| Ring (jira, commits) | `#D97706,#10B981` | `#B45309,#047857` |
| Volume (prs, jiras) | `#06B6D4,#A855F7` | `#0E7490,#9333EA` |

The dark commit-type starting set is today's `TYPE_HEX` (`org/page.tsx:22-31`) with one change: `other` moves from `#4B5563` to `#9CA3AF`, because `#4B5563` measures 2.35:1 on `#111827`. The light set starts from the nearest Tailwind 600/700 steps. The lines palette includes the in-flight color, because the in-flight hatch sits against both added and removed.

Run each command, one per invocation. Commit types, dark, adjacent pairs:

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#3B82F6,#EF4444,#A855F7,#EAB308,#6B7280,#22C55E,#9CA3AF,#06B6D4" --mode dark --surface "#111827"'`

Commit types, dark, all pairs (the donut sorts by count, so any two types can end up adjacent; record this, do not gate on it):

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#3B82F6,#EF4444,#A855F7,#EAB308,#6B7280,#22C55E,#9CA3AF,#06B6D4" --mode dark --surface "#111827" --pairs all'`

Commit types, light, adjacent, then all pairs:

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#2563EB,#DC2626,#9333EA,#A16207,#6B7280,#15803D,#4B5563,#0E7490" --mode light --surface "#ffffff"'`

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#2563EB,#DC2626,#9333EA,#A16207,#6B7280,#15803D,#4B5563,#0E7490" --mode light --surface "#ffffff" --pairs all'`

Lines, both modes (all pairs, since each of the three touches the other two):

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#10B981,#06B6D4,#EF4444" --mode dark --surface "#111827" --pairs all'`

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#047857,#0E7490,#DC2626" --mode light --surface "#ffffff" --pairs all'`

Ring, both modes:

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#D97706,#10B981" --mode dark --surface "#111827"'`

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#B45309,#047857" --mode light --surface "#ffffff"'`

Volume, both modes:

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#06B6D4,#A855F7" --mode dark --surface "#111827"'`

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#0E7490,#9333EA" --mode light --surface "#ffffff"'`

**Acceptance: gate on exactly the three checks spec Decision 14 names.** In each **adjacent** run (the default, no `--pairs all`):

1. **`CVD separation`** must read `[PASS]`. That means ΔE ≥ 8. The validator's `[WARN]` band (6-8) counts as a failure here, because the spec's floor is 8.
2. **`Normal-vision floor`** must read `[PASS]`.
3. **3:1 contrast is gated by `chart-contrast.test.ts`,** not by the validator's `Contrast vs surface` line. Record that line, but the Jest test is authoritative.

`Lightness band` and `Chroma floor` are **recorded, not gated.** `docs` and `other` are grays by design, so the chroma floor always fails them. The validator's exit code is therefore expected to be 1 for the commit-type palettes, so don't loop on it. The `--pairs all` runs are recorded, not gated.

**Snapping rule when a gated check fails:**
- Move the failing color one Tailwind shade within its hue family. Dark mode goes lighter (500→400), light mode goes darker (600→700).
- If the pair is still too close, change the other member of the pair instead.
- Keep feature blue and bug red in both modes (Decision 8).
- Re-run until the gated checks pass.

Save each final command's full output. It goes into the spec in Step 7.

- [ ] **Step 5: Add the tokens to `globals.css`**

Add this at the end of the `:root` block, after `--vuln-series-other` (line 31, before the closing `}` on line 32). Replace any value Step 4 changed.

```css
  /* GLOOK-58: chart tokens (dark, the app's default). Values validated in the spec's Palette
     section; chart-contrast.test.ts guards every Decision 14 threshold. --chart-surface is the
     card colour charts sit on (bg-gray-900). */
  --chart-grid: #6b7280;
  --chart-axis: #9ca3af;
  --chart-cursor: #1f2937;
  --chart-tooltip-bg: #1f2937;
  --chart-tooltip-border: #6b7280;
  --chart-tooltip-text: #e5e7eb;
  --chart-track: #1f2937;
  --chart-surface: #111827;
  --chart-type-feature: #3b82f6;
  --chart-type-bug: #ef4444;
  --chart-type-refactor: #a855f7;
  --chart-type-infra: #eab308;
  --chart-type-docs: #6b7280;
  --chart-type-test: #22c55e;
  --chart-type-other: #9ca3af;
  --chart-type-in-flight: #06b6d4;
  --chart-lines-added: #10b981;
  --chart-lines-removed: #ef4444;
  --chart-ring-jira: #d97706;
  --chart-ring-commits: #10b981;
  --chart-volume-prs: #06b6d4;
  --chart-volume-jiras: #a855f7;
  --chart-volume-commits: #374151;
```

Add this at the end of the bare `[data-theme-mode="light"]` block, after `--vuln-series-other: #6b7280;` (line 88, before the closing `}` on line 89). Again, replace any value Step 4 changed.

```css
  /* GLOOK-58: chart tokens (light). Same names as :root. --chart-surface is the light card
     (the .bg-gray-900 override below is #ffffff). */
  --chart-grid: #6b7280;
  --chart-axis: #4b5563;
  --chart-cursor: #f3f4f6;
  --chart-tooltip-bg: #ffffff;
  --chart-tooltip-border: #6b7280;
  --chart-tooltip-text: #111827;
  --chart-track: #e5e7eb;
  --chart-surface: #ffffff;
  --chart-type-feature: #2563eb;
  --chart-type-bug: #dc2626;
  --chart-type-refactor: #9333ea;
  --chart-type-infra: #a16207;
  --chart-type-docs: #6b7280;
  --chart-type-test: #15803d;
  --chart-type-other: #4b5563;
  --chart-type-in-flight: #0e7490;
  --chart-lines-added: #047857;
  --chart-lines-removed: #dc2626;
  --chart-ring-jira: #b45309;
  --chart-ring-commits: #047857;
  --chart-volume-prs: #0e7490;
  --chart-volume-jiras: #9333ea;
  --chart-volume-commits: #d1d5db;
```

- [ ] **Step 6: Register the `chart.*` color namespace in Tailwind**

Replace the whole of `tailwind.config.ts` with:

```ts
import type { Config } from 'tailwindcss';

// GLOOK-58: chart tokens are CSS variables (globals.css), so the same class resolves to the dark
// value under :root and the light value under [data-theme-mode="light"]. Opacity modifiers
// (e.g. bg-chart-grid/50) do NOT work on these: Tailwind v3 cannot split a var() hex into channels.
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        chart: {
          grid: 'var(--chart-grid)',
          axis: 'var(--chart-axis)',
          cursor: 'var(--chart-cursor)',
          'tooltip-bg': 'var(--chart-tooltip-bg)',
          'tooltip-border': 'var(--chart-tooltip-border)',
          'tooltip-text': 'var(--chart-tooltip-text)',
          track: 'var(--chart-track)',
          surface: 'var(--chart-surface)',
          type: {
            feature: 'var(--chart-type-feature)',
            bug: 'var(--chart-type-bug)',
            refactor: 'var(--chart-type-refactor)',
            infra: 'var(--chart-type-infra)',
            docs: 'var(--chart-type-docs)',
            test: 'var(--chart-type-test)',
            other: 'var(--chart-type-other)',
            'in-flight': 'var(--chart-type-in-flight)',
          },
        },
      },
    },
  },
  plugins: [],
};

export default config;
```

- [ ] **Step 7: Run both guards and confirm they pass**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/chart-tokens-css.test.ts src/lib/__tests__/unit/chart-contrast.test.ts'`

Expected: PASS. If a contrast line fails, snap that token as in Step 4 (for chrome grays, step one Tailwind gray at a time) and re-run. Re-run the matching validator command for any fixed-palette color you changed.

- [ ] **Step 8: Write the Palette section into the spec**

In the spec, replace the placeholder paragraph under `### Palette` (the one beginning *"Filled in by the first implementation task"*) with:

1. **A table.** Columns: token, dark hex, light hex, and what it colors. One row per `--chart-*` token.
2. **A short list of every value that moved from its starting hex,** with the reason, for example "`--chart-type-other` dark `#4B5563` → `#9CA3AF`: 2.35:1 on `#111827`".
3. **The full validator output for every run in Step 4,** in fenced code blocks, labeled by palette, mode and pairs. Adjacent runs are the gated ones. `--pairs all` runs are "recorded, not gated".
4. **One sentence on what is not gated:** lightness band, chroma floor (grays fail it by design), and all-pairs separation.

- [ ] **Step 9: Run the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all suites pass. That is 171 suites: the 169 baseline plus the 2 new ones. `vuln-trend-colors-css.test.ts` and `vuln-series-contrast.test.ts` still pass, because `--vuln-series-*` is untouched.

- [ ] **Step 10: Commit**

```bash
git add src/app/globals.css tailwind.config.ts src/lib/__tests__/unit/chart-tokens-css.test.ts src/lib/__tests__/unit/chart-contrast.test.ts docs/superpowers/specs/2026-09-25-glook-58-recharts-migration-design.md
git commit -F - <<'EOF'
GLOOK-58: chart palette tokens and contrast guards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: Foundation (dependencies, jsdom setup, `cn`, ported `chart.tsx`)

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm)
- Modify: `jest.config.ts`
- Create: `src/lib/cn.ts`
- Create: `src/lib/__tests__/setup/resize-observer.ts`
- Create: `src/lib/__tests__/setup/chart-size.ts`
- Create: `src/components/charts/chart.tsx`
- Test: `src/lib/__tests__/unit/cn.test.ts`, `src/lib/__tests__/unit/chart-wrapper.test.tsx`

**Interfaces:**
- Consumes: `chart.*` Tailwind colors from Task 1.
- Produces:
  - `cn(...inputs: ClassValue[]): string` from `@/lib/cn`
  - `fixChartSize(width?: number, height?: number): void` from `src/lib/__tests__/setup/chart-size.ts`. It registers a `beforeEach`.
  - From `@/components/charts/chart`:
    - `ChartContainer` (props: `config: ChartConfig`, `className?`, `initialDimension?`, `children`)
    - `ChartTooltip` (alias of Recharts `Tooltip`)
    - `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartStyle`
    - `type ChartConfig`
    - `CHART_TOOLTIP_CLASS: string`

**Why `react-is@^19.2` is added.** It is not in the spec's dependency list. Recharts 3.10.1 has `react-is` as a peer dependency and imports `isFragment` from it (`es6/util/ReactUtils.js:3`). The copy hoisted in `node_modules` today is 18.3.1, while React is 19.2.4. React 19 changed the element `$$typeof` symbol, so `react-is` 18 does not recognize React 19 fragments. Recharts would then fail to flatten `<>…</>` children.

**Two jsdom facts this task works around.** Both were read from the Recharts 3.10.1 source.

1. **`initialDimension` does not survive a mount in jsdom.** `ResponsiveContainer`'s size detector (`es6/component/ResponsiveContainer.js:96-123`) returns early when `ResizeObserver` is undefined. When it is defined, it immediately calls `getBoundingClientRect()` and stores the result. In jsdom that result is 0×0, which overwrites `initialDimension` and renders no chart. The spec's Testing section suggests `initialDimension` as the sizing mechanism; it is not sufficient on its own. The global stub makes `ResizeObserver` exist, and `fixChartSize()` stubs `getBoundingClientRect` so the measurement returns a real size.
2. **Recharts animation.** This is handled by the Global Constraints rule: every series sets `isAnimationActive={false}`.

**Wrapper port choices (spec Decisions 3, 4, 6).**
- **Tailwind classes** come from shadcn `new-york` (the Tailwind v3 variant), fetched from `https://ui.shadcn.com/r/styles/new-york/chart.json`. For example, it uses `border-[--color-border]`, not v4's `border-(--color-border)`.
- **TypeScript types** come from `new-york-v4`, which already targets Recharts 3.8: `DefaultTooltipContentProps<TooltipValueType, …>`, `DefaultLegendContentProps` and the `initialDimension` prop. This is how the port applies the Recharts 3 type changes Decision 3 asks for. Components are plain functions (React 19 passes `ref` as a prop), as in v4.
- **`THEMES`** is `{ dark: '', light: '[data-theme-mode="light"]' }` (Decision 4).
- **Class rewrites (Decision 6):**
  - `fill-muted-foreground` → `fill-chart-axis`
  - `stroke-border/50` and `stroke-border` → `stroke-chart-grid`. Opacity modifiers are dropped, because Tailwind v3 cannot apply alpha to a `var()` hex, and 50% would break the grid's 3:1 guarantee.
  - `fill-muted` → `fill-chart-track` (radial background) or `fill-chart-cursor` (tooltip cursor)
  - the curve cursor → `stroke-chart-cursor`
  - `border-border/50` → `border-chart-tooltip-border`
  - `bg-background` → `bg-chart-tooltip-bg`
  - `text-muted-foreground` and `text-foreground` → `text-chart-tooltip-text`
  - The legend root gains `text-chart-axis`, so legend labels are chrome text.
- **The `[stroke='#ccc']` and `[stroke='#fff']` attribute selectors stay.** They match the default colors Recharts emits and restyle them. They never set a color. The Task 10 guard strips attribute selectors before it scans, and proves that a bare hex still fails.
- **The value display uses v4's `item.value != null`,** so a 0 is shown. The v3 variant's `item.value &&` hides zeros.
- **`chartId` is sanitized with `/[^A-Za-z0-9_-]/g`,** not just `:`. React 19's `useId()` format is not guaranteed to be `:r0:`, and the ID goes unquoted into a CSS attribute selector.

- [ ] **Step 1: Install the dependencies**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm install recharts@^3.10 clsx@^2.1 tailwind-merge@^2.6 react-is@^19.2'`

Expected: `package.json` `dependencies` gains `"recharts": "^3.10.1"` (or later 3.x), `"clsx": "^2.1.x"`, `"tailwind-merge": "^2.6.x"` and `"react-is": "^19.2.x"`.

- [ ] **Step 2: Confirm Recharts resolves react-is 19**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm ls react-is'`

Expected: the `recharts@3.x` entry shows `react-is@19.x` (deduped is fine). If it shows 18.x, stop and report it. Do not continue with a mismatched `react-is`.

- [ ] **Step 3: Add the jsdom setup file and the Jest `setupFiles` entry**

Create `src/lib/__tests__/setup/resize-observer.ts`:

```ts
// GLOOK-58: jsdom has no ResizeObserver. Recharts' ResponsiveContainer skips its size detector
// entirely without one, so any test that renders a chart (including the vuln-content-* tests that
// render VulnerabilitiesContent with the real TrendChart) needs this stub. Guarded so node-env
// suites are untouched. The stub never fires: sizing in chart tests comes from fixChartSize().
if (typeof window !== 'undefined' && typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

export {};
```

In `jest.config.ts`, add a `setupFiles` line directly after `roots: ['<rootDir>/src/lib'],`:

```ts
  setupFiles: ['<rootDir>/src/lib/__tests__/setup/resize-observer.ts'],
```

- [ ] **Step 4: Add the chart-size test helper**

Create `src/lib/__tests__/setup/chart-size.ts`:

```ts
// GLOOK-58: Recharts' ResponsiveContainer measures its div with getBoundingClientRect() on mount
// and overwrites initialDimension with the result. jsdom returns 0x0, so without this every chart
// test would render an empty container. Call once at the top of a chart test file. It re-applies
// in beforeEach because jest.config.ts has restoreMocks: true, which undoes spies after each test.
export function fixChartSize(width = 640, height = 240): void {
  beforeEach(() => {
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height, toJSON: () => ({}) }) as DOMRect,
    );
  });
}
```

- [ ] **Step 5: Write the failing tests**

Create `src/lib/__tests__/unit/cn.test.ts`:

```ts
import { cn } from '@/lib/cn';

it('joins truthy classes and drops falsy ones', () => {
  expect(cn('a', false && 'b', undefined, 'c')).toBe('a c');
});

it('lets a later conflicting utility win', () => {
  expect(cn('px-2', 'px-4')).toBe('px-4');
});

it('keeps a font-size and a chart colour together (different groups, both survive)', () => {
  expect(cn('text-xs', 'text-chart-axis')).toBe('text-xs text-chart-axis');
});
```

Create `src/lib/__tests__/unit/chart-wrapper.test.tsx`:

```tsx
/** @jest-environment jsdom */
// GLOOK-58 Task 2 gate: Recharts 3 renders real marks in jsdom through the ported wrapper, and the
// wrapper's theme selectors and chrome classes follow Decisions 4 and 6.
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Bar, BarChart } from 'recharts';
import {
  ChartContainer, ChartLegendContent, ChartStyle, ChartTooltipContent, type ChartConfig,
} from '@/components/charts/chart';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

const config: ChartConfig = { commits: { label: 'Commits', color: 'var(--accent)' } };

it('renders one bar rectangle per non-zero datum (spike: Recharts draws in jsdom)', () => {
  const { container } = render(
    <ChartContainer config={config}>
      <BarChart data={[{ w: 'a', commits: 3 }, { w: 'b', commits: 0 }, { w: 'c', commits: 5 }]}>
        <Bar dataKey="commits" fill="var(--color-commits)" isAnimationActive={false} />
      </BarChart>
    </ChartContainer>,
  );
  const rects = container.querySelectorAll('.recharts-bar-rectangle path.recharts-rectangle');
  expect(rects).toHaveLength(2);
  rects.forEach(r => expect(r.getAttribute('fill')).toBe('var(--color-commits)'));
});

it('ChartStyle scopes dark to the unprefixed selector and light to [data-theme-mode="light"]', () => {
  const { container } = render(
    <ChartStyle id="chart-x" config={{ a: { theme: { dark: 'var(--dark-a)', light: 'var(--light-a)' } } }} />,
  );
  const css = container.querySelector('style')!.innerHTML;
  expect(css).toMatch(/(^|\n)\s*\[data-chart=chart-x\] \{\s*--color-a: var\(--dark-a\);/);
  expect(css).toContain('[data-theme-mode="light"] [data-chart=chart-x] {\n  --color-a: var(--light-a);');
  expect(css).not.toContain('.dark');
});

it('the tooltip shows the configured label and a zero value, on chrome tokens', () => {
  const payload = [{ name: 'commits', dataKey: 'commits', value: 0, color: 'var(--accent)', payload: {} }];
  const { container } = render(
    <ChartContainer config={config}>
      <ChartTooltipContent active payload={payload as React.ComponentProps<typeof ChartTooltipContent>['payload']} label="2026-09-21" hideLabel />
    </ChartContainer>,
  );
  expect(screen.getByText('Commits')).toBeTruthy();
  expect(screen.getByText('0')).toBeTruthy();
  const root = container.querySelector('.bg-chart-tooltip-bg');
  expect(root).not.toBeNull();
  expect(root!.className).toContain('border-chart-tooltip-border');
  expect(root!.className).toContain('text-chart-tooltip-text');
});

it('the legend lists configured labels in chrome text', () => {
  const payload = [{ value: 'commits', dataKey: 'commits', color: 'var(--accent)', type: 'square' as const }];
  const { container } = render(
    <ChartContainer config={config}>
      <ChartLegendContent payload={payload} />
    </ChartContainer>,
  );
  expect(screen.getByText('Commits')).toBeTruthy();
  expect(container.querySelector('.text-chart-axis')).not.toBeNull();
});
```

- [ ] **Step 6: Run the tests and confirm they fail**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/cn.test.ts src/lib/__tests__/unit/chart-wrapper.test.tsx'`

Expected: FAIL with `Cannot find module '@/lib/cn'` and `Cannot find module '@/components/charts/chart'`.

- [ ] **Step 7: Implement `cn`**

Create `src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Join class names and resolve Tailwind conflicts (later wins). Used by the chart wrapper. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 8: Implement the ported wrapper**

Create `src/components/charts/chart.tsx`:

```tsx
'use client';

// Ported from shadcn/ui's Tailwind-v3 "new-york" chart.tsx (GLOOK-58 Decision 3), with the
// Recharts 3 types from the "new-york-v4" variant, the theme map inverted for this app
// (Decision 4), and shadcn's generic colour classes rewritten to the chart.* namespace (Decision 6).

import * as React from 'react';
import * as RechartsPrimitive from 'recharts';
import type { TooltipValueType } from 'recharts';
import { cn } from '@/lib/cn';

// Format: { THEME_NAME: CSS_SELECTOR }. The app's unscoped styles are dark and light is the
// override (applyTheme() in src/app/themes.ts sets data-theme-mode on <html>), so dark takes the
// empty selector. Renaming shadcn's `.dark` key in place would invert every chart.
const THEMES = { dark: '', light: '[data-theme-mode="light"]' } as const;

const INITIAL_DIMENSION = { width: 320, height: 200 } as const;
type TooltipNameType = number | string;

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
>;

/** Shared by ChartTooltipContent and the charts' own tooltip bodies. */
export const CHART_TOOLTIP_CLASS =
  'grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-chart-tooltip-border bg-chart-tooltip-bg px-2.5 py-1.5 text-xs text-chart-tooltip-text shadow-xl';

type ChartContextProps = { config: ChartConfig };

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />');
  }
  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children'];
  initialDimension?: { width: number; height: number };
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${(id ?? uniqueId).replace(/[^A-Za-z0-9_-]/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-chart-axis [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-chart-grid [&_.recharts-curve.recharts-tooltip-cursor]:stroke-chart-cursor [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-none [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-chart-grid [&_.recharts-radial-bar-background-sector]:fill-chart-track [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-chart-cursor [&_.recharts-reference-line_[stroke='#ccc']]:stroke-chart-grid [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-none [&_.recharts-surface]:outline-none",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(([, itemConfig]) => itemConfig.theme || itemConfig.color);

  if (!colorConfig.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ?? itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .join('\n')}
}
`,
          )
          .join('\n'),
      }}
    />
  );
};

const ChartTooltip = RechartsPrimitive.Tooltip;

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
  React.ComponentProps<'div'> & {
    hideLabel?: boolean;
    hideIndicator?: boolean;
    indicator?: 'line' | 'dot' | 'dashed';
    nameKey?: string;
    labelKey?: string;
  } & Omit<RechartsPrimitive.DefaultTooltipContentProps<TooltipValueType, TooltipNameType>, 'accessibilityLayer'>) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) {
      return null;
    }

    const [item] = payload;
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? 'value'}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    const value = !labelKey && typeof label === 'string' ? (config[label]?.label ?? label) : itemConfig?.label;

    if (labelFormatter) {
      return <div className={cn('font-medium', labelClassName)}>{labelFormatter(value, payload)}</div>;
    }

    if (!value) {
      return null;
    }

    return <div className={cn('font-medium', labelClassName)}>{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, labelClassName, config, labelKey]);

  if (!active || !payload?.length) {
    return null;
  }

  const nestLabel = payload.length === 1 && indicator !== 'dot';

  return (
    <div className={cn(CHART_TOOLTIP_CLASS, className)}>
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload
          .filter(item => item.type !== 'none')
          .map((item, index) => {
            const key = `${nameKey ?? item.name ?? item.dataKey ?? 'value'}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color ?? item.payload?.fill ?? item.color;

            return (
              <div
                key={index}
                className={cn(
                  'flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-chart-tooltip-text',
                  indicator === 'dot' && 'items-center',
                )}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn('shrink-0 rounded-[2px] border-[--color-border] bg-[--color-bg]', {
                            'h-2.5 w-2.5': indicator === 'dot',
                            'w-1': indicator === 'line',
                            'w-0 border-[1.5px] border-dashed bg-transparent': indicator === 'dashed',
                            'my-0.5': nestLabel && indicator === 'dashed',
                          })}
                          style={{ '--color-bg': indicatorColor, '--color-border': indicatorColor } as React.CSSProperties}
                        />
                      )
                    )}
                    <div className={cn('flex flex-1 justify-between leading-none', nestLabel ? 'items-end' : 'items-center')}>
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-chart-tooltip-text">{itemConfig?.label ?? item.name}</span>
                      </div>
                      {item.value != null && (
                        <span className="font-mono font-medium tabular-nums text-chart-tooltip-text">
                          {typeof item.value === 'number' ? item.value.toLocaleString() : String(item.value)}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

const ChartLegend = RechartsPrimitive.Legend;

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = 'bottom',
  nameKey,
}: React.ComponentProps<'div'> & {
  hideIcon?: boolean;
  nameKey?: string;
} & RechartsPrimitive.DefaultLegendContentProps) {
  const { config } = useChart();

  if (!payload?.length) {
    return null;
  }

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-4 text-chart-axis',
        verticalAlign === 'top' ? 'pb-3' : 'pt-3',
        className,
      )}
    >
      {payload
        .filter(item => item.type !== 'none')
        .map((item, index) => {
          const key = `${nameKey ?? item.dataKey ?? 'value'}`;
          const itemConfig = getPayloadConfigFromPayload(config, item, key);

          return (
            <div key={index} className="flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-chart-axis">
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: item.color }} />
              )}
              {itemConfig?.label}
            </div>
          );
        })}
    </div>
  );
}

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== 'object' || payload === null) {
    return undefined;
  }

  const payloadPayload =
    'payload' in payload && typeof payload.payload === 'object' && payload.payload !== null ? payload.payload : undefined;

  let configLabelKey: string = key;

  if (key in payload && typeof payload[key as keyof typeof payload] === 'string') {
    configLabelKey = payload[key as keyof typeof payload] as string;
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === 'string'
  ) {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string;
  }

  return configLabelKey in config ? config[configLabelKey] : config[key];
}

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent, ChartStyle };
```

- [ ] **Step 9: Run the tests and confirm they pass (this is the spike gate)**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/cn.test.ts src/lib/__tests__/unit/chart-wrapper.test.tsx'`

Expected: PASS, 7 tests.

**Verification, not assumption.** Handle each of these failure modes as described.

- **Jest reports `SyntaxError: Unexpected token 'export'` in a `node_modules/<pkg>` path.** jsdom's `browser` export condition picked an ESM build. Append that package name to the `transformIgnorePatterns` alternation in `jest.config.ts`, for example `'node_modules/(?!(p-limit|yocto-queue|@octokit|universal-user-agent|before-after-hook|<pkg>)/)'`. Then re-run.
- **The spike test finds 0 rectangles.** Log `container.innerHTML`.
  - If the `.recharts-responsive-container` div is present but empty, the size stub did not apply. Check that `fixChartSize()` is called at module top level.
  - If `recharts-wrapper` is present but without rectangles, check that `isAnimationActive={false}` reached the `Bar`.
  - Do not continue to Task 3 until this test passes.
- **The ChartStyle regex fails only on whitespace.** Compare against the actual `innerHTML` and fix the test's whitespace, not the component's selector order.

- [ ] **Step 10: Confirm the four vuln-content suites that render the real TrendChart still pass**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/vuln-content-trend-range.test.tsx src/lib/__tests__/unit/vuln-content-team-dropdown.test.tsx src/lib/__tests__/unit/vuln-content-repo-reset.test.tsx src/lib/__tests__/unit/vuln-content-error.test.tsx'`

Expected: PASS (unchanged).

- [ ] **Step 11: Type-check**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx tsc --noEmit --pretty false'`

Expected: no errors in `src/lib/cn.ts`, `src/components/charts/chart.tsx`, `src/lib/__tests__/setup/*` or `src/lib/__tests__/unit/chart-wrapper.test.tsx`. Errors in files this task did not touch predate it; `git diff --stat HEAD` confirms which files changed. Only errors in files this task created are this task's to fix. For errors in `ChartTooltipContent`'s intersected prop type, match the new-york-v4 source, which compiles against Recharts 3.8.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json jest.config.ts src/lib/cn.ts src/lib/__tests__/setup/resize-observer.ts src/lib/__tests__/setup/chart-size.ts src/components/charts/chart.tsx src/lib/__tests__/unit/cn.test.ts src/lib/__tests__/unit/chart-wrapper.test.tsx
git commit -F - <<'EOF'
GLOOK-58: Recharts 3 foundation and ported chart wrapper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: Shared helpers (`chart-format.ts`, `commit-types.ts`, `hatch.tsx`)

**Files:**
- Create: `src/components/charts/chart-format.ts`
- Create: `src/components/charts/commit-types.ts`
- Create: `src/components/charts/hatch.tsx`
- Test: `src/lib/__tests__/unit/chart-format.test.ts`, `src/lib/__tests__/unit/commit-types.test.ts`, `src/lib/__tests__/unit/chart-hatch.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks except the token names.
- Produces, from `@/components/charts/chart-format`:
  - `type MetricKind = 'count' | 'ratio'`
  - `toNum(v: unknown): number`
  - `mondayOf(date: Date): string`. UTC calendar date, `YYYY-MM-DD`.
  - `snapWeekKey(key: string): string | null`. The nearest Monday, or `null` for an invalid key.
  - `buildWeekDomain(cutoff: Date, today: Date): string[]`. Every Monday from `mondayOf(cutoff)` to `mondayOf(today)`, inclusive.
  - `recentWeekDomain(now?: Date, days?: number): string[]`. Defaults: `new Date()`, `90`.
  - `groupByWeek<T extends { week: string }>(weeks: string[], data: T[]): Map<string, T[]>`
  - `interface WeekPoint<T> { week: string; value: number | null; hasData: boolean; rows: T[] }`
  - `interface FillOptions<T> { value: (row: T) => unknown; kind: MetricKind; isDefined?: (row: T) => boolean; weight?: (row: T) => number }`
  - `fillWeeks<T extends { week: string }>(weeks: string[], data: T[], opts: FillOptions<T>): WeekPoint<T>[]`
  - `formatWeek(iso: string): string`. For example `'Sep 21'`.
  - `formatValue(v: number | null | undefined, opts?: { suffix?: string; decimals?: number }): string`
  - `formatCompact(v: number): string`. For example `'1.5K'` or `'-2K'`.
  - `isTopOfStack(row: Record<string, unknown>, keys: readonly string[], key: string): boolean`
- Produces, from `@/components/charts/commit-types`:
  - `COMMIT_TYPE_ORDER`, `type CommitType`
  - `normalizeType(t: string): CommitType`
  - `commitTypeColor(t: string): string` (a `var(--chart-type-*)`)
  - `commitTypeBg(t: string): string` (a `bg-chart-type-*` class)
  - `foldTypes(list: Array<Record<string, unknown>>): Record<CommitType, number>`
- Produces, from `@/components/charts/hatch`:
  - `interface Hatch { id: string; fill: string; defs: ReactElement }`
  - `useHatch(colorVar: string): Hatch`
  - `HatchSwatch({ colorVar, size? }): JSX.Element`

**Semantics that later tasks rely on (spec Decision 10, plus Review Focus 1):**
- **`fillWeeks` with `kind: 'count'`:** a week with no rows is `0`, and several rows in one week are summed.
- **`fillWeeks` with `kind: 'ratio'`:** a week with no usable row is `null`. A row is unusable if `isDefined(row)` is false or its value is `null`/`undefined`. Several usable rows in one week are averaged, weighted by `weight(row)`. With no weights, or all weights zero, it is a plain mean. `hasData` is true only when a usable row exists.
- **Snapping:** keys are snapped with `snapWeekKey` before grouping, so a Tuesday or Sunday key lands in its Monday's week. Rows outside the domain (older than the 90-day cutoff) are dropped, as today's `d.week >= cutoffStr` filter does.
- **Dates are UTC.** `buildWeekDomain` and `formatWeek` work on UTC calendar dates, so every chart on a page and every test machine agree.

`COMMIT_TYPE_ORDER` is a stacking order, so `commit-types.ts` returns the order, the color var and the badge class. Unknown types map to `other` for color. In the stacked chart, `foldTypes` also folds their counts into `other`. Today's stacked chart drops unknown types from the stack entirely.

- [ ] **Step 1: Write the failing `chart-format` test**

Create `src/lib/__tests__/unit/chart-format.test.ts`:

```ts
import {
  buildWeekDomain, fillWeeks, formatCompact, formatValue, formatWeek, groupByWeek, isTopOfStack,
  mondayOf, recentWeekDomain, snapWeekKey, toNum,
} from '@/components/charts/chart-format';

const utc = (iso: string) => new Date(`${iso}T12:00:00Z`);
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

describe('toNum', () => {
  it('parses DECIMAL strings and passes numbers through', () => {
    expect(toNum('12.50')).toBe(12.5);
    expect(toNum(7)).toBe(7);
  });
  it('renders everything unusable as 0 instead of NaN', () => {
    expect(toNum('')).toBe(0);
    expect(toNum('abc')).toBe(0);
    expect(toNum(null)).toBe(0);
    expect(toNum(undefined)).toBe(0);
    expect(toNum(NaN)).toBe(0);
    expect(toNum(Infinity)).toBe(0);
  });
});

describe('week domain', () => {
  it('mondayOf returns the Monday of the containing UTC week', () => {
    expect(mondayOf(utc('2026-09-25'))).toBe('2026-09-21'); // Friday
    expect(mondayOf(utc('2026-09-21'))).toBe('2026-09-21'); // Monday
    expect(mondayOf(utc('2026-09-27'))).toBe('2026-09-21'); // Sunday belongs to the week before
  });

  it('buildWeekDomain lists every Monday from the cutoff week to the current week, 7 days apart', () => {
    const weeks = buildWeekDomain(utc('2026-06-27'), utc('2026-09-25'));
    expect(weeks[0]).toBe('2026-06-22');
    expect(weeks[weeks.length - 1]).toBe('2026-09-21');
    expect(weeks).toHaveLength(14);
    weeks.forEach(w => expect(dow(w)).toBe(1));
    for (let i = 1; i < weeks.length; i++) {
      expect(Date.parse(weeks[i]) - Date.parse(weeks[i - 1])).toBe(7 * 86_400_000);
    }
  });

  it('recentWeekDomain gives every chart on a page an identical week array', () => {
    const now = utc('2026-09-25');
    expect(recentWeekDomain(now)).toEqual(recentWeekDomain(now));
    expect(recentWeekDomain(now)).toEqual(buildWeekDomain(new Date(now.getTime() - 90 * 86_400_000), now));
  });
});

describe('snapWeekKey (weekKeyForDate can emit a key one day either side of Monday)', () => {
  it('keeps Mondays, pulls a Tuesday back and pushes a Sunday forward', () => {
    expect(snapWeekKey('2026-09-21')).toBe('2026-09-21');
    expect(snapWeekKey('2026-09-22')).toBe('2026-09-21');
    expect(snapWeekKey('2026-09-20')).toBe('2026-09-21');
  });
  it('rejects malformed and impossible dates', () => {
    expect(snapWeekKey('garbage')).toBeNull();
    expect(snapWeekKey('2026-13-01')).toBeNull();
    expect(snapWeekKey('2026-02-30')).toBeNull();
  });
});

describe('fillWeeks', () => {
  const weeks = ['2026-09-07', '2026-09-14', '2026-09-21'];

  it("kind 'count': a missing week is a real 0", () => {
    const pts = fillWeeks(weeks, [{ week: '2026-09-14', n: 4 }], { value: r => r.n, kind: 'count' });
    expect(pts.map(p => p.value)).toEqual([0, 4, 0]);
    expect(pts.map(p => p.hasData)).toEqual([false, true, false]);
  });

  it("kind 'ratio': a missing week has no value (null), so it renders as a gap", () => {
    const pts = fillWeeks(weeks, [{ week: '2026-09-14', r: 2.5 }], { value: r => r.r, kind: 'ratio' });
    expect(pts.map(p => p.value)).toEqual([null, 2.5, null]);
  });

  it('isDefined returning false gives null for a ratio week that is present', () => {
    const data = [{ week: '2026-09-07', avg: 0, prs: 0 }, { week: '2026-09-14', avg: 120, prs: 3 }];
    const pts = fillWeeks(weeks, data, { value: r => r.avg, kind: 'ratio', isDefined: r => r.prs > 0 });
    expect(pts.map(p => p.value)).toEqual([null, 120, null]);
    expect(pts[0].hasData).toBe(false);
  });

  it('an off-Monday key still lands in its week instead of becoming a false zero', () => {
    const pts = fillWeeks(weeks, [{ week: '2026-09-15', n: 6 }], { value: r => r.n, kind: 'count' });
    expect(pts.map(p => p.value)).toEqual([0, 6, 0]);
  });

  it('a week split across two keys is summed for counts and weight-averaged for ratios', () => {
    const data = [
      { week: '2026-09-14', n: 2, pct: 50, commits: 2 },
      { week: '2026-09-15', n: 6, pct: 100, commits: 6 },
    ];
    expect(fillWeeks(weeks, data, { value: r => r.n, kind: 'count' })[1].value).toBe(8);
    expect(fillWeeks(weeks, data, { value: r => r.pct, kind: 'ratio', weight: r => r.commits })[1].value).toBeCloseTo(87.5);
    expect(fillWeeks(weeks, data, { value: r => r.pct, kind: 'ratio' })[1].value).toBe(75);
  });

  it('string numerics are converted, and rows older than the domain are dropped', () => {
    const data = [{ week: '2026-08-31', n: '9' }, { week: '2026-09-21', n: '3' }];
    expect(fillWeeks(weeks, data, { value: r => r.n, kind: 'count' }).map(p => p.value)).toEqual([0, 0, 3]);
  });

  it('two metrics filled from the same domain produce identical week sequences (syncId matches by index)', () => {
    const data = [{ week: '2026-09-14', a: 1, b: 2 }];
    const a = fillWeeks(weeks, data, { value: r => r.a, kind: 'count' }).map(p => p.week);
    const b = fillWeeks(weeks, data, { value: r => r.b, kind: 'ratio' }).map(p => p.week);
    expect(a).toEqual(weeks);
    expect(b).toEqual(weeks);
  });

  it('groupByWeek skips invalid keys and keeps every domain week', () => {
    const g = groupByWeek(weeks, [{ week: 'nope' }, { week: '2026-09-07' }]);
    expect([...g.keys()]).toEqual(weeks);
    expect(g.get('2026-09-07')).toHaveLength(1);
  });
});

describe('formatters', () => {
  it('formatWeek prints a short UTC date', () => {
    expect(formatWeek('2026-09-21')).toBe('Sep 21');
    expect(formatWeek('not-a-date')).toBe('not-a-date');
  });
  it('formatValue respects suffix and decimals, groups thousands, and shows a dash for no value', () => {
    expect(formatValue(1234, { suffix: ' lines' })).toBe('1,234 lines');
    expect(formatValue(2.345, { decimals: 1 })).toBe('2.3');
    expect(formatValue(42, { suffix: '%' })).toBe('42%');
    expect(formatValue(null)).toBe('—');
  });
  it('formatCompact abbreviates axis values and keeps the sign', () => {
    expect(formatCompact(1500)).toBe('1.5K');
    expect(formatCompact(-2000)).toBe('-2K');
    expect(formatCompact(12)).toBe('12');
  });
});

describe('isTopOfStack', () => {
  const keys = ['a', 'b', 'c'];
  it('is true when every later key in the stack is zero', () => {
    expect(isTopOfStack({ a: 1, b: 2, c: 0 }, keys, 'b')).toBe(true);
    expect(isTopOfStack({ a: 1, b: 2, c: 3 }, keys, 'b')).toBe(false);
    expect(isTopOfStack({ a: 1, b: 0, c: '0' }, keys, 'a')).toBe(true);
  });
});
```

- [ ] **Step 2: Write the failing `commit-types` test**

Create `src/lib/__tests__/unit/commit-types.test.ts`:

```ts
import fs from 'fs';
import path from 'path';
import {
  COMMIT_TYPE_ORDER, commitTypeBg, commitTypeColor, foldTypes, normalizeType,
} from '@/components/charts/commit-types';

it('stacks types in the spec order', () => {
  expect([...COMMIT_TYPE_ORDER]).toEqual(['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other', 'in_flight']);
});

it('maps each type to its own token and badge class', () => {
  expect(commitTypeColor('feature')).toBe('var(--chart-type-feature)');
  expect(commitTypeColor('in_flight')).toBe('var(--chart-type-in-flight)');
  expect(commitTypeBg('bug')).toBe('bg-chart-type-bug');
  expect(commitTypeBg('in_flight')).toBe('bg-chart-type-in-flight');
});

it('maps unknown types to other', () => {
  expect(normalizeType('chore')).toBe('other');
  expect(commitTypeColor('chore')).toBe('var(--chart-type-other)');
  expect(commitTypeBg('')).toBe('bg-chart-type-other');
});

it('foldTypes sums across weeks, folds unknown types into other, and tolerates string counts', () => {
  const folded = foldTypes([{ feature: 2, chore: 1 }, { feature: '3', other: 1, in_flight: 4 }]);
  expect(folded.feature).toBe(5);
  expect(folded.other).toBe(2);
  expect(folded.in_flight).toBe(4);
  expect(folded.bug).toBe(0);
});

// The palette gate could move a hue in the charts while a page kept an old copy of the map.
it('no report page keeps its own commit-type colour map', () => {
  const files = [
    'src/app/report/[id]/org/page.tsx',
    'src/app/report/[id]/dev/[login]/page.tsx',
    'src/app/report/[id]/team/dev-table.tsx',
  ];
  const offenders = files.filter(f =>
    /const\s+TYPE_(COLORS|HEX|TEXT_COLORS)\b/.test(fs.readFileSync(path.join(__dirname, '../../../..', f), 'utf8')),
  );
  expect(offenders).toEqual([]);
});
```

The last test fails until Tasks 5 and 6 remove the three maps. That is intended. Mark it with `it.skip` in this task, and un-skip it in Task 6, Step 5. Write it as shown, then change `it(` to `it.skip(` on that one test before running.

- [ ] **Step 3: Write the failing hatch test**

Create `src/lib/__tests__/unit/chart-hatch.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';
import { HatchSwatch, useHatch } from '@/components/charts/hatch';

function Probe({ colorVar }: { colorVar: string }) {
  const hatch = useHatch(colorVar);
  return (
    <svg data-fill={hatch.fill}>
      {hatch.defs}
    </svg>
  );
}

it('gives each instance its own DOM-safe pattern id, and fill references it', () => {
  const { container } = render(<><Probe colorVar="var(--accent)" /><Probe colorVar="var(--chart-type-in-flight)" /></>);
  const patterns = Array.from(container.querySelectorAll('pattern'));
  expect(patterns).toHaveLength(2);
  const [a, b] = patterns.map(p => p.id);
  expect(a).not.toBe(b);
  patterns.forEach(p => expect(p.id).toMatch(/^hatch-[A-Za-z0-9_-]+$/));
  const fills = Array.from(container.querySelectorAll('svg[data-fill]')).map(s => s.getAttribute('data-fill'));
  expect(fills).toEqual([`url(#${a})`, `url(#${b})`]);
});

it('draws stripes in the given colour over an explicit surface background, never transparent', () => {
  const { container } = render(<Probe colorVar="var(--accent)" />);
  const rect = container.querySelector('pattern rect') as SVGRectElement;
  const line = container.querySelector('pattern line') as SVGLineElement;
  expect(rect.style.fill).toBe('var(--chart-surface)');
  expect(line.style.stroke).toBe('var(--accent)');
});

it('HatchSwatch is a self-contained hatched square for HTML legends', () => {
  const { container } = render(<HatchSwatch colorVar="var(--chart-type-in-flight)" />);
  const pattern = container.querySelector('pattern')!;
  const filled = container.querySelector('svg > rect')!;
  expect(filled.getAttribute('fill')).toBe(`url(#${pattern.id})`);
  expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
});
```

- [ ] **Step 4: Run the tests and confirm they fail**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/chart-format.test.ts src/lib/__tests__/unit/commit-types.test.ts src/lib/__tests__/unit/chart-hatch.test.tsx'`

Expected: FAIL with `Cannot find module` for all three.

- [ ] **Step 5: Implement `chart-format.ts`**

Create `src/components/charts/chart-format.ts`:

```ts
// GLOOK-58: pure helpers shared by every chart. Numbers from DECIMAL/REAL columns can arrive as
// strings, so every value goes through toNum(). Week handling is UTC calendar dates throughout.

export type MetricKind = 'count' | 'ratio';

const DAY_MS = 86_400_000;

/** Number, or 0 for anything unusable. Charts never throw and never render NaN. */
export function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function isoOf(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function utcDay(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isoOf(t) === iso ? t : null; // rejects 2026-13-01, 2026-02-30
}

/** Monday of the UTC week containing `date`, as YYYY-MM-DD. */
export function mondayOf(date: Date): string {
  const t = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dow = new Date(t).getUTCDay();
  return isoOf(t - ((dow + 6) % 7) * DAY_MS);
}

/**
 * Nearest Monday to a server week key. weekKeyForDate() (src/lib/report/timeline.ts) sets the
 * local-time Monday but keeps the commit's time of day and formats in UTC, so a key can land a
 * day either side of Monday. Matching exactly would turn those weeks into false zeros.
 */
export function snapWeekKey(key: string): string | null {
  const t = utcDay(key);
  if (t === null) return null;
  const dow = new Date(t).getUTCDay(); // 0 = Sunday
  const shift = dow === 0 ? 1 : dow <= 4 ? 1 - dow : 8 - dow;
  return isoOf(t + shift * DAY_MS);
}

/** Every Monday from the cutoff's week to today's week, inclusive. */
export function buildWeekDomain(cutoff: Date, today: Date): string[] {
  const start = utcDay(mondayOf(cutoff)) as number;
  const end = utcDay(mondayOf(today)) as number;
  const out: string[] = [];
  for (let t = start; t <= end; t += 7 * DAY_MS) out.push(isoOf(t));
  return out;
}

/** The page-wide domain: the last `days` days (default 90). Compute once per page and pass it to every chart. */
export function recentWeekDomain(now: Date = new Date(), days = 90): string[] {
  return buildWeekDomain(new Date(now.getTime() - days * DAY_MS), now);
}

/** Rows grouped by snapped week. Every domain week is present; rows outside the domain or with invalid keys are dropped. */
export function groupByWeek<T extends { week: string }>(weeks: string[], data: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>(weeks.map(w => [w, [] as T[]]));
  for (const row of data) {
    const key = snapWeekKey(row.week);
    if (key === null) continue;
    groups.get(key)?.push(row);
  }
  return groups;
}

export interface WeekPoint<T> {
  week: string;
  value: number | null;
  hasData: boolean;
  rows: T[];
}

export interface FillOptions<T> {
  value: (row: T) => unknown;
  kind: MetricKind;
  isDefined?: (row: T) => boolean;
  weight?: (row: T) => number;
}

/**
 * One point per domain week. kind 'count': a missing week is 0 and split weeks sum.
 * kind 'ratio': a week with no usable row is null (a gap); split weeks take a weighted mean.
 */
export function fillWeeks<T extends { week: string }>(weeks: string[], data: T[], opts: FillOptions<T>): WeekPoint<T>[] {
  const groups = groupByWeek(weeks, data);
  return weeks.map(week => {
    const rows = groups.get(week) ?? [];
    if (opts.kind === 'count') {
      const usable = opts.isDefined ? rows.filter(opts.isDefined) : rows;
      return { week, rows, hasData: rows.length > 0, value: usable.reduce((s, r) => s + toNum(opts.value(r)), 0) };
    }
    const usable = rows.filter(r => (opts.isDefined ? opts.isDefined(r) : true) && opts.value(r) != null);
    if (usable.length === 0) return { week, rows, hasData: false, value: null };
    const weights = usable.map(r => Math.max(0, opts.weight ? toNum(opts.weight(r)) : 1));
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const value = totalWeight > 0
      ? usable.reduce((s, r, i) => s + toNum(opts.value(r)) * weights[i], 0) / totalWeight
      : usable.reduce((s, r) => s + toNum(opts.value(r)), 0) / usable.length;
    return { week, rows, hasData: true, value };
  });
}

export function formatWeek(iso: string): string {
  const t = utcDay(iso);
  if (t === null) return iso;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function formatValue(v: number | null | undefined, { suffix = '', decimals = 0 }: { suffix?: string; decimals?: number } = {}): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const body = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toLocaleString('en-US');
  return body + suffix;
}

const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function formatCompact(v: number): string {
  return COMPACT.format(toNum(v));
}

/** True when every key after `key` in stacking order is zero in this row: that segment gets the rounded top. */
export function isTopOfStack(row: Record<string, unknown>, keys: readonly string[], key: string): boolean {
  const i = keys.indexOf(key);
  return keys.slice(i + 1).every(k => toNum(row[k]) === 0);
}
```

- [ ] **Step 6: Implement `commit-types.ts`**

Create `src/components/charts/commit-types.ts`:

```ts
// GLOOK-58: the one commit-type map. Replaces TYPE_HEX/TYPE_COLORS (org page), TYPE_COLORS/
// TYPE_TEXT_COLORS (dev page) and TYPE_COLORS (team dev-table), so a palette change reaches every
// surface at once. Class names are written out in full so Tailwind's content scan finds them.
import { toNum } from './chart-format';

export const COMMIT_TYPE_ORDER = ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other', 'in_flight'] as const;
export type CommitType = (typeof COMMIT_TYPE_ORDER)[number];

const COLOR: Record<CommitType, string> = {
  feature: 'var(--chart-type-feature)',
  bug: 'var(--chart-type-bug)',
  refactor: 'var(--chart-type-refactor)',
  infra: 'var(--chart-type-infra)',
  docs: 'var(--chart-type-docs)',
  test: 'var(--chart-type-test)',
  other: 'var(--chart-type-other)',
  in_flight: 'var(--chart-type-in-flight)',
};

const BG: Record<CommitType, string> = {
  feature: 'bg-chart-type-feature',
  bug: 'bg-chart-type-bug',
  refactor: 'bg-chart-type-refactor',
  infra: 'bg-chart-type-infra',
  docs: 'bg-chart-type-docs',
  test: 'bg-chart-type-test',
  other: 'bg-chart-type-other',
  in_flight: 'bg-chart-type-in-flight',
};

export function normalizeType(t: string): CommitType {
  return (COMMIT_TYPE_ORDER as readonly string[]).includes(t) ? (t as CommitType) : 'other';
}

export function commitTypeColor(t: string): string {
  return COLOR[normalizeType(t)];
}

export function commitTypeBg(t: string): string {
  return BG[normalizeType(t)];
}

/** Sum type counts across rows; unknown types count as other. */
export function foldTypes(list: Array<Record<string, unknown>>): Record<CommitType, number> {
  const out = Object.fromEntries(COMMIT_TYPE_ORDER.map(t => [t, 0])) as Record<CommitType, number>;
  for (const types of list) {
    for (const [t, n] of Object.entries(types ?? {})) out[normalizeType(t)] += toNum(n);
  }
  return out;
}
```

- [ ] **Step 7: Implement `hatch.tsx`**

Create `src/components/charts/hatch.tsx`:

```tsx
'use client';

// GLOOK-58 Hatch: in-flight is never shown by colour alone. The pattern has an explicit
// --chart-surface background (never transparent) and ~2px diagonal stripes in the given colour.
// Each instance gets its own id from useId(): a page shows several charts in one document-wide
// id space, so a static id would make the accent and in-flight patterns collide.
import { useId, type ReactElement } from 'react';

const TILE = 6;

export interface Hatch {
  id: string;
  fill: string;
  defs: ReactElement;
}

export function useHatch(colorVar: string): Hatch {
  const id = `hatch-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const defs = (
    <defs>
      <pattern id={id} width={TILE} height={TILE} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width={TILE} height={TILE} style={{ fill: 'var(--chart-surface)' }} />
        <line x1={TILE / 2} y1={0} x2={TILE / 2} y2={TILE} style={{ stroke: colorVar, strokeWidth: 2 }} />
      </pattern>
    </defs>
  );
  return { id, fill: `url(#${id})`, defs };
}

/** A hatched legend swatch that carries its own pattern, so it works outside any chart's <svg>. */
export function HatchSwatch({ colorVar, size = 10 }: { colorVar: string; size?: number }) {
  const hatch = useHatch(colorVar);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0 rounded-sm">
      {hatch.defs}
      <rect width={size} height={size} fill={hatch.fill} />
    </svg>
  );
}
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/chart-format.test.ts src/lib/__tests__/unit/commit-types.test.ts src/lib/__tests__/unit/chart-hatch.test.tsx'`

Expected: PASS. The skipped test is reported as skipped. If `rect.style.fill` reads `''` in jsdom, cssstyle 4.6 dropped the `var()`. In that case assert `rect.getAttribute('style')` contains `fill: var(--chart-surface)` instead, and note it in the commit body.

- [ ] **Step 9: Commit**

```bash
git add src/components/charts/chart-format.ts src/components/charts/commit-types.ts src/components/charts/hatch.tsx src/lib/__tests__/unit/chart-format.test.ts src/lib/__tests__/unit/commit-types.test.ts src/lib/__tests__/unit/chart-hatch.test.tsx
git commit -F - <<'EOF'
GLOOK-58: shared chart helpers, commit-type map and hatch pattern

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `TimelineChart`, wired into the org and dev timeline grids

**Files:**
- Create: `src/components/charts/timeline-chart.tsx`
- Modify: `src/app/report/[id]/org/page.tsx`
  - Imports: lines 3-9.
  - Replace the timeline grid at lines 248-278.
  - Delete the local `TimelineChart` at lines 784-922.
- Modify: `src/app/report/[id]/dev/[login]/page.tsx`
  - Imports: lines 3-8.
  - Replace the timeline grid at lines 310-357.
  - Delete the local `TimelineChart` at lines 668-842.
- Test: `src/lib/__tests__/unit/timeline-chart.test.tsx`

**Interfaces:**
- Consumes:
  - From chart-format: `fillWeeks`, `formatCompact`, `formatValue`, `formatWeek`, `toNum`, `MetricKind`, `recentWeekDomain`.
  - `useHatch` from hatch.
  - `ChartContainer`, `ChartTooltip`, `CHART_TOOLTIP_CLASS` from chart.
- Produces, from `@/components/charts/timeline-chart`:
  - `interface TimelineRow { week: string; commits?: unknown }`
  - `interface TimelinePoint { week: string; value: number | null; shipped: number | null; inFlight: number | null }`
  - `interface TimelineChartProps<T extends TimelineRow>` with fields: `data`, `weeks`, `valueKey?`, `computeValue?`, `kind`, `isDefined?`, `label`, `suffix?`, `decimals?`, `inFlightValue?`, `syncId`.
  - `TimelineChart<T extends TimelineRow>(props: TimelineChartProps<T>)`
  - `TimelineTooltip(props)`, the tooltip body, exported for testing.

**Behavior (spec Charts → TimelineChart, Decisions 7, 9, 10):**
- **Bars are placed by date on the page's shared `weeks`.**
- **Header:**
  - "Latest" is the last week with data, and "change" is its difference from the previous week with data.
  - The change keeps today's green/red color. It adds a `+` or `−` sign, so direction isn't shown by color alone.
- **In-flight is a portion of the week's total,** as in today's org code, where shipped is `barH - inFlightH`. `inFlight` is clamped to `[0, value]`, so the stack never goes negative (Review Focus 5). The shipped segment gets the 4px rounded top only when that week has no in-flight segment above it.
- **Colors:** bars use `var(--accent)`. The in-flight segment uses an accent hatch, whose `<defs>` render only when `inFlightValue` is passed.
- **Empty state:** "No data in the last 90 days" when no week in the domain has data.
- **Ratio weeks** are weighted by `commits` when a week arrives split across two keys.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/timeline-chart.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { TimelineChart, TimelineTooltip } from '@/components/charts/timeline-chart';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

const weeks = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21'];
type Row = { week: string; commits: number | string; prs: number; avg?: number | string; types?: Record<string, number> };

const rects = (c: HTMLElement) => Array.from(c.querySelectorAll('.recharts-bar-rectangle path.recharts-rectangle'));

it("kind 'count': one accent bar per week with a value, zero weeks draw nothing", () => {
  const data: Row[] = [{ week: '2026-09-07', commits: 3, prs: 1 }, { week: '2026-09-21', commits: 5, prs: 2 }];
  const { container } = render(<TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="Commits / Week" syncId="t" />);
  expect(rects(container)).toHaveLength(2);
  rects(container).forEach(r => expect(r.getAttribute('fill')).toBe('var(--accent)'));
});

it("kind 'ratio' with isDefined: a present week with prs === 0 is a gap, not a 0 bar", () => {
  const data: Row[] = [
    { week: '2026-09-07', commits: 2, prs: 0, avg: 0 },
    { week: '2026-09-14', commits: 2, prs: 2, avg: 80 },
    { week: '2026-09-21', commits: 2, prs: 1, avg: 40 },
  ];
  const { container } = render(
    <TimelineChart data={data} weeks={weeks} valueKey="avg" kind="ratio" isDefined={d => d.prs > 0} label="Avg" suffix=" lines" syncId="t" />,
  );
  expect(rects(container)).toHaveLength(2);
});

it('the header shows the latest week with data and its change from the previous one', () => {
  const data: Row[] = [{ week: '2026-09-07', commits: 3, prs: 0 }, { week: '2026-09-14', commits: 5, prs: 0 }];
  render(<TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="Commits / Week" syncId="t" />);
  // Scoped by test id: y-axis tick text can also render a bare "5".
  expect(screen.getByTestId('timeline-latest').textContent).toBe('5');
  expect(screen.getByTestId('timeline-change').textContent).toBe('+2');
});

it('a downward change carries a minus sign, so direction is not shown by colour alone', () => {
  const data: Row[] = [{ week: '2026-09-07', commits: 5, prs: 0 }, { week: '2026-09-14', commits: 2, prs: 0 }];
  render(<TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="Commits / Week" syncId="t" />);
  expect(screen.getByTestId('timeline-change').textContent).toBe('−3');
});

it('string DECIMAL values render as numbers in the header', () => {
  const data: Row[] = [{ week: '2026-09-14', commits: 1, prs: 1, avg: '2.50' }];
  render(<TimelineChart data={data} weeks={weeks} valueKey="avg" kind="ratio" decimals={1} label="Avg Complexity" syncId="t" />);
  expect(screen.getByTestId('timeline-latest').textContent).toBe('2.5');
});

it('a Tuesday-keyed row still draws in its Monday week', () => {
  const data: Row[] = [{ week: '2026-09-15', commits: 4, prs: 0 }];
  const { container } = render(<TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="C" syncId="t" />);
  expect(rects(container)).toHaveLength(1);
});

it('the hatch appears only with inFlightValue, and the in-flight segment uses it', () => {
  const data: Row[] = [{ week: '2026-09-14', commits: 5, prs: 0, types: { feature: 3, in_flight: 2 } }];
  const plain = render(<TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="C" syncId="t" />);
  expect(plain.container.querySelector('pattern')).toBeNull();
  plain.unmount();

  const { container } = render(
    <TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="C" syncId="t" inFlightValue={d => d.types?.in_flight ?? 0} />,
  );
  const pattern = container.querySelector('pattern')!;
  const fills = rects(container).map(r => r.getAttribute('fill'));
  expect(fills).toEqual(['var(--accent)', `url(#${pattern.id})`]);
});

it('in-flight larger than the week total is clamped: the stack is all hatch, never negative', () => {
  const data: Row[] = [{ week: '2026-09-14', commits: 2, prs: 0, types: { in_flight: 9 } }];
  const { container } = render(
    <TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="C" syncId="t" inFlightValue={d => d.types?.in_flight ?? 0} />,
  );
  const fills = rects(container).map(r => r.getAttribute('fill'));
  expect(fills).toHaveLength(1);
  expect(fills[0]).toMatch(/^url\(#hatch-/);
});

it('two instances on one page get different pattern ids', () => {
  const data: Row[] = [{ week: '2026-09-14', commits: 5, prs: 0, types: { in_flight: 2 } }];
  const { container } = render(
    <>
      <TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="A" syncId="t" inFlightValue={d => d.types?.in_flight ?? 0} />
      <TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="B" syncId="t" inFlightValue={d => d.types?.in_flight ?? 0} />
    </>,
  );
  const ids = Array.from(container.querySelectorAll('pattern')).map(p => p.id);
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
});

it('shows an explicit empty state when no week has data', () => {
  render(<TimelineChart data={[] as Row[]} weeks={weeks} valueKey="commits" kind="count" label="Commits / Week" syncId="t" />);
  expect(screen.getByText('No data in the last 90 days')).toBeTruthy();
});

it('the tooltip shows the week, the value, and the shipped / in-flight split when present', () => {
  const row = { week: '2026-09-21', value: 5, shipped: 3, inFlight: 2 };
  const { container } = render(<TimelineTooltip active payload={[{ payload: row }] as never} split />);
  expect(screen.getByText('Sep 21')).toBeTruthy();
  expect(container.textContent).toContain('Shipped3');
  expect(container.textContent).toContain('In flight2');
});

it('the tooltip omits the split when the week has no in-flight work', () => {
  const row = { week: '2026-09-21', value: 5, shipped: 5, inFlight: 0 };
  const { container } = render(<TimelineTooltip active payload={[{ payload: row }] as never} split suffix="%" />);
  expect(container.textContent).toContain('5%');
  expect(container.textContent).not.toContain('In flight');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/timeline-chart.test.tsx'`

Expected: FAIL with `Cannot find module '@/components/charts/timeline-chart'`.

- [ ] **Step 3: Implement `TimelineChart`**

Create `src/components/charts/timeline-chart.tsx`:

```tsx
'use client';

// GLOOK-58: the one TimelineChart (it used to exist twice, in the org and dev pages, and the
// copies had diverged). Bars are placed by date on the page's shared week domain, so every chart
// in a grid has the same array and hover sync (syncId, matched by index) lines up.
import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis, type BarShapeProps, type RectangleProps } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS } from './chart';
import { fillWeeks, formatCompact, formatValue, formatWeek, toNum, type MetricKind } from './chart-format';
import { useHatch } from './hatch';

export interface TimelineRow {
  week: string;
  commits?: unknown;
}

export interface TimelinePoint {
  week: string;
  value: number | null;
  shipped: number | null;
  inFlight: number | null;
}

export interface TimelineChartProps<T extends TimelineRow> {
  data: T[];
  /** The page's shared week domain (recentWeekDomain()). */
  weeks: string[];
  valueKey?: keyof T & string;
  computeValue?: (row: T) => unknown;
  kind: MetricKind;
  isDefined?: (row: T) => boolean;
  label: string;
  suffix?: string;
  decimals?: number;
  /** Per-week in-flight portion of the value (a part of the total, not an addition to it). */
  inFlightValue?: (row: T) => unknown;
  syncId: string;
}

type TimelineTooltipProps = Partial<TooltipContentProps<TooltipValueType, string | number>> & {
  suffix?: string;
  decimals?: number;
  split?: boolean;
};

export function TimelineTooltip({ active, payload, suffix = '', decimals = 0, split = false }: TimelineTooltipProps) {
  const row = payload?.[0]?.payload as TimelinePoint | undefined;
  if (!active || !row || row.value === null) return null;
  const fmt = (v: number) => formatValue(v, { suffix, decimals });
  const inFlight = row.inFlight ?? 0;
  return (
    <div className={CHART_TOOLTIP_CLASS}>
      <div className="font-medium">{formatWeek(row.week)}</div>
      <div className="font-mono tabular-nums">{fmt(row.value)}</div>
      {split && inFlight > 0 && (
        <>
          <div className="flex justify-between gap-4"><span>Shipped</span><span className="font-mono tabular-nums">{fmt(row.shipped ?? 0)}</span></div>
          <div className="flex justify-between gap-4"><span>In flight</span><span className="font-mono tabular-nums">{fmt(inFlight)}</span></div>
        </>
      )}
    </div>
  );
}

function shippedShape(props: BarShapeProps) {
  const row = props.payload as TimelinePoint;
  const top = !((row.inFlight ?? 0) > 0);
  return <Rectangle {...(props as RectangleProps)} radius={top ? [4, 4, 0, 0] : 0} />;
}

export function TimelineChart<T extends TimelineRow>({
  data, weeks, valueKey, computeValue, kind, isDefined, label, suffix = '', decimals = 0, inFlightValue, syncId,
}: TimelineChartProps<T>) {
  const hatch = useHatch('var(--accent)');
  const read = (row: T): unknown => (computeValue ? computeValue(row) : valueKey ? row[valueKey] : undefined);
  const points = fillWeeks(weeks, data, { value: read, kind, isDefined, weight: r => toNum(r.commits) });
  const inFlight = inFlightValue ? fillWeeks(weeks, data, { value: inFlightValue, kind: 'count' }) : null;

  const rows: TimelinePoint[] = points.map((p, i) => {
    if (p.value === null) return { week: p.week, value: null, shipped: null, inFlight: null };
    const f = inFlight ? Math.min(Math.max(0, inFlight[i].value ?? 0), p.value) : 0;
    return { week: p.week, value: p.value, shipped: p.value - f, inFlight: f };
  });

  const withData = points.filter(p => p.hasData);
  const latest = withData.length > 0 ? withData[withData.length - 1].value : null;
  const prev = withData.length > 1 ? withData[withData.length - 2].value : null;
  const diff = latest !== null && prev !== null ? latest - prev : 0;
  const fmt = (v: number) => formatValue(v, { suffix, decimals });

  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-xs text-gray-500 font-medium">{label}</p>
        {latest !== null && (
          <div className="flex items-baseline gap-2">
            <span data-testid="timeline-latest" className="text-sm font-bold text-white">{fmt(latest)}</span>
            {diff !== 0 && (
              <span data-testid="timeline-change" className={`text-xs ${diff > 0 ? 'text-green-400' : 'text-red-400'}`}>
                {diff > 0 ? '+' : '−'}{fmt(Math.abs(diff))}
              </span>
            )}
          </div>
        )}
      </div>
      {withData.length === 0 ? (
        <p className="text-xs text-chart-axis py-8 text-center">No data in the last 90 days</p>
      ) : (
        <ChartContainer config={{}} className="aspect-auto h-[140px] w-full">
          <BarChart data={rows} syncId={syncId} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            {inFlightValue && hatch.defs}
            <CartesianGrid vertical={false} />
            <XAxis dataKey="week" tickLine={false} axisLine={false} minTickGap={24} tickFormatter={formatWeek} />
            <YAxis tickLine={false} axisLine={false} width={40} tickCount={4} allowDecimals={decimals > 0} tickFormatter={formatCompact} />
            <ChartTooltip content={<TimelineTooltip suffix={suffix} decimals={decimals} split={!!inFlightValue} />} />
            <Bar dataKey="shipped" stackId="timeline" fill="var(--accent)" stroke="var(--chart-surface)" strokeWidth={2}
              shape={shippedShape} isAnimationActive={false} />
            {inFlightValue && (
              <Bar dataKey="inFlight" stackId="timeline" fill={hatch.fill} stroke="var(--chart-surface)" strokeWidth={2}
                radius={[4, 4, 0, 0]} isAnimationActive={false} />
            )}
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/timeline-chart.test.tsx'`

Expected: PASS, 12 tests.

**Verification.** If the hatch test sees the in-flight rectangle before the shipped one, Recharts rendered the Bars in a different DOM order. Change the assertion to compare sorted arrays, because the user-visible fact is that both fills are present. Do not reorder the Bars.

- [ ] **Step 5: Wire the org page**

In `src/app/report/[id]/org/page.tsx`, add these imports after line 9 (the `./spend-tab` import):

```tsx
import { TimelineChart } from '@/components/charts/timeline-chart';
import { recentWeekDomain, toNum } from '@/components/charts/chart-format';
```

Directly after `const totalTyped = …` (line 98), add:

```tsx
  // One week domain per render, shared by every chart below so hover sync (syncId) lines up.
  const weeks = recentWeekDomain(new Date());
```

Replace the timeline grid (lines 248-278, from `{/* Timeline Charts */}` through the closing `)}` of that block) with:

```tsx
      {/* Timeline Charts */}
      {timeline.length >= 2 && (
        <div className="mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Org Activity Over Time (weekly)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TimelineChart
              data={timeline}
              weeks={weeks}
              valueKey="commits"
              kind="count"
              label="Commits / Week"
              inFlightValue={d => d.types?.in_flight ?? 0}
              syncId="org-timeline"
            />
            <TimelineChart data={timeline} weeks={weeks} valueKey="prs" kind="count" label="PRs / Week" syncId="org-timeline" />
            <TimelineChart
              data={timeline}
              weeks={weeks}
              valueKey="avgLinesPerPr"
              kind="ratio"
              isDefined={d => toNum(d.prs) > 0}
              label="Avg Lines Changed / PR (outliers excluded)"
              suffix=" lines"
              syncId="org-timeline"
            />
            <TimelineChart data={timeline} weeks={weeks} valueKey="avgImpact" kind="ratio" label="Avg Impact Score / Week" decimals={1} syncId="org-timeline" />
            <LinesChangedChart data={timeline} />
            <TimelineChart
              data={timeline}
              weeks={weeks}
              valueKey="aiPercent"
              kind="ratio"
              isDefined={d => toNum(d.commits) > 0}
              label="AI Assisted %"
              suffix="%"
              syncId="org-timeline"
            />
          </div>
        </div>
      )}
```

`<LinesChangedChart data={timeline} />` still refers to the page's local component. Task 5 replaces it.

Delete the local `TimelineChart` function and its preceding comment, lines 784-922 (`// Reusable timeline chart (same as developer detail page)` through the final `}`). Keep `useState`: `JiraIssuesPopover`, `StackedTypesChart`, `LinesChangedChart` and `PieChart` still use it.

- [ ] **Step 6: Wire the dev page**

In `src/app/report/[id]/dev/[login]/page.tsx`, add these imports after line 8 (the `./usage-card` import):

```tsx
import { TimelineChart } from '@/components/charts/timeline-chart';
import { recentWeekDomain, toNum } from '@/components/charts/chart-format';
```

Directly after `const totalTyped = …` (line 166), add:

```tsx
  // One week domain per render, shared by every chart below so hover sync (syncId) lines up.
  const weeks = recentWeekDomain(new Date());
```

Replace the timeline grid (lines 310-357, `{/* Timeline Charts */}` through its closing `)}`) with:

```tsx
      {/* Timeline Charts */}
      {timeline.length >= 2 && (
        <div className="mb-6">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Activity Over Time (weekly)</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TimelineChart data={timeline} weeks={weeks} valueKey="commits" kind="count" label="Commits / Week" syncId="dev-timeline" />
            <TimelineChart data={timeline} weeks={weeks} valueKey="prs" kind="count" label="PRs / Week" syncId="dev-timeline" />
            <TimelineChart
              data={timeline}
              weeks={weeks}
              valueKey="avgLinesPerPr"
              kind="ratio"
              isDefined={d => toNum(d.prs) > 0}
              label="Avg Lines Changed / PR (outliers excluded)"
              suffix=" lines"
              syncId="dev-timeline"
            />
            <TimelineChart
              data={timeline}
              weeks={weeks}
              kind="count"
              label="Lines Changed / Week"
              computeValue={d => toNum(d.linesAdded) + toNum(d.linesRemoved)}
              syncId="dev-timeline"
            />
            <TimelineChart data={timeline} weeks={weeks} valueKey="avgComplexity" kind="ratio" label="Avg Complexity / Week" decimals={1} syncId="dev-timeline" />
            <TimelineChart
              data={timeline}
              weeks={weeks}
              valueKey="aiPercent"
              kind="ratio"
              isDefined={d => toNum(d.commits) > 0}
              label="AI Assisted %"
              suffix="%"
              syncId="dev-timeline"
            />
          </div>
        </div>
      )}
```

Delete the local `TimelineChart` function, lines 668-842 (`function TimelineChart({` through the final `}` of the file). Keep `useState`: `expandedSha` and `expandedIssueKey` use it.

`avgComplexity` gets no `isDefined`. Its payload has no denominator, so a present week that reports 0 is drawn as 0 (spec Decision 10, and Risks).

- [ ] **Step 7: Run the new test and the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all suites pass.

- [ ] **Step 8: Early browser check that `var()` resolves in Recharts presentation attributes**

Every Recharts mark in this plan passes its color as a presentation attribute: `fill="var(--accent)"` or `stroke="var(--chart-…)"`. shadcn's charts rely on this working. However, a comment from GLOOK-43 in the old `trend-chart.tsx` says presentation attributes "don't reliably resolve var()". Check it now, before three more tasks build on it.

1. Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run seed:reset'`
2. Start `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run dev:mock'` in the background.
3. Open `/reports`, then the newest report's `/report/<id>/org`.
4. Check the timeline bars:
   - **Accent-colored (amber in Amber Glow):** the assumption holds. Stop the server and continue.
   - **Black:** the attribute did not resolve. Stop and report it before Task 5. The fallback is a custom `shape` that passes the color through `style={{ fill }}`. That changes every chart task, so it needs sign-off first.

- [ ] **Step 9: Commit**

```bash
git add src/components/charts/timeline-chart.tsx src/lib/__tests__/unit/timeline-chart.test.tsx "src/app/report/[id]/org/page.tsx" "src/app/report/[id]/dev/[login]/page.tsx"
git commit -F - <<'EOF'
GLOOK-58: one date-placed TimelineChart with synced hover on org and dev pages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: `StackedTypesChart`, `LinesChangedChart`, `CommitTypeDonut` and the org wiring

**Files:**
- Create: `src/components/charts/stacked-types-chart.tsx`
- Create: `src/components/charts/lines-changed-chart.tsx`
- Create: `src/components/charts/commit-type-donut.tsx`
- Modify: `src/app/report/[id]/org/page.tsx`
  - Delete `TYPE_COLORS`/`TYPE_HEX` at lines 11-31.
  - Replace the donut card at lines 193-197.
  - Replace `<LinesChangedChart data={timeline} />` and the `StackedTypesChart` line.
  - Delete the local `StackedTypesChart`, `LinesChangedChart` and `PieChart` (the three functions between `JiraIssuesPopover` and the end of the file).
- Test: `src/lib/__tests__/unit/stacked-types-chart.test.tsx`, `src/lib/__tests__/unit/lines-changed-chart.test.tsx`, `src/lib/__tests__/unit/commit-type-donut.test.tsx`

**Interfaces:**
- Consumes:
  - From chart-format: `groupByWeek`, `isTopOfStack`, `toNum`, `formatWeek`, `formatCompact`, `formatValue`.
  - From commit-types: `COMMIT_TYPE_ORDER`, `commitTypeColor`, `foldTypes`, `CommitType`.
  - `useHatch` and `HatchSwatch` from hatch.
  - `ChartContainer`, `ChartTooltip`, `CHART_TOOLTIP_CLASS` from chart.
- Produces:
  - `StackedTypesChart({ data, weeks }: { data: Array<{ week: string; types?: Record<string, unknown> }>; weeks: string[] })`
  - `LinesChangedChart({ data, weeks, syncId }: { data: LinesWeek[]; weeks: string[]; syncId?: string })`, where `LinesWeek` has `week` plus optional `linesP95Added`, `linesP95Removed`, `inFlightLinesP95Added`, `inFlightLinesP95Removed` (all `unknown`)
  - `CommitTypeDonut({ entries, total }: { entries: [string, number][]; total: number | string })`

**Behavior:**
- **LinesChangedChart (Decision 12).**
  - Shipped `linesP95*` and in-flight `inFlightLinesP95*` are **added together**, unlike the timeline's in-flight, which is a portion. This keeps today's four-layer semantics.
  - Added values go above zero and removed values are negated below zero, in one `stackOffset="sign"` stack.
  - Both in-flight layers use one hatch in `--chart-type-in-flight`.
  - A `ReferenceLine y={0}` draws the baseline in `var(--chart-axis)`.
  - It joins `syncId="org-timeline"`, because it sits in the org grid.
- **StackedTypesChart.**
  - Unknown types fold into `other`; today they are dropped from the stack.
  - The legend lists only the types present, in `COMMIT_TYPE_ORDER`, with a hatched swatch for `in_flight`.
  - The tooltip lists the non-zero types and the total.
- **CommitTypeDonut (Decision 13).**
  - The legend always shows count and %.
  - The center shows the total at rest. Hovering a slice or legend row shows that type's count, a swatch with its name, and its %, and dims the other slices to 0.3.
  - The center text uses `text-chart-tooltip-text` and `text-chart-axis` only, never an inline color.
  - The `in_flight` wedge and swatch are hatched.
  - A total of 0 renders "No categorized commits".
  - The chart sits in a `max-w-[320px]` wrapper with `aspect-square`. The spec says `<ResponsiveContainer aspect={1}>`. `ChartContainer` owns the `ResponsiveContainer` and fills a square div, which gives the same 1:1 result.
  - Hover uses Pie's `onMouseEnter` plus state. Recharts 3 removed `activeIndex`. Rows carry `fill` and `opacity`, because Pie reads `fill` from each data entry (`es6/polar/Pie.js`, around line 379) and spreads the entry into the sector props. `Cell` is not used; it is deprecated in 3.10.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/unit/stacked-types-chart.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { StackedTypesChart, StackedTypesTooltip } from '@/components/charts/stacked-types-chart';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

const weeks = ['2026-09-07', '2026-09-14', '2026-09-21'];
const rects = (c: HTMLElement) => Array.from(c.querySelectorAll('.recharts-bar-rectangle path.recharts-rectangle'));

it('draws one segment per non-zero type per week, in type tokens, with in-flight hatched', () => {
  const data = [
    { week: '2026-09-07', types: { feature: 2, bug: 1 } },
    { week: '2026-09-14', types: { feature: 1, in_flight: 3 } },
  ];
  const { container } = render(<StackedTypesChart data={data} weeks={weeks} />);
  const fills = rects(container).map(r => r.getAttribute('fill'));
  expect(fills).toHaveLength(4);
  expect(fills.filter(f => f === 'var(--chart-type-feature)')).toHaveLength(2);
  expect(fills.filter(f => f === 'var(--chart-type-bug)')).toHaveLength(1);
  const hatched = fills.filter(f => f?.startsWith('url(#hatch-'));
  expect(hatched).toHaveLength(1);
  expect(container.querySelector(`pattern#${hatched[0]!.slice(5, -1)}`)).not.toBeNull();
});

it('the legend lists the types present, in stacking order, in chrome text', () => {
  const data = [{ week: '2026-09-07', types: { test: 1, feature: 2 } }];
  const { container } = render(<StackedTypesChart data={data} weeks={weeks} />);
  const legend = Array.from(container.querySelectorAll('span.text-chart-axis')).map(s => s.textContent);
  expect(legend).toEqual(['feature', 'test']);
});

it('folds unknown types into other instead of dropping them', () => {
  const data = [{ week: '2026-09-07', types: { chore: 2 } }];
  const { container } = render(<StackedTypesChart data={data} weeks={weeks} />);
  expect(rects(container).map(r => r.getAttribute('fill'))).toEqual(['var(--chart-type-other)']);
  expect(screen.getByText('other')).toBeTruthy();
});

it('shows an explicit empty state when no week has commits', () => {
  render(<StackedTypesChart data={[]} weeks={weeks} />);
  expect(screen.getByText('No commits in the last 90 days')).toBeTruthy();
});

it('the tooltip lists the week total and only the non-zero types', () => {
  const row = { week: '2026-09-14', total: 4, feature: 3, bug: 0, refactor: 0, infra: 0, docs: 0, test: 0, other: 0, in_flight: 1 };
  const { container } = render(<StackedTypesTooltip active payload={[{ payload: row }] as never} />);
  expect(container.textContent).toContain('Sep 14 · 4 total');
  expect(container.textContent).toContain('feature3');
  expect(container.textContent).toContain('in_flight1');
  expect(container.textContent).not.toContain('bug');
});
```

Create `src/lib/__tests__/unit/lines-changed-chart.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { LinesChangedChart } from '@/components/charts/lines-changed-chart';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

const weeks = ['2026-09-07', '2026-09-14', '2026-09-21'];
const rectsWithFill = (c: HTMLElement, fill: RegExp) =>
  Array.from(c.querySelectorAll('.recharts-bar-rectangle path.recharts-rectangle')).filter(r => fill.test(r.getAttribute('fill') ?? ''));
const extent = (r: Element) => {
  const y = Number(r.getAttribute('y'));
  const h = Number(r.getAttribute('height'));
  return [Math.min(y, y + h), Math.max(y, y + h)];
};

it('draws removed lines below the zero baseline and added lines above it', () => {
  const data = [
    { week: '2026-09-07', linesP95Added: 120, linesP95Removed: 40 },
    { week: '2026-09-14', linesP95Added: '80', linesP95Removed: '60' },
  ];
  const { container } = render(<LinesChangedChart data={data} weeks={weeks} />);
  const zero = container.querySelector('.recharts-reference-line line')!;
  expect(zero.getAttribute('stroke')).toBe('var(--chart-axis)');
  const zeroY = Number(zero.getAttribute('y1'));

  const removed = rectsWithFill(container, /^var\(--chart-lines-removed\)$/);
  const added = rectsWithFill(container, /^var\(--chart-lines-added\)$/);
  expect(removed).toHaveLength(2);
  expect(added).toHaveLength(2);
  removed.forEach(r => {
    const [top, bottom] = extent(r);
    expect(top).toBeGreaterThanOrEqual(zeroY - 0.5);
    expect(bottom).toBeGreaterThan(zeroY);
  });
  added.forEach(r => {
    const [top, bottom] = extent(r);
    expect(bottom).toBeLessThanOrEqual(zeroY + 0.5);
    expect(top).toBeLessThan(zeroY);
  });
});

it('hatches the in-flight part of each side and lists it in the legend only when present', () => {
  const data = [{ week: '2026-09-14', linesP95Added: 50, linesP95Removed: 20, inFlightLinesP95Added: 30, inFlightLinesP95Removed: 10 }];
  const { container } = render(<LinesChangedChart data={data} weeks={weeks} />);
  expect(rectsWithFill(container, /^url\(#hatch-/)).toHaveLength(2);
  expect(screen.getByText('In flight')).toBeTruthy();
});

it('omits the in-flight legend entry when nothing is in flight', () => {
  render(<LinesChangedChart data={[{ week: '2026-09-14', linesP95Added: 5, linesP95Removed: 5 }]} weeks={weeks} />);
  expect(screen.queryByText('In flight')).toBeNull();
});

it('shows an explicit empty state when every week is zero', () => {
  render(<LinesChangedChart data={[{ week: '2026-09-14', linesP95Added: 0, linesP95Removed: '0' }]} weeks={weeks} />);
  expect(screen.getByText('No line changes in the last 90 days')).toBeTruthy();
});
```

Create `src/lib/__tests__/unit/commit-type-donut.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommitTypeDonut } from '@/components/charts/commit-type-donut';
import { fixChartSize } from '../setup/chart-size';

fixChartSize(320, 320);

const entries: [string, number][] = [['feature', 6], ['bug', 3], ['in_flight', 1]];
const center = () => screen.getByTestId('donut-center');

it('shows every type with count and % without any hover', () => {
  render(<CommitTypeDonut entries={entries} total={10} />);
  expect(screen.getByText('6 (60%)')).toBeTruthy();
  expect(screen.getByText('3 (30%)')).toBeTruthy();
  expect(screen.getByText('1 (10%)')).toBeTruthy();
});

it('shows the total in the centre when nothing is hovered', () => {
  render(<CommitTypeDonut entries={entries} total={10} />);
  expect(center().textContent).toBe('10commits');
});

it('hovering a legend row moves that type into the centre, in chrome text, and dims the other slices', () => {
  const { container } = render(<CommitTypeDonut entries={entries} total={10} />);
  fireEvent.mouseEnter(screen.getByTestId('donut-legend-bug'));
  expect(center().textContent).toBe('3bug30%');
  center().querySelectorAll('span').forEach(s => {
    expect(s.getAttribute('style') ?? '').not.toContain('color');
    expect(s.className).toMatch(/text-chart-(tooltip-text|axis)/);
  });
  const sectors = Array.from(container.querySelectorAll('.recharts-pie-sector path'));
  expect(sectors.map(p => p.getAttribute('opacity'))).toEqual(['0.3', '1', '0.3']);
  fireEvent.mouseLeave(screen.getByTestId('donut-legend-bug'));
  expect(center().textContent).toBe('10commits');
});

it('hovering a slice also moves its figures into the centre', () => {
  const { container } = render(<CommitTypeDonut entries={entries} total={10} />);
  fireEvent.mouseEnter(container.querySelectorAll('.recharts-pie-sector')[0]);
  expect(center().textContent).toBe('6feature60%');
});

it('fills the in_flight wedge and its legend swatch with a hatch pattern', () => {
  const { container } = render(<CommitTypeDonut entries={entries} total={10} />);
  const sectors = Array.from(container.querySelectorAll('.recharts-pie-sector path'));
  expect(sectors[0].getAttribute('fill')).toBe('var(--chart-type-feature)');
  const hatchFill = sectors[2].getAttribute('fill')!;
  expect(hatchFill).toMatch(/^url\(#hatch-/);
  expect(container.querySelector(`pattern#${hatchFill.slice(5, -1)}`)).not.toBeNull();
  expect(screen.getByTestId('donut-legend-in_flight').querySelector('pattern')).not.toBeNull();
});

it('a total of 0 (or "0") renders the empty state instead of a chart', () => {
  const { container, rerender } = render(<CommitTypeDonut entries={[]} total={0} />);
  expect(screen.getByText('No categorized commits')).toBeTruthy();
  expect(container.querySelector('svg')).toBeNull();
  rerender(<CommitTypeDonut entries={[['feature', 0]]} total="0" />);
  expect(screen.getByText('No categorized commits')).toBeTruthy();
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/stacked-types-chart.test.tsx src/lib/__tests__/unit/lines-changed-chart.test.tsx src/lib/__tests__/unit/commit-type-donut.test.tsx'`

Expected: FAIL with `Cannot find module` for all three.

- [ ] **Step 3: Implement `StackedTypesChart`**

Create `src/components/charts/stacked-types-chart.tsx`:

```tsx
'use client';

import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis, type BarShapeProps, type RectangleProps } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS } from './chart';
import { formatCompact, formatWeek, groupByWeek, isTopOfStack } from './chart-format';
import { COMMIT_TYPE_ORDER, commitTypeColor, foldTypes, type CommitType } from './commit-types';
import { HatchSwatch, useHatch } from './hatch';

interface TypesWeek {
  week: string;
  types?: Record<string, unknown>;
}

type StackRow = { week: string; total: number } & Record<CommitType, number>;

export function StackedTypesTooltip({ active, payload }: Partial<TooltipContentProps<TooltipValueType, string | number>>) {
  const row = payload?.[0]?.payload as StackRow | undefined;
  if (!active || !row) return null;
  return (
    <div className={CHART_TOOLTIP_CLASS}>
      <div className="font-medium">{formatWeek(row.week)} · {row.total} total</div>
      {COMMIT_TYPE_ORDER.filter(t => row[t] > 0).map(t => (
        <div key={t} className="flex justify-between gap-4">
          <span>{t}</span>
          <span className="font-mono tabular-nums">{row[t]}</span>
        </div>
      ))}
    </div>
  );
}

export function StackedTypesChart({ data, weeks }: { data: TypesWeek[]; weeks: string[] }) {
  const hatch = useHatch(commitTypeColor('in_flight'));
  const groups = groupByWeek(weeks, data);
  const rows: StackRow[] = weeks.map(week => {
    const folded = foldTypes((groups.get(week) ?? []).map(r => r.types ?? {}));
    const total = COMMIT_TYPE_ORDER.reduce((s, t) => s + folded[t], 0);
    return { week, total, ...folded };
  });
  const present = COMMIT_TYPE_ORDER.filter(t => rows.some(r => r[t] > 0));
  const fillFor = (t: CommitType) => (t === 'in_flight' ? hatch.fill : commitTypeColor(t));
  const shapeFor = (t: CommitType) => {
    function TypeSegment(props: BarShapeProps) {
      return <Rectangle {...(props as RectangleProps)} radius={isTopOfStack(props.payload, present, t) ? [4, 4, 0, 0] : 0} />;
    }
    return TypeSegment;
  };

  return (
    <div className="bg-gray-900 rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <p className="text-xs text-gray-500 font-medium">Commit Types Over Time (weekly)</p>
        <div className="flex flex-wrap gap-3">
          {present.map(t => (
            <span key={t} className="flex items-center gap-1.5 text-[11px] text-chart-axis">
              {t === 'in_flight'
                ? <HatchSwatch colorVar={commitTypeColor(t)} />
                : <i aria-hidden="true" className="w-2.5 h-2.5 rounded-sm" style={{ background: commitTypeColor(t) }} />}
              {t}
            </span>
          ))}
        </div>
      </div>
      {present.length === 0 ? (
        <p className="text-xs text-chart-axis py-8 text-center">No commits in the last 90 days</p>
      ) : (
        <ChartContainer config={{}} className="aspect-auto h-[200px] w-full">
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {hatch.defs}
            <CartesianGrid vertical={false} />
            <XAxis dataKey="week" tickLine={false} axisLine={false} minTickGap={24} tickFormatter={formatWeek} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} tickFormatter={formatCompact} />
            <ChartTooltip content={<StackedTypesTooltip />} />
            {present.map(t => (
              <Bar key={t} dataKey={t} name={t} stackId="types" fill={fillFor(t)} stroke="var(--chart-surface)" strokeWidth={2}
                shape={shapeFor(t)} isAnimationActive={false} />
            ))}
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}
```

The legend swatch is an `<i>`, not a `<span>`. That keeps the legend test's `span.text-chart-axis` query to the labeled entries.

- [ ] **Step 4: Implement `LinesChangedChart`**

Create `src/components/charts/lines-changed-chart.tsx`:

```tsx
'use client';

// GLOOK-58 Decision 12: a diverging chart. Added lines stack above zero, removed lines are negated
// and stack below, in ONE stackOffset="sign" stack. Two stackIds would place them side by side
// instead. Shipped linesP95* and in-flight inFlightLinesP95* are separate additive layers, as today.
import { Bar, BarChart, CartesianGrid, Rectangle, ReferenceLine, XAxis, YAxis, type BarShapeProps, type RectangleProps } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS } from './chart';
import { formatCompact, formatValue, formatWeek, groupByWeek, toNum } from './chart-format';
import { commitTypeColor } from './commit-types';
import { HatchSwatch, useHatch } from './hatch';

export interface LinesWeek {
  week: string;
  linesP95Added?: unknown;
  linesP95Removed?: unknown;
  inFlightLinesP95Added?: unknown;
  inFlightLinesP95Removed?: unknown;
}

interface LinesRow {
  week: string;
  added: number;
  inFlightAdded: number;
  removed: number;
  inFlightRemoved: number;
}

const ADDED = 'var(--chart-lines-added)';
const REMOVED = 'var(--chart-lines-removed)';
const TOP: [number, number, number, number] = [4, 4, 0, 0];
const BOTTOM: [number, number, number, number] = [0, 0, 4, 4];

export function LinesTooltip({ active, payload }: Partial<TooltipContentProps<TooltipValueType, string | number>>) {
  const row = payload?.[0]?.payload as LinesRow | undefined;
  if (!active || !row) return null;
  const fmt = (v: number) => formatValue(v);
  const total = row.added + row.inFlightAdded - row.removed - row.inFlightRemoved;
  return (
    <div className={CHART_TOOLTIP_CLASS}>
      <div className="font-medium">{formatWeek(row.week)}</div>
      <div className="font-mono tabular-nums">+{fmt(row.added)} added</div>
      {row.inFlightAdded > 0 && <div className="font-mono tabular-nums">+{fmt(row.inFlightAdded)} added in flight</div>}
      <div className="font-mono tabular-nums">−{fmt(-row.removed)} removed</div>
      {row.inFlightRemoved < 0 && <div className="font-mono tabular-nums">−{fmt(-row.inFlightRemoved)} removed in flight</div>}
      <div className="font-mono tabular-nums">{fmt(total)} total</div>
    </div>
  );
}

function addedShape(props: BarShapeProps) {
  const row = props.payload as LinesRow;
  return <Rectangle {...(props as RectangleProps)} radius={row.inFlightAdded > 0 ? 0 : TOP} />;
}
function removedShape(props: BarShapeProps) {
  const row = props.payload as LinesRow;
  return <Rectangle {...(props as RectangleProps)} radius={row.inFlightRemoved < 0 ? 0 : BOTTOM} />;
}

export function LinesChangedChart({ data, weeks, syncId }: { data: LinesWeek[]; weeks: string[]; syncId?: string }) {
  const hatch = useHatch(commitTypeColor('in_flight'));
  const groups = groupByWeek(weeks, data);
  const rows: LinesRow[] = weeks.map(week => {
    const g = groups.get(week) ?? [];
    const sum = (k: keyof LinesWeek) => g.reduce((s, r) => s + toNum(r[k]), 0);
    return {
      week,
      added: sum('linesP95Added'),
      inFlightAdded: sum('inFlightLinesP95Added'),
      removed: -sum('linesP95Removed'),
      inFlightRemoved: -sum('inFlightLinesP95Removed'),
    };
  });
  const hasAny = rows.some(r => r.added || r.inFlightAdded || r.removed || r.inFlightRemoved);
  const hasInFlight = rows.some(r => r.inFlightAdded > 0 || r.inFlightRemoved < 0);

  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <p className="text-xs text-gray-500 font-medium mb-2">
        Lines Changed / Week <span className="text-gray-600 font-normal">(outlier commits excluded)</span>
      </p>
      {!hasAny ? (
        <p className="text-xs text-chart-axis py-8 text-center">No line changes in the last 90 days</p>
      ) : (
        <ChartContainer config={{}} className="aspect-auto h-[160px] w-full">
          <BarChart data={rows} stackOffset="sign" syncId={syncId} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            {hatch.defs}
            <CartesianGrid vertical={false} />
            <XAxis dataKey="week" tickLine={false} axisLine={false} minTickGap={24} tickFormatter={formatWeek} />
            <YAxis tickLine={false} axisLine={false} width={44} tickCount={5} tickFormatter={formatCompact} />
            <ChartTooltip content={<LinesTooltip />} />
            <ReferenceLine y={0} stroke="var(--chart-axis)" strokeWidth={1} ifOverflow="extendDomain" />
            <Bar dataKey="added" stackId="lines" fill={ADDED} stroke="var(--chart-surface)" strokeWidth={2} shape={addedShape} isAnimationActive={false} />
            <Bar dataKey="inFlightAdded" stackId="lines" fill={hatch.fill} stroke="var(--chart-surface)" strokeWidth={2} radius={TOP} isAnimationActive={false} />
            <Bar dataKey="removed" stackId="lines" fill={REMOVED} stroke="var(--chart-surface)" strokeWidth={2} shape={removedShape} isAnimationActive={false} />
            <Bar dataKey="inFlightRemoved" stackId="lines" fill={hatch.fill} stroke="var(--chart-surface)" strokeWidth={2} radius={BOTTOM} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      )}
      <div className="flex gap-4 mt-2 justify-end">
        <span className="flex items-center gap-1.5 text-[11px] text-chart-axis">
          <i aria-hidden="true" className="w-2.5 h-2.5 rounded-sm" style={{ background: ADDED }} /> Added
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-chart-axis">
          <i aria-hidden="true" className="w-2.5 h-2.5 rounded-sm" style={{ background: REMOVED }} /> Removed
        </span>
        {hasInFlight && (
          <span className="flex items-center gap-1.5 text-[11px] text-chart-axis">
            <HatchSwatch colorVar={commitTypeColor('in_flight')} /> In flight
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Implement `CommitTypeDonut`**

Create `src/components/charts/commit-type-donut.tsx`:

```tsx
'use client';

// GLOOK-58 Decision 13: the legend always shows count and %, the centre shows the total at rest
// and the hovered type's figures on hover. Centre text is chrome text; type identity comes from a
// swatch beside it, never from coloured text.
import { useState, type ReactElement } from 'react';
import { Pie, PieChart } from 'recharts';
import { ChartContainer } from './chart';
import { toNum } from './chart-format';
import { commitTypeColor } from './commit-types';
import { HatchSwatch, useHatch } from './hatch';

function Swatch({ type, size }: { type: string; size: number }): ReactElement {
  if (type === 'in_flight') return <HatchSwatch colorVar={commitTypeColor(type)} size={size} />;
  return <i aria-hidden="true" className="rounded-sm shrink-0 inline-block" style={{ width: size, height: size, background: commitTypeColor(type) }} />;
}

export function CommitTypeDonut({ entries, total }: { entries: [string, number][]; total: number | string }) {
  const [hover, setHover] = useState<string | null>(null);
  const hatch = useHatch(commitTypeColor('in_flight'));
  const sum = toNum(total);
  if (sum <= 0) return <p className="text-xs text-chart-axis">No categorized commits</p>;

  const pct = (n: number) => Math.round((n / sum) * 100);
  const data = entries.map(([type, count]) => ({
    type,
    count: toNum(count),
    fill: type === 'in_flight' ? hatch.fill : commitTypeColor(type),
    opacity: hover === null || hover === type ? 1 : 0.3,
  }));
  const hovered = hover === null ? undefined : data.find(d => d.type === hover);

  return (
    <div className="flex items-center justify-center gap-6 h-full w-full">
      <div className="relative w-full max-w-[320px] shrink-0">
        <ChartContainer config={{}} className="aspect-square w-full">
          <PieChart>
            {hatch.defs}
            <Pie
              data={data}
              dataKey="count"
              nameKey="type"
              innerRadius="60%"
              outerRadius="96%"
              stroke="var(--chart-surface)"
              strokeWidth={2}
              isAnimationActive={false}
              onMouseEnter={d => setHover(String(d?.payload?.type ?? ''))}
              onMouseLeave={() => setHover(null)}
            />
          </PieChart>
        </ChartContainer>
        <div data-testid="donut-center" className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {hovered ? (
            <>
              <span className="text-xl font-bold text-chart-tooltip-text">{hovered.count.toLocaleString('en-US')}</span>
              <span className="flex items-center gap-1 text-xs font-semibold text-chart-axis">
                <Swatch type={hovered.type} size={8} />
                {hovered.type}
              </span>
              <span className="text-xs text-chart-axis">{pct(hovered.count)}%</span>
            </>
          ) : (
            <>
              <span className="text-2xl font-bold text-chart-tooltip-text">{sum.toLocaleString('en-US')}</span>
              <span className="text-xs text-chart-axis">commits</span>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-col justify-center gap-1.5">
        {data.map(d => (
          <div
            key={d.type}
            data-testid={`donut-legend-${d.type}`}
            className={`flex items-center gap-2 text-sm cursor-default transition-opacity duration-150 ${hover !== null && hover !== d.type ? 'opacity-30' : ''}`}
            onMouseEnter={() => setHover(d.type)}
            onMouseLeave={() => setHover(null)}
          >
            <Swatch type={d.type} size={12} />
            <span className="text-chart-tooltip-text font-medium">{d.type}</span>
            <span className="text-chart-axis">{d.count.toLocaleString('en-US')} ({pct(d.count)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the three tests and confirm they pass**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/stacked-types-chart.test.tsx src/lib/__tests__/unit/lines-changed-chart.test.tsx src/lib/__tests__/unit/commit-type-donut.test.tsx'`

Expected: PASS.

**Verification. Each item below is behavior read from source but not yet observed in jsdom.**

- **"draws removed lines below the zero baseline".** It relies on `path.recharts-rectangle` carrying `y` and `height` attributes. Recharts writes them only when the rectangle is not animating. If they are missing, confirm `isAnimationActive={false}` on every `Bar`.
  - If the test shows removed bars **above** zero, the negative stack regressed (upstream issue 6802, fixed by PR 6806 on 2025-12-19, before 3.10.1). Stop and report it. Two `stackId`s are **not** an acceptable fallback (spec Risks).
- **The donut dimming assertion (`opacity` `0.3`/`1`/`0.3`).** It relies on Pie spreading data-entry fields into the sector path. If `opacity` is absent from the paths but the center and legend behave, move the dimming to a `className` on each entry (`className: hover … ? 'opacity-30' : ''`). Recharts appends `entry.className` to the sector. Assert the class instead.
- **"hovering a slice".** It relies on Pie's `onMouseEnter` firing from a React `mouseenter` on `.recharts-pie-sector`. If Recharts routes this event only through its internal store in jsdom, delete that one test and record in the commit body that slice hover is covered by the screenshot pass. The legend-hover test stays.

- [ ] **Step 7: Wire the org page and delete the old charts and color maps**

In `src/app/report/[id]/org/page.tsx`:

1. Delete lines 11-31 (`const TYPE_COLORS …` and `const TYPE_HEX …`).
2. Add these imports next to the ones Task 4 added:

```tsx
import { StackedTypesChart } from '@/components/charts/stacked-types-chart';
import { LinesChangedChart } from '@/components/charts/lines-changed-chart';
import { CommitTypeDonut } from '@/components/charts/commit-type-donut';
```

3. Replace the donut card (the block starting `{/* Type Breakdown — Pie Chart */}`):

```tsx
        {/* Type Breakdown — Donut */}
        <div className="bg-gray-900 rounded-xl p-5 flex flex-col">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-4 font-semibold">Commit Types (org-wide)</p>
          <div className="flex-1 flex items-center"><CommitTypeDonut entries={typeEntries} total={totalTyped} /></div>
        </div>
```

4. In the timeline grid, replace `<LinesChangedChart data={timeline} />` with:

```tsx
            <LinesChangedChart data={timeline} weeks={weeks} syncId="org-timeline" />
```

5. Replace `{timeline.length >= 2 && <StackedTypesChart data={timeline} />}` with:

```tsx
      {timeline.length >= 2 && <StackedTypesChart data={timeline} weeks={weeks} />}
```

6. Delete the local functions `StackedTypesChart`, `LinesChangedChart` and `PieChart`. That is everything from `function StackedTypesChart({ data }: { data: WeeklyData[] }) {` to the end of the file (after Task 4, `PieChart` is the last function).
7. Keep `useState` (used by `JiraIssuesPopover`). Keep the `WeeklyData` interface (typed data for the charts).

- [ ] **Step 8: Run the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all suites pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/charts/stacked-types-chart.tsx src/components/charts/lines-changed-chart.tsx src/components/charts/commit-type-donut.tsx src/lib/__tests__/unit/stacked-types-chart.test.tsx src/lib/__tests__/unit/lines-changed-chart.test.tsx src/lib/__tests__/unit/commit-type-donut.test.tsx "src/app/report/[id]/org/page.tsx"
git commit -F - <<'EOF'
GLOOK-58: stacked types, diverging lines and donut charts on the org page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: Dev page and team dev-table read `commit-types.ts`

**Files:**
- Modify: `src/app/report/[id]/dev/[login]/page.tsx`
  - Delete `TYPE_COLORS`/`TYPE_TEXT_COLORS` at lines 10-18. `TYPE_TEXT_COLORS` is unused today.
  - Update the three `TYPE_COLORS[...]` uses: the type bar (~line 272), the legend swatch (~line 282) and the commit-row badge (~line 499).
- Modify: `src/app/report/[id]/team/dev-table.tsx`
  - Delete `TYPE_COLORS` at lines 27-35.
  - Update the badge at ~line 322.
- Modify: `src/app/globals.css`
  - The light-mode "Preserve white text on colored backgrounds" rule (~lines 158-175).
  - The print "Keep badges colored" rule (~lines 403-409).
- Modify: `src/lib/__tests__/unit/commit-types.test.ts` (un-skip the page-map test)

**Interfaces:**
- Consumes: `commitTypeBg(t: string): string` from `@/components/charts/commit-types`.
- Produces: nothing new.

**Why the CSS edits are needed.** Two existing rules would otherwise break the badges.
- **Light mode:** `[data-theme-mode="light"] .text-white` turns white text dark (`#111827 !important`) unless the element carries one of the whitelisted background classes (`.bg-blue-500.text-white` and so on). The badges move from `bg-blue-500` to `bg-chart-type-feature`, so without this edit their labels would turn dark on dark-ish fills.
- **Print:** the print block forces `print-color-adjust: exact` only for the old class names.

- [ ] **Step 1: Un-skip the page-map guard and confirm it fails**

In `src/lib/__tests__/unit/commit-types.test.ts`, change `it.skip('no report page keeps its own commit-type colour map'` back to `it('no report page keeps its own commit-type colour map'`.

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/commit-types.test.ts'`

Expected: FAIL. `offenders` lists the dev page and `team/dev-table.tsx`; the org page's maps are already gone after Task 5.

- [ ] **Step 2: Update the dev page**

In `src/app/report/[id]/dev/[login]/page.tsx`:
- Delete lines 10-18 (`const TYPE_COLORS …` and `const TYPE_TEXT_COLORS …`).
- Add the import `import { commitTypeBg } from '@/components/charts/commit-types';` next to the Task 4 imports.
- Make these three replacements:

```tsx
                  className={`${commitTypeBg(type)} h-full`}
```

(was ``className={`${TYPE_COLORS[type] || 'bg-gray-600'} h-full`}``)

```tsx
                <span className={`w-2.5 h-2.5 rounded-sm ${commitTypeBg(type)}`} />
```

(was ``<span className={`w-2.5 h-2.5 rounded-sm ${TYPE_COLORS[type] || 'bg-gray-600'}`} />``)

```tsx
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs text-white ${commitTypeBg(c.type)}`}>
```

(was the same line with `${TYPE_COLORS[c.type] || 'bg-gray-600'}`)

- [ ] **Step 3: Update the team dev-table**

In `src/app/report/[id]/team/dev-table.tsx`:
- Delete lines 27-35 (`const TYPE_COLORS …`).
- Add `import { commitTypeBg } from '@/components/charts/commit-types';` after line 6 (the `url-state` import).
- Replace the badge class line in `TypeBreakdown`:

```tsx
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-white ${commitTypeBg(type)}`}
```

- [ ] **Step 4: Keep badge text white in light mode and badges colored in print**

In `src/app/globals.css`, in the rule headed `/* Preserve white text on colored backgrounds (buttons, badges, etc.) */`, add these selectors before the final `[data-theme-mode="light"] .bg-gray-600.text-white {` line. Each gets a trailing comma, as the existing lines do:

```css
[data-theme-mode="light"] .bg-chart-type-feature.text-white,
[data-theme-mode="light"] .bg-chart-type-bug.text-white,
[data-theme-mode="light"] .bg-chart-type-refactor.text-white,
[data-theme-mode="light"] .bg-chart-type-infra.text-white,
[data-theme-mode="light"] .bg-chart-type-docs.text-white,
[data-theme-mode="light"] .bg-chart-type-test.text-white,
[data-theme-mode="light"] .bg-chart-type-other.text-white,
[data-theme-mode="light"] .bg-chart-type-in-flight.text-white,
```

In the print block's `/* Keep badges colored */` rule, extend the selector list so it reads:

```css
  .bg-blue-500, .bg-blue-600, .bg-blue-700,
  .bg-red-500, .bg-green-500, .bg-purple-500,
  .bg-yellow-500, .bg-gray-500, .bg-gray-600, .bg-gray-700,
  .bg-chart-type-feature, .bg-chart-type-bug, .bg-chart-type-refactor, .bg-chart-type-infra,
  .bg-chart-type-docs, .bg-chart-type-test, .bg-chart-type-other, .bg-chart-type-in-flight {
```

- [ ] **Step 5: Run the guard and the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all suites pass, including the un-skipped `no report page keeps its own commit-type colour map`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/report/[id]/dev/[login]/page.tsx" "src/app/report/[id]/team/dev-table.tsx" src/app/globals.css src/lib/__tests__/unit/commit-types.test.ts
git commit -F - <<'EOF'
GLOOK-58: dev page and team table type badges read the shared commit-type map

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: `TrendChart` rewrite, `assignTeamColors`, and the `colorByTeam` caller

**Files:**
- Create: `src/app/vulnerabilities/team-colors.ts`
- Rewrite: `src/app/vulnerabilities/trend-chart.tsx`
- Modify: `src/app/vulnerabilities/vulnerabilities-content.tsx`
  - Import at line 9.
  - The `TrendChart` render at line 203.
- Rewrite: `src/lib/__tests__/unit/vuln-trend-chart.test.tsx`
- Create: `src/lib/__tests__/unit/vuln-team-colors.test.ts`, `src/lib/__tests__/unit/vuln-content-trend-colors.test.tsx`

**Interfaces:**
- Consumes:
  - `TrendSeries` (`{ team: string; points: Array<{ date: string; open: number }> }`) from `@/lib/vulnerabilities/aggregate`.
  - `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartConfig`.
  - `formatWeek`, `toNum`.
- Produces:
  - `assignTeamColors(series: TrendSeries[]): Record<string, string>`
  - `OTHER_TEAM_COLOR = 'var(--vuln-series-other)'`
  - `TrendChart({ series, colorByTeam }: { series: TrendSeries[]; colorByTeam: Record<string, string> })` (default export, unchanged path)

**Decision 11 semantics.**
- Colors follow the team name, not the team's rank. `assignTeamColors` picks the 12 teams with the most open alerts, measured at each team's latest point, with ties broken by name. It sorts those 12 by name and gives them `var(--vuln-series-1..12)`. The rest get `OTHER_TEAM_COLOR`.
- The caller builds the map from the **unfiltered** `trend.series` and passes it with the (possibly filtered) series. `assignTeamColors` takes the series rather than bare names, because the more-than-12 fallback needs the open counts.
- **Legend:** the swatch is colored and the text uses chrome color (`text-chart-axis`). Today the legend text itself is series-colored, which breaks the spec's text rule.
- **Lines:**
  - Each line uses a function `dataKey`, so a team named `team.alpha` is not read as a nested path (Review Focus 4).
  - `connectNulls` keeps today's behavior: consecutive measurements of one team join even across dates where only other teams have points.
- **Test change.** The old test asserted that colors sit on `style`, not on a presentation attribute. Recharts emits `stroke` as an attribute. The screenshot pass (Task 10) is the check that `var()` resolves in the browser.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/unit/vuln-team-colors.test.ts`:

```ts
import { assignTeamColors, OTHER_TEAM_COLOR } from '@/app/vulnerabilities/team-colors';
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';

const s = (team: string, open: number): TrendSeries => ({ team, points: [{ date: '2026-09-01', open: 1 }, { date: '2026-09-08', open }] });

it('assigns palette slots by sorted team name, not by rank', () => {
  expect(assignTeamColors([s('TeamC', 50), s('TeamA', 1), s('TeamB', 9)])).toEqual({
    TeamA: 'var(--vuln-series-1)',
    TeamB: 'var(--vuln-series-2)',
    TeamC: 'var(--vuln-series-3)',
  });
});

it('a team keeps its colour when the open-count ranking swaps', () => {
  const before = assignTeamColors([s('TeamA', 10), s('TeamB', 2)]);
  const after = assignTeamColors([s('TeamA', 2), s('TeamB', 10)]);
  expect(after).toEqual(before);
});

it('gives every team a distinct colour up to 12 teams', () => {
  const teams = Array.from({ length: 12 }, (_, i) => s(`Team${String(i).padStart(2, '0')}`, i));
  const colors = Object.values(assignTeamColors(teams));
  expect(new Set(colors).size).toBe(12);
});

it('beyond 12 teams: the 12 with the most open alerts (ties by name) get slots, the rest share "other"', () => {
  const teams = [
    ...Array.from({ length: 12 }, (_, i) => s(`Busy${String(i).padStart(2, '0')}`, 100 + i)),
    s('Quiet-b', 1),
    s('Quiet-a', 1),
  ];
  const colors = assignTeamColors(teams);
  expect(colors['Quiet-a']).toBe(OTHER_TEAM_COLOR);
  expect(colors['Quiet-b']).toBe(OTHER_TEAM_COLOR);
  expect(colors.Busy00).toBe('var(--vuln-series-1)');
  expect(colors.Busy11).toBe('var(--vuln-series-12)');
});

it('breaks an open-count tie at the 12-team boundary by name', () => {
  const teams = [...Array.from({ length: 11 }, (_, i) => s(`Busy${String(i).padStart(2, '0')}`, 100)), s('Tie-b', 5), s('Tie-a', 5)];
  const colors = assignTeamColors(teams);
  expect(colors['Tie-a']).not.toBe(OTHER_TEAM_COLOR);
  expect(colors['Tie-b']).toBe(OTHER_TEAM_COLOR);
});

it('returns an empty map for no series and tolerates string counts', () => {
  expect(assignTeamColors([])).toEqual({});
  const colors = assignTeamColors([{ team: 'TeamA', points: [{ date: '2026-09-01', open: '3' as unknown as number }] }]);
  expect(colors.TeamA).toBe('var(--vuln-series-1)');
});
```

Replace the whole of `src/lib/__tests__/unit/vuln-trend-chart.test.tsx` with:

```tsx
/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-trend-chart.test.tsx
// GLOOK-58: TrendChart is a Recharts LineChart. Colours come from the caller's colorByTeam map
// (assignTeamColors over the UNFILTERED series), so a team keeps its colour when the page filter
// narrows the chart. The legend names every team in chrome text beside a coloured swatch.
import React from 'react';
import { render, screen } from '@testing-library/react';
import TrendChart from '@/app/vulnerabilities/trend-chart';
import { assignTeamColors } from '@/app/vulnerabilities/team-colors';
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';
import { fixChartSize } from '../setup/chart-size';

fixChartSize();

const series: TrendSeries[] = [
  { team: 'TeamA', points: [{ date: '2026-09-01', open: 4 }, { date: '2026-09-08', open: 6 }] },
  { team: 'TeamB', points: [{ date: '2026-09-01', open: 9 }, { date: '2026-09-08', open: 7 }] },
  { team: 'team.alpha', points: [{ date: '2026-09-01', open: 2 }, { date: '2026-09-08', open: 3 }] },
];
const colors = assignTeamColors(series);
const strokes = (c: HTMLElement) => Array.from(c.querySelectorAll('path.recharts-line-curve')).map(p => p.getAttribute('stroke'));

it('draws one line per team in its assigned colour, and the colours are distinct', () => {
  const { container } = render(<TrendChart series={series} colorByTeam={colors} />);
  const drawn = strokes(container);
  expect(drawn).toHaveLength(3);
  expect(new Set(drawn).size).toBe(3);
  expect([...drawn].sort()).toEqual(Object.values(colors).sort());
});

it('a team keeps its colour after the page filters the chart down to it', () => {
  const { container } = render(<TrendChart series={series.filter(s => s.team === 'TeamB')} colorByTeam={colors} />);
  expect(strokes(container)).toEqual([colors.TeamB]);
  expect(colors.TeamB).not.toBe('var(--vuln-series-1)');
});

it('draws a line for a team whose name contains a dot (no nested-path lookup)', () => {
  const { container } = render(<TrendChart series={series.filter(s => s.team === 'team.alpha')} colorByTeam={colors} />);
  const path = container.querySelector('path.recharts-line-curve');
  expect(path).not.toBeNull();
  expect(path!.getAttribute('d')).toMatch(/^M[\d.]+,[\d.]+L/);
});

it('the legend names every team in chrome text beside a swatch in the team colour', () => {
  render(<TrendChart series={series} colorByTeam={colors} />);
  for (const s of series) {
    const label = screen.getByText(s.team);
    expect(label.className).toContain('text-chart-axis');
    expect(label.getAttribute('style') ?? '').not.toContain('color');
    const swatch = label.parentElement!.querySelector('i') as HTMLElement;
    expect(swatch.style.background).toBe(colors[s.team]);
  }
});

it('falls back to the "other" grey for a team missing from the map', () => {
  const { container } = render(<TrendChart series={[series[0]]} colorByTeam={{}} />);
  expect(strokes(container)).toEqual(['var(--vuln-series-other)']);
});

it('shows the empty state when there are no measurements', () => {
  render(<TrendChart series={[]} colorByTeam={{}} />);
  expect(screen.getByText('No measurements yet for this view.')).toBeTruthy();
});
```

Create `src/lib/__tests__/unit/vuln-content-trend-colors.test.tsx`:

```tsx
/** @jest-environment jsdom */
// GLOOK-58 Decision 11: VulnerabilitiesContent builds colorByTeam from the UNFILTERED trend
// series and passes it alongside the (possibly team-filtered) series, so a team keeps its colour
// when the page filter narrows the chart. Mocking approach copied from
// vuln-content-resolved-caption.test.tsx (mocks `swr` directly, keyed by request URL).
import React from 'react';
import { render } from '@testing-library/react';

const urlStore: Record<string, unknown> = { codebase: 'backend', baseline: 'last', team: 'TeamB', sev: 'critical' };
jest.mock('@/lib/url-state', () => ({
  __esModule: true,
  useUrlState: (schema: { key: string; default: unknown }) => [
    urlStore[schema.key] ?? schema.default,
    (next: unknown) => { urlStore[schema.key] = next; },
  ],
}));

type SwrEntry = { data?: unknown; error?: unknown; isLoading?: boolean };
let swrData: Record<string, SwrEntry> = {};
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) => {
    if (!key) return { data: undefined, error: undefined, isLoading: false };
    const entry = swrData[Object.keys(swrData).find(k => key.startsWith(k)) ?? ''] ?? {};
    return { data: entry.data, error: entry.error, isLoading: entry.isLoading ?? false };
  },
}));

const trendProps: Array<{ series: Array<{ team: string }>; colorByTeam: Record<string, string> }> = [];
jest.mock('@/app/vulnerabilities/trend-chart', () => ({
  __esModule: true,
  default: (props: { series: Array<{ team: string }>; colorByTeam: Record<string, string> }) => { trendProps.push(props); return null; },
}));
jest.mock('@/app/vulnerabilities/team-pivot', () => ({ __esModule: true, default: () => null }));
jest.mock('@/app/vulnerabilities/coverage-panel', () => ({ __esModule: true, default: () => null }));
jest.mock('@/app/vulnerabilities/policy-panel', () => ({ __esModule: true, default: () => null }));

import VulnerabilitiesContent from '@/app/vulnerabilities/vulnerabilities-content';

const summary = {
  available: true, org: 'acme',
  sync: { stale: false, lastSuccessfulAt: '2026-09-22T06:00:00Z', lastStatus: 'succeeded', issues: [] },
  resolvedCountStartDate: '2020-01-08',
  resolvedCountInvalid: false,
  resolvedSince: { date: '2020-01-08', invalid: false },
  policy: [],
  slaStatus: { critical: 'none', high: 'none' },
  pivot: {
    rows: [],
    total: { team: 'Total', critical: { open: 0, resolved: 0, dismissed: 0, pctClosed: 0, overdue: null, dueSoon: null }, high: { open: 0, resolved: 0, dismissed: 0, pctClosed: 0, overdue: null, dueSoon: null }, unmeasuredRepos: 0 },
  },
  kpi: { openCriticalOtherCodebases: null },
  delta: { critical: { available: false }, high: { available: false } },
  knownTeams: ['TeamA', 'TeamB', 'TeamC'],
};

const series = [
  { team: 'TeamC', points: [{ date: '2026-09-01', open: 50 }] },
  { team: 'TeamA', points: [{ date: '2026-09-01', open: 1 }] },
  { team: 'TeamB', points: [{ date: '2026-09-01', open: 9 }] },
];

it('passes the filtered series with colours computed from every team', () => {
  swrData = {
    '/api/vulnerabilities/summary': { data: summary },
    '/api/vulnerabilities/trend': { data: { series } },
    '/api/vulnerabilities/alerts': { data: { rows: [], totalCount: 0, truncated: false } },
    '/api/vulnerabilities/coverage': { data: { needsTagging: [] } },
  };
  render(<VulnerabilitiesContent />);
  const last = trendProps[trendProps.length - 1];
  expect(last.series.map(s => s.team)).toEqual(['TeamB']);
  expect(last.colorByTeam).toEqual({
    TeamA: 'var(--vuln-series-1)',
    TeamB: 'var(--vuln-series-2)',
    TeamC: 'var(--vuln-series-3)',
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/vuln-team-colors.test.ts src/lib/__tests__/unit/vuln-trend-chart.test.tsx src/lib/__tests__/unit/vuln-content-trend-colors.test.tsx'`

Expected: FAIL. `team-colors` is not found; the trend chart finds no `path.recharts-line-curve`; the caller test sees `colorByTeam` as `undefined`.

- [ ] **Step 3: Implement `assignTeamColors`**

Create `src/app/vulnerabilities/team-colors.ts`:

```ts
// GLOOK-58 Decision 11: trend colours follow the team, not its rank, so a team keeps its colour
// across syncs and when the page filter narrows the chart. Build the map from the UNFILTERED
// series. Assumption (spec): at most 12 teams have alerts; beyond that, the 12 with the most open
// alerts (latest point, ties by name) get slots 1..12 in name order and the rest share "other".
// In that fallback a team entering or leaving the top 12 can shift other teams' slots.
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';
import { toNum } from '@/components/charts/chart-format';

export const OTHER_TEAM_COLOR = 'var(--vuln-series-other)';
const SLOTS = 12;

export function assignTeamColors(series: TrendSeries[]): Record<string, string> {
  const latest = new Map<string, number>();
  for (const s of series) latest.set(s.team, toNum(s.points[s.points.length - 1]?.open));
  const byName = (a: string, b: string) => a.localeCompare(b);
  const chosen = [...latest.keys()]
    .sort((a, b) => (latest.get(b)! - latest.get(a)!) || byName(a, b))
    .slice(0, SLOTS)
    .sort(byName);
  const out: Record<string, string> = {};
  for (const team of latest.keys()) out[team] = OTHER_TEAM_COLOR;
  chosen.forEach((team, i) => { out[team] = `var(--vuln-series-${i + 1})`; });
  return out;
}
```

- [ ] **Step 4: Rewrite `TrendChart`**

Replace the whole of `src/app/vulnerabilities/trend-chart.tsx` with:

```tsx
'use client';

// GLOOK-58: a Recharts LineChart. Colours come from the caller (assignTeamColors over the
// unfiltered series, Decision 11). The chart no longer computes them, because `series` may
// already be filtered. Hovering a line or legend entry fades the others, as before.
import { useState } from 'react';
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts';
import type { TrendSeries } from '@/lib/vulnerabilities/aggregate';
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/charts/chart';
import { formatWeek, toNum } from '@/components/charts/chart-format';
import { OTHER_TEAM_COLOR } from './team-colors';

interface TrendRow {
  date: string;
  values: Record<string, number>;
}

export default function TrendChart({ series, colorByTeam }: { series: TrendSeries[]; colorByTeam: Record<string, string> }) {
  const [hover, setHover] = useState<string | null>(null);
  const dates = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();
  if (dates.length === 0) return <p className="text-xs text-gray-500">No measurements yet for this view.</p>;

  const byDate = new Map<string, TrendRow>(dates.map(d => [d, { date: d, values: {} }]));
  for (const s of series) {
    for (const p of s.points) {
      const row = byDate.get(p.date);
      if (row) row.values[s.team] = toNum(p.open);
    }
  }
  const rows = [...byDate.values()];
  const latest = (s: TrendSeries) => toNum(s.points[s.points.length - 1]?.open);
  const ranked = [...series].sort((a, b) => latest(b) - latest(a) || a.team.localeCompare(b.team));
  const colorOf = (team: string) => colorByTeam[team] ?? OTHER_TEAM_COLOR;
  // Labels only: a colour here would make ChartStyle emit --color-<team name> custom properties,
  // and team names can contain spaces.
  const config: ChartConfig = Object.fromEntries(series.map(s => [s.team, { label: s.team }]));
  const opacity = (team: string) => (hover === null || hover === team ? 1 : 0.15);

  return (
    <div>
      <ChartContainer config={config} className="aspect-auto h-[200px] w-full">
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={formatWeek} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} />
          <ChartTooltip
            itemSorter={item => -toNum(item.value)}
            content={<ChartTooltipContent indicator="line" labelFormatter={label => String(label)} />}
          />
          {ranked.map(s => (
            <Line
              key={s.team}
              type="linear"
              name={s.team}
              dataKey={(row: TrendRow) => row.values[s.team] ?? null}
              stroke={colorOf(s.team)}
              strokeWidth={2}
              strokeOpacity={opacity(s.team)}
              dot={{ r: 2, fill: colorOf(s.team), strokeWidth: 0, fillOpacity: opacity(s.team) }}
              activeDot={{ r: 4 }}
              connectNulls
              isAnimationActive={false}
              onMouseEnter={() => setHover(s.team)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </LineChart>
      </ChartContainer>
      <div className="flex flex-wrap gap-3 text-[11px] mt-1">
        {ranked.map(s => (
          <span key={s.team} className="flex items-center gap-1.5 cursor-default"
            onMouseEnter={() => setHover(s.team)} onMouseLeave={() => setHover(null)}>
            <i aria-hidden="true" className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: colorOf(s.team) }} />
            <span className="text-chart-axis">{s.team}</span>
          </span>
        ))}
      </div>
      <p className="text-[10px] text-gray-500 mt-1">Each dot is one measurement (an imported CSV run or a sync). Lines start at the first measurement for this view.</p>
    </div>
  );
}
```

- [ ] **Step 5: Pass `colorByTeam` from the caller**

In `src/app/vulnerabilities/vulnerabilities-content.tsx`, add this after line 9 (`import TrendChart from './trend-chart';`):

```tsx
import { assignTeamColors } from './team-colors';
```

Replace the `TrendChart` render at line 203:

```tsx
            ? <div className={trendStale ? 'opacity-60' : undefined}><TrendChart series={team ? trend.series.filter((x: any) => x.team === team) : trend.series} colorByTeam={assignTeamColors(trend.series)} /></div>
```

`assignTeamColors(trend.series)` reads the unfiltered array, so the map is built before the team filter is applied to the prop.

- [ ] **Step 6: Run the three tests and the existing vuln suites**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/vuln-team-colors.test.ts src/lib/__tests__/unit/vuln-trend-chart.test.tsx src/lib/__tests__/unit/vuln-content-trend-colors.test.tsx src/lib/__tests__/unit/vuln-trend-colors-css.test.ts src/lib/__tests__/unit/vuln-series-contrast.test.ts'`

Expected: PASS.

**Verification.** If `swatch.style.background` reads `''` in jsdom (cssstyle rejecting `var()` in the `background` shorthand), switch the swatch and the assertion to `backgroundColor`.

- [ ] **Step 7: Run the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all suites pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/vulnerabilities/team-colors.ts src/app/vulnerabilities/trend-chart.tsx src/app/vulnerabilities/vulnerabilities-content.tsx src/lib/__tests__/unit/vuln-team-colors.test.ts src/lib/__tests__/unit/vuln-trend-chart.test.tsx src/lib/__tests__/unit/vuln-content-trend-colors.test.tsx
git commit -F - <<'EOF'
GLOOK-58: Recharts TrendChart with team-stable colours

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: `ProgressRing` rewrite

**Files:**
- Rewrite: `src/app/projects/progress-ring.tsx`. `EpicRingStats`, `ProgressRingProps` and the `ProgressRing` export are unchanged, so `projects-content.tsx:916-920` needs no edit.
- Rewrite: `src/lib/__tests__/unit/progress-ring.test.tsx`

**Interfaces:**
- Consumes: `toNum` from `@/components/charts/chart-format`.
- Produces:
  - `EpicRingStats`, `ProgressRingProps` (unchanged)
  - `ProgressRing(props)` (unchanged signature)
  - new: `ringGeometry(stats: EpicRingStats, maxVolume: number, avgCommitsPerJira: number): { px: number; stroke: number; jiraPct: number; commitPct: number }`

**Behavior (spec Charts → ProgressRing).**
- **Chart:** a fixed-size `RadialBarChart`, `width = height = px`, with no responsive container.
- **Angles:** `startAngle={90}` and `endAngle={-270}`, so each ring starts at the top and fills clockwise. `<PolarAngleAxis type="number" domain={[0, 100]} tick={false} />` fixes the scale to 0-100%.
- **Tracks:** each ring's track is its `background` in `var(--chart-track)`.
- **Geometry:** it keeps the old 48-unit geometry, scaled by `px / 48`.
  - The radial band runs from `13 - stroke/2` to `20 + stroke/2`, with `barSize = stroke`.
  - Recharts places the first data entry innermost, so data is `[commits, jira]`, which puts Jira outside.
  - `ringGeometry` keeps the old `Math.log` size (22-48px), the inverse stroke (`max(3, 8 - sizePct*5)`) and the `maxVolume = 0` guard.
- **Tooltip:** the colored text spans (`text-amber-400`/`text-emerald-400`) become chrome text with a small swatch in the ring token. `text-amber-400` has no light-mode override today, so it would sit at about 2:1 on the light tooltip background.

- [ ] **Step 1: Write the failing test**

Replace the whole of `src/lib/__tests__/unit/progress-ring.test.tsx` with:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';
import { ProgressRing, ringGeometry, type EpicRingStats } from '@/app/projects/progress-ring';

const stats = (over: Partial<EpicRingStats> = {}): EpicRingStats => ({
  epicKey: 'EPIC-1',
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

const MAX_VOLUME = Math.log(31); // an epic with 30 child issues is the page's largest

// Sector paths are "M x,y A r,r,0,largeArc,sweep,x,y ...". The first arc is the outer edge.
const arc = (p: Element) => {
  const m = /A\s*([\d.]+),([\d.]+),0,\s*([01]),/.exec(p.getAttribute('d') ?? '');
  return m ? { r: Number(m[1]), largeArc: m[3] === '1' } : null;
};
const sector = (c: HTMLElement, token: string) =>
  Array.from(c.querySelectorAll('.recharts-radial-bar-sectors path')).find(p => p.getAttribute('fill') === `var(${token})`);

describe('ringGeometry (size and stroke guarantees)', () => {
  it('sizes the largest epic at 48px with a 3px stroke', () => {
    expect(ringGeometry(stats({ totalJiras: 30, resolvedJiras: 30 }), MAX_VOLUME, 0)).toMatchObject({ px: 48, stroke: 3 });
  });
  it('floors a childless epic at 22px with an 8px stroke', () => {
    expect(ringGeometry(stats({ totalJiras: 0 }), MAX_VOLUME, 0)).toMatchObject({ px: 22, stroke: 8 });
  });
  it('does not divide by zero when maxVolume is 0', () => {
    const g = ringGeometry(stats({ totalJiras: 0 }), 0, 0);
    expect(g).toEqual({ px: 22, stroke: 8, jiraPct: 0, commitPct: 0 });
  });
  it('tolerates string counts from the API', () => {
    const g = ringGeometry(stats({ totalJiras: '10' as unknown as number, resolvedJiras: '4' as unknown as number }), MAX_VOLUME, 1);
    expect(g.jiraPct).toBeCloseTo(0.4);
  });
});

describe('ProgressRing render', () => {
  it('renders an SVG at the computed size', () => {
    const { container } = render(<ProgressRing stats={stats({ totalJiras: 30, resolvedJiras: 30 })} maxVolume={MAX_VOLUME} avgCommitsPerJira={0} />);
    expect(container.querySelector('svg.recharts-surface')!.getAttribute('width')).toBe('48');
    const zero = render(<ProgressRing stats={stats({ totalJiras: 0 })} maxVolume={0} avgCommitsPerJira={0} />);
    expect(zero.container.querySelector('svg.recharts-surface')!.getAttribute('width')).toBe('22');
  });

  it('shows the developer count in the centre', () => {
    const { container } = render(<ProgressRing stats={stats({ devCount: 3 })} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />);
    expect(container.querySelector('span.font-bold')?.textContent).toBe('3');
  });

  it('draws Jira on the outer ring and commits on the inner ring, each over a track', () => {
    const s = stats({ totalJiras: 10, resolvedJiras: 4, commitCount: 2 });
    const { container } = render(<ProgressRing stats={s} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />);
    const jira = arc(sector(container, '--chart-ring-jira')!);
    const commits = arc(sector(container, '--chart-ring-commits')!);
    expect(jira!.r).toBeGreaterThan(commits!.r);
    const tracks = Array.from(container.querySelectorAll('.recharts-radial-bar-background-sector'));
    expect(tracks).toHaveLength(2);
    tracks.forEach(t => expect(t.getAttribute('fill')).toBe('var(--chart-track)'));
  });

  it('fixes the angle domain at 0-100, so 40% draws as a minor arc, not a full ring', () => {
    const s = stats({ totalJiras: 10, resolvedJiras: 4, commitCount: 2 }); // Jira 40%, commits 20%
    const { container } = render(<ProgressRing stats={s} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />);
    expect(arc(sector(container, '--chart-ring-jira')!)!.largeArc).toBe(false);
  });

  it('draws 75% as a major arc', () => {
    const s = stats({ totalJiras: 4, resolvedJiras: 3, commitCount: 1 });
    const { container } = render(<ProgressRing stats={s} maxVolume={MAX_VOLUME} avgCommitsPerJira={1} />);
    expect(arc(sector(container, '--chart-ring-jira')!)!.largeArc).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/progress-ring.test.tsx'`

Expected: FAIL, because `ringGeometry` is not exported and there is no `svg.recharts-surface`.

- [ ] **Step 3: Rewrite `ProgressRing`**

Replace the whole of `src/app/projects/progress-ring.tsx` with:

```tsx
'use client';

// GLOOK-58: a fixed-size Recharts RadialBarChart. The angle domain is pinned to 0-100: without it
// RadialBar scales to the largest value in its data, so at 40% Jira / 20% commits the 40% ring
// would draw as a full circle.
import { PolarAngleAxis, RadialBar, RadialBarChart } from 'recharts';
import { toNum } from '@/components/charts/chart-format';

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
}

export interface RingGeometry {
  px: number;
  stroke: number;
  jiraPct: number;
  commitPct: number;
}

export function ringGeometry(stats: EpicRingStats, maxVolume: number, avgCommitsPerJira: number): RingGeometry {
  const commits = toNum(stats.commitCount);
  const total = toNum(stats.totalJiras);
  const resolved = toNum(stats.resolvedJiras);
  const maxV = toNum(maxVolume);
  // Match the maxVolume metric (commits + jiras) so jira-only epics size correctly. Floor of 22px
  // so even a zero-volume epic shows a legible ring.
  const volume = Math.log(commits + total + 1);
  const sizePct = maxV > 0 ? volume / maxV : 0;
  const px = Math.max(22, Math.round(sizePct * 48));
  const jiraPct = total > 0 ? resolved / total : 0;
  const expectedCommits = total * toNum(avgCommitsPerJira);
  const commitPct = expectedCommits > 0 ? Math.min(1, commits / expectedCommits) : 0;
  // Stroke width scales inversely with size for readability.
  const stroke = Math.max(3, 8 - sizePct * 5);
  return { px, stroke, jiraPct, commitPct };
}

export function ProgressRing({ stats, maxVolume, avgCommitsPerJira }: ProgressRingProps) {
  const { px, stroke, jiraPct, commitPct } = ringGeometry(stats, maxVolume, avgCommitsPerJira);
  // The old ring was drawn in a 48-unit viewBox with arcs centred on r=13 (commits) and r=20 (Jira).
  const scale = px / 48;
  // First entry is innermost.
  const data = [
    { ring: 'commits', value: commitPct * 100, fill: 'var(--chart-ring-commits)' },
    { ring: 'jira', value: jiraPct * 100, fill: 'var(--chart-ring-jira)' },
  ];

  const jiraPctDisplay = Math.round(jiraPct * 100);
  const commitPctDisplay = Math.round(commitPct * 100);
  const totalLines = toNum(stats.linesAdded) + toNum(stats.linesRemoved);
  const devCount = toNum(stats.devCount);
  const linesPerDev = devCount > 0 ? totalLines / devCount : 0;
  const isAiSpeed = linesPerDev >= 20000;

  return (
    <div className="relative group" style={{ width: px, height: px }}>
      <RadialBarChart
        width={px}
        height={px}
        data={data}
        innerRadius={(13 - stroke / 2) * scale}
        outerRadius={(20 + stroke / 2) * scale}
        barSize={stroke * scale}
        startAngle={90}
        endAngle={-270}
        margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
        <RadialBar dataKey="value" background={{ fill: 'var(--chart-track)' }} isAnimationActive={false} />
      </RadialBarChart>
      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-bold text-gray-200 pointer-events-none"
        style={{ fontSize: Math.max(7, Math.round(px * 0.28)) }}>
        {devCount}
      </span>
      {isAiSpeed && (
        <span className="absolute -top-1 -left-1 text-[10px] leading-none" title="AI speed">⚡</span>
      )}
      {/* Tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20
        bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-xs text-gray-300 whitespace-nowrap shadow-lg">
        <i aria-hidden="true" className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ background: 'var(--chart-ring-jira)' }} />
        Jira: <span className="text-gray-200 font-semibold">{toNum(stats.resolvedJiras)}/{toNum(stats.totalJiras)}</span> closed ({jiraPctDisplay}%)
        {' · '}
        <i aria-hidden="true" className="inline-block w-2 h-2 rounded-sm mr-1 align-middle" style={{ background: 'var(--chart-ring-commits)' }} />
        Commits: <span className="text-gray-200 font-semibold">{toNum(stats.commitCount)}</span> ({commitPctDisplay}% of expected)
        {' · '}<span className="text-gray-200 font-semibold">{devCount}</span> dev{devCount !== 1 ? 's' : ''}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-700" />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/progress-ring.test.tsx'`

Expected: PASS.

**Verification (behavior read from source, not yet observed).**
- **Ring order.** The test expects the first data entry to be innermost. If "Jira outer" fails with Jira's radius smaller, swap the two `data` entries and keep the test as written.
- **Arc parsing.** The `arc()` regex assumes Recharts' sector path format `M x,y A r,r,0,large,sweep,x,y` (`es6/shape/Sector.js:54`). If it returns `null`, log one sector's `d` and adjust the regex, not the assertion.
- **Sector class.** If `.recharts-radial-bar-sectors path` finds nothing, the data sectors may carry the `recharts-radial-bar-sector` class on a wrapping `<g>`. Query `.recharts-radial-bar-sector path` instead.

- [ ] **Step 5: Run the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all suites pass.

- [ ] **Step 6: Commit**

```bash
git add src/app/projects/progress-ring.tsx src/lib/__tests__/unit/progress-ring.test.tsx
git commit -F - <<'EOF'
GLOOK-58: ProgressRing as a Recharts RadialBarChart with a fixed 0-100 domain

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: Non-chart bars move to tokens (colors only)

**Files:**
- Modify: `src/components/ProjectsCard.tsx`
  - `SEGMENT_COLORS` at lines 6-10.
  - The legend swatches at lines 196-204.
  - The volume-bar track at line 252 and the segments at lines 257-259.
  - The "Other" row track at line 426 and its segments at lines 431-433.
- Modify: `src/app/reports/page.tsx`. The sync progress track at line 466.
- Modify: `src/app/reports/vulnerability-syncs-tab.tsx`. The progress track at line 132.
- Test: `src/lib/__tests__/unit/projects-card-volume.test.tsx`

**Interfaces:**
- Consumes: `--chart-volume-prs`, `--chart-volume-jiras`, `--chart-volume-commits` and `--chart-track` from Task 1; the Tailwind class `bg-chart-track`.
- Produces: nothing new.

**Scope (spec Non-goals).** These stay `<div>`s. Only their colors move.
- **`ProjectsCard`.** Its segments and swatches use `var(--chart-volume-*)`, its tracks use `var(--chart-track)`, and each segment uses `backgroundColor`, not the `background` shorthand. Today's white-alpha `commits` segment and track are invisible on a light card.
- **The two sync progress bars.** Only their `bg-gray-800` tracks become `bg-chart-track`. Their fills (`bg-indigo-500`, `bg-red-500`, `bg-orange-500`) encode run status, and the spec defines no status tokens, so they stay. See the spec gaps in the plan's hand-off report.
- **Out of scope.** The row container styles at line 406 (`rgba(255,255,255,0.01)` background and `0.06` border) are card chrome, not the bar, and stay as they are.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/projects-card-volume.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';
import ProjectsCard from '@/components/ProjectsCard';

const project = { name: 'Alpha', summary: '', developers: [], jira_count: 2, estimated_commits: 3, estimated_prs: 1 };

it('draws the volume bar from chart tokens that exist in both theme modes', () => {
  const { container } = render(<ProjectsCard projects={[project]} />);
  const bar = container.querySelector('[role="img"][aria-label^="Volume:"]') as HTMLElement;
  expect(bar.style.backgroundColor).toBe('var(--chart-track)');
  const segments = Array.from(bar.querySelectorAll(':scope > div > div')) as HTMLElement[];
  expect(segments.map(s => s.style.backgroundColor)).toEqual([
    'var(--chart-volume-prs)', 'var(--chart-volume-jiras)', 'var(--chart-volume-commits)',
  ]);
});

it('legend swatches use the same tokens as the segments', () => {
  const { container } = render(<ProjectsCard projects={[project]} />);
  const swatches = Array.from(container.querySelectorAll('span[aria-hidden="true"].rounded-\\[2px\\]')) as HTMLElement[];
  expect(swatches.map(s => s.style.backgroundColor)).toEqual([
    'var(--chart-volume-prs)', 'var(--chart-volume-jiras)', 'var(--chart-volume-commits)',
  ]);
});
```

If `ProjectsCard` with only `projects` renders its collapsed header instead of the body, pass `expanded` as well: `render(<ProjectsCard projects={[project]} expanded />)`. Read `ProjectsCardProps` (lines 62-86) before running.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/projects-card-volume.test.tsx'`

Expected: FAIL. The track reads `''` because it uses the `background` shorthand with an `rgba` value, and the segments read hex, `rgba` or `''`.

- [ ] **Step 3: Update `ProjectsCard`**

Replace lines 5-10:

```tsx
// Segment colors used in both the legend swatches and the bar segments. GLOOK-58: chart tokens,
// so the bar reads in light mode too (the old white-alpha commits segment was invisible there).
const SEGMENT_COLORS = {
  prs:     'var(--chart-volume-prs)',
  jiras:   'var(--chart-volume-jiras)',
  commits: 'var(--chart-volume-commits)',
} as const;
const TRACK_COLOR = 'var(--chart-track)';
```

In the legend (lines 196-204), change each swatch's `style={{ background: … }}` to `style={{ backgroundColor: … }}`. The commits swatch becomes `style={{ backgroundColor: SEGMENT_COLORS.commits }}`, replacing `'rgba(255,255,255,0.18)'`.

In the project-row bar (line 252) and the "Other" bar (line 426), change `style={{ background: 'rgba(255,255,255,0.05)' }}` to `style={{ backgroundColor: TRACK_COLOR }}`.

In both bars' segments (lines 257-259 and 431-433), change `background:` to `backgroundColor:`, for example:

```tsx
                      <div style={{ flex: p.estimated_prs, backgroundColor: SEGMENT_COLORS.prs }} />
                      <div style={{ flex: p.jira_count, backgroundColor: SEGMENT_COLORS.jiras }} />
                      <div style={{ flex: p.estimated_commits, backgroundColor: SEGMENT_COLORS.commits }} />
```

- [ ] **Step 4: Update the two sync progress tracks**

In `src/app/reports/page.tsx` line 466, and in `src/app/reports/vulnerability-syncs-tab.tsx` line 132, change:

```tsx
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
```

to:

```tsx
                  <div className="h-1.5 bg-chart-track rounded-full overflow-hidden">
```

Keep each file's existing indentation.

- [ ] **Step 5: Run the test, the tokens guard, and the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all suites pass. `chart-tokens-css.test.ts` confirms every `var(--chart-volume-*)` in `ProjectsCard.tsx` is defined. `vuln-syncs-tab*.test.tsx` still pass; neither asserts on the track class.

**Verification.** If `style.backgroundColor` reads `''` for a `var()` value in jsdom (cssstyle 4.6), assert on `getAttribute('style')` containing `background-color: var(--chart-…)` instead.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProjectsCard.tsx src/app/reports/page.tsx src/app/reports/vulnerability-syncs-tab.tsx src/lib/__tests__/unit/projects-card-volume.test.tsx
git commit -F - <<'EOF'
GLOOK-58: volume and progress bars read chart tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: Literal-color guard, full verification, build, screenshot pass

**Files:**
- Create: `src/lib/__tests__/unit/chart-no-literal-colors.test.ts` (spec guard test 1)

**Interfaces:**
- Consumes: every chart module from Tasks 2-8.
- Produces: nothing.

- [ ] **Step 1: Write guard test 1**

Create `src/lib/__tests__/unit/chart-no-literal-colors.test.ts`:

```ts
// src/lib/__tests__/unit/chart-no-literal-colors.test.ts
// GLOOK-58 guard test 1 (Decision 5): chart modules contain no hex colour and no fill-gray-*/
// stroke-gray-* class. Every colour comes from a CSS variable defined for both theme modes.
// Static scan in the style of logger-enforcement.test.ts.
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '../../../..');
const CHART_DIR = path.join(root, 'src/components/charts');
const EXTRA = [
  'src/app/vulnerabilities/trend-chart.tsx',
  'src/app/vulnerabilities/team-colors.ts',
  'src/app/projects/progress-ring.tsx',
];

// The ported shadcn wrapper restyles the default colours Recharts emits by attribute selector,
// e.g. [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-chart-grid. Those match a colour;
// they never set one. They are stripped before scanning.
const ATTRIBUTE_SELECTOR = /\[(?:stroke|fill)='#[0-9a-fA-F]{3,8}'\]/g;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const GRAY_CLASS = /\b(?:fill|stroke)-gray-\d{2,3}\b/g;

function findLiteralColors(source: string): string[] {
  const s = source.replace(ATTRIBUTE_SELECTOR, '');
  return [...(s.match(HEX) ?? []), ...(s.match(GRAY_CLASS) ?? [])];
}

function chartFiles(): string[] {
  const files = fs.readdirSync(CHART_DIR).filter(f => /\.tsx?$/.test(f)).map(f => path.join(CHART_DIR, f));
  return [...files, ...EXTRA.map(f => path.join(root, f))];
}

describe('findLiteralColors (the scanner itself)', () => {
  it('flags a bare hex fill', () => {
    expect(findLiteralColors('<rect fill="#123456" />')).toEqual(['#123456']);
  });
  it('flags gray fill and stroke classes', () => {
    expect(findLiteralColors('className="fill-gray-600 stroke-gray-800"')).toEqual(['fill-gray-600', 'stroke-gray-800']);
  });
  it("ignores Recharts default-colour attribute selectors like [stroke='#ccc']", () => {
    expect(findLiteralColors("[&_.recharts-dot[stroke='#fff']]:stroke-transparent")).toEqual([]);
  });
  it('still flags a hex next to an attribute selector', () => {
    expect(findLiteralColors("[stroke='#ccc'] color: #abcdef")).toEqual(['#abcdef']);
  });
  it('ignores url(#hatch-…) pattern references', () => {
    expect(findLiteralColors('fill="url(#hatch-r1)"')).toEqual([]);
  });
});

it('scans every chart module', () => {
  const names = chartFiles().map(f => path.relative(root, f)).sort();
  expect(names).toEqual([
    'src/app/projects/progress-ring.tsx',
    'src/app/vulnerabilities/team-colors.ts',
    'src/app/vulnerabilities/trend-chart.tsx',
    'src/components/charts/chart-format.ts',
    'src/components/charts/chart.tsx',
    'src/components/charts/commit-type-donut.tsx',
    'src/components/charts/commit-types.ts',
    'src/components/charts/hatch.tsx',
    'src/components/charts/lines-changed-chart.tsx',
    'src/components/charts/stacked-types-chart.tsx',
    'src/components/charts/timeline-chart.tsx',
  ]);
});

it('no chart module contains a literal colour', () => {
  const offenders = chartFiles().flatMap(f =>
    findLiteralColors(fs.readFileSync(f, 'utf8')).map(c => `${path.relative(root, f)}: ${c}`),
  );
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run the guard**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/chart-no-literal-colors.test.ts'`

Expected: PASS. If it flags something, fix the chart module: replace the literal with a token, or reword a comment that contains `#` followed by hex digits. Do not add an exemption to the guard.

- [ ] **Step 3: Full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: 0 failed. Suites are the 169 baseline plus the new ones:
- `chart-tokens-css`
- `chart-contrast`
- `cn`
- `chart-wrapper`
- `chart-format`
- `commit-types`
- `chart-hatch`
- `timeline-chart`
- `stacked-types-chart`
- `lines-changed-chart`
- `commit-type-donut`
- `vuln-team-colors`
- `vuln-content-trend-colors`
- `projects-card-volume`
- `chart-no-literal-colors`

That is 15 new suites, 184 in total. `vuln-trend-chart` and `progress-ring` were rewritten in place, so they add none. Record the actual suite and test counts in the commit body.

- [ ] **Step 4: Type-check and build**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run build'`

Expected: the build succeeds. A failure mentioning a `page.tsx` export means a helper leaked into a page file. Move it to `src/components/charts/`.

- [ ] **Step 5: Clear the build cache before running dev** (CLAUDE.md: `next build` artifacts conflict with `next dev`)

Run: `rm -rf /Users/maes/Documents/1macmount/code/glooker/.claude/worktrees/GLOOK-58-recharts/.next`

- [ ] **Step 6: Seed and start the mock-mode app**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run seed:reset'`

Then start the server in the background (Bash `run_in_background: true`):

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run dev:mock'`

Wait until `http://localhost:3000/api/health` returns `{"status":"ok",…}`. Check it with `curl -s http://localhost:3000/api/health`.

- [ ] **Step 7: Screenshot pass**

Open `http://localhost:3000/reports` and take the newest completed report's id. Screenshot these four pages in **Amber Glow** (dark) and again in **Daylight Blue** (light). Switch themes with the app's theme picker, or run `localStorage.setItem('glooker-theme', 'daylight-blue')` in the page console and reload.
- `/report/<id>/org`
- `/report/<id>/dev/<login>`. Pick a developer from the org report's team table.
- `/vulnerabilities`
- `/projects`

Check each screenshot against this list, and record pass or fail per item and page:

1. **Colors resolve.**
   - No chart mark is black. A black bar or line means a `var()` in a presentation attribute did not resolve.
   - No chart internal stays dark inside a light card: grid, axis text, tooltip, ring tracks.
2. **Legibility and layout.**
   - Axis labels don't collide or clip.
   - Y-axis numbers are readable.
   - Tooltips don't overflow their card. Hover at least one bar per chart and the donut.
3. **The hatch is legible on narrow bars.**
   - On the org Commits / Week timeline and on Lines Changed at the default card width, the in-flight segments show visible diagonal stripes.
   - Resize to about 390px wide and check again.
4. **The diverging chart.**
   - Removed lines sit below a visible zero line.
   - Rounded corners face away from zero on both sides. If the removed side's corners face zero, swap `BOTTOM` to `[4, 4, 0, 0]` in `lines-changed-chart.tsx`, re-run its test, and re-check.
5. **Hover sync.** Hovering one org timeline moves the cursor on every chart in the grid. Do the same check on the dev page.
6. **The donut.**
   - Every legend row shows count and %.
   - Hovering a slice and hovering a legend row both update the center and dim the other slices.
   - The in_flight wedge and its swatch are hatched.
7. **TrendChart.**
   - Team colors match between lines and legend swatches.
   - Filtering to one team keeps that team's color.
   - Hovering fades the other lines.
8. **ProgressRing.** Rings start at the top and fill clockwise, Jira is outside, tracks are visible in light mode, and the smallest (22px) ring is still legible.
9. **ProjectsCard volume bar** (team report page, `/report/<id>/team/<team>`). The commits segment and the track are visible in light mode.

Fix any failure in the owning chart module, re-run that module's test and the full suite, and re-shoot the affected page. Stop the dev server when done.

- [ ] **Step 8: Commit**

```bash
git add src/lib/__tests__/unit/chart-no-literal-colors.test.ts
git commit -F - <<'EOF'
GLOOK-58: guard against literal colours in chart modules

Full suite: <N> suites / <M> tests green. Build green. Screenshot pass (Amber Glow,
Daylight Blue; org, dev, vulnerabilities, projects) checked against the spec list.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Replace `<N>` and `<M>` with the counts from Step 3 before committing. If Step 7 needed fixes, commit them before this step, with their own `GLOOK-58: ` messages, listing each file explicitly.
