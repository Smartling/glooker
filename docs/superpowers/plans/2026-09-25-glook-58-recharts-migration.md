# GLOOK-58 Recharts v3 Chart Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every hand-rolled SVG chart with a Recharts v3 component that lives outside `page.tsx`, takes every color from a theme-aware CSS token, and has behavioral tests. This includes the Spend vs Impact scatter.

**Architecture:**
- **Wrapper:** a ported shadcn `chart.tsx` sits on Recharts 3.10.
- **Helpers under it:** pure functions in `chart-format.ts` and `commit-types.ts`, and a hatch-pattern hook in `hatch.tsx`.
- **Charts on top:** six components in `src/components/charts/`. `TrendChart` and `ProgressRing` are rewritten in place.
- **Tokens:** every color is a `--chart-*` CSS variable, defined for dark under `:root` and for light under `[data-theme-mode="light"]`. Commit-type badges carry text, so they get their own badge tokens rather than reusing the mark colors.
- **Week keys:** the server's `weekKeyForDate` is fixed to use UTC. The client's week helpers use UTC too, so week keys match exactly with no client-side repair.
- **Guards:** three tests stop literal colors, missing tokens and contrast regressions from coming back.

**Tech Stack:** Next.js 15 App Router, React 19.2, TypeScript, Tailwind CSS 3.4, Recharts 3.10.1, clsx 2, tailwind-merge 2.6, react-is 19, Jest 30 + ts-jest + jsdom 26, @testing-library/react 16.

**Spec:** `docs/superpowers/specs/2026-09-25-glook-58-recharts-migration-design.md`, as amended at commit `033fe01`. Read it fully before Task 1. The plan argues from the spec, and where the two disagree the plan says so and why.

## Global Constraints

- **Run every node command through Node 24.** The machine's default Node 26 breaks `better-sqlite3`. Always use this form from the worktree root, with one plain command inside the quotes: no `$VARS`, no `&&`, no pipes. The harness refuses compound payloads.
  `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c '<one command>'`
- **Worktree:** `/Users/maes/Documents/1macmount/code/glooker/.claude/worktrees/GLOOK-58-recharts`. Work only here. Git works normally in this worktree. Use `git add <explicit paths>`, never `git add -A` or `git add .`.
- **Test baseline:** 169 suites / 1669 tests green. Run a single file with `npx jest <path>` and the full suite with `npx jest --maxWorkers=3`.
- **Commit messages** start with `GLOOK-58: ` and end with a blank line followed by `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Write each message with a heredoc: `git commit -F - <<'EOF' ... EOF`.
- **Dependency versions (spec Decision 2):** `recharts@^3.10`, `clsx@^2.1`, `tailwind-merge@^2.6` and `react-is@^19.2`. Do **not** use tailwind-merge 3.x, which supports Tailwind v4 only.
- **`src/app/**/page.tsx` may export only `default`.** An extra export passes `npm test` and `tsc`, and fails only at `npm run build`. Charts and their helpers live in `src/components/charts/`.
- **Tests live flat in `src/lib/__tests__/unit/`**, because Jest's `roots` is `src/lib`. Component tests start with `/** @jest-environment jsdom */` on line 1. `@testing-library/jest-dom` is **not** installed, so use plain Jest matchers.
- **Tests check behavior a user sees:** rendered values, fills, marker shapes, ARIA, legend and tooltip text, and counts of marks. They never assert tick counts, tick positions or label placement, because jsdom has no SVG text layout.
- **Numeric inputs pass through `toNum()`** from `chart-format.ts`, because `DECIMAL`/`REAL` columns can arrive as strings. Charts never throw, and `NaN` renders as 0.
- **No literal colors in chart modules** (spec Decision 5): no hex color and no `fill-gray-*` or `stroke-gray-*` class.
  - This covers `src/components/charts/*`, `src/app/vulnerabilities/trend-chart.tsx`, `src/app/vulnerabilities/team-colors.ts` and `src/app/projects/progress-ring.tsx`.
  - It includes comments. Don't write `#` followed by three or more hex digits in those files, for example an issue reference like `#6806`. The guard in Task 11 reads it as a color.
- **Every `--chart-*` token value is a 6-digit hex** (`#rrggbb`) in both blocks. The contrast guard only parses that form.
- **Text in charts uses chrome tokens** (`text-chart-axis`, `text-chart-tooltip-text`, `fill-chart-axis`), never a series color. Badge text uses the badge text tokens.
- **Every Recharts series sets `isAnimationActive={false}`.** There are two reasons:
  1. `window.print()` from the org page's Download PDF button would capture bars mid-animation.
  2. jsdom has no `matchMedia`, so Recharts' `'auto'` animation stays on in tests. A bar's first frame has zero height, and a zero-height `Rectangle` renders nothing.
- **Weeks are UTC calendar weeks everywhere.** The server keys them with `weekKeyForDate`, which is fixed in Task 3. The client builds them with `buildWeekDomain`. Neither side reads the local time zone.
- **The repo is public OSS.** No company-internal names (teams, repos, people, org structure) in code, tests, fixtures, docs or commit messages. Use generic names such as `acme`, `TeamA` and `team.alpha`.
- **Find edits by the quoted code, not by line number.** Line numbers are as of commit `033fe01`; the source is unchanged since `acad605`. An earlier step in the same task, such as an added import, shifts them.
- **Do not touch unrelated code.** Each task lists its files. If a change seems to need a file that isn't listed, stop and ask. The one standing exception is Task 11's screenshot pass. It may make a colors-only fix to an inline bar or badge that is broken in light mode (spec Decision 1).

## Review Focus

1. **A report older than 90 days.** The week domain is anchored to *today*, as the old charts' cutoff was, so a report viewed long after it ran has no weeks in range. A reasonable person expects a message, not a blank card or a crash. Every chart must render its explicit empty state, and the page must not throw. Today the org charts silently disappear (`filtered.length < 2 → null`). Tests:
   - Task 4: the timeline shows "No data in the last 90 days" when data is present but entirely outside the domain.
   - Task 5: the stacked chart and the lines chart each show their empty state in the same case.
2. **Numbers that arrive as strings.** A `"12.50"` or `""` from a DECIMAL column must render as 12.5 or 0, never as `NaN` or as a concatenated string. Tests:
   - Task 3 covers `toNum`.
   - Task 4 checks that a string-valued ratio renders its header value.
   - Task 6 checks that string cost and impact values place a scatter dot.
3. **All-zero and zero-total inputs.** Each case below must show its explicit empty state, never an empty frame or `NaN%`. ProgressRing is the spec's exception: its all-zero state draws both tracks and no arc, with no `NaN`.
   - A donut total of 0 or `"0"`.
   - A lines chart whose weeks are all zero.
   - A timeline with no data.
   - A scatter with no spend.

   Pinned in Tasks 4, 5, 6 and 9.
4. **A team name containing `.`.** Recharts resolves a string `dataKey` as a lodash-style path, so a team named `team.alpha` would be read as `row.team.alpha` and draw nothing. `TrendChart` uses a function `dataKey` to avoid this. Pinned in Task 8.
5. **In-flight larger than the week's total.** If the overlay claims more in-flight commits than the week has, shipped would go negative and the stack would draw below zero. The timeline clamps in-flight to `[0, total]`. Pinned in Task 4.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/app/globals.css` | `--chart-*` tokens for both modes (marks, chrome, scatter, volume, badges); print rule for the new classes | 1, 7 |
| `tailwind.config.ts` | The `chart.*` color namespace | 1 |
| `src/lib/cn.ts` | The `cn()` class merger | 2 |
| `src/lib/__tests__/setup/resize-observer.ts` | jsdom-only `ResizeObserver` stub (`setupFiles`) | 2 |
| `src/lib/__tests__/setup/chart-size.ts` | The `fixChartSize()` test helper | 2 |
| `jest.config.ts` | The `setupFiles` entry, and ESM recovery if needed | 2 |
| `src/components/charts/chart.tsx` | The ported shadcn wrapper | 2 |
| `src/lib/report/timeline.ts` | `weekKeyForDate` switches to UTC | 3 |
| `src/components/charts/chart-format.ts` | `toNum`, the UTC week domain, `indexByWeek`, `fillWeeks`, the formatters, `isTopOfStack` | 3 |
| `src/components/charts/commit-types.ts` | Type order, mark color and background maps, `commitTypeBadge`, `foldTypes`, `typeEntriesFrom` | 3 |
| `src/components/charts/hatch.tsx` | `useHatch()` and `HatchSwatch` | 3 |
| `src/components/charts/timeline-chart.tsx` | `TimelineChart` and `TimelineTooltip` | 4 |
| `src/components/charts/stacked-types-chart.tsx` | `StackedTypesChart` and `StackedTypesTooltip` | 5 |
| `src/components/charts/lines-changed-chart.tsx` | `LinesChangedChart` and `LinesTooltip` | 5 |
| `src/components/charts/commit-type-donut.tsx` | `CommitTypeDonut` | 5 |
| `src/components/charts/spend-impact-scatter.tsx` | `SpendImpactScatter` and `SpendImpactTooltip` | 6 |
| `src/app/report/[id]/org/page.tsx` | Wiring only | 4, 5 |
| `src/app/report/[id]/org/spend-tab.tsx` | The scatter wiring | 6 |
| `src/app/report/[id]/dev/[login]/page.tsx` | Wiring, the Commit Types bar and badges | 4, 7 |
| `src/app/report/[id]/team/dev-table.tsx` | Badges read `commitTypeBadge`; types are folded | 7 |
| `src/app/vulnerabilities/team-colors.ts` | `assignTeamColors` and `OTHER_TEAM_COLOR` | 8 |
| `src/app/vulnerabilities/trend-chart.tsx` | The rewritten `TrendChart` | 8 |
| `src/app/vulnerabilities/vulnerabilities-content.tsx` | Passes `colorByTeam` | 8 |
| `src/app/projects/progress-ring.tsx` | The rewritten `ProgressRing` and `ringGeometry` | 9 |
| `src/components/ProjectsCard.tsx`, `src/app/reports/page.tsx`, `src/app/reports/vulnerability-syncs-tab.tsx` | Colors only | 10 |

**One deliberate addition to the spec's interfaces:** every page-grid chart takes a `weeks: string[]` prop. The page computes it once, with `recentWeekDomain(new Date())`. Decision 10 says every chart on a page shares the same week array, because `syncId` matches charts by index. Computing the domain once per render guarantees that, even across midnight.

---

### Task 1: Palette and tokens (gate)

Every later task depends on this one. Its values are produced here, not in the plan. The plan gives the starting hexes, the exact commands and the acceptance criteria.

**Files:**
- Modify: `src/app/globals.css`, in two places:
  - the `:root` block (lines 6-32)
  - the bare `[data-theme-mode="light"]` block (lines 62-89)
- Modify: `tailwind.config.ts`
- Modify: `docs/superpowers/specs/2026-09-25-glook-58-recharts-migration-design.md`, the `### Palette` section only
- Create: `src/lib/__tests__/unit/chart-tokens-css.test.ts` (spec guard test 2)
- Create: `src/lib/__tests__/unit/chart-contrast.test.ts` (spec guard test 3)

**Interfaces:**
- Consumes: `THEMES` from `src/app/themes.ts`.
- Produces CSS custom properties, defined in both blocks:
  - **Chrome:** `--chart-grid`, `--chart-axis`, `--chart-cursor`, `--chart-tooltip-bg`, `--chart-tooltip-border`, `--chart-tooltip-text`, `--chart-track`, `--chart-surface`.
  - **Commit-type marks:** `--chart-type-feature`, `--chart-type-bug`, `--chart-type-refactor`, `--chart-type-infra`, `--chart-type-docs`, `--chart-type-test`, `--chart-type-other`, `--chart-type-in-flight`.
  - **Lines:** `--chart-lines-added`, `--chart-lines-removed`.
  - **Ring:** `--chart-ring-jira`, `--chart-ring-commits`.
  - **Scatter:** `--chart-scatter-typical`, `--chart-scatter-outlier`.
  - **Volume bar:** `--chart-volume-prs`, `--chart-volume-jiras`, `--chart-volume-commits`.
  - **Badges:** `--chart-badge-<t>-bg` and `--chart-badge-<t>-text` for each `<t>` in `feature, bug, refactor, infra, docs, test, other, in-flight`.
- Produces Tailwind classes:
  - **Chrome:** the `bg-`, `text-`, `fill-`, `stroke-` and `border-` prefixes for `chart-grid`, `chart-axis`, `chart-cursor`, `chart-tooltip-bg`, `chart-tooltip-border`, `chart-tooltip-text`, `chart-track` and `chart-surface`.
  - **Mark backgrounds:** `bg-chart-type-feature` … `bg-chart-type-in-flight`.
  - **Badges:** `bg-chart-badge-<t>-bg` and `text-chart-badge-<t>-text`.

**What the contrast gate checks, per the amended Decision 14:**

| Check | Threshold | Against |
|---|---|---|
| Fixed mark palettes: types, lines, ring, scatter, and volume `prs`/`jiras` | 3:1 | the card surface |
| Ring colors | 3:1 | `--chart-track` |
| All ten theme accents | 3:1 | their own mode's surface |
| `--chart-axis` | 4.5:1 | the card surface |
| `--chart-tooltip-text` | 4.5:1 | `--chart-tooltip-bg` |
| Badge text, all 8 types, both modes | 4.5:1 | its badge fill |

Four things sit outside the numeric thresholds:
- **Grid and tooltip border are exempt.** They are decorative, so the grid can stay recessive.
- **Volume `commits` is exempt.** It is a de-emphasized remainder.
- **Scatter vs bug red.** Neither scatter color may equal `--chart-type-bug` in either mode. This is an identity check, not a contrast check.
- **Colorblind separation** is checked by the dataviz validator in Step 4 and recorded in the spec, not in Jest.

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

const TYPES = ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other', 'in-flight'];
const REQUIRED = [
  'chart-grid', 'chart-axis', 'chart-cursor', 'chart-tooltip-bg', 'chart-tooltip-border',
  'chart-tooltip-text', 'chart-track', 'chart-surface',
  ...TYPES.map(t => `chart-type-${t}`),
  'chart-lines-added', 'chart-lines-removed',
  'chart-ring-jira', 'chart-ring-commits',
  'chart-scatter-typical', 'chart-scatter-outlier',
  'chart-volume-prs', 'chart-volume-jiras', 'chart-volume-commits',
  ...TYPES.flatMap(t => [`chart-badge-${t}-bg`, `chart-badge-${t}-text`]),
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
  const files = REFERENCING_FILES.map(f => path.join(root, f));
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
//   - Fixed mark palettes (commit types, lines, ring, scatter, volume prs/jiras) >= 3:1 against
//     the card surface.
//   - Ring colours >= 3:1 against --chart-track, the surface they are drawn over.
//   - All ten theme accents >= 3:1 against their own mode's card surface (single-metric timelines
//     are drawn in var(--accent)).
//   - --chart-axis >= 4.5:1 against the card; --chart-tooltip-text >= 4.5:1 against --chart-tooltip-bg.
//   - Commit-type badge text >= 4.5:1 against its own badge fill, all 8 types.
// --chart-grid and --chart-tooltip-border are exempt (decorative; Decision 14), so the grid can
// stay recessive. Colour-blind separation is checked by the dataviz validator and recorded in the
// spec's Palette section.
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

const TYPES = ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other', 'in-flight'];
const FIXED = [
  ...TYPES.map(t => `chart-type-${t}`),
  'chart-lines-added', 'chart-lines-removed',
  'chart-ring-jira', 'chart-ring-commits',
  'chart-scatter-typical', 'chart-scatter-outlier',
  'chart-volume-prs', 'chart-volume-jiras',
];

type Pair = [label: string, a: string, b: string, min: number];
function check(pairs: Pair[]): string[] {
  return pairs
    .filter(([, a, b, min]) => contrast(a, b) < min)
    .map(([label, a, b, min]) => `${label}: ${a} vs ${b} = ${contrast(a, b).toFixed(2)} (< ${min})`);
}

describe.each(['dark', 'light'] as const)('%s mode chart contrast', mode => {
  const v = modes[mode];

  it('--chart-surface is the card colour charts sit on (dark bg-gray-900 #111827, light card #ffffff)', () => {
    expect(v['chart-surface']).toBe(mode === 'dark' ? '#111827' : '#ffffff');
  });

  it('fixed mark palettes clear 3:1 against the card surface', () => {
    expect(check(FIXED.map(t => [`--${t}`, v[t], v['chart-surface'], 3] as Pair))).toEqual([]);
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
    expect(check(accents.map(t => [`${t.id} accent`, t.accent.toLowerCase(), v['chart-surface'], 3] as Pair))).toEqual([]);
  });

  it('chrome text clears 4.5:1 against its own background', () => {
    expect(check([
      ['--chart-axis vs surface', v['chart-axis'], v['chart-surface'], 4.5],
      ['--chart-tooltip-text vs tooltip-bg', v['chart-tooltip-text'], v['chart-tooltip-bg'], 4.5],
    ])).toEqual([]);
  });

  it('every commit-type badge has text at 4.5:1 against its own fill', () => {
    expect(check(TYPES.map(t => [`badge ${t}`, v[`chart-badge-${t}-text`], v[`chart-badge-${t}-bg`], 4.5] as Pair))).toEqual([]);
  });

  it('neither scatter colour is the commit-type bug red', () => {
    expect(v['chart-scatter-typical']).not.toBe(v['chart-type-bug']);
    expect(v['chart-scatter-outlier']).not.toBe(v['chart-type-bug']);
  });
});
```

- [ ] **Step 3: Run both guards and confirm they fail**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/chart-tokens-css.test.ts src/lib/__tests__/unit/chart-contrast.test.ts'`

Expected: FAIL. The tokens test lists all 41 required tokens as missing. The contrast test fails on `undefined`-valued comparisons, or on the `--chart-surface` assertion.

- [ ] **Step 4: Run the dataviz validator on the starting mark palettes**

The validator lives at `/private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js`. If that path is gone, find it with `ls /private/tmp/claude-501/bundled-skills` and use the `dataviz/scripts/validate_palette.js` under the newest version directory.

**What the gate checks, per palette.** Every palette gets the same three checks (spec Decision 14):
1. **Colorblind separation:** `CVD separation` ΔE ≥ 8.
   - **Exception for in-flight pairs.** A pair that includes the in-flight color may sit in the validator's `[WARN]` band (ΔE 6-8), because in-flight is always hatched, which is secondary encoding.
   - Every other pair needs `[PASS]`.
2. **Normal-vision floor:** `Normal-vision floor` must read `[PASS]` (ΔE ≥ 15) for **every** pair, in-flight included. Nothing excuses a failure here.
3. **3:1 contrast:** gated by `chart-contrast.test.ts`. The validator's `Contrast vs surface` line is recorded only.

**Which pairs count as neighbours.** The validator reports only the *worst* pair, so an in-flight pair in the 6-8 band would hide a weak non-in-flight pair. Each palette that includes in-flight therefore gets three runs:
1. **The full order:** the normal-vision floor is gated here.
2. **The order with in-flight removed:** every remaining pair is gated at colorblind ΔE ≥ 8.
3. **Each in-flight pair in isolation:** checks the 6-8 allowance and the normal-vision floor.

The pairs that touch are:
- **Commit types:** neighbours in `COMMIT_TYPE_ORDER`. The stacked chart, the donut (spec Decision 13, amended: the donut follows the same fixed order, not a sort by count) and the dev page's segmented bar all use that order. `other` and `in_flight` are **always** neighbours.
- **Lines:** all three colors touch each other. Added and removed meet at the zero line, and the in-flight hatch sits against both. So use `--pairs all`, and gate every run.

**Starting values, and the pairs already known to fail.** The review loop and I ran these starting values through the validator.

| Palette (order) | Dark (surface `#111827`) | Light (surface `#ffffff`) |
|---|---|---|
| Commit types (feature, bug, refactor, infra, docs, test, other, in_flight) | `#3B82F6,#EF4444,#A855F7,#EAB308,#6B7280,#22C55E,#9CA3AF,#06B6D4` | `#2563EB,#DC2626,#9333EA,#A16207,#6B7280,#15803D,#4B5563,#0E7490` |
| Lines (added, in-flight, removed) | `#10B981,#06B6D4,#EF4444` | `#047857,#0E7490,#DC2626` |
| Ring (jira, commits) | `#D97706,#10B981` | `#B45309,#047857` |
| Scatter (typical, outlier) | `#60A5FA,#FB923C` | `#2563EB,#C2410C` |
| Volume (prs, jiras) | `#06B6D4,#A855F7` | `#0E7490,#9333EA` |

The dark commit types come from today's `TYPE_HEX` (`org/page.tsx:22-31`), with `other` lifted off `#4B5563`, which is 2.35:1 on `#111827`. The scatter outlier moves off red so it can't be mistaken for the bug type.

Known failures:

| Palette | Mode | Failing pair | Measured ΔE | Result |
|---|---|---|---|---|
| Commit types | Dark | `other #9CA3AF` / `in_flight #06B6D4` | colorblind 5.6, normal 11.3 | Both fail |
| Commit types | Light | `other #4B5563` / `in_flight #0E7490` | normal 10.4 (colorblind 8.1) | Normal-vision fails |
| Commit types | Light | `infra #A16207` / `docs #6B7280` | normal 14.3 | Normal-vision fails |
| Lines | Dark | `added #10B981` / `in-flight #06B6D4` | normal 12.5 | Normal-vision fails |
| Lines | Light | `added #047857` / `in-flight #0E7490` | normal 9.7 | Normal-vision fails |

**So both modes must re-step, starting from these verified candidates:**
- **Commit types, dark:** `other → #D1D5DB`. The full order passes the gated checks: the worst pair is `other`/`in_flight` at colorblind 12.5 and normal 19.7, and all eight clear 3:1. The review loop verified this, and I re-ran it.
- **Commit types, light:** `docs → #4B5563`, `other → #374151`, `in_flight → #0891B2`.
  - The full order passes the gated checks: worst colorblind 12.2 and worst normal 16.8, both on `test`/`docs`. All eight clear 3:1.
  - In isolation, `other`/`in_flight` measures colorblind 23.6 and normal 25.2.
  - This changes the light in-flight color, so the light **lines** palette must use `#0891B2` too.
  - **Lightness heuristic:** these candidates separate the two grays by lightness. When re-stepping in light mode, try shades within the gray and cyan families first. Only if no pair within those families passes, pick a new in-flight hue, and record why in the spec's Palette section.
- **Lines:** no passing candidate yet. Re-step `added` first, since in-flight is shared with the commit types. Two probes:
  - **Dark `#84CC16,#06B6D4,#EF4444` (lime added):** passes all pairs. Colorblind worst 12.7, normal worst 23.5.
  - **Light `#4D7C0F,#0891B2,#DC2626`:** fails. `added`/`removed` is at colorblind 6.1, and that pair has no in-flight exception.

  Keep added in the green family where you can. If lime is the only passing green, record it in the Palette section.

**Commands.** Run each one separately, and substitute the current candidate hexes each time. Every run below is gated.

Commit types, full order (dark, then light):

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#3B82F6,#EF4444,#A855F7,#EAB308,#6B7280,#22C55E,#D1D5DB,#06B6D4" --mode dark --surface "#111827"'`

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#2563EB,#DC2626,#9333EA,#A16207,#4B5563,#15803D,#374151,#0891B2" --mode light --surface "#ffffff"'`

Commit types without in-flight, which gates the non-in-flight neighbours at ΔE ≥ 8:

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#3B82F6,#EF4444,#A855F7,#EAB308,#6B7280,#22C55E,#D1D5DB" --mode dark --surface "#111827"'`

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#2563EB,#DC2626,#9333EA,#A16207,#4B5563,#15803D,#374151" --mode light --surface "#ffffff"'`

The `other`/`in_flight` pair in isolation:

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#D1D5DB,#06B6D4" --mode dark --surface "#111827"'`

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#374151,#0891B2" --mode light --surface "#ffffff"'`

Lines, all pairs. For the in-flight exception, confirm which pair the reported worst belongs to. Then re-run `added,removed` alone and require ΔE ≥ 8 there:

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#10B981,#06B6D4,#EF4444" --mode dark --surface "#111827" --pairs all'`

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#047857,#0891B2,#DC2626" --mode light --surface "#ffffff" --pairs all'`

Ring, both modes:

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#D97706,#10B981" --mode dark --surface "#111827"'`

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#B45309,#047857" --mode light --surface "#ffffff"'`

Scatter, both modes:

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#60A5FA,#FB923C" --mode dark --surface "#111827"'`

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#2563EB,#C2410C" --mode light --surface "#ffffff"'`

Volume, both modes:

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#06B6D4,#A855F7" --mode dark --surface "#111827"'`

`env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node /private/tmp/claude-501/bundled-skills/2.1.282/27f946b5296782145e05ad642766e802/dataviz/scripts/validate_palette.js "#0E7490,#9333EA" --mode light --surface "#ffffff"'`

**Recorded, not gated:**
- The `Lightness band` and `Chroma floor` checks. `docs` and `other` are grays by design, so they always fail the chroma floor, and the validator exits 1 because of those two lines. Read the gated lines, not the exit code.
- The badge tokens. They carry text and are gated only by the 4.5:1 badge test.

**Snapping rule when a gated check fails:**
1. Move the failing color one Tailwind shade within its hue family, separating by lightness first. In dark mode move lighter, in light mode darker.
2. If the pair is still too close, change the other member instead.
3. Keep feature blue and bug red in both modes (Decision 8).
4. Re-run the full-order, without-in-flight and in-isolation runs for every palette that shares the color you changed. For example, in-flight appears in both the commit types and the lines.

Save each final command's full output. It goes into the spec in Step 8.

- [ ] **Step 5: Add the tokens to `globals.css`**

Add this at the end of the `:root` block, after `--vuln-series-other` and before the block's closing `}`. Replace any value that Step 4 changed.

```css
  /* GLOOK-58: chart tokens (dark, the app's default). Values validated in the spec's Palette
     section; chart-contrast.test.ts guards every Decision 14 threshold. --chart-surface is the
     card colour charts sit on (bg-gray-900). The grid and tooltip border are decorative and
     exempt from contrast, so they stay recessive. */
  --chart-grid: #1f2937;
  --chart-axis: #9ca3af;
  --chart-cursor: #1f2937;
  --chart-tooltip-bg: #1f2937;
  --chart-tooltip-border: #374151;
  --chart-tooltip-text: #e5e7eb;
  --chart-track: #1f2937;
  --chart-surface: #111827;
  --chart-type-feature: #3b82f6;
  --chart-type-bug: #ef4444;
  --chart-type-refactor: #a855f7;
  --chart-type-infra: #eab308;
  --chart-type-docs: #6b7280;
  --chart-type-test: #22c55e;
  --chart-type-other: #d1d5db;
  --chart-type-in-flight: #06b6d4;
  --chart-lines-added: #10b981;
  --chart-lines-removed: #ef4444;
  --chart-ring-jira: #d97706;
  --chart-ring-commits: #10b981;
  --chart-scatter-typical: #60a5fa;
  --chart-scatter-outlier: #fb923c;
  --chart-volume-prs: #06b6d4;
  --chart-volume-jiras: #a855f7;
  --chart-volume-commits: #374151;
  /* Commit-type badges carry text, so they get their own fill/text pairs (4.5:1), separate from
     the mark colours above. */
  --chart-badge-feature-bg: #2563eb;
  --chart-badge-feature-text: #ffffff;
  --chart-badge-bug-bg: #dc2626;
  --chart-badge-bug-text: #ffffff;
  --chart-badge-refactor-bg: #9333ea;
  --chart-badge-refactor-text: #ffffff;
  --chart-badge-infra-bg: #ca8a04;
  --chart-badge-infra-text: #111827;
  --chart-badge-docs-bg: #4b5563;
  --chart-badge-docs-text: #ffffff;
  --chart-badge-test-bg: #15803d;
  --chart-badge-test-text: #ffffff;
  --chart-badge-other-bg: #374151;
  --chart-badge-other-text: #ffffff;
  --chart-badge-in-flight-bg: #0e7490;
  --chart-badge-in-flight-text: #ffffff;
```

Add this at the end of the bare `[data-theme-mode="light"]` block, after `--vuln-series-other: #6b7280;` and before the block's closing `}`. Again, replace any value that Step 4 changed.

```css
  /* GLOOK-58: chart tokens (light). Same names as :root. --chart-surface is the light card
     (the .bg-gray-900 override below is #ffffff). */
  --chart-grid: #e5e7eb;
  --chart-axis: #4b5563;
  --chart-cursor: #f3f4f6;
  --chart-tooltip-bg: #ffffff;
  --chart-tooltip-border: #e5e7eb;
  --chart-tooltip-text: #111827;
  --chart-track: #e5e7eb;
  --chart-surface: #ffffff;
  --chart-type-feature: #2563eb;
  --chart-type-bug: #dc2626;
  --chart-type-refactor: #9333ea;
  --chart-type-infra: #a16207;
  --chart-type-docs: #4b5563;
  --chart-type-test: #15803d;
  --chart-type-other: #374151;
  --chart-type-in-flight: #0891b2;
  --chart-lines-added: #047857;
  --chart-lines-removed: #dc2626;
  --chart-ring-jira: #b45309;
  --chart-ring-commits: #047857;
  --chart-scatter-typical: #2563eb;
  --chart-scatter-outlier: #c2410c;
  --chart-volume-prs: #0e7490;
  --chart-volume-jiras: #9333ea;
  --chart-volume-commits: #d1d5db;
  --chart-badge-feature-bg: #dbeafe;
  --chart-badge-feature-text: #1e40af;
  --chart-badge-bug-bg: #fee2e2;
  --chart-badge-bug-text: #991b1b;
  --chart-badge-refactor-bg: #f3e8ff;
  --chart-badge-refactor-text: #6b21a8;
  --chart-badge-infra-bg: #fef9c3;
  --chart-badge-infra-text: #854d0e;
  --chart-badge-docs-bg: #f3f4f6;
  --chart-badge-docs-text: #374151;
  --chart-badge-test-bg: #dcfce7;
  --chart-badge-test-text: #166534;
  --chart-badge-other-bg: #e5e7eb;
  --chart-badge-other-text: #1f2937;
  --chart-badge-in-flight-bg: #cffafe;
  --chart-badge-in-flight-text: #155e75;
```

I pre-computed the badge starting pairs with the same WCAG formula the test uses:
- **Dark:** 4.83 for `bug` (the lowest) up to 10.31.
- **Light:** 6.38 up to 11.86.

The grid starts at `#1f2937` (1.21:1) in dark and `#e5e7eb` (1.24:1) in light. Both are recessive by design.

- [ ] **Step 6: Register the `chart.*` color namespace in Tailwind**

Replace the whole of `tailwind.config.ts` with:

```ts
import type { Config } from 'tailwindcss';

// GLOOK-58: chart tokens are CSS variables (globals.css), so the same class resolves to the dark
// value under :root and the light value under [data-theme-mode="light"]. Opacity modifiers
// (e.g. bg-chart-grid/50) do NOT work on these: Tailwind v3 cannot split a var() hex into channels.
const TYPES = ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other', 'in-flight'] as const;

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
          type: Object.fromEntries(TYPES.map(t => [t, `var(--chart-type-${t})`])),
          badge: Object.fromEntries(
            TYPES.flatMap(t => [[`${t}-bg`, `var(--chart-badge-${t}-bg)`], [`${t}-text`, `var(--chart-badge-${t}-text)`]]),
          ),
        },
      },
    },
  },
  plugins: [],
};

export default config;
```

Guard test 2 scans this file for `var(--chart-…)`. The template literals above don't match that literal pattern, so guard 2 cannot check the names they generate. Two other things cover them:
- The `REQUIRED` list in guard 2 names every token these templates produce.
- Task 11's screenshot pass shows any badge or mark class that failed to resolve.

- [ ] **Step 7: Run both guards and confirm they pass**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/chart-tokens-css.test.ts src/lib/__tests__/unit/chart-contrast.test.ts'`

Expected: PASS. If a contrast line fails, snap that token as in Step 4, one Tailwind step at a time, and re-run. Re-run the matching validator command for any mark color you change.

- [ ] **Step 8: Write the Palette section into the spec**

In the spec, replace the placeholder paragraph under `### Palette` (the one beginning *"Filled in by the first implementation task"*) with four things:
1. **A token table.** One row per `--chart-*` token, with columns for the token, its dark hex, its light hex, and what it colors.
2. **A moves list.** Every value that moved from its starting hex, with the reason. For example: "`--chart-type-other` dark `#4B5563` → `#9CA3AF`: 2.35:1 on `#111827`".
3. **The full validator output** for every run in Step 4, in fenced code blocks labeled by palette, mode and run: full order, without in-flight, or in isolation. Note every in-flight pair that uses the colorblind 6-8 allowance.
4. **The reason for any hue change,** for example a new in-flight hue or a non-green added color, if one was needed.
5. **One sentence on what is not gated:** the lightness band, the chroma floor (grays fail it by design), the grid and tooltip border (exempt), and volume `commits` (exempt).

- [ ] **Step 9: Run the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all 171 suites pass. `vuln-trend-colors-css.test.ts` and `vuln-series-contrast.test.ts` still pass, because the `--vuln-series-*` tokens are untouched.

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
- Modify: `package.json` and `package-lock.json` (via npm)
- Modify: `jest.config.ts`
- Create: `src/lib/cn.ts`
- Create: `src/lib/__tests__/setup/resize-observer.ts`
- Create: `src/lib/__tests__/setup/chart-size.ts`
- Create: `src/components/charts/chart.tsx`
- Test: `src/lib/__tests__/unit/cn.test.ts`, `src/lib/__tests__/unit/chart-wrapper.test.tsx`

**Interfaces:**
- Consumes: the `chart.*` Tailwind colors from Task 1.
- Produces:
  - `cn(...inputs: ClassValue[]): string` from `@/lib/cn`.
  - `fixChartSize(width?: number, height?: number): void` from `src/lib/__tests__/setup/chart-size.ts`. It registers a `beforeEach`.
  - From `@/components/charts/chart`: `ChartContainer` (props `config: ChartConfig`, `className?`, `initialDimension?`, `children`), `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, `ChartLegendContent`, `ChartStyle`, `type ChartConfig` and `CHART_TOOLTIP_CLASS: string`.

**Why `react-is@^19.2` is needed (spec Decision 2).** Recharts 3.10.1 declares `react-is` as a peer dependency and imports `isFragment` from it (`es6/util/ReactUtils.js:3`). The copy hoisted in the repo today is 18.3.1, while React is 19.2.4. React 19 changed the element `$$typeof` symbol, so `react-is` 18 would not recognize React 19 fragments.

**jsdom sizing (per the amended spec Testing section).** In 3.10.1, `ResponsiveContainer`'s size detector (`es6/component/ResponsiveContainer.js:96-123`) behaves in two ways:
- It returns early when `ResizeObserver` is undefined.
- Otherwise, it calls `getBoundingClientRect()` on mount. jsdom returns 0×0, and that overwrites `initialDimension`.

So two pieces are needed. The global stub makes `ResizeObserver` exist, and `fixChartSize()` stubs `getBoundingClientRect` so the mount-time measurement returns a real size.

**Wrapper port choices (spec Decisions 3, 4, 6):**
- **Tailwind classes** come from shadcn `new-york`, the Tailwind v3 variant: for example, `border-[--color-border]`.
- **TypeScript types** come from `new-york-v4`, which already targets Recharts 3.8: `DefaultTooltipContentProps<TooltipValueType, …>`, `DefaultLegendContentProps` and the `initialDimension` prop. Components are plain functions, as in v4.
- **`THEMES`** is `{ dark: '', light: '[data-theme-mode="light"]' }`.
- **Class rewrites:**

  | shadcn class | Replacement |
  |---|---|
  | `fill-muted-foreground` | `fill-chart-axis` |
  | `stroke-border/50`, `stroke-border` | `stroke-chart-grid` (the alpha modifier is dropped; Tailwind v3 cannot apply alpha to a `var()` hex) |
  | `fill-muted` | `fill-chart-track` for the radial background, `fill-chart-cursor` for the tooltip cursor |
  | curve cursor | `stroke-chart-cursor` |
  | `border-border/50` | `border-chart-tooltip-border` |
  | `bg-background` | `bg-chart-tooltip-bg` |
  | `text-muted-foreground`, `text-foreground` | `text-chart-tooltip-text` |

  The legend root gains `text-chart-axis`.
- **The `[stroke='#ccc']` and `[stroke='#fff']` attribute selectors stay.** They match the default colors Recharts emits; they never set a color. The Task 11 guard strips them before it scans.
- **Values use v4's `item.value != null`,** so a 0 is shown.
- **`chartId` is sanitized** with `/[^A-Za-z0-9_-]/g`.

- [ ] **Step 1: Install the dependencies**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm install recharts@^3.10 clsx@^2.1 tailwind-merge@^2.6 react-is@^19.2'`

Expected: `package.json` gains `recharts ^3.10.x`, `clsx ^2.1.x`, `tailwind-merge ^2.6.x` and `react-is ^19.2.x` under `dependencies`.

- [ ] **Step 2: Confirm Recharts resolves react-is 19**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm ls react-is'`

Expected: the `recharts@3.x` entry shows `react-is@19.x` (deduped is fine). If it shows 18.x, stop and report it.

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

Expected: FAIL, with `Cannot find module '@/lib/cn'` and `Cannot find module '@/components/charts/chart'`.

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

**If Jest reports `SyntaxError: Unexpected token 'export'` in a `node_modules/<pkg>` path,** recover in two stages. Try the next stage only if the current one fails. Un-ignoring the package in `transformIgnorePatterns` alone does nothing, because `transform` only covers `.tsx?` files.
1. **Stage 1: ask for CommonJS builds.** jsdom's default `browser` export condition can select a package's ESM build. Add this to `jest.config.ts`, next to `setupFiles`, then re-run:
   ```ts
     testEnvironmentOptions: { customExportConditions: ['node', 'node-addons'] },
   ```
2. **Stage 2: transform the ESM files.** Add a JS transform to the existing `transform` map. `tsconfig.jest.json` extends `tsconfig.json`, which has `allowJs: true`, so ts-jest can compile JS. Then append the package name to the `transformIgnorePatterns` alternation, for example `'node_modules/(?!(p-limit|yocto-queue|@octokit|universal-user-agent|before-after-hook|<pkg>)/)'`, and re-run.
   ```ts
     transform: {
       '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
       '^.+\\.m?js$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
     },
   ```

**If the spike test finds 0 rectangles,** log `container.innerHTML` and check which case you're in:
- **The `.recharts-responsive-container` div is present but empty:** the size stub did not apply. Check that `fixChartSize()` is called at module top level.
- **`recharts-wrapper` is present but has no rectangles:** check that `isAnimationActive={false}` reached the `Bar`.

Do not continue to Task 3 until this test passes.

**If the ChartStyle regex fails only on whitespace,** compare against the actual `innerHTML` and fix the test's whitespace, not the component's selector order.

- [ ] **Step 10: Confirm the four vuln-content suites that render the real TrendChart still pass**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/vuln-content-trend-range.test.tsx src/lib/__tests__/unit/vuln-content-team-dropdown.test.tsx src/lib/__tests__/unit/vuln-content-repo-reset.test.tsx src/lib/__tests__/unit/vuln-content-error.test.tsx'`

Expected: PASS (unchanged).

- [ ] **Step 11: Type-check**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx tsc --noEmit --pretty false'`

Expected: no errors in `src/lib/cn.ts`, `src/components/charts/chart.tsx`, `src/lib/__tests__/setup/*` or `src/lib/__tests__/unit/chart-wrapper.test.tsx`. Errors in files this task did not touch predate it, and `git diff --stat HEAD` shows which files changed. For errors in `ChartTooltipContent`'s intersected prop type, match the new-york-v4 source, which compiles against Recharts 3.8.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json jest.config.ts src/lib/cn.ts src/lib/__tests__/setup/resize-observer.ts src/lib/__tests__/setup/chart-size.ts src/components/charts/chart.tsx src/lib/__tests__/unit/cn.test.ts src/lib/__tests__/unit/chart-wrapper.test.tsx
git commit -F - <<'EOF'
GLOOK-58: Recharts 3 foundation and ported chart wrapper

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: UTC week keys and shared helpers (`timeline.ts`, `chart-format.ts`, `commit-types.ts`, `hatch.tsx`)

**Files:**
- Modify: `src/lib/report/timeline.ts:23-28` (`weekKeyForDate`)
- Create: `src/components/charts/chart-format.ts`
- Create: `src/components/charts/commit-types.ts`
- Create: `src/components/charts/hatch.tsx`
- Test: `src/lib/__tests__/unit/week-key-utc.test.ts`, `src/lib/__tests__/unit/chart-format.test.ts`, `src/lib/__tests__/unit/commit-types.test.ts`, `src/lib/__tests__/unit/chart-hatch.test.tsx`

**Interfaces:**
- Consumes: token names from Task 1.
- Produces:
  - **From `@/lib/report/timeline`:** `weekKeyForDate(d: Date): string`. The signature is unchanged; it now returns the Monday of the containing UTC week.
  - **From `@/components/charts/chart-format`:**
    - `type MetricKind = 'count' | 'ratio'`
    - `toNum(v: unknown): number`
    - `mondayOf(date: Date): string`, the UTC calendar Monday as `YYYY-MM-DD`
    - `buildWeekDomain(cutoff: Date, today: Date): string[]`
    - `recentWeekDomain(now?: Date, days?: number): string[]`
    - `indexByWeek<T extends { week: string }>(data: T[]): Map<string, T>`
    - `interface WeekPoint<T> { week: string; value: number | null; hasData: boolean; row?: T }`
    - `interface FillOptions<T> { value: (row: T) => unknown; kind: MetricKind; isDefined?: (row: T) => boolean }`
    - `fillWeeks<T extends { week: string }>(weeks: string[], data: T[], opts: FillOptions<T>): WeekPoint<T>[]`
    - `formatWeek(iso: string): string`
    - `formatValue(v: number | null | undefined, opts?: { suffix?: string; decimals?: number }): string`
    - `formatCompact(v: number): string`
    - `isTopOfStack(row: Record<string, unknown>, keys: readonly string[], key: string): boolean`
  - **From `@/components/charts/commit-types`:**
    - `COMMIT_TYPE_ORDER`, `type CommitType`
    - `normalizeType(t: string): CommitType`
    - `commitTypeColor(t: string): string`, a mark `var(--chart-type-*)`
    - `commitTypeBg(t: string): string`, a mark `bg-chart-type-*` class for bar segments
    - `commitTypeBadge(t: string): { bg: string; text: string }`, the `bg-chart-badge-*-bg` and `text-chart-badge-*-text` classes
    - `foldTypes(list: Array<Record<string, unknown>>): Record<CommitType, number>`
    - `typeEntriesFrom(list: Array<Record<string, unknown>>): [CommitType, number][]`, the non-zero entries in fixed `COMMIT_TYPE_ORDER`, never sorted by count (spec Decision 13), with unknown types folded into `other`. The donut, the dev page's segmented bar and legend, and the team badges all use it, so every neighbouring pair they show is one the palette gate checked.
  - **From `@/components/charts/hatch`:**
    - `interface Hatch { id: string; fill: string; defs: ReactElement }`
    - `useHatch(colorVar: string): Hatch`
    - `HatchSwatch({ colorVar, size? })`

**Semantics that later tasks rely on:**
- **Week keys are exact UTC Mondays** on both sides (spec Decision 10, amended), so `fillWeeks` matches keys exactly. No client-side snapping or merging is needed.
  - A key that isn't in the domain is ignored, for example a week older than the 90-day cutoff.
  - The server emits one row per key, because `aggregateWeekly` groups by key.
- **Count metrics (`kind: 'count'`):**
  - A week with no row is `0`.
  - A present week whose value is `null`/`undefined`, or fails `isDefined`, is also `0`.
- **Ratio metrics (`kind: 'ratio'`):**
  - A week with no row, a `null`/`undefined` value, or a failing `isDefined` is `null`.
  - `hasData` is true only when the week has a usable value.

**How the time-zone test works.** Setting `process.env.TZ` inside a Jest test does **not** change `Date`'s time zone. I checked this on this machine, in Jest 30 with Node 24.16. After assigning `'Asia/Tokyo'` inside a test, `new Date('2026-09-22T01:00:00Z').getHours()` still returned the machine's New York hour, 21. Jest hands the test a copy of `process.env`, and Node only resets its time-zone cache when the real one changes. So the regression test spawns a child `tsx` process with `TZ=America/New_York` in its environment. That child does run in New York time. I confirmed the unfixed code there returns `2026-09-22` (Tuesday) for a Monday-21:00 commit, while a `TZ=UTC` child returns `2026-09-21`. The test does not set or restore `process.env.TZ` itself, because an in-process assignment would have no effect.

- [ ] **Step 1: Write the failing week-key test**

Create `src/lib/__tests__/unit/week-key-utc.test.ts`:

```ts
// GLOOK-58 Decision 10: weekKeyForDate keys by the containing UTC week, whatever the server's
// time zone. Assigning process.env.TZ inside a Jest test does not change Date's zone (Jest gives
// the test a copy of process.env, and Node resets its zone cache only on the real one), so the
// time-zone case runs in a child process that starts with TZ set.
import { execFileSync } from 'child_process';
import path from 'path';
import { weekKeyForDate } from '@/lib/report/timeline';

const root = path.join(__dirname, '../../../..');
// Monday 2026-09-21 21:00 in New York (EDT, UTC-4) is Tuesday 2026-09-22 01:00 UTC.
const MONDAY_9PM_NEW_YORK = '2026-09-22T01:00:00Z';

function keyUnderTz(tz: string, iso: string): string {
  const script = `import { weekKeyForDate } from './src/lib/report/timeline'; console.log(weekKeyForDate(new Date('${iso}')));`;
  return execFileSync(path.join(root, 'node_modules/.bin/tsx'), ['-e', script], {
    cwd: root,
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  }).trim();
}

it('a Monday-21:00 commit under TZ=America/New_York keys to that UTC week, not the next day', () => {
  expect(keyUnderTz('America/New_York', MONDAY_9PM_NEW_YORK)).toBe('2026-09-21');
}, 30_000);

it('the same instant keys identically in every server time zone', () => {
  expect(keyUnderTz('Asia/Tokyo', MONDAY_9PM_NEW_YORK)).toBe('2026-09-21');
  expect(keyUnderTz('UTC', MONDAY_9PM_NEW_YORK)).toBe('2026-09-21');
}, 30_000);

it('keys a UTC Monday, midweek day and Sunday to that UTC Monday (in-process)', () => {
  expect(weekKeyForDate(new Date('2026-09-21T00:00:00Z'))).toBe('2026-09-21');
  expect(weekKeyForDate(new Date('2026-09-24T12:00:00Z'))).toBe('2026-09-21');
  expect(weekKeyForDate(new Date('2026-09-27T23:59:59Z'))).toBe('2026-09-21');
});
```

- [ ] **Step 2: Write the failing `chart-format` test**

Create `src/lib/__tests__/unit/chart-format.test.ts`:

```ts
import {
  buildWeekDomain, fillWeeks, formatCompact, formatValue, formatWeek, indexByWeek, isTopOfStack,
  mondayOf, recentWeekDomain, toNum,
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

describe('week domain (UTC)', () => {
  it('mondayOf returns the Monday of the containing UTC week', () => {
    expect(mondayOf(utc('2026-09-25'))).toBe('2026-09-21'); // Friday
    expect(mondayOf(utc('2026-09-21'))).toBe('2026-09-21'); // Monday
    expect(mondayOf(utc('2026-09-27'))).toBe('2026-09-21'); // Sunday belongs to the week before
    expect(mondayOf(new Date('2026-09-27T23:59:59Z'))).toBe('2026-09-21');
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

  it('an undefined ratio value (an optional field) is a gap, not a 0', () => {
    const pts = fillWeeks(weeks, [{ week: '2026-09-14' } as { week: string; v?: number }], { value: r => r.v, kind: 'ratio' });
    expect(pts[1].value).toBeNull();
  });

  it('string numerics are converted, and rows outside the domain are ignored', () => {
    const data = [{ week: '2026-08-31', n: '9' }, { week: '2026-09-21', n: '3' }];
    expect(fillWeeks(weeks, data, { value: r => r.n, kind: 'count' }).map(p => p.value)).toEqual([0, 0, 3]);
  });

  it('data entirely outside the domain (an old report) yields no week with data', () => {
    const pts = fillWeeks(weeks, [{ week: '2025-01-06', n: 5 }], { value: r => r.n, kind: 'count' });
    expect(pts.some(p => p.hasData)).toBe(false);
  });

  it('two metrics filled from the same domain produce identical week sequences (syncId matches by index)', () => {
    const data = [{ week: '2026-09-14', a: 1, b: 2 }];
    const a = fillWeeks(weeks, data, { value: r => r.a, kind: 'count' }).map(p => p.week);
    const b = fillWeeks(weeks, data, { value: r => r.b, kind: 'ratio' }).map(p => p.week);
    expect(a).toEqual(weeks);
    expect(b).toEqual(weeks);
  });

  it('indexByWeek looks rows up by exact key', () => {
    const idx = indexByWeek([{ week: '2026-09-07', n: 1 }]);
    expect(idx.get('2026-09-07')?.n).toBe(1);
    expect(idx.get('2026-09-08')).toBeUndefined();
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

- [ ] **Step 3: Write the failing `commit-types` test**

Create `src/lib/__tests__/unit/commit-types.test.ts`:

```ts
import fs from 'fs';
import path from 'path';
import {
  COMMIT_TYPE_ORDER, commitTypeBadge, commitTypeBg, commitTypeColor, foldTypes, normalizeType, typeEntriesFrom,
} from '@/components/charts/commit-types';

it('stacks types in the spec order', () => {
  expect([...COMMIT_TYPE_ORDER]).toEqual(['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other', 'in_flight']);
});

it('maps each type to its own mark token and mark background class', () => {
  expect(commitTypeColor('feature')).toBe('var(--chart-type-feature)');
  expect(commitTypeColor('in_flight')).toBe('var(--chart-type-in-flight)');
  expect(commitTypeBg('bug')).toBe('bg-chart-type-bug');
  expect(commitTypeBg('in_flight')).toBe('bg-chart-type-in-flight');
});

it('every type returns a badge fill and a badge text colour, separate from the mark colour', () => {
  for (const t of COMMIT_TYPE_ORDER) {
    const slug = t === 'in_flight' ? 'in-flight' : t;
    expect(commitTypeBadge(t)).toEqual({ bg: `bg-chart-badge-${slug}-bg`, text: `text-chart-badge-${slug}-text` });
  }
});

it('maps unknown types to other, for marks and badges alike', () => {
  expect(normalizeType('chore')).toBe('other');
  expect(commitTypeColor('chore')).toBe('var(--chart-type-other)');
  expect(commitTypeBg('')).toBe('bg-chart-type-other');
  expect(commitTypeBadge('chore')).toEqual(commitTypeBadge('other'));
});

it('foldTypes sums across weeks, folds unknown types into other, and tolerates string counts', () => {
  const folded = foldTypes([{ feature: 2, chore: 1 }, { feature: '3', other: 1, in_flight: 4 }]);
  expect(folded.feature).toBe(5);
  expect(folded.other).toBe(2);
  expect(folded.in_flight).toBe(4);
  expect(folded.bug).toBe(0);
});

it('typeEntriesFrom gives one row per non-zero type in fixed COMMIT_TYPE_ORDER, not by count, with unknown types in a single other row', () => {
  expect(typeEntriesFrom([{ feature: 2, chore: 1, other: 1 }, { bug: 3 }, { in_flight: 9 }])).toEqual([
    ['feature', 2], ['bug', 3], ['other', 2], ['in_flight', 9],
  ]);
  expect(typeEntriesFrom([])).toEqual([]);
});

// The palette gate could move a hue in the charts while a page kept an old copy of the map.
it.skip('no report page keeps its own commit-type colour map', () => {
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

The last test stays skipped until Task 7, Step 1 un-skips it, after Tasks 5 and 7 have removed the three maps.

- [ ] **Step 4: Write the failing hatch test**

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

- [ ] **Step 5: Run the tests and confirm they fail**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/week-key-utc.test.ts src/lib/__tests__/unit/chart-format.test.ts src/lib/__tests__/unit/commit-types.test.ts src/lib/__tests__/unit/chart-hatch.test.tsx'`

Expected results:
- `week-key-utc`: the New York test FAILS with `Expected: "2026-09-21"`, `Received: "2026-09-22"`, and the Tokyo case fails too. The in-process test may pass or fail, depending on this machine's zone.
- The other three files fail with `Cannot find module`.

- [ ] **Step 6: Fix `weekKeyForDate`**

In `src/lib/report/timeline.ts`, replace the comment and function at lines 20-28:

```ts
// ISO date string for the Monday of the UTC week containing `d`. Used by both the shipped-commit
// aggregator below and the in-flight overlay in `org.ts`, so the two paths can't drift on what
// counts as the same week. GLOOK-58: UTC throughout. The old local-time arithmetic formatted with
// toISOString(), so on a server west of UTC a Monday-evening commit got a Tuesday key and one week
// arrived as two buckets. No week keys are persisted (timelines are computed per request), so this
// needs no migration.
export function weekKeyForDate(d: Date): string {
  const day = d.getUTCDay();
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return monday.toISOString().split('T')[0];
}
```

- [ ] **Step 7: Implement `chart-format.ts`**

Create `src/components/charts/chart-format.ts`:

```ts
// GLOOK-58: pure helpers shared by every chart. Numbers from DECIMAL/REAL columns can arrive as
// strings, so every value goes through toNum(). Weeks are UTC calendar weeks, matching the
// server's weekKeyForDate(), so keys match exactly.

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

/** Monday of the UTC week containing `date`, as YYYY-MM-DD. Same rule as weekKeyForDate(). */
export function mondayOf(date: Date): string {
  const t = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const dow = new Date(t).getUTCDay();
  return isoOf(t - ((dow + 6) % 7) * DAY_MS);
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

/** Rows keyed by their exact week. aggregateWeekly emits one row per key, so there are no collisions. */
export function indexByWeek<T extends { week: string }>(data: T[]): Map<string, T> {
  return new Map(data.map(r => [r.week, r]));
}

export interface WeekPoint<T> {
  week: string;
  value: number | null;
  hasData: boolean;
  row?: T;
}

export interface FillOptions<T> {
  value: (row: T) => unknown;
  kind: MetricKind;
  isDefined?: (row: T) => boolean;
}

/**
 * One point per domain week. kind 'count': a missing or undefined week is 0.
 * kind 'ratio': a missing or undefined week is null (a gap). Rows outside the domain are ignored.
 */
export function fillWeeks<T extends { week: string }>(weeks: string[], data: T[], opts: FillOptions<T>): WeekPoint<T>[] {
  const byWeek = indexByWeek(data);
  return weeks.map(week => {
    const row = byWeek.get(week);
    const raw = row ? opts.value(row) : undefined;
    const defined = !!row && raw != null && (opts.isDefined ? opts.isDefined(row) : true);
    if (opts.kind === 'count') return { week, row, hasData: !!row, value: defined ? toNum(raw) : 0 };
    return { week, row, hasData: defined, value: defined ? toNum(raw) : null };
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

- [ ] **Step 8: Implement `commit-types.ts`**

Create `src/components/charts/commit-types.ts`:

```ts
// GLOOK-58: the one commit-type map. Replaces TYPE_HEX/TYPE_COLORS (org page), TYPE_COLORS/
// TYPE_TEXT_COLORS (dev page) and TYPE_COLORS (team dev-table), so a palette change reaches every
// surface at once. Marks (bars, wedges, swatches) and badges (text on a fill) use separate tokens:
// a mark only needs 3:1 against the card, a badge's text needs 4.5:1 against its own fill.
// Class names are written out in full so Tailwind's content scan finds them.
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

const BADGE: Record<CommitType, { bg: string; text: string }> = {
  feature: { bg: 'bg-chart-badge-feature-bg', text: 'text-chart-badge-feature-text' },
  bug: { bg: 'bg-chart-badge-bug-bg', text: 'text-chart-badge-bug-text' },
  refactor: { bg: 'bg-chart-badge-refactor-bg', text: 'text-chart-badge-refactor-text' },
  infra: { bg: 'bg-chart-badge-infra-bg', text: 'text-chart-badge-infra-text' },
  docs: { bg: 'bg-chart-badge-docs-bg', text: 'text-chart-badge-docs-text' },
  test: { bg: 'bg-chart-badge-test-bg', text: 'text-chart-badge-test-text' },
  other: { bg: 'bg-chart-badge-other-bg', text: 'text-chart-badge-other-text' },
  in_flight: { bg: 'bg-chart-badge-in-flight-bg', text: 'text-chart-badge-in-flight-text' },
};

export function normalizeType(t: string): CommitType {
  return (COMMIT_TYPE_ORDER as readonly string[]).includes(t) ? (t as CommitType) : 'other';
}

/** Mark colour (bars, wedges, lines, swatches). */
export function commitTypeColor(t: string): string {
  return COLOR[normalizeType(t)];
}

/** Mark colour as a background class, for HTML bar segments. */
export function commitTypeBg(t: string): string {
  return BG[normalizeType(t)];
}

/** Badge fill and text classes (text on a coloured fill, 4.5:1). */
export function commitTypeBadge(t: string): { bg: string; text: string } {
  return BADGE[normalizeType(t)];
}

/** Sum type counts across rows; unknown types count as other. */
export function foldTypes(list: Array<Record<string, unknown>>): Record<CommitType, number> {
  const out = Object.fromEntries(COMMIT_TYPE_ORDER.map(t => [t, 0])) as Record<CommitType, number>;
  for (const types of list) {
    for (const [t, n] of Object.entries(types ?? {})) out[normalizeType(t)] += toNum(n);
  }
  return out;
}

/**
 * Folded, non-zero [type, count] rows in fixed COMMIT_TYPE_ORDER (spec Decision 13). Never sorted by
 * count: the palette gate validates neighbours in this order, so any other order could put two
 * unchecked colours side by side (other and in_flight are always neighbours here).
 */
export function typeEntriesFrom(list: Array<Record<string, unknown>>): [CommitType, number][] {
  const folded = foldTypes(list);
  return COMMIT_TYPE_ORDER
    .filter(t => folded[t] > 0)
    .map(t => [t, folded[t]] as [CommitType, number]);
}
```

- [ ] **Step 9: Implement `hatch.tsx`**

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

- [ ] **Step 10: Run the new tests and the existing timeline suites**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/week-key-utc.test.ts src/lib/__tests__/unit/chart-format.test.ts src/lib/__tests__/unit/commit-types.test.ts src/lib/__tests__/unit/chart-hatch.test.tsx src/lib/__tests__/unit/timeline.test.ts src/lib/__tests__/unit/report-timeline.test.ts'`

Expected: PASS, with one test skipped. The two existing timeline suites use commit times at 10:00Z, so their expected week keys don't change.

- If `rect.style.fill` reads `''` in jsdom, cssstyle 4.6 dropped the `var()`. In that case, assert that `rect.getAttribute('style')` contains `fill: var(--chart-surface)`.
- If the child-process test fails with `ENOENT` for `node_modules/.bin/tsx`, run `npm ls tsx`. tsx is a devDependency (`^4.21.0`) and is required here.

- [ ] **Step 11: Full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all suites pass. The report, org and dev integration suites must stay green with UTC keys.

- [ ] **Step 12: Commit**

```bash
git add src/lib/report/timeline.ts src/components/charts/chart-format.ts src/components/charts/commit-types.ts src/components/charts/hatch.tsx src/lib/__tests__/unit/week-key-utc.test.ts src/lib/__tests__/unit/chart-format.test.ts src/lib/__tests__/unit/commit-types.test.ts src/lib/__tests__/unit/chart-hatch.test.tsx
git commit -F - <<'EOF'
GLOOK-58: UTC week keys, shared chart helpers, commit-type map and hatch pattern

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: `TimelineChart`, wired into the org and dev timeline grids

**Files:**
- Create: `src/components/charts/timeline-chart.tsx`
- Modify: `src/app/report/[id]/org/page.tsx`
  - the imports
  - the timeline grid (lines 248-278)
  - delete the local `TimelineChart` (lines 784-922)
- Modify: `src/app/report/[id]/dev/[login]/page.tsx`
  - the imports
  - the timeline grid (lines 310-357)
  - delete the local `TimelineChart` (lines 668-842)
- Test: `src/lib/__tests__/unit/timeline-chart.test.tsx`
- Modify (Step 8, when the seed precondition fails): `scripts/seed-data.ts` (date anchor, `seedUnmergedCommits`) and `scripts/seed.ts` (one `seed('unmerged_commits', …)` line)

**Interfaces:**
- Consumes:
  - `fillWeeks`, `formatCompact`, `formatValue`, `formatWeek`, `toNum`, `MetricKind` and `recentWeekDomain` from chart-format.
  - `useHatch` from hatch.
  - `ChartContainer`, `ChartTooltip` and `CHART_TOOLTIP_CLASS` from chart.
- Produces, from `@/components/charts/timeline-chart`:
  - `interface TimelineRow { week: string }`
  - `interface TimelinePoint { week: string; value: number | null; shipped: number | null; inFlight: number | null }`
  - `interface TimelineChartProps<T extends TimelineRow>`, with `data`, `weeks`, `valueKey?`, `computeValue?`, `kind`, `isDefined?`, `label`, `suffix?`, `decimals?`, `inFlightValue?` and `syncId`
  - `TimelineChart<T extends TimelineRow>(props)`
  - `TimelineTooltip(props)`, exported for testing

**Behavior (spec Charts → TimelineChart, Decisions 7, 9, 10):**
- **Placement:** bars are placed by date on the page's shared `weeks`.
- **Header:** shows the last week with data, and the change from the previous week with data. The change keeps today's green and red, and adds a `+` or `−` sign.
- **In-flight:** it is a portion of the week's total, clamped to `[0, value]`. The shipped segment gets the 4px rounded top only when no in-flight segment sits above it.
- **Colors:** bars use `var(--accent)`. The in-flight segment uses an accent hatch, whose `<defs>` render only when `inFlightValue` is set.
- **Empty state:** "No data in the last 90 days". This covers an old report whose weeks fall outside the domain (Review Focus 1).

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

it('shows the empty state, not a blank card, for an old report whose weeks are all outside the domain', () => {
  const data: Row[] = [{ week: '2025-01-06', commits: 7, prs: 1 }];
  const { container } = render(<TimelineChart data={data} weeks={weeks} valueKey="commits" kind="count" label="Commits / Week" syncId="t" />);
  expect(screen.getByText('No data in the last 90 days')).toBeTruthy();
  expect(container.querySelector('svg.recharts-surface')).toBeNull();
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
import { fillWeeks, formatCompact, formatValue, formatWeek, type MetricKind } from './chart-format';
import { useHatch } from './hatch';

export interface TimelineRow {
  week: string;
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
  const points = fillWeeks(weeks, data, { value: read, kind, isDefined });
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

Expected: PASS, 12 tests. If the hatch test sees the in-flight rectangle before the shipped one, Recharts rendered the Bars in a different DOM order. In that case, compare sorted arrays instead; don't reorder the Bars.

- [ ] **Step 5: Wire the org page**

In `src/app/report/[id]/org/page.tsx`, add these imports after the `./spend-tab` import:

```tsx
import { TimelineChart } from '@/components/charts/timeline-chart';
import { recentWeekDomain, toNum } from '@/components/charts/chart-format';
```

Directly after `const totalTyped = …`, add:

```tsx
  // One week domain per render, shared by every chart below so hover sync (syncId) lines up.
  const weeks = recentWeekDomain(new Date());
```

Replace the timeline grid block, from `{/* Timeline Charts */}` through its closing `)}`, with:

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

`<LinesChangedChart data={timeline} />` still refers to the page's local component; Task 5 replaces it.

Then delete the local `TimelineChart` function and the comment above it, `// Reusable timeline chart (same as developer detail page)`. Keep the `useState` import.

- [ ] **Step 6: Wire the dev page**

In `src/app/report/[id]/dev/[login]/page.tsx`, add these imports after the `./usage-card` import:

```tsx
import { TimelineChart } from '@/components/charts/timeline-chart';
import { recentWeekDomain, toNum } from '@/components/charts/chart-format';
```

Directly after `const totalTyped = …`, add:

```tsx
  // One week domain per render, shared by every chart below so hover sync (syncId) lines up.
  const weeks = recentWeekDomain(new Date());
```

Replace the timeline grid block, from `{/* Timeline Charts */}` through its closing `)}`, with:

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

Then delete the local `TimelineChart` function, from `function TimelineChart({` through the end of the file. Keep the `useState` import.

`avgComplexity` deliberately gets no `isDefined`. Its payload has no denominator, so a present week that reports 0 is drawn as 0 (spec Decision 10 and Risks).

- [ ] **Step 7: Run the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all suites pass.

- [ ] **Step 8: Make the seed data exercise the charts (precondition for Step 9 and for Task 11's screenshot pass)**

The spec requires seeded in-flight commits and at least one scatter outlier. I checked the current seed on 2026-09-25 by importing `scripts/seed-data.ts` with `tsx`:

| Check | Result |
|---|---|
| **Outlier** | Present. In both completed reports, `frank-mock` exceeds 2× `medianCPI`, which is 15521 cents per impact point. No change needed. |
| **Timeline dates** | Out of range. `daysAgo()` counts from a fixed anchor, `2026-04-01T00:00:00Z`, so every seeded `committed_at` falls between 2026-03-18 and 2026-03-31. That is more than 90 days before today. Every seeded timeline, stacked-types and lines chart would therefore show its empty state, so neither Step 9 below nor Task 11's screenshot pass could check anything. |
| **In-flight commits** | None. `scripts/seed.ts` never inserts `unmerged_commits`, which is the table the org page's in-flight overlay reads (`src/lib/report/org.ts:108-176`). |

Re-check before editing, because the seed may have changed since. Write this file to your scratchpad as `seed-check.ts`, replacing `<scratchpad>` with the scratchpad path:

```ts
import * as data from '/Users/maes/Documents/1macmount/code/glooker/.claude/worktrees/GLOOK-58-recharts/scripts/seed-data';
const byReport = new Map<string, any[]>();
for (const d of data.seedDeveloperStats) byReport.set(d.report_id, [...(byReport.get(d.report_id) ?? []), d]);
for (const [rid, devs] of byReport) {
  const withSpend = devs.filter(d => Number(d.cc_total_cost ?? 0) > 0);
  const cpi = withSpend.filter(d => Number(d.impact_score) > 0).map(d => Number(d.cc_total_cost) / Number(d.impact_score)).sort((a, b) => a - b);
  const medianCPI = cpi[Math.floor(cpi.length / 2)] ?? 0;
  const outliers = withSpend.filter(d => Number(d.impact_score) > 0 && Number(d.cc_total_cost) / Number(d.impact_score) > 2 * medianCPI);
  console.log(rid, 'outliers:', outliers.map(d => d.github_login).join(',') || 'NONE');
}
const dates = data.seedCommitAnalyses.map((c: any) => String(c.committed_at)).sort();
console.log('commit dates', dates[0], '..', dates[dates.length - 1]);
console.log('unmerged commits exported:', 'seedUnmergedCommits' in data ? (data as any).seedUnmergedCommits.length : 'none');
```

Run it: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx tsx <scratchpad>/seed-check.ts'`

**If the dates are old or no in-flight rows are seeded (expected),** extend the seed. CLAUDE.md requires `scripts/seed-data.ts` to cover new page data needs. Inserting a new table also needs one line in `scripts/seed.ts`.

There are two ways to bring the dates into range:
- **Minimal (recommended): move the anchor to today's UTC midnight.** It is one helper change, every seeded surface moves into the window together, and values stay deterministic within a day.
- **Alternative: add a second, recent set of `commit_analyses` rows.** This keeps the fixed anchor, but duplicates about 60 rows and leaves the report headers dated March.

Go with the minimal option unless a test pins seeded dates. In that case, stop and report it.

1. In `scripts/seed-data.ts`, replace the two date helpers (`daysAgo` and `dateDaysAgo`, lines 18-30) with:

```ts
/**
 * GLOOK-58: seeded dates count back from today's UTC midnight (was a fixed 2026-04-01), so seeded
 * activity falls inside the charts' 90-day window. Values are deterministic within a day.
 */
const SEED_ANCHOR = (() => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
})();

/** ISO timestamp N days before SEED_ANCHOR */
function daysAgo(n: number): string {
  const anchor = new Date(SEED_ANCHOR);
  anchor.setUTCDate(anchor.getUTCDate() - n);
  return anchor.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

/** YYYY-MM-DD date N days before SEED_ANCHOR (for cc_period columns) */
function dateDaysAgo(n: number): string {
  const anchor = new Date(SEED_ANCHOR);
  anchor.setUTCDate(anchor.getUTCDate() - n);
  return anchor.toISOString().slice(0, 10);
}
```

2. In `scripts/seed-data.ts`, add a new section after section 13 (`seedUnmergedPrs`):

```ts
// ---------------------------------------------------------------------------
// 13b. seedUnmergedCommits (GLOOK-58: in-flight overlay rows, so the org charts show the hatch)
// ---------------------------------------------------------------------------
// One in-flight commit two days ago sits next to that week's full shipped total (a SHORT hatched
// segment); five in-flight commits nine days ago give a taller one. The two dates are exactly 7
// days apart, so they always fall in different UTC weeks.

const IN_FLIGHT_PLAN: Array<{ days: number; count: number }> = [
  { days: 2, count: 1 },
  { days: 9, count: 5 },
];

export const seedUnmergedCommits: Record<string, any>[] = [];
for (const { days, count } of IN_FLIGHT_PLAN) {
  for (let i = 0; i < count; i++) {
    const dev = MOCK_DEVELOPERS[i % MOCK_DEVELOPERS.length];
    seedUnmergedCommits.push({
      report_id: R1,
      github_login: dev.githubLogin,
      repo: 'data-pipeline',
      branch: `feature/in-flight-${days}-${i + 1}`,
      pr_number: null,
      commit_sha: fakeSha(`in-flight-${days}-${i}`),
      commit_message: `wip: in-flight change ${i + 1}`,
      lines_added: 40 + i * 10,
      lines_removed: 10 + i * 5,
      committed_at: daysAgo(days),
    });
  }
}
```

3. In `scripts/seed.ts`, add this line after `await seed('unmerged_prs', data.seedUnmergedPrs);`:

```ts
  await seed('unmerged_commits', data.seedUnmergedCommits);
```

4. Re-run the check script. Expected: an outlier is still listed, the commit dates fall within the last 14 days, and 6 unmerged commits are exported.
5. Run the full suite, which includes `cc-breakdown-mock.test.ts` (it imports `seed-data.ts`): `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`. Expected: all green. If a test pins seeded dates, stop and report it rather than editing that test.
6. Commit:

```bash
git add scripts/seed-data.ts scripts/seed.ts
git commit -F - <<'EOF'
GLOOK-58: seed data inside the 90-day chart window, with in-flight commits

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 9: Early browser check that `var()` resolves in Recharts presentation attributes**

Every Recharts mark in this plan passes its color as a presentation attribute, for example `fill="var(--accent)"`. shadcn relies on that working, but a GLOOK-43 comment in the old `trend-chart.tsx` says attributes "don't reliably resolve var()". Check it before later tasks build on it.

1. Reset the seed data: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run seed:reset'`
2. Start the mock server in the background: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run dev:mock'`. If port 3000 is taken (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health` prints anything but `000`), use `sh -c 'npm run dev:mock -- -p 3001'` instead. Also run `rm -rf .next` first if a `next build` ran since the last dev server.
3. Open `/reports`, then the newest report's `/report/<id>/org`.
4. Check the timeline bars:
   - **Accent-colored (amber in Amber Glow):** the assumption holds. Stop the server and continue.
   - **Black:** the attribute didn't resolve. Stop and report before Task 5. The fallback is a custom `shape` that passes the color through `style={{ fill }}`. That changes every chart task, so it needs sign-off first.

- [ ] **Step 10: Commit**

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
  - Delete `TYPE_COLORS`/`TYPE_HEX` (lines 11-31).
  - Fold `orgTypes`/`typeEntries`/`totalTyped` through `typeEntriesFrom` (lines 88-98).
  - Replace the donut card, the `<LinesChangedChart>` line and the `StackedTypesChart` line.
  - Delete the local `StackedTypesChart`, `LinesChangedChart` and `PieChart`.
- Test: `src/lib/__tests__/unit/stacked-types-chart.test.tsx`, `src/lib/__tests__/unit/lines-changed-chart.test.tsx`, `src/lib/__tests__/unit/commit-type-donut.test.tsx`

**Interfaces:**
- Consumes:
  - `indexByWeek`, `isTopOfStack`, `toNum`, `formatWeek`, `formatCompact` and `formatValue` from chart-format.
  - `COMMIT_TYPE_ORDER`, `commitTypeColor`, `foldTypes`, `typeEntriesFrom` and `CommitType` from commit-types.
  - `useHatch` and `HatchSwatch` from hatch.
  - `ChartContainer`, `ChartTooltip` and `CHART_TOOLTIP_CLASS` from chart.
- Produces:
  - `StackedTypesChart({ data, weeks }: { data: Array<{ week: string; types?: Record<string, unknown> }>; weeks: string[] })`
  - `StackedTypesTooltip(props: Partial<TooltipContentProps<TooltipValueType, string | number>>)`, the tooltip body; it lists the week total and the non-zero types
  - `interface LinesWeek { week: string; linesP95Added?: unknown; linesP95Removed?: unknown; inFlightLinesP95Added?: unknown; inFlightLinesP95Removed?: unknown }`
  - `LinesChangedChart({ data, weeks, syncId }: { data: LinesWeek[]; weeks: string[]; syncId?: string })`
  - `LinesTooltip(props: Partial<TooltipContentProps<TooltipValueType, string | number>>)`, the tooltip body
  - `CommitTypeDonut({ entries, total }: { entries: [string, number][]; total: number | string })`

**Behavior:**
- **LinesChangedChart (Decision 12):**
  - Shipped `linesP95*` and in-flight `inFlightLinesP95*` values are **additive** layers.
  - Added lines sit above zero. Removed lines are negated and sit below, in one `stackOffset="sign"` stack.
  - Both in-flight layers use one hatch in `--chart-type-in-flight`.
  - The zero baseline is `ReferenceLine y={0}` in `var(--chart-axis)`, and the chart joins `syncId="org-timeline"`.
- **StackedTypesChart:**
  - Unknown types fold into `other`.
  - The legend lists only the types present, in `COMMIT_TYPE_ORDER`, with a hatched `in_flight` swatch.
- **CommitTypeDonut (Decision 13):**
  - Slices and legend rows follow the fixed `COMMIT_TYPE_ORDER`, not a sort by count. The component renders `entries` in the order it receives them. The page passes `typeEntriesFrom(...)`, which returns that fixed order.
  - The legend always shows count and %.
  - The center shows the total at rest. Hovering a legend row shows that type's count, swatch, name and %, and dims the other slices.
  - Center text uses chrome tokens only.
  - The `in_flight` wedge and swatch are hatched.
  - A total of 0 shows "No categorized commits".
  - It uses `ChartContainer className="aspect-square"` inside a `max-w-[320px]` wrapper. This gives the same 1:1 shape as the spec's `ResponsiveContainer aspect={1}`, because `ChartContainer` owns the container.
  - Rows carry `fill` and `opacity`. Pie reads `fill` from each data entry and spreads the entry into the sector's props.
  - `Cell` isn't used, because it is deprecated in 3.10.
- **Folding (spec CommitTypeDonut).** The page builds `entries` and `total` with `typeEntriesFrom`, never a raw `Object.entries(week.types)`, so an unknown type joins the single `other` row.

**Every `.types` read, per the review loop's grep.** Command: `grep -nE "\.types\b|type_breakdown" src/app/report/[id]/org/page.tsx src/app/report/[id]/dev/[login]/page.tsx src/app/report/[id]/team/dev-table.tsx`

| Site | What it reads | Action |
|---|---|---|
| `org/page.tsx:93` | The donut totals | Folded in this task |
| `org/page.tsx:258` | `d.types?.in_flight` | Reads a known key, not a type list; no fold needed |
| `org/page.tsx:421-428` | The old `StackedTypesChart` | Deleted in this task; the new chart folds |
| `dev/[login]/page.tsx:165` | `type_breakdown` | Folded in Task 7 |
| `team/dev-table.tsx` `TypeBreakdown` | `breakdown` | Folded in Task 7 |

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

it('shows the empty state for an old report whose weeks are all outside the domain', () => {
  render(<StackedTypesChart data={[{ week: '2025-01-06', types: { feature: 4 } }]} weeks={weeks} />);
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
import { LinesChangedChart, LinesTooltip } from '@/components/charts/lines-changed-chart';
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

it('shows the empty state for an old report whose weeks are all outside the domain', () => {
  render(<LinesChangedChart data={[{ week: '2025-01-06', linesP95Added: 90, linesP95Removed: 10 }]} weeks={weeks} />);
  expect(screen.getByText('No line changes in the last 90 days')).toBeTruthy();
});

it('the tooltip shows added, removed, in-flight and total for the week', () => {
  const row = { week: '2026-09-14', added: 50, inFlightAdded: 30, removed: -20, inFlightRemoved: -10 };
  const { container } = render(<LinesTooltip active payload={[{ payload: row }] as never} />);
  expect(container.textContent).toContain('+50 added');
  expect(container.textContent).toContain('+30 added in flight');
  expect(container.textContent).toContain('−20 removed');
  expect(container.textContent).toContain('−10 removed in flight');
  expect(container.textContent).toContain('50 total');
});
```

Create `src/lib/__tests__/unit/commit-type-donut.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommitTypeDonut } from '@/components/charts/commit-type-donut';
import { typeEntriesFrom } from '@/components/charts/commit-types';
import { fixChartSize } from '../setup/chart-size';

fixChartSize(320, 320);

const entries: [string, number][] = [['feature', 6], ['bug', 3], ['in_flight', 1]];
const center = () => screen.getByTestId('donut-center');

it('orders slices and legend rows by COMMIT_TYPE_ORDER, not by count', () => {
  const byOrder = typeEntriesFrom([{ in_flight: 9, feature: 1, other: 5, bug: 3 }]);
  const { container } = render(<CommitTypeDonut entries={byOrder} total={18} />);
  const legend = Array.from(container.querySelectorAll('[data-testid^="donut-legend-"]')).map(e => e.getAttribute('data-testid'));
  expect(legend).toEqual(['donut-legend-feature', 'donut-legend-bug', 'donut-legend-other', 'donut-legend-in_flight']);
  const fills = Array.from(container.querySelectorAll('.recharts-pie-sector path')).map(p => p.getAttribute('fill'));
  expect(fills.slice(0, 3)).toEqual(['var(--chart-type-feature)', 'var(--chart-type-bug)', 'var(--chart-type-other)']);
  expect(fills[3]).toMatch(/^url\(#hatch-/);
});

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

it('fills the in_flight wedge and its legend swatch with a hatch pattern', () => {
  const { container } = render(<CommitTypeDonut entries={entries} total={10} />);
  const sectors = Array.from(container.querySelectorAll('.recharts-pie-sector path'));
  expect(sectors[0].getAttribute('fill')).toBe('var(--chart-type-feature)');
  const hatchFill = sectors[2].getAttribute('fill')!;
  expect(hatchFill).toMatch(/^url\(#hatch-/);
  expect(container.querySelector(`pattern#${hatchFill.slice(5, -1)}`)).not.toBeNull();
  expect(screen.getByTestId('donut-legend-in_flight').querySelector('pattern')).not.toBeNull();
});

it('an unknown type folds into a single "other" row with a single wedge', () => {
  const folded = typeEntriesFrom([{ feature: 2, chore: 1, other: 1 }]);
  const { container } = render(<CommitTypeDonut entries={folded} total={4} />);
  expect(screen.queryByTestId('donut-legend-chore')).toBeNull();
  expect(screen.getByTestId('donut-legend-other').textContent).toContain('2 (50%)');
  const otherWedges = Array.from(container.querySelectorAll('.recharts-pie-sector path'))
    .filter(p => p.getAttribute('fill') === 'var(--chart-type-other)');
  expect(otherWedges).toHaveLength(1);
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
import { formatCompact, formatWeek, indexByWeek, isTopOfStack } from './chart-format';
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
  const byWeek = indexByWeek(data);
  const rows: StackRow[] = weeks.map(week => {
    const folded = foldTypes([byWeek.get(week)?.types ?? {}]);
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

The legend swatch is an `<i>`, so the legend test's `span.text-chart-axis` query reaches only the labeled entries.

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
import { formatCompact, formatValue, formatWeek, indexByWeek, toNum } from './chart-format';
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
  const byWeek = indexByWeek(data);
  const rows: LinesRow[] = weeks.map(week => {
    const r = byWeek.get(week);
    return {
      week,
      added: toNum(r?.linesP95Added),
      inFlightAdded: toNum(r?.inFlightLinesP95Added),
      removed: -toNum(r?.linesP95Removed),
      inFlightRemoved: -toNum(r?.inFlightLinesP95Removed),
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
// swatch beside it, never from coloured text. Callers pass entries built with typeEntriesFrom(),
// so unknown types are already folded into `other`.
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

These points are read from the Recharts source but haven't yet been observed in jsdom. Check each if its test fails:
- **Rectangle `y`/`height` attributes.** The "draws removed lines below the zero baseline" test reads the `y` and `height` attributes of `path.recharts-rectangle`. Recharts writes them only while the rectangle isn't animating. If they're missing, confirm `isAnimationActive={false}` on every `Bar`.
- **Removed bars above zero.** If removed bars render above zero, the negative-stack fix (upstream issue 6802, fixed by PR 6806 on 2025-12-19) has regressed. Stop and report it. Two `stackId`s are **not** an acceptable fallback (spec Risks).
- **Donut dimming.** This relies on Pie spreading each entry's fields into the sector path. If `opacity` is missing from the paths while the center and legend still behave, move the dimming to a `className: 'opacity-30'` on the dimmed entries. Recharts appends `entry.className` to the sector, so assert on the class instead.

- [ ] **Step 7: Try the slice-hover test (keep it only if it passes)**

Append this test to `commit-type-donut.test.tsx` and run the file again:

```tsx
it('hovering a slice also moves its figures into the centre', () => {
  const { container } = render(<CommitTypeDonut entries={entries} total={10} />);
  fireEvent.mouseEnter(container.querySelectorAll('.recharts-pie-sector')[0]);
  expect(center().textContent).toBe('6feature60%');
});
```

- **If it passes:** keep it.
- **If it fails:** remove it before committing. Recharts 3 wires the sector's `onMouseEnter` through its own interaction store, and a synthetic `mouseenter` on the `<g>` may not reach `Pie`'s `onMouseEnter` in jsdom. The **fallback** is Task 11's screenshot checklist, item 7 (Donut), which checks slice hover in a real browser. Say in the commit body which way it went.

The required center-label test is the legend-row hover test in Step 1. It needs nothing from Recharts' event wiring.

- [ ] **Step 8: Wire the org page and delete the old charts and color maps**

In `src/app/report/[id]/org/page.tsx`:

1. **Delete** `const TYPE_COLORS …` and `const TYPE_HEX …` (lines 11-31).
2. **Add** these imports next to the ones from Task 4:

```tsx
import { StackedTypesChart } from '@/components/charts/stacked-types-chart';
import { LinesChangedChart } from '@/components/charts/lines-changed-chart';
import { CommitTypeDonut } from '@/components/charts/commit-type-donut';
import { typeEntriesFrom } from '@/components/charts/commit-types';
```

3. **Replace the type-breakdown computation** (the comment starting `// Type breakdown — sum across all timeline weeks`, then `const orgTypes …`, the `for` loop, `const typeEntries …` and `const totalTyped …`) with:

```tsx
  // Type breakdown — folded across all timeline weeks, so an unrecognized type joins `other`
  // instead of becoming a second, identically coloured wedge. timeline already carries the
  // per-commit in_flight override (applied server-side in getOrgReport).
  const typeEntries = typeEntriesFrom(timeline.map(w => w.types ?? {}));
  const totalTyped = typeEntries.reduce((s, [, c]) => s + c, 0);
```

4. **Replace the donut card** (the block starting `{/* Type Breakdown — Pie Chart */}`) with:

```tsx
        {/* Type Breakdown — Donut */}
        <div className="bg-gray-900 rounded-xl p-5 flex flex-col">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-4 font-semibold">Commit Types (org-wide)</p>
          <div className="flex-1 flex items-center"><CommitTypeDonut entries={typeEntries} total={totalTyped} /></div>
        </div>
```

5. **In the timeline grid,** replace `<LinesChangedChart data={timeline} />` with:

```tsx
            <LinesChangedChart data={timeline} weeks={weeks} syncId="org-timeline" />
```

6. **Replace** `{timeline.length >= 2 && <StackedTypesChart data={timeline} />}` with:

```tsx
      {timeline.length >= 2 && <StackedTypesChart data={timeline} weeks={weeks} />}
```

7. **Delete** the local functions `StackedTypesChart`, `LinesChangedChart` and `PieChart`, from `function StackedTypesChart({ data }: { data: WeeklyData[] }) {` to the end of the file. Keep `useState` and the `WeeklyData` interface.

- [ ] **Step 9: Run the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all suites pass.

- [ ] **Step 10: Commit**

```bash
git add src/components/charts/stacked-types-chart.tsx src/components/charts/lines-changed-chart.tsx src/components/charts/commit-type-donut.tsx src/lib/__tests__/unit/stacked-types-chart.test.tsx src/lib/__tests__/unit/lines-changed-chart.test.tsx src/lib/__tests__/unit/commit-type-donut.test.tsx "src/app/report/[id]/org/page.tsx"
git commit -F - <<'EOF'
GLOOK-58: stacked types, diverging lines and donut charts on the org page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: `SpendImpactScatter` on the spend tab

**Files:**
- Create: `src/components/charts/spend-impact-scatter.tsx`
- Modify: `src/app/report/[id]/org/spend-tab.tsx`
  - the imports (lines 3-5)
  - delete `maxImpact`/`maxCost` (lines 204-205)
  - replace the scatter block (lines 518-561)
- Test: `src/lib/__tests__/unit/spend-impact-scatter.test.tsx`

**Interfaces:**
- Consumes:
  - `toNum` and `formatCompact` from chart-format.
  - `ChartContainer`, `ChartTooltip` and `CHART_TOOLTIP_CLASS` from chart.
  - `--chart-scatter-typical`, `--chart-scatter-outlier` and `--chart-axis` from Task 1.
- Produces, from `@/components/charts/spend-impact-scatter`:
  - `interface ScatterPoint { login: string; impact: number; cost: number; outlier: boolean }`. `cost` is in cents, as `cc_total_cost` is.
  - `SpendImpactScatter({ points, medianImpact, medianCost, onSelect }: { points: ScatterPoint[]; medianImpact: number; medianCost: number; onSelect: (login: string) => void })`
  - `SpendImpactTooltip(props)`, the tooltip body

**Behavior (spec Charts → SpendImpactScatter):**
- **Axes:** a `ScatterChart` with numeric axes, impact on x and dollars on y.
- **Median lines:** `ReferenceLine x={medianImpact}` and `ReferenceLine y={medianCost}`. They share the dots' axes, so the quadrant boundaries sit in the dots' scale. Today they don't (`:527-528` vs `:537-538`).
- **Series:** two `Scatter` series, `typical` (circle) and `outlier` (triangle), in the scatter tokens. An HTML legend shows the shape swatches.
- **Kept from today:** the four quadrant labels, the tooltip (login, spend, impact) and click-to-navigate.
- **Empty state:** "No developer has spend in this period".
- **Unchanged in `spend-tab.tsx`:** the `isOutlier` rule (`:191-195`, cost per impact point > 2× `medianCPI`) and the median computations. The component gets the flag per point.

**Routing.** `SpendTab` receives `router` as a prop (`spend-tab.tsx:134-137`) rather than calling `useRouter()`. The existing `spend-model-mix.test.tsx` passes `router: { push: jest.fn() }`. So the click test renders `SpendTab` with a `push` mock, following the same convention. No `next/navigation` mock is needed.

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/spend-impact-scatter.test.tsx`:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SpendImpactScatter, type ScatterPoint } from '@/components/charts/spend-impact-scatter';
import { SpendTab } from '@/app/report/[id]/org/spend-tab';
import { fixChartSize } from '../setup/chart-size';

fixChartSize(640, 320);

const points: ScatterPoint[] = [
  { login: 'dev-a', impact: 2, cost: 100, outlier: false },
  { login: 'dev-b', impact: 5, cost: 500, outlier: false },
  { login: 'dev-c', impact: 8, cost: 900, outlier: false },
  { login: 'dev-d', impact: 1, cost: 800, outlier: true },
];

const symbolsOf = (c: HTMLElement, series: 'typical' | 'outlier') =>
  Array.from(c.querySelectorAll(`.recharts-scatter.scatter-${series} path.recharts-symbols`));
const centre = (p: Element) => {
  const m = /translate\(([-\d.]+),\s*([-\d.]+)\)/.exec(p.getAttribute('transform') ?? '');
  return { cx: Number(m![1]), cy: Number(m![2]) };
};

it('a developer at exactly the median impact and cost sits on both reference lines', () => {
  const { container } = render(<SpendImpactScatter points={points} medianImpact={5} medianCost={500} onSelect={() => {}} />);
  const lines = Array.from(container.querySelectorAll('.recharts-reference-line line'));
  const vertical = lines.find(l => l.getAttribute('x1') === l.getAttribute('x2'))!;
  const horizontal = lines.find(l => l.getAttribute('y1') === l.getAttribute('y2'))!;
  const atMedian = centre(symbolsOf(container, 'typical')[1]); // dev-b
  expect(atMedian.cx).toBeCloseTo(Number(vertical.getAttribute('x1')), 1);
  expect(atMedian.cy).toBeCloseTo(Number(horizontal.getAttribute('y1')), 1);
});

it('outliers use the triangle marker and the outlier colour; typical developers use circles', () => {
  const { container } = render(<SpendImpactScatter points={points} medianImpact={5} medianCost={500} onSelect={() => {}} />);
  const outliers = symbolsOf(container, 'outlier');
  const typical = symbolsOf(container, 'typical');
  expect(outliers).toHaveLength(1);
  expect(typical).toHaveLength(3);
  // d3's circle symbol is drawn with arcs; its triangle is straight segments only.
  expect(outliers[0].getAttribute('d')).not.toMatch(/A/);
  typical.forEach(p => expect(p.getAttribute('d')).toMatch(/A/));
  expect(outliers[0].getAttribute('fill')).toBe('var(--chart-scatter-outlier)');
  typical.forEach(p => expect(p.getAttribute('fill')).toBe('var(--chart-scatter-typical)'));
  expect(screen.getByText('Typical')).toBeTruthy();
  expect(screen.getByText(/Outlier/)).toBeTruthy();
});

it('string cost and impact values still place a dot', () => {
  const stringy = [{ login: 'dev-s', impact: '4.5' as unknown as number, cost: '300' as unknown as number, outlier: false }];
  const { container } = render(<SpendImpactScatter points={stringy} medianImpact={4.5} medianCost={300} onSelect={() => {}} />);
  const { cx, cy } = centre(symbolsOf(container, 'typical')[0]);
  expect(Number.isFinite(cx) && Number.isFinite(cy)).toBe(true);
});

it('shows an explicit empty state when no developer has spend', () => {
  render(<SpendImpactScatter points={[]} medianImpact={0} medianCost={0} onSelect={() => {}} />);
  expect(screen.getByText('No developer has spend in this period')).toBeTruthy();
});

it('clicking a dot on the spend tab navigates to that developer', () => {
  const push = jest.fn();
  const developers = [
    { github_login: 'alice', cc_total_cost: 600, cc_requests: 10, impact_score: 5 },
    { github_login: 'bob', cc_total_cost: 400, cc_requests: 40, impact_score: 4 },
  ] as never[];
  const { container } = render(
    <SpendTab developers={developers} reportId="r1" router={{ push } as never} report={{ id: 'r1', org: 'acme', period_days: 14 } as never}
      spendWindow={null} modelUsage={[]} skillsUsage={[]} />,
  );
  const first = container.querySelector('.recharts-scatter.scatter-typical .recharts-scatter-symbol')!; // withSpend is sorted by cost: alice first
  fireEvent.click(first);
  expect(push).toHaveBeenCalledWith('/report/r1/dev/alice');
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/spend-impact-scatter.test.tsx'`

Expected: FAIL with `Cannot find module '@/components/charts/spend-impact-scatter'`.

- [ ] **Step 3: Implement `SpendImpactScatter`**

Create `src/components/charts/spend-impact-scatter.tsx`:

```tsx
'use client';

// GLOOK-58: Spend vs Impact as a Recharts ScatterChart. The median reference lines share the dots'
// axes, so the quadrant boundaries are drawn in the same scale as the dots (the old <div> plot
// scaled dots by x*92+4 but the lines by x*100, which put the quadrants in the wrong place).
// Outliers differ by shape (triangle) as well as colour, so they never depend on colour alone.
import { CartesianGrid, ReferenceLine, Scatter, ScatterChart, XAxis, YAxis } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS } from './chart';
import { formatCompact, toNum } from './chart-format';

export interface ScatterPoint {
  login: string;
  impact: number;
  /** Cents, as cc_total_cost. */
  cost: number;
  outlier: boolean;
}

const TYPICAL = 'var(--chart-scatter-typical)';
const OUTLIER = 'var(--chart-scatter-outlier)';
const dollars = (cents: number) => `$${(toNum(cents) / 100).toFixed(2)}`;
const axisDollars = (cents: number) => `$${formatCompact(toNum(cents) / 100)}`;

export function SpendImpactTooltip({ active, payload }: Partial<TooltipContentProps<TooltipValueType, string | number>>) {
  const p = payload?.[0]?.payload as ScatterPoint | undefined;
  if (!active || !p) return null;
  return (
    <div className={CHART_TOOLTIP_CLASS}>
      <div className="font-medium">@{p.login}</div>
      <div className="font-mono tabular-nums">{dollars(p.cost)} · {p.impact.toFixed(1)} impact</div>
      {p.outlier && <div>Cost per impact point over 2× the median</div>}
    </div>
  );
}

export function SpendImpactScatter({ points, medianImpact, medianCost, onSelect }: {
  points: ScatterPoint[];
  medianImpact: number;
  medianCost: number;
  onSelect: (login: string) => void;
}) {
  if (points.length === 0) {
    return <p className="text-xs text-chart-axis py-8 text-center">No developer has spend in this period</p>;
  }
  const clean = points.map(p => ({ ...p, impact: toNum(p.impact), cost: toNum(p.cost) }));
  const typical = clean.filter(p => !p.outlier);
  const outliers = clean.filter(p => p.outlier);
  const select = (item: unknown) => {
    const login = (item as { payload?: ScatterPoint } | undefined)?.payload?.login;
    if (login) onSelect(login);
  };

  return (
    <div>
      <div className="relative">
        <ChartContainer config={{}} className="aspect-auto h-[320px] w-full">
          <ScatterChart margin={{ top: 20, right: 16, bottom: 4, left: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis type="number" dataKey="impact" name="Impact" domain={[0, 'auto']} tickLine={false} axisLine={false} />
            <YAxis type="number" dataKey="cost" name="Spend" domain={[0, 'auto']} tickLine={false} axisLine={false} width={56} tickFormatter={axisDollars} />
            <ReferenceLine x={toNum(medianImpact)} stroke="var(--chart-axis)" strokeDasharray="4 4" />
            <ReferenceLine y={toNum(medianCost)} stroke="var(--chart-axis)" strokeDasharray="4 4" />
            <ChartTooltip cursor={false} content={<SpendImpactTooltip />} />
            <Scatter name="typical" className="scatter-typical cursor-pointer" data={typical} fill={TYPICAL} shape="circle"
              isAnimationActive={false} onClick={select} />
            <Scatter name="outlier" className="scatter-outlier cursor-pointer" data={outliers} fill={OUTLIER} shape="triangle"
              isAnimationActive={false} onClick={select} />
          </ScatterChart>
        </ChartContainer>
        <div className="pointer-events-none absolute top-1 left-16 text-[10px] text-chart-axis">High Spend / Low Impact</div>
        <div className="pointer-events-none absolute top-1 right-4 text-[10px] text-chart-axis">High Spend / High Impact</div>
        <div className="pointer-events-none absolute bottom-8 left-16 text-[10px] text-chart-axis">Low Spend / Low Impact</div>
        <div className="pointer-events-none absolute bottom-8 right-4 text-[10px] text-chart-axis">Low Spend / High Impact</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 mt-2 text-[11px] text-chart-axis">
        <span>Impact score → · Spend ↑ · dashed lines are the medians</span>
        <span className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true"><circle cx={5} cy={5} r={4} style={{ fill: TYPICAL }} /></svg>
            <span>Typical</span>
          </span>
          <span className="flex items-center gap-1.5">
            <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1 L9 9 L1 9 Z" style={{ fill: OUTLIER }} /></svg>
            <span>Outlier (cost per impact point over 2× the median)</span>
          </span>
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the spend tab**

In `src/app/report/[id]/org/spend-tab.tsx`:

1. Add these imports after the `RunMetadata` type import:

```tsx
import { SpendImpactScatter } from '@/components/charts/spend-impact-scatter';
import { toNum } from '@/components/charts/chart-format';
```

2. Delete the two lines `const maxImpact = …` and `const maxCost = …`. After step 3, nothing uses them; confirm with `grep -n "maxImpact\|maxCost"` on the file, which should show no hits.
3. Replace the scatter block, from `{/* Spend vs Impact Scatter Plot */}` through the closing `</div>` of that card (the one before the tab's final `</div>`), with:

```tsx
      {/* Spend vs Impact Scatter Plot */}
      <div className="bg-gray-900 rounded-xl p-5">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-4">Spend vs Impact</p>
        <SpendImpactScatter
          points={withSpend.map(dev => ({
            login: dev.github_login,
            impact: toNum(dev.impact_score),
            cost: toNum(dev.cc_total_cost),
            outlier: isOutlier(dev),
          }))}
          medianImpact={medianImpact}
          medianCost={medianCost}
          onSelect={login => router.push(`/report/${reportId}/dev/${login}`)}
        />
      </div>
```

- [ ] **Step 5: Run the scatter test and the existing spend-tab suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/spend-impact-scatter.test.tsx src/lib/__tests__/unit/spend-model-mix.test.tsx'`

Expected: PASS.

These points are read from the Recharts source but haven't yet been observed in jsdom. Check each if its test fails:
- **Symbol position.** `Symbols` renders a `path.recharts-symbols` whose position is a `transform="translate(cx, cy)"` (`es6/shape/Symbols.js`). If `centre()` finds no transform, log one symbol's attributes and read `cx`/`cy` from wherever they appear.
- **Series className.** If `.recharts-scatter.scatter-typical` matches nothing, the series `className` isn't reaching the layer. Select series by fill instead: circles have fill `var(--chart-scatter-typical)`.
- **The triangle shape.** If `shape="triangle"` throws, fails to type-check, or renders no `path.recharts-symbols` for the outlier series, check the exact symbol literal the installed version accepts.
  - In 3.10.1 the union is declared in `node_modules/recharts/types/util/types.d.ts`: `export type SymbolType = 'circle' | 'cross' | 'diamond' | 'square' | 'star' | 'triangle' | 'wye'`. It is not in `types/shape/Symbols.d.ts`, which only imports it.
  - If the literal is right but nothing renders, pass a render prop instead: `shape={(p: { cx?: number; cy?: number; fill?: string }) => <Symbols cx={p.cx} cy={p.cy} type="triangle" size={64} fill={p.fill} />}`. `Symbols` is exported from `recharts`. Keep the triangle test unchanged.
- **Click handler argument.** Recharts wires `Scatter`'s `onClick` through `useMouseClickItemDispatch`. If `push` isn't called, log the handler's first argument. It should carry `payload.login`. If the handler never fires from `fireEvent.click` on `.recharts-scatter-symbol`, try the inner `path.recharts-symbols`. If neither works, report it before committing; click-to-navigate is a kept behavior.

- [ ] **Step 6: Run the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all suites pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/charts/spend-impact-scatter.tsx src/lib/__tests__/unit/spend-impact-scatter.test.tsx "src/app/report/[id]/org/spend-tab.tsx"
git commit -F - <<'EOF'
GLOOK-58: Spend vs Impact as a Recharts scatter with medians in the dots' scale

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: Dev page and team dev-table use the shared commit-type map

**Files:**
- Modify: `src/app/report/[id]/dev/[login]/page.tsx`
  - Delete `TYPE_COLORS`/`TYPE_TEXT_COLORS` (lines 10-18).
  - Fold `typeEntries` (line 165).
  - Update the Commit Types segmented bar and its legend (lines 262-288).
  - Update the commit-row type badge (~line 499).
- Modify: `src/app/report/[id]/team/dev-table.tsx`
  - Delete `TYPE_COLORS` (lines 27-35).
  - Fold and badge `TypeBreakdown` (lines 315-329).
- Modify: `src/app/globals.css`, the print `/* Keep badges colored */` rule
- Modify: `src/lib/__tests__/unit/commit-types.test.ts` (un-skip the page-map test)
- Test: `src/lib/__tests__/unit/dev-type-badges.test.tsx`

**Interfaces:**
- Consumes: `commitTypeBg`, `commitTypeBadge` and `typeEntriesFrom` from `@/components/charts/commit-types`.
- Produces: nothing new.

**Behavior (amended spec Decisions 1 and 14):**
- **Segmented bar:** the dev page's Commit Types bar keeps its HTML `<div>`s. Its **segments** use the mark classes (`commitTypeBg`).
- **Legend and badges:** the count legend under that bar, the commit-row badges and the team table's badges all use `commitTypeBadge`. That is a separate fill/text pair with 4.5:1 text, so none of them combines a mark color with `text-white` any more.
- **Folding:** the dev page's `typeEntries` and the team `TypeBreakdown` are folded with `typeEntriesFrom`, so unknown types join `other`.
- **Order:** they now show types in the fixed `COMMIT_TYPE_ORDER`, where today they sort by count. On the segmented bar that order is required, because adjacent segments must be pairs the palette gate checked. The team badges follow the same order for consistency.

**CSS rules:**
- **Light mode needs no new rule.** The old breakage came from `[data-theme-mode="light"] .text-white` turning white badge text dark. Badges no longer use `text-white`; their text color comes from `--chart-badge-*-text`, which the light block redefines.
- **Print needs one change.** The print block forces `print-color-adjust: exact` only for listed classes, so the new mark and badge background classes are added to that list.

- [ ] **Step 1: Un-skip the page-map guard and write the badge test**

In `src/lib/__tests__/unit/commit-types.test.ts`, change `it.skip('no report page keeps its own commit-type colour map'` back to `it('no report page keeps its own commit-type colour map'`.

Create `src/lib/__tests__/unit/dev-type-badges.test.tsx`. It renders the team `DevTable`, which is exported from a non-page module, and checks the badge classes a user would see:

```tsx
/** @jest-environment jsdom */
import React from 'react';
import { render } from '@testing-library/react';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/report/r1/team/core',
}));

import DevTable from '@/app/report/[id]/team/dev-table';

const dev = {
  github_login: 'dev-a', github_name: 'Dev A', avatar_url: '', total_prs: 1, total_commits: 4,
  lines_added: 10, lines_removed: 2, avg_complexity: 3, impact_score: 5, pr_percentage: 50, ai_percentage: 0,
  type_breakdown: { feature: 2, chore: 1, other: 1 }, active_repos: [],
};

const renderTable = () => render(<DevTable developers={[dev] as never} reportId="r1" org="acme" filterLogins={new Set()} />);

it('team type badges use the badge fill and badge text classes, never a mark colour with text-white', () => {
  const { container } = renderTable();
  const badges = Array.from(container.querySelectorAll('span.rounded.text-xs')).filter(s => /^(feature|other)/.test(s.textContent ?? ''));
  expect(badges.map(b => b.textContent?.split(' ')[0])).toEqual(['feature', 'other']);
  const feature = badges[0].className;
  expect(feature).toContain('bg-chart-badge-feature-bg');
  expect(feature).toContain('text-chart-badge-feature-text');
  expect(feature).not.toContain('text-white');
});

it('an unknown type folds into the single other badge', () => {
  const { container } = renderTable();
  const other = Array.from(container.querySelectorAll('span.rounded.text-xs')).find(s => s.textContent?.startsWith('other'))!;
  expect(other.textContent).toBe('other 2');
  expect(container.textContent).not.toContain('chore');
});
```

`DevTable` is the default export. Its props are `developers`, `reportId`, `org` and `filterLogins` (`dev-table.tsx:44-53`); an empty `filterLogins` shows every developer. It reads `useRouter` directly, and `usePathname` and `useSearchParams` through `useUrlState`, which is why those three hooks are mocked. If a type badge renders only inside an expanded row, expand that row first with `fireEvent.click` on the developer row. Keep the assertions unchanged.

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/commit-types.test.ts src/lib/__tests__/unit/dev-type-badges.test.tsx'`

Expected: FAIL. In `commit-types.test.ts`, `offenders` lists the dev page and `team/dev-table.tsx`. The badge test sees `bg-purple-500`-style classes and a separate `chore` badge.

- [ ] **Step 2: Update the dev page**

In `src/app/report/[id]/dev/[login]/page.tsx`:
- Delete `const TYPE_COLORS …` and `const TYPE_TEXT_COLORS …`. `TYPE_TEXT_COLORS` is unused today.
- Add `import { commitTypeBadge, commitTypeBg, typeEntriesFrom } from '@/components/charts/commit-types';` next to the Task 4 imports.
- Replace `const typeEntries = Object.entries(dev.type_breakdown || {}).sort((a, b) => b[1] - a[1]);` with:

```tsx
  const typeEntries = typeEntriesFrom([dev.type_breakdown ?? {}]);
```

- Replace the Commit Types card body, from `{totalTyped > 0 && (` through the legend's closing `</div>`, with:

```tsx
          {totalTyped > 0 && (
            <div className="h-4 rounded-full overflow-hidden flex mb-3">
              {typeEntries.map(([type, count]) => (
                <div
                  key={type}
                  className={`${commitTypeBg(type)} h-full`}
                  style={{ width: `${(count / totalTyped) * 100}%` }}
                  title={`${type}: ${count}`}
                />
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {typeEntries.map(([type, count]) => {
              const badge = commitTypeBadge(type);
              return (
                <span key={type} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${badge.bg} ${badge.text}`}>
                  {type} <span className="opacity-80">{count} ({Math.round((count / totalTyped) * 100)}%)</span>
                </span>
              );
            })}
          </div>
```

- Replace the commit-row badge (the `<span className={`inline-block px-1.5 py-0.5 rounded text-xs text-white ${TYPE_COLORS[c.type] || 'bg-gray-600'}`}>` line) with:

```tsx
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs ${commitTypeBadge(c.type).bg} ${commitTypeBadge(c.type).text}`}>
```

- [ ] **Step 3: Update the team dev-table**

In `src/app/report/[id]/team/dev-table.tsx`:
- Delete `const TYPE_COLORS …`.
- Add `import { commitTypeBadge, typeEntriesFrom } from '@/components/charts/commit-types';` after the `url-state` import.
- Replace the `TypeBreakdown` function with:

```tsx
function TypeBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = typeEntriesFrom([breakdown ?? {}]);
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(([type, count]) => {
        const badge = commitTypeBadge(type);
        return (
          <span key={type} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ${badge.bg} ${badge.text}`}>
            {type} <span className="opacity-75">{count}</span>
          </span>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Keep marks and badges colored in print**

In `src/app/globals.css`, in the print block's `/* Keep badges colored */` rule, extend the selector list so it reads:

```css
  .bg-blue-500, .bg-blue-600, .bg-blue-700,
  .bg-red-500, .bg-green-500, .bg-purple-500,
  .bg-yellow-500, .bg-gray-500, .bg-gray-600, .bg-gray-700,
  .bg-chart-type-feature, .bg-chart-type-bug, .bg-chart-type-refactor, .bg-chart-type-infra,
  .bg-chart-type-docs, .bg-chart-type-test, .bg-chart-type-other, .bg-chart-type-in-flight,
  .bg-chart-badge-feature-bg, .bg-chart-badge-bug-bg, .bg-chart-badge-refactor-bg, .bg-chart-badge-infra-bg,
  .bg-chart-badge-docs-bg, .bg-chart-badge-test-bg, .bg-chart-badge-other-bg, .bg-chart-badge-in-flight-bg {
```

- [ ] **Step 5: Run the tests and the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all suites pass, including the un-skipped page-map guard and `dev-type-badges.test.tsx`.

- [ ] **Step 6: Commit**

```bash
git add "src/app/report/[id]/dev/[login]/page.tsx" "src/app/report/[id]/team/dev-table.tsx" src/app/globals.css src/lib/__tests__/unit/commit-types.test.ts src/lib/__tests__/unit/dev-type-badges.test.tsx
git commit -F - <<'EOF'
GLOOK-58: dev page and team table read the shared commit-type marks and badges

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 8: `TrendChart` rewrite, `assignTeamColors`, and the `colorByTeam` caller

**Files:**
- Create: `src/app/vulnerabilities/team-colors.ts`
- Rewrite: `src/app/vulnerabilities/trend-chart.tsx`
- Modify: `src/app/vulnerabilities/vulnerabilities-content.tsx`, the import at line 9 and the `TrendChart` render at line 203
- Rewrite: `src/lib/__tests__/unit/vuln-trend-chart.test.tsx`
- Create: `src/lib/__tests__/unit/vuln-team-colors.test.ts` and `src/lib/__tests__/unit/vuln-content-trend-colors.test.tsx`

**Interfaces:**
- Consumes:
  - `TrendSeries` (`{ team: string; points: Array<{ date: string; open: number }> }`) from `@/lib/vulnerabilities/aggregate`.
  - `ChartContainer`, `ChartTooltip`, `ChartTooltipContent` and `ChartConfig` from chart.
  - `formatWeek` and `toNum` from chart-format.
- Produces:
  - `assignTeamColors(series: TrendSeries[]): Record<string, string>`
  - `OTHER_TEAM_COLOR = 'var(--vuln-series-other)'`
  - `TrendChart({ series, colorByTeam }: { series: TrendSeries[]; colorByTeam: Record<string, string> })`, the default export at the unchanged path

**Decision 11 semantics:**
- **Color by name, not rank.** Colors follow the team name. `assignTeamColors` picks the 12 teams with the most open alerts at each team's latest point, breaking ties by name. It sorts those 12 by name and gives them `var(--vuln-series-1..12)`. The rest get `OTHER_TEAM_COLOR`.
- **Build from the unfiltered series.** The caller builds the map from the **unfiltered** `trend.series`.
- **Why the function takes series, not names.** The spec writes `assignTeamColors(teamNames)`, but its own fallback for more than 12 teams needs each team's open count. So the function takes the series.
- **Legend:** the swatch is colored and the text uses the chrome color.
- **Lines:** each line uses a function `dataKey` (Review Focus 4). `connectNulls` keeps today's behavior, joining a team's consecutive measurements.

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

it('draws a line for a team whose name contains a dot (no lodash-path dataKey lookup)', () => {
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

Expected: FAIL. `team-colors` is not found, the trend chart has no `path.recharts-line-curve`, and the caller test sees `colorByTeam` as `undefined`.

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
  // Labels only: a colour here would make ChartStyle emit a --color-<team name> custom property
  // per team, keyed by arbitrary text.
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

In `src/app/vulnerabilities/vulnerabilities-content.tsx`, add this line after `import TrendChart from './trend-chart';`:

```tsx
import { assignTeamColors } from './team-colors';
```

Then replace the `TrendChart` render with:

```tsx
            ? <div className={trendStale ? 'opacity-60' : undefined}><TrendChart series={team ? trend.series.filter((x: any) => x.team === team) : trend.series} colorByTeam={assignTeamColors(trend.series)} /></div>
```

- [ ] **Step 6: Run the three tests and the existing vuln suites**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/vuln-team-colors.test.ts src/lib/__tests__/unit/vuln-trend-chart.test.tsx src/lib/__tests__/unit/vuln-content-trend-colors.test.tsx src/lib/__tests__/unit/vuln-trend-colors-css.test.ts src/lib/__tests__/unit/vuln-series-contrast.test.ts'`

Expected: PASS. If `swatch.style.background` reads `''` in jsdom, switch both the swatch and its assertion to `backgroundColor`.

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

### Task 9: `ProgressRing` rewrite

**Files:**
- Rewrite: `src/app/projects/progress-ring.tsx`. The exports `EpicRingStats`, `ProgressRingProps` and `ProgressRing` keep their names and signatures, so `projects-content.tsx:916-920` needs no edit.
- Rewrite: `src/lib/__tests__/unit/progress-ring.test.tsx`

**Interfaces:**
- Consumes: `toNum` from `@/components/charts/chart-format`.
- Produces: `EpicRingStats`, `ProgressRingProps` and `ProgressRing(props)`, all unchanged, plus a new `ringGeometry(stats: EpicRingStats, maxVolume: number, avgCommitsPerJira: number): { px: number; stroke: number; jiraPct: number; commitPct: number }`.

**Behavior (spec Charts → ProgressRing and Every chart):**
- **Chart:** a fixed-size `RadialBarChart` with `startAngle={90}`, `endAngle={-270}` and `<PolarAngleAxis type="number" domain={[0, 100]} tick={false} />`.
- **Tracks:** each ring's track is its `background` in `var(--chart-track)`.
- **Geometry:** the old 48-unit geometry, scaled by `px / 48`.
- **Ring order:** the data is `[commits, jira]`. The first entry draws innermost, so Jira is the outer ring.
- **Empty state:** ProgressRing is the spec's exception to the empty-state rule. At 0% it draws both tracks and no arc, and no path may contain `NaN`.
- **Tooltip:** the tooltip's colored text spans become chrome text with ring-token swatches.

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

  it('with every value at 0: both tracks draw, no arc draws, and no path contains NaN', () => {
    const zero = stats({ totalJiras: 0, resolvedJiras: 0, remainingJiras: 0 });
    const { container } = render(<ProgressRing stats={zero} maxVolume={0} avgCommitsPerJira={0} />);
    expect(container.querySelectorAll('.recharts-radial-bar-background-sector')).toHaveLength(2);
    expect(sector(container, '--chart-ring-jira')).toBeUndefined();
    expect(sector(container, '--chart-ring-commits')).toBeUndefined();
    Array.from(container.querySelectorAll('path')).forEach(p => expect(p.getAttribute('d') ?? '').not.toContain('NaN'));
    expect(container.querySelector('span.font-bold')?.textContent).toBe('0');
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
// would draw as a full circle. At 0% the ring is its own empty state: both tracks, no arc.
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

These points are read from the Recharts source but haven't yet been observed in jsdom. Check each if its test fails:
- **Ring order.** If the test finds Jira's radius smaller than commits', swap the two `data` entries. Leave the test as it is.
- **Arc path format.** If `arc()` returns `null`, log one sector's `d` and adjust the regex to match. The expected shape is `M x,y A r,r,0,large,sweep,x,y` (`es6/shape/Sector.js:54`).
- **Sector selector.** If `.recharts-radial-bar-sectors path` matches nothing, query `.recharts-radial-bar-sector path` instead.
- **Both rings in one color.** This means `RadialBar` isn't applying each row's `fill`, so `sector(container, '--chart-ring-jira')` finds nothing. There are two fallbacks. Use the first one that makes the "Jira outer, commits inner" and angle-domain tests pass. Keep the tests as written.
  1. A `shape` render prop that reads the row's color: `shape={(p: SectorProps & { payload?: { fill?: string } }) => <Sector {...p} fill={p.payload?.fill} />}`. `Sector` and `SectorProps` are exported from `recharts`.
  2. Two separate `RadialBar` elements, each with its own `fill` and a `dataKey` picking its own field: `data={[{ commits: commitPct * 100, jira: jiraPct * 100 }]}`, then `<RadialBar dataKey="commits" fill="var(--chart-ring-commits)" … />` and `<RadialBar dataKey="jira" fill="var(--chart-ring-jira)" … />`. Re-check the ring order afterwards: each `RadialBar` gets its own band, and the first one declared is innermost.
- **Zero-value test.** If a zero-angle sector is rendered with a real `d`, check that `sector(...)` finds no path. Recharts' `Sector` returns null when start angle equals end angle. If it doesn't, assert that the path's arc spans 0° instead of asserting that it's absent.

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

### Task 10: Non-chart bars move to tokens (colors only)

**Files:**
- Modify: `src/components/ProjectsCard.tsx`:
  - `SEGMENT_COLORS` (lines 6-10)
  - the legend swatches (lines 196-204)
  - the tracks (lines 252 and 426)
  - the segments (lines 257-259 and 431-433)
- Modify: `src/app/reports/page.tsx`, the sync progress track (line 466)
- Modify: `src/app/reports/vulnerability-syncs-tab.tsx`, the progress track (line 132)
- Test: `src/lib/__tests__/unit/projects-card-volume.test.tsx`

**Interfaces:**
- Consumes: `--chart-volume-*`, `--chart-track` and `bg-chart-track` from Task 1.
- Produces: nothing new.

**Scope (spec Non-goals and Decision 1).** Everything here stays a `<div>`; only colors change.
- **`ProjectsCard`:** segments and swatches use `var(--chart-volume-*)`, set with `backgroundColor`. Tracks use `var(--chart-track)`.
- **The two sync bars:** only the track moves, to `bg-chart-track`. The status fills (indigo running, red failed, orange stopped/warning) stay.
- **Out of scope:** the `ProjectsCard` row container at line 406 (`rgba` background and border). It's card chrome, not part of the bar.

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

Before running, read `ProjectsCardProps` (lines 62-86). If rendering `ProjectsCard` with only `projects` shows a collapsed header instead of the body, pass `expanded` as well.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/projects-card-volume.test.tsx'`

Expected: FAIL. The track reads `''`, because it uses the `background` shorthand with an `rgba` value. The segments read hex values, `rgba` values or `''`.

- [ ] **Step 3: Update `ProjectsCard`**

Replace lines 5-10 with:

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

Then make these replacements:
- **Legend (lines 196-204):** change each swatch's `style={{ background: … }}` to `style={{ backgroundColor: … }}`. The commits swatch becomes `style={{ backgroundColor: SEGMENT_COLORS.commits }}`, replacing `'rgba(255,255,255,0.18)'`.
- **Both tracks (lines 252 and 426):** change `style={{ background: 'rgba(255,255,255,0.05)' }}` to `style={{ backgroundColor: TRACK_COLOR }}`.
- **Both bars' segments:** change `background:` to `backgroundColor:`, for example:

```tsx
                      <div style={{ flex: p.estimated_prs, backgroundColor: SEGMENT_COLORS.prs }} />
                      <div style={{ flex: p.jira_count, backgroundColor: SEGMENT_COLORS.jiras }} />
                      <div style={{ flex: p.estimated_commits, backgroundColor: SEGMENT_COLORS.commits }} />
```

- [ ] **Step 4: Update the two sync progress tracks**

In both `src/app/reports/page.tsx` and `src/app/reports/vulnerability-syncs-tab.tsx`, change:

```tsx
<div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
```

to:

```tsx
<div className="h-1.5 bg-chart-track rounded-full overflow-hidden">
```

Keep each file's existing indentation.

- [ ] **Step 5: Run the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: all suites pass. If `style.backgroundColor` reads `''` for a `var()` value, assert on `getAttribute('style')` containing `background-color: var(--chart-…)` instead.

- [ ] **Step 6: Commit**

```bash
git add src/components/ProjectsCard.tsx src/app/reports/page.tsx src/app/reports/vulnerability-syncs-tab.tsx src/lib/__tests__/unit/projects-card-volume.test.tsx
git commit -F - <<'EOF'
GLOOK-58: volume and progress bars read chart tokens

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: Literal-color guard, full verification, build, screenshot pass

**Files:**
- Create: `src/lib/__tests__/unit/chart-no-literal-colors.test.ts` (spec guard test 1)

**Interfaces:**
- Consumes: every chart module from Tasks 2-9.
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
    'src/components/charts/spend-impact-scatter.tsx',
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

Expected: PASS. If the guard flags a module, fix the module itself: replace the literal with a token, or reword a comment that contains `#` followed by hex digits. Do not add an exemption to the guard.

- [ ] **Step 3: Confirm the seed still exercises the charts**

Task 4, Step 8 moved the seed dates into the 90-day window and seeded in-flight commits. If `scripts/seed-data.ts` or `scripts/seed.ts` has changed since, repeat that step's check script before continuing. Step 7 below re-confirms the data through the API once the server is up.

- [ ] **Step 4: Full suite (sanity check)**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: 0 failed, and **about 187 suites**: the 169 baseline plus the 18 new test files below. This count is a sanity check, not a hard gate. What must hold is that every file in the table appears in the run:

| Task | New suites |
|---|---|
| 1 | `chart-tokens-css`, `chart-contrast` |
| 2 | `cn`, `chart-wrapper` |
| 3 | `week-key-utc`, `chart-format`, `commit-types`, `chart-hatch` |
| 4 | `timeline-chart` |
| 5 | `stacked-types-chart`, `lines-changed-chart`, `commit-type-donut` |
| 6 | `spend-impact-scatter` |
| 7 | `dev-type-badges` |
| 8 | `vuln-team-colors`, `vuln-content-trend-colors` |
| 10 | `projects-card-volume` |
| 11 | `chart-no-literal-colors` |

Task 8 rewrites `vuln-trend-chart` and Task 9 rewrites `progress-ring`; both are existing suites, so they don't add to the count. Record the actual suite and test counts in the commit body.

- [ ] **Step 5: Build**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run build'`

Expected: the build succeeds. If it fails on a `page.tsx` export, a helper has leaked into a page file. Move it to `src/components/charts/`.

- [ ] **Step 6: Clear the build cache before running dev** (CLAUDE.md: `next build` artifacts conflict with `next dev`)

Run: `rm -rf /Users/maes/Documents/1macmount/code/glooker/.claude/worktrees/GLOOK-58-recharts/.next`

Don't skip this step, even if you are only switching ports.

- [ ] **Step 7: Seed and start the mock-mode app**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run seed:reset'`

**Pick the port.** The user's main checkout may already be serving port 3000. Check with `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health`:
- If it prints `000`, port 3000 is free. Use `PORT=3000` below.
- If it prints anything else, port 3000 is taken. Use 3001.

Start the server in the background (Bash `run_in_background: true`) with one of these:
- **Port 3000 free:** `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run dev:mock'`
- **Port 3000 taken:** `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run dev:mock -- -p 3001'`. `dev:mock` ends in `next dev`, so `-p 3001` is passed through to it.

Wait until `curl -s http://localhost:<port>/api/health` returns `{"status":"ok",…}`. Use the same port in every URL below.

**Confirm the seeded data reached the page.** Run `curl -s http://localhost:<port>/api/report/00000000-0000-4000-a000-000000000001/org`. In the output, `timeline` must contain weeks from the last 90 days, and at least two weeks must carry `types.in_flight`: one with 1 in-flight against a larger `commits`, and one with 5. If they don't, return to Task 4, Step 8.

- [ ] **Step 8: Screenshot pass**

1. Open `http://localhost:<port>/reports` and note the newest completed report's id. The seeded one is `00000000-0000-4000-a000-000000000001`.
2. Screenshot every page below in three themes:
   - **Amber Glow**, dark.
   - **Daylight Blue**, light, with a white page background.
   - **Fresh Mint**, light, whose page background is `#F0FDF4`. It shows translucent surfaces against a themed background.

   Switch themes with the app's theme picker, or run `localStorage.setItem('glooker-theme', 'daylight-blue')` (or `'fresh-mint'`, `'amber-glow'`) in the console and reload.

**Charts:** check every item on every page where the chart appears.

1. **Colors resolve.** No mark is black. No chart internal stays dark inside a light card: grid, axis text, tooltip, ring tracks, scatter median lines. In Fresh Mint, check that chart cards and tooltips don't pick up the mint body background where they should be the card surface.
2. **Legibility.** No axis label collides or clips. Y-axis numbers are readable. Tooltips don't overflow the card; hover at least one mark per chart.
3. **Hatch on narrow bars.** On the org Commits / Week timeline and on Lines Changed, in-flight segments show visible stripes at the default card width. Check again at about 390px wide.
4. **Hatch on a short segment.** The seeded week with 1 in-flight commit against a full weekly total gives a **short** hatched segment on the org Commits / Week chart. At the default size it must still read as texture: at least one visible stripe, not a flat cyan or accent sliver.
   - **If it reads as a flat sliver,** add `minPointSize={4}` to the in-flight `Bar` in `timeline-chart.tsx`, re-run that test, and re-check.
   - **If it still fails,** report it. Recharts notes that `minPointSize` is not always respected in stacks, so the pattern tile or the minimum height may need a design call.
5. **Diverging chart.** Removed lines sit below a visible zero line. Rounded corners face away from zero on both sides. If the removed-side corners face zero, set `BOTTOM` to `[4, 4, 0, 0]` in `lines-changed-chart.tsx`, re-run its test, and re-check.
6. **Hover sync.** Hovering one org timeline moves the cursor on every chart in the org grid. Check the same on the dev page.
7. **Donut.** Slices and legend rows are in `COMMIT_TYPE_ORDER` (feature, bug, refactor, infra, docs, test, other, in_flight), not by size. Legend rows show count and %. Hovering a **slice** and hovering a **legend row** both update the center and dim the other slices. This is the fallback check if Task 5, Step 7's slice test was not kept. The in_flight wedge and swatch are hatched.
8. **Spend vs Impact scatter** (org page → Spend tab).
   - Median lines cross where median dots sit.
   - The seeded outlier (`frank-mock`) is drawn as a **triangle** in the outlier color, not red. It is clearly distinct from the circles at normal zoom.
   - The legend shows both shapes.
   - Clicking a dot opens that developer's page.
   - Quadrant labels don't badly cover the dots.
9. **TrendChart** (`/vulnerabilities`). Line colors match the legend swatches. Filtering to one team keeps that team's color. Hovering fades the other lines.
10. **ProgressRing** (`/projects`). Rings start at the top and fill clockwise, with Jira on the outside. Tracks are visible in light mode. The 22px ring is legible, and a 0% ring shows both tracks.

**Inline data bars and badges (spec Decision 1).** These are screenshot-only. Each gets a colors-only fix **only if** it is broken in a light theme (Daylight Blue or Fresh Mint):

| Page | What to check |
|---|---|
| Org page → Spend tab | Top-20% bar (`spend-tab.tsx:279-291`), Model Mix bar (`:300-345`), Impact threshold badges in the leaderboard (`:500`) |
| Dev page `/report/<id>/dev/<login>` | Commit Types segmented bar and its badge legend; commit-row type badges; Active Repos bars; the p50/p95 marker bar (`dev/[login]/page.tsx:214-240`); `usage-card.tsx` model cost bars (`:68`); Complexity/Impact/PR%/AI% threshold badges |
| Org page, Impact tab | Top Repos bars; the In-flight Work KPI cards (now non-zero from the seed) |
| Team page `/report/<id>/team/<team>` | Team table type badges; threshold badges; `ProjectsCard` volume bar (commits segment and track visible in light mode) |
| Home page `/` | The explainer bars in `llm-findings.tsx:257-360` |
| `/reports` | Report progress bars: the track token and the status fills |
| `/reports` vulnerability syncs tab | Sync progress bars |
| `/vulnerabilities` | Severity badges |
| `/projects` | Jira status dots |

**How to fix a broken item.** Keep the fix to colors and follow the file's own convention:
- For Tailwind classes that lack a light variant, add a `[data-theme-mode="light"]` override in `globals.css`.
- For inline colors, use an existing token.

Commit each fix separately, with a `GLOOK-58: ` message that names the item and page. List every fix in the final commit body.

**For any failure in a chart module:** fix it in the owning module, re-run that module's test and the full suite, and re-shoot the page.

3. Stop the dev server when you're done.

- [ ] **Step 9: Commit**

```bash
git add src/lib/__tests__/unit/chart-no-literal-colors.test.ts
git commit -F - <<'EOF'
GLOOK-58: guard against literal colours in chart modules

Full suite: <N> suites / <M> tests green. Build green. Screenshot pass (Amber Glow, Daylight Blue, Fresh Mint;
org incl. spend tab, dev, team, home, reports, vulnerabilities, projects) checked against the
chart list and the inline-bar/badge table. Light-mode fixes: <list, or "none needed">.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

Before committing, replace `<N>` and `<M>` with the counts from Step 4, and replace `<list …>` with the fixes from Step 8.


---

## Addendum: Decision 15, measured weeks in the report's own era (Tasks 12-13)

Tasks 1-11 are implemented and reviewed. Tasks 12 and 13 implement spec **Decision 15**, the amended **Decision 10**, and the Testing table's two "Coverage" rows, as amended at commits `ed73927` and `4f8a2a5`. Read those sections before starting. `git show ed73927 4f8a2a5 -- docs/superpowers/specs/` shows exactly what changed.

**What the two tasks deliver:**
- **Task 12, server:** the org and dev report responses gain `coveredWeeks: string[]` and `anchorWeek: string`.
  - `coveredWeeks` lists the UTC Monday keys of the weeks that some completed report provably measured, all 7 days of them.
  - `anchorWeek` is the week the report's charts end at.
- **Task 13, client:** every page-grid chart row carries a `measured` flag. All three tooltips read "Not measured" for an unmeasured week. Both pages build their week domain from `anchorWeek` instead of today.

**Response types.** No named TypeScript response type exists for either service. `getOrgReport` and `getDevReport` return object literals, and the literal is the type. Both routes (`src/app/api/report/[id]/org/route.ts`, `…/dev/[login]/route.ts`) pass the object through `NextResponse.json` after cost stripping, which never touches the new fields. So neither route changes. The pages read the response untyped through SWR.

**Seed data needs no change.** Checked on 2026-09-25 against `scripts/seed-data.ts`:
- R1 (14 days) completes 1 day ago, and R2 (30 days) completes 15 days ago. R3 is `running`.
- Together they cover at most about 45 days, and seeded commits fall within about the last 20 days.
- The org page's domain is 14 weeks. So its earliest weeks are always both uncovered and empty, whatever day the seed runs.
- No new tables or entities are introduced, so CLAUDE.md's seed rule doesn't apply. Task 13's verification step re-checks this through the live API before hovering.

**Addendum review focus.** These are the input classes most likely to bite, with the test that pins each:
1. **A timestamp that doesn't parse.** The mocked `org-model-usage.test.ts` feeds `completed_at: 'y'`, and a corrupt row can do the same. `weekKeyForDate(new Date('y'))` throws a `RangeError`, so `anchorWeekFor` falls back to today's week, and the coverage helpers skip the row. Pinned in Task 12 (`report-coverage.test.ts`).
2. **A `running` report that carries a stale `completed_at`.** `runReport` sets `status = 'running'` on resume without clearing `completed_at`, and a failed run sets `completed_at = NOW()`. Coverage filters on status, not on `completed_at IS NOT NULL`. Pinned in Task 12 (`report-coverage-db.test.ts`, `rRunning`).
3. **A week with data that no report covered.** For example, an in-flight commit older than every report period. It stays measured and shows its value. Pinned in Task 13 (`chart-format.test.ts`).
4. **A missing or malformed `anchorWeek` on the client.** `weekDomainEndingAt` falls back to today's domain instead of throwing. Pinned in Task 13.
5. **Two report windows that meet mid-day.** Days are marked per window, as the spec states. So the split day, and its whole week, read "Not measured". This is a deliberate under-claim. Pinned in Task 12 so that any change to it is a visible decision.

**Superseded wording.** Plan Review Focus 1 and Tasks 4-5 quote the empty states as "No … in the last 90 days". Task 13 changes them to "No … in the 90 days before this report" (spec Decision 15, part 3). Task 13 lists the six existing assertions it updates.

---

### Task 12: Server coverage (`coveredWeeks`, `anchorWeek`)

**Rules for this task** (restated from Global Constraints):
- **Commands:** run every node command as `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c '<one command>'`. Put one plain command inside the quotes, with no `&&`, pipes or `$VARS`.
- **Commits:** the message starts with `GLOOK-58: `. Use `git add` with explicit paths, never `-A` or `.`. End the message with a blank line and a `Co-Authored-By:` trailer naming **the model you are running as**, for example `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Tests:** they live flat in `src/lib/__tests__/unit/` and check behavior, never tick positions.
- **Test baseline before this task:** 188 suites / 1805 tests.
- **Honesty:** if this task's code and its own test disagree, stop and report it. Don't pick one silently.
- **Scope:** don't touch files that aren't listed.

**Files:**
- Modify: `src/lib/report/timeline.ts` (add the coverage helpers after `weekKeyForDate`)
- Modify: `src/lib/report/org.ts` (the imports; step 3's `SELECT id FROM reports` query; the `return`)
- Modify: `src/lib/report/dev.ts` (the imports; the `SELECT id FROM reports` query; the `return`)
- Create: `src/lib/__tests__/unit/report-coverage.test.ts` (pure helpers)
- Create: `src/lib/__tests__/unit/report-coverage-db.test.ts` (both services on a real SQLite file)

**Interfaces:**
- Consumes: `weekKeyForDate(d: Date): string` from `timeline.ts` (Task 3, UTC).
- Produces, from `@/lib/report/timeline`:
  - `interface CoverageWindow { end: Date; periodDays: number }`
  - `completedReportWindows(rows: Array<{ status?: unknown; period_days?: unknown; completed_at?: unknown }>): CoverageWindow[]`
  - `coveredWeeksFromWindows(windows: CoverageWindow[]): string[]`, sorted ascending with no duplicates.
  - `anchorWeekFor(completedAt: unknown, createdAt: unknown, now?: Date): string`
- Produces on the responses, additively:
  - `getOrgReport(id)` returns `{ …existing, coveredWeeks: string[], anchorWeek: string }`.
  - `getDevReport(id, login)` returns `{ …existing, coveredWeeks: string[], anchorWeek: string }`.
  - Task 13 reads both fields.

**How DB timestamps are parsed.** Every timestamp is parsed with `new Date(value)`, the same call `org.ts:94` already makes for `completed_at` (`weekKeyForDate(new Date(row.completed_at))`). Concretely:
- **MySQL** returns `DATETIME` as a JS `Date`, which `new Date()` copies.
- **SQLite** stores `datetime('now','localtime')`, a zone-less `'YYYY-MM-DD HH:MM:SS'` string. V8 reads that as host local time. The spec's premise is that the server reads it on the same host that wrote it.
- **ISO strings with `Z`** parse as absolute instants.
- **An Invalid Date** (`NaN` time) is skipped for coverage. For the anchor it falls through to the next candidate.

**Why the SQL is widened, not extended with a new query.** `org-unmerged-summary.test.ts` resets its mock and then supplies exactly 9 `mockResolvedValueOnce` values. A 10th `db.execute` call gets `undefined`, and its destructure throws. `report-org.test.ts` and `report-dev.test.ts` are positional too. So each service reads coverage from the `SELECT id FROM reports WHERE org = ?` query it already runs. The call count and order stay unchanged. Existing mocks return `{ id }`-only rows, which yield no coverage, and no test asserts that query's SQL text or params (checked 2026-09-25). No test asserts either whole response with `toEqual` either. The route tests mock the services.

- [ ] **Step 1: Write the failing pure-helper test**

Create `src/lib/__tests__/unit/report-coverage.test.ts`:

```ts
// GLOOK-58 Decision 15: the pure coverage helpers in timeline.ts. Every timestamp is an absolute
// instant (…Z), so the expected keys hold on any host time zone, CI's UTC included. The one
// zone-less case is chosen so it gives the same answer in every zone within ±11h.
import { anchorWeekFor, completedReportWindows, coveredWeeksFromWindows } from '@/lib/report/timeline';

const win = (end: string, periodDays: number) => ({ end: new Date(end), periodDays });

describe('coveredWeeksFromWindows', () => {
  it('a 14-day window ending on a Wednesday lists only the one week all 7 of whose days it covers', () => {
    // 2026-03-04T12:00Z → 2026-03-18T12:00Z. Whole UTC days: Thu 5 … Tue 17. The weeks of Mar 2 and
    // Mar 16 are only partly inside, so only the week of Mar 9 is listed.
    expect(coveredWeeksFromWindows([win('2026-03-18T12:00:00Z', 14)])).toEqual(['2026-03-09']);
  });

  it('a window ending exactly at Monday midnight covers the Sunday before it', () => {
    expect(coveredWeeksFromWindows([win('2026-03-16T00:00:00Z', 7)])).toEqual(['2026-03-09']);
  });

  it('a window that starts mid-day leaves that day, and so its week, out', () => {
    // 2026-03-09T03:00Z → 2026-03-16T03:00Z: Monday the 9th is only partly inside.
    expect(coveredWeeksFromWindows([win('2026-03-16T03:00:00Z', 7)])).toEqual([]);
  });

  it('two reports with a gap between them leave the gap weeks out', () => {
    const weeks = coveredWeeksFromWindows([win('2026-03-02T00:00:00Z', 14), win('2026-04-06T00:00:00Z', 14)]);
    expect(weeks).toEqual(['2026-02-16', '2026-02-23', '2026-03-23', '2026-03-30']);
  });

  it('overlapping windows list each week once, in ascending order', () => {
    // Given newest first on purpose: the output is sorted regardless of input order.
    const weeks = coveredWeeksFromWindows([win('2026-03-23T00:00:00Z', 14), win('2026-03-16T00:00:00Z', 14)]);
    expect(weeks).toEqual(['2026-03-02', '2026-03-09', '2026-03-16']);
  });

  it('marks days per window: two windows meeting mid-day leave the boundary day, and its week, unmarked', () => {
    // Decision 15 marks the UTC days inside ANY ONE window. 2026-03-11 is split between the two
    // windows at 12:00Z, so neither holds it whole, and the week of Mar 9 reads "Not measured".
    // That is the spec's deliberate under-claim. Merging windows first would list it.
    const weeks = coveredWeeksFromWindows([win('2026-03-11T12:00:00Z', 14), win('2026-03-25T12:00:00Z', 14)]);
    expect(weeks).toEqual(['2026-03-02', '2026-03-16']);
  });

  it('skips a window with an unparseable end or an unusable period instead of throwing', () => {
    const weeks = coveredWeeksFromWindows([
      { end: new Date('y'), periodDays: 14 },
      win('2026-03-16T00:00:00Z', 0),
      win('2026-03-16T00:00:00Z', Number.NaN),
      win('2026-03-16T00:00:00Z', -7),
    ]);
    expect(weeks).toEqual([]);
  });

  it('no windows, no weeks', () => {
    expect(coveredWeeksFromWindows([])).toEqual([]);
  });
});

describe('completedReportWindows', () => {
  it('keeps completed reports only, each windowed on its completed_at', () => {
    const windows = completedReportWindows([
      { status: 'completed', period_days: 14, completed_at: '2026-03-18T12:00:00Z' },
      { status: 'failed', period_days: 30, completed_at: '2026-03-02T00:00:00Z' },
      { status: 'stopped', period_days: 14, completed_at: '2026-01-19T00:00:00Z' },
      { status: 'running', period_days: 14, completed_at: '2026-05-04T00:00:00Z' },
      { status: 'pending', period_days: 14, completed_at: null },
      { status: 'completed', period_days: 14, completed_at: null },
      { status: 'completed', period_days: 14, completed_at: 'y' },
    ]);
    expect(windows.map(w => [w.end.toISOString(), w.periodDays])).toEqual([['2026-03-18T12:00:00.000Z', 14]]);
  });

  it('accepts a MySQL Date and a string period_days', () => {
    const windows = completedReportWindows([
      { status: 'completed', period_days: '14', completed_at: new Date('2026-03-18T12:00:00Z') },
    ]);
    expect(windows.map(w => [w.end.toISOString(), w.periodDays])).toEqual([['2026-03-18T12:00:00.000Z', 14]]);
  });
});

describe('anchorWeekFor', () => {
  it("is completed_at's UTC week", () => {
    expect(anchorWeekFor('2026-03-18T12:00:00Z', '2026-03-04T12:00:00Z')).toBe('2026-03-16');
  });

  it("falls back to created_at's week while completed_at is null", () => {
    expect(anchorWeekFor(null, '2026-05-13T12:00:00Z')).toBe('2026-05-11');
  });

  it("reads SQLite's zone-less local timestamp as host local time, the way getOrgReport already does", () => {
    // Noon local on Wednesday 18 March is still the 18th in UTC for any host zone within ±11h.
    expect(anchorWeekFor('2026-03-18 12:00:00', null)).toBe('2026-03-16');
  });

  it("falls back to today's week when neither timestamp parses, instead of throwing", () => {
    expect(anchorWeekFor('y', 'x', new Date('2026-09-25T12:00:00Z'))).toBe('2026-09-21');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/report-coverage.test.ts'`

Expected: FAIL. The suite doesn't compile, because `@/lib/report/timeline` has no exported member `anchorWeekFor`, `completedReportWindows` or `coveredWeeksFromWindows` (TS2305).

- [ ] **Step 3: Implement the helpers**

In `src/lib/report/timeline.ts`, insert this directly after the closing `}` of `weekKeyForDate`:

```ts
const DAY_MS = 86_400_000;

/** One report's searched period, ending at the instant it completed (GLOOK-58 Decision 15). */
export interface CoverageWindow {
  end: Date;
  periodDays: number;
}

/**
 * GLOOK-58 Decision 15: which reports' windows count. Completed reports only, windowed on
 * completed_at: every run searched from runStart − period_days (report-runner.ts:44), and runStart is
 * no later than completed_at, resumed runs included, so [completed_at − period_days, completed_at]
 * always sits inside what was searched. The filter is on status, not on completed_at being set: a
 * failed run sets completed_at, and a resumed run is 'running' with its old completed_at still set.
 *
 * Timestamps are parsed with new Date(value), exactly as getOrgReport's avg-impact bucketing does:
 * MySQL DATETIME arrives as a Date; SQLite's zone-less 'YYYY-MM-DD HH:MM:SS' (datetime('now',
 * 'localtime')) is read as local time, on the same host that wrote it. Unparseable rows are skipped.
 */
export function completedReportWindows(
  rows: Array<{ status?: unknown; period_days?: unknown; completed_at?: unknown }>,
): CoverageWindow[] {
  const out: CoverageWindow[] = [];
  for (const r of rows) {
    if (r.status !== 'completed' || r.completed_at == null) continue;
    const end = new Date(r.completed_at as string | number | Date);
    if (Number.isNaN(end.getTime())) continue;
    out.push({ end, periodDays: Number(r.period_days) });
  }
  return out;
}

/**
 * GLOOK-58 Decision 15: the UTC Monday keys of every week all 7 of whose UTC days lie wholly inside
 * at least one window. Coverage may under-claim but never over-claim: a partly covered week is left
 * out, so the edges of a gap never claim a measured zero. Days are marked per window, as the spec
 * states, so a day split between two windows that meet mid-day is not marked. A window with an
 * invalid end, or a period that isn't a positive number, is skipped. Sorted ascending, no duplicates.
 */
export function coveredWeeksFromWindows(windows: CoverageWindow[]): string[] {
  const days = new Set<number>(); // UTC midnights, as epoch ms
  for (const { end, periodDays } of windows) {
    const endMs = end.getTime();
    const period = Number(periodDays);
    if (!Number.isFinite(endMs) || !Number.isFinite(period) || period <= 0) continue;
    const startMs = endMs - period * DAY_MS;
    // The first whole day starts at the first UTC midnight at or after startMs. A day counts only
    // if it also ends at or before endMs.
    for (let d = Math.ceil(startMs / DAY_MS) * DAY_MS; d + DAY_MS <= endMs; d += DAY_MS) days.add(d);
  }
  const weeks = new Set<string>();
  for (const d of days) {
    const key = weekKeyForDate(new Date(d));
    const monday = Date.parse(`${key}T00:00:00Z`);
    let whole = true;
    for (let i = 0; i < 7 && whole; i++) whole = days.has(monday + i * DAY_MS);
    if (whole) weeks.add(key);
  }
  return [...weeks].sort();
}

/**
 * GLOOK-58 Decision 15: the week this report's charts end at, weekKeyForDate(completed_at ??
 * created_at), parsed with new Date() as above. completed_at is null while a report is pending. If
 * neither timestamp parses, today's week, the pre-Decision-15 anchor, because weekKeyForDate
 * would otherwise throw a RangeError on an Invalid Date.
 */
export function anchorWeekFor(completedAt: unknown, createdAt: unknown, now: Date = new Date()): string {
  for (const v of [completedAt, createdAt]) {
    if (v == null) continue;
    const d = new Date(v as string | number | Date);
    if (!Number.isNaN(d.getTime())) return weekKeyForDate(d);
  }
  return weekKeyForDate(now);
}
```

- [ ] **Step 4: Run the pure-helper test and confirm it passes**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/report-coverage.test.ts'`

Expected: PASS, 14 tests.

- [ ] **Step 5: Write the failing DB-backed service test**

This test copies the SQLite pattern from `cc-apply-breakdowns.test.ts` exactly:
- capture `SQLITE_PATH` and `DB_TYPE`;
- set both in `beforeAll`;
- dynamic-import `@/lib/db` and the services;
- restore both in `afterAll`, per CLAUDE.md.

The `@octokit/rest` mock uses the factory form CLAUDE.md requires. `report-runner` and `progress-store` are mocked because `org.ts` and `dev.ts` import `./service`, which pulls in the ESM-only `p-limit` (see `org-model-usage.test.ts`).

I dry-ran this harness against the current code on 2026-09-25:
- Both services ran on the real SQLite driver.
- The widened `EXISTS` query ran.
- `completed_at` came back as the inserted ISO string, unchanged.

Create `src/lib/__tests__/unit/report-coverage-db.test.ts`:

```ts
// GLOOK-58 Decision 15: coveredWeeks and anchorWeek through the REAL SQLite driver, so the status
// filter, the per-login EXISTS and the timestamp parsing run against real rows, not positional
// mocks. Env set/restore copied from cc-apply-breakdowns.test.ts. Timestamps are inserted as
// absolute instants (…Z), so the expected keys hold on any host zone, CI's UTC included; the
// zone-less SQLite form is pinned in report-coverage.test.ts.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
// org.ts / dev.ts → ./service → @/lib/report-runner pulls in the ESM-only p-limit package.
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
jest.mock('@/lib/progress-store', () => ({ initProgress: jest.fn(), updateProgress: jest.fn(), getProgress: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let getOrgReport: any;
let getDevReport: any;

// process.env is shared across test files in a Jest worker: restore both in afterAll, or later
// files inherit a deleted DB path (CLAUDE.md).
const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

// id, org, period_days, status, created_at, completed_at — and what each window WOULD cover.
const REPORTS: Array<[string, string, number, string, string, string | null]> = [
  ['rA', 'acme', 14, 'completed', '2026-03-04T12:00:00Z', '2026-03-18T12:00:00Z'], // week of Mar 9
  // Resumed: created in January, completed in April. Windowed on completed_at: Mar 23, Mar 30.
  // Windowed on created_at it would be the week of 2025-12-29 instead.
  ['rB', 'acme', 14, 'completed', '2026-01-05T09:00:00Z', '2026-04-06T00:00:00Z'],
  ['rFailed', 'acme', 30, 'failed', '2026-01-31T00:00:00Z', '2026-03-02T00:00:00Z'], // would be Feb 2-23
  ['rStopped', 'acme', 14, 'stopped', '2026-01-05T00:00:00Z', '2026-01-19T00:00:00Z'], // would be Jan 5, 12
  // Resumed and running again: its old completed_at is still set. Would be Apr 20, Apr 27.
  ['rRunning', 'acme', 14, 'running', '2026-04-15T12:00:00Z', '2026-05-04T00:00:00Z'],
  ['rPending', 'acme', 14, 'pending', '2026-05-13T12:00:00Z', null],
  ['rOther', 'beta', 14, 'completed', '2026-05-18T00:00:00Z', '2026-06-01T00:00:00Z'], // other org: May 18, 25
];
// alice: rA (completed), rFailed (failed), rPending (pending). bob: rA and rB (both completed).
const DEV_ROWS: Array<[string, string]> = [
  ['rA', 'alice'], ['rA', 'bob'], ['rB', 'bob'], ['rFailed', 'alice'], ['rPending', 'alice'],
];

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-coverage-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  ({ getOrgReport } = await import('@/lib/report/org'));
  ({ getDevReport } = await import('@/lib/report/dev'));
  for (const r of REPORTS) {
    await db.execute(
      `INSERT INTO reports (id, org, period_days, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)`,
      r,
    );
  }
  for (const [reportId, login] of DEV_ROWS) {
    await db.execute(
      `INSERT INTO developer_stats (report_id, github_login, github_name) VALUES (?, ?, ?)`,
      [reportId, login, login],
    );
  }
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = priorDbType;
  try { fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }); } catch { /* already gone */ }
});

describe('getOrgReport coverage', () => {
  it("lists exactly the fully covered weeks of this org's completed reports", async () => {
    expect((await getOrgReport('rA')).coveredWeeks).toEqual(['2026-03-09', '2026-03-23', '2026-03-30']);
  });

  it('leaves the week between two completed reports out', async () => {
    expect((await getOrgReport('rA')).coveredWeeks).not.toContain('2026-03-16');
  });

  it('failed, stopped, running and pending reports add nothing, even when they carry a completed_at', async () => {
    const { coveredWeeks } = await getOrgReport('rA');
    const fromIgnored = ['2026-01-05', '2026-01-12', '2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23', '2026-04-20', '2026-04-27'];
    expect(coveredWeeks.filter((w: string) => fromIgnored.includes(w))).toEqual([]);
  });

  it('a resumed report is windowed on completed_at, not created_at', async () => {
    const { coveredWeeks } = await getOrgReport('rA');
    expect(coveredWeeks).toEqual(expect.arrayContaining(['2026-03-23', '2026-03-30']));
    expect(coveredWeeks).not.toContain('2025-12-29');
  });

  it("another org's reports add nothing", async () => {
    const { coveredWeeks } = await getOrgReport('rA');
    expect(coveredWeeks.filter((w: string) => ['2026-05-18', '2026-05-25'].includes(w))).toEqual([]);
  });

  it("anchorWeek is the viewed report's completed_at week", async () => {
    expect((await getOrgReport('rA')).anchorWeek).toBe('2026-03-16');
  });

  it("anchorWeek falls back to created_at's week while completed_at is null", async () => {
    expect((await getOrgReport('rPending')).anchorWeek).toBe('2026-05-11');
  });
});

describe('getDevReport coverage', () => {
  it('counts only completed reports that hold a developer_stats row for this login', async () => {
    // alice's failed and pending reports add nothing; bob's rB is not hers.
    expect((await getDevReport('rA', 'alice')).coveredWeeks).toEqual(['2026-03-09']);
  });

  it("a login with rows in more completed reports gets those reports' weeks too", async () => {
    expect((await getDevReport('rA', 'bob')).coveredWeeks).toEqual(['2026-03-09', '2026-03-23', '2026-03-30']);
  });

  it('anchorWeek follows the viewed report, falling back to created_at', async () => {
    expect((await getDevReport('rA', 'alice')).anchorWeek).toBe('2026-03-16');
    expect((await getDevReport('rPending', 'alice')).anchorWeek).toBe('2026-05-11');
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/report-coverage-db.test.ts'`

Expected: FAIL. Every test fails on `coveredWeeks` or `anchorWeek` being `undefined`, for example `Expected: ["2026-03-09", …] Received: undefined`. None may fail inside `beforeAll`. A `beforeAll` failure is a harness problem, so stop and report it.

- [ ] **Step 7: Wire `getOrgReport`**

In `src/lib/report/org.ts`, change the import:

```ts
import { dedupCommitsBySha, aggregateWeekly, weekKeyForDate } from './timeline';
```

to:

```ts
import {
  dedupCommitsBySha, aggregateWeekly, weekKeyForDate,
  anchorWeekFor, completedReportWindows, coveredWeeksFromWindows,
} from './timeline';
```

Replace:

```ts
  // 3. All commits across all reports for org, deduped
  const [allReportIds] = await db.execute(
    `SELECT id FROM reports WHERE org = ?`, [org],
  ) as [any[], any];
```

with:

```ts
  // 3. All commits across all reports for org, deduped. status/period_days/completed_at feed the
  // GLOOK-58 Decision 15 coverage below; they're read in this same query so the call order is
  // unchanged (org-unmerged-summary.test.ts supplies exactly one mock per call).
  const [allReportIds] = await db.execute(
    `SELECT id, status, period_days, completed_at FROM reports WHERE org = ?`, [org],
  ) as [any[], any];
```

Replace the final `return`:

```ts
  return { report: reportRows[0], developers, timeline, spendWindow, unmergedSummary, modelUsage, skillsUsage };
```

with:

```ts
  // GLOOK-58 Decision 15: the weeks some completed report of this org provably measured, and the
  // week this report's charts end at. Additive fields; nothing above changes.
  const coveredWeeks = coveredWeeksFromWindows(completedReportWindows(allReportIds));
  const anchorWeek = anchorWeekFor(reportRows[0].completed_at, reportRows[0].created_at);

  return { report: reportRows[0], developers, timeline, spendWindow, unmergedSummary, modelUsage, skillsUsage, coveredWeeks, anchorWeek };
```

- [ ] **Step 8: Wire `getDevReport`**

In `src/lib/report/dev.ts`, change the import:

```ts
import { dedupCommitsBySha, aggregateWeekly } from './timeline';
```

to:

```ts
import { dedupCommitsBySha, aggregateWeekly, anchorWeekFor, completedReportWindows, coveredWeeksFromWindows } from './timeline';
```

Replace:

```ts
  // Timeline: all commits for this developer across ALL reports for this org,
  // deduped by commit_sha, for weekly aggregation graphs
  const [allReportIds] = await db.execute(
    `SELECT id FROM reports WHERE org = ?`,
    [org],
  ) as [any[], any];
```

with:

```ts
  // Timeline: all commits for this developer across ALL reports for this org,
  // deduped by commit_sha, for weekly aggregation graphs. GLOOK-58 Decision 15: status,
  // period_days, completed_at and has_login_stats feed this developer's coverage below. Only
  // completed reports holding a developer_stats row for this login count. They're read in this
  // same query so the call order is unchanged. The login match is exact-case, like every other
  // developer_stats read in this file.
  const [allReportIds] = await db.execute(
    `SELECT r.id, r.status, r.period_days, r.completed_at,
            EXISTS(SELECT 1 FROM developer_stats ds WHERE ds.report_id = r.id AND ds.github_login = ?) AS has_login_stats
     FROM reports r WHERE r.org = ?`,
    [login, org],
  ) as [any[], any];
```

Then, directly above the final `return {`, add:

```ts
  // GLOOK-58 Decision 15: a report counts only if it completed and holds this developer's row. A
  // row exists only for developers with commits in that report, so an idle week reads "Not
  // measured", never a proven 0. MySQL and SQLite both return EXISTS as 0/1; a mock row without
  // the column gives NaN, which counts as absent.
  const coveredWeeks = coveredWeeksFromWindows(
    completedReportWindows(allReportIds.filter((r: any) => Number(r.has_login_stats) > 0)),
  );
  const anchorWeek = anchorWeekFor(reportRows[0].completed_at, reportRows[0].created_at);
```

and add the two fields to the returned object, after `models: …`:

```ts
    models: modelRows.map((r: any): DevModelUsage => ({
      model: String(r.model),
      cost: Number(r.cost) || 0,
      requests: Number(r.requests) || 0,
    })),
    coveredWeeks,
    anchorWeek,
  };
```

- [ ] **Step 9: Run both new tests and the existing service suites**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/report-coverage.test.ts src/lib/__tests__/unit/report-coverage-db.test.ts src/lib/__tests__/unit/report-org.test.ts src/lib/__tests__/unit/report-dev.test.ts src/lib/__tests__/unit/org-unmerged-summary.test.ts src/lib/__tests__/unit/org-model-usage.test.ts'`

Expected: PASS, 6 suites.
- `report-coverage` has 14 tests and `report-coverage-db` has 10.
- `org-model-usage` is the canary for the unparseable-timestamp fallback: its mock returns `completed_at: 'y'`. If it throws `RangeError: Invalid time value`, the guard in `anchorWeekFor` or `completedReportWindows` is missing.

- [ ] **Step 10: Run the full suite**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: 0 failed, **190 suites / 1829 tests**. That's the 188 / 1805 baseline plus 2 suites and 24 tests. If the counts differ, record the actual numbers in the commit body and say why.

- [ ] **Step 11: Commit**

```bash
git add src/lib/report/timeline.ts src/lib/report/org.ts src/lib/report/dev.ts src/lib/__tests__/unit/report-coverage.test.ts src/lib/__tests__/unit/report-coverage-db.test.ts
git commit -F - <<'EOF'
GLOOK-58: coveredWeeks and anchorWeek on the org and dev report responses

Decision 15, server side. Only completed reports count, windowed on
completed_at, and a week is listed only when all 7 of its UTC days are
covered. The dev page counts only reports with a developer_stats row for
that login. anchorWeek is completed_at's week, or created_at's while it is
null. Both are read from the existing reports query, so the call order is
unchanged.

Full suite: <N> suites / <M> tests green.

Co-Authored-By: Claude <Model> <noreply@anthropic.com>
EOF
```

Before committing:
- Replace `<N>` and `<M>` with Step 10's counts.
- Replace `Claude <Model>` with the model you are running as.

---

### Task 13: Client wiring (`measured` rows, "Not measured" tooltips, the report-anchored domain)

**Rules for this task** (restated from Global Constraints):
- **Commands:** run every node command as `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c '<one command>'`. Put one plain command inside the quotes, with no `&&`, pipes or `$VARS`.
- **Commits:** the message starts with `GLOOK-58: `. Use `git add` with explicit, quoted paths for the bracketed page paths. End the message with a blank line and a `Co-Authored-By:` trailer naming **the model you are running as**.
- **Tests:** they live flat in `src/lib/__tests__/unit/`, and component tests start with `/** @jest-environment jsdom */` on line 1. They check behavior, never tick positions.
  - Recharts never activates its tooltip on a synthetic jsdom mouse event. So tooltip tests render the tooltip component directly, fed rows from the chart's own exported row builder.
- **Code:** no hex literals in chart modules, comments included. Don't write `#` followed by three or more hex digits anywhere in `src/components/charts/*`. `src/app/**/page.tsx` exports only `default`.
- **Test baseline before this task:** 190 suites / 1829 tests (after Task 12).
- **Honesty:** if this task's code and its own test disagree, stop and report it. Don't pick one silently.
- **Scope:** don't touch files that aren't listed.

**Files:**
- Modify: `src/components/charts/chart-format.ts` (`WeekPoint.measured`, `FillOptions.covered`, `isMeasured`, `weekDomainEndingAt`)
- Modify: `src/components/charts/chart.tsx` (add `NotMeasuredTooltip` after `CHART_TOOLTIP_CLASS`, and one import)
- Replace: `src/components/charts/timeline-chart.tsx` (full new content below)
- Replace: `src/components/charts/lines-changed-chart.tsx` (full new content below)
- Replace: `src/components/charts/stacked-types-chart.tsx` (full new content below)
- Modify: `src/app/report/[id]/org/page.tsx` (one import, two data reads, the `weeks` line, the timeline grid, the stacked chart line)
- Modify: `src/app/report/[id]/dev/[login]/page.tsx` (one import, two data reads, the `weeks` line, the timeline grid)
- Test, modify: `src/lib/__tests__/unit/chart-format.test.ts`, `timeline-chart.test.tsx`, `lines-changed-chart.test.tsx`, `stacked-types-chart.test.tsx`
- Test, create: `src/lib/__tests__/unit/report-pages-coverage-wiring.test.tsx`
- Unchanged, must stay green: `src/lib/__tests__/unit/chart-domain-alignment.test.tsx`

**Interfaces:**
- Consumes (Task 12): the org and dev responses' `coveredWeeks: string[]` and `anchorWeek: string`.
- Produces, from `@/components/charts/chart-format`:
  - `WeekPoint<T>` gains `measured: boolean`.
  - `FillOptions<T>` gains `covered?: ReadonlySet<string>`. The spec calls this "`fillWeeks` takes an optional `covered`". It goes in the options object, not in a fourth parameter.
  - `isMeasured(week: string, hasRow: boolean, covered?: ReadonlySet<string>): boolean`
  - `weekDomainEndingAt(anchorWeek: string | null | undefined, days?: number): string[]`
- Produces, from `@/components/charts/chart`: `NotMeasuredTooltip({ week }: { week: string })`.
- Produces, from `@/components/charts/timeline-chart`:
  - `TimelinePoint` gains `measured: boolean`.
  - `TimelineChartProps` gains `coveredWeeks?: string[]`.
  - New: `interface TimelineRowOptions<T>`, and `buildTimelineRows(weeks, data, opts): { points: WeekPoint<T>[]; rows: TimelinePoint[] }`, exported for tests.
- Produces, from `@/components/charts/lines-changed-chart`:
  - `buildLinesRows(data, weeks, covered?: ReadonlySet<string>)`. Its rows gain `measured`.
  - `LinesChangedChart` gains `coveredWeeks?: string[]`.
- Produces, from `@/components/charts/stacked-types-chart`:
  - New: `buildStackRows(data, weeks, covered?: ReadonlySet<string>)`, whose rows carry `measured`. Exported for tests.
  - `StackedTypesChart` gains `coveredWeeks?: string[]`.

**Behavior (spec Decision 15, part 2 and part 3):**
- **Row values stay numeric.** In these bar charts `0` and `null` draw the same nothing. The false zero only ever appeared in the tooltip. A `0` also survives Recharts' `filterNull`, so a real hover still reaches the tooltip.
- **`measured`** is true when the week has a data row or is in `covered`. With no `covered`, it is true everywhere, which is today's behavior. Ratio timelines keep their `null` gaps.
- **Tooltips.** A tooltip whose row has `measured === false` renders the week label and "Not measured", and no values. The check is `=== false`, so rows built without the field (the existing tooltip tests) keep rendering values.
- **Empty states.** The new wording is:
  - Timeline: "No data in the 90 days before this report".
  - Lines: "No line changes in the 90 days before this report".
  - Stacked: "No commits in the 90 days before this report".
- **Pages** build one domain with `weekDomainEndingAt(data?.anchorWeek)`, and pass it and `coveredWeeks` to every page-grid chart:
  - the org page to 7 charts (5 `TimelineChart`, `LinesChangedChart`, `StackedTypesChart`);
  - the dev page to its 6 `TimelineChart`s.
  - A response without `coveredWeeks` passes `[]`. Every week without data then reads "Not measured", which is the never-over-claim default.

- [ ] **Step 1: Write the failing `chart-format` tests**

In `src/lib/__tests__/unit/chart-format.test.ts`, change the import block at the top to:

```ts
import {
  buildWeekDomain, fillWeeks, formatCompact, formatValue, formatWeek, indexByWeek, isTopOfStack,
  mondayOf, recentWeekDomain, toNum, weekDomainEndingAt,
} from '@/components/charts/chart-format';
```

Append at the end of the file:

```ts
describe('fillWeeks measured (Decision 15)', () => {
  const weeks = ['2026-09-07', '2026-09-14', '2026-09-21'];

  it('a week is measured when it has data or is covered, and not otherwise; values stay numeric', () => {
    const pts = fillWeeks(weeks, [{ week: '2026-09-21', n: 4 }], { value: r => r.n, kind: 'count', covered: new Set(['2026-09-14']) });
    expect(pts.map(p => p.measured)).toEqual([false, true, true]);
    expect(pts.map(p => p.value)).toEqual([0, 0, 4]);
  });

  it('a week with data is measured even when no report covered it (in-flight older than every report)', () => {
    const pts = fillWeeks(weeks, [{ week: '2026-09-07', n: 2 }], { value: r => r.n, kind: 'count', covered: new Set<string>() });
    expect(pts[0].measured).toBe(true);
    expect(pts[0].value).toBe(2);
  });

  it('with no covered set, every week counts as measured (the old behavior)', () => {
    const pts = fillWeeks(weeks, [] as { week: string; n: number }[], { value: r => r.n, kind: 'count' });
    expect(pts.map(p => p.measured)).toEqual([true, true, true]);
  });

  it('ratio kinds keep their null gaps; covered changes only measured', () => {
    const pts = fillWeeks(weeks, [{ week: '2026-09-14', r: 2.5 }], { value: r => r.r, kind: 'ratio', covered: new Set(['2026-09-21']) });
    expect(pts.map(p => p.value)).toEqual([null, 2.5, null]);
    expect(pts.map(p => p.measured)).toEqual([false, true, true]);
  });
});

describe('weekDomainEndingAt', () => {
  afterEach(() => jest.useRealTimers());

  it('ends at the anchor week and spans the 90 days before it', () => {
    const weeks = weekDomainEndingAt('2026-07-06');
    expect(weeks[weeks.length - 1]).toBe('2026-07-06');
    expect(weeks[0]).toBe('2026-04-06');
    expect(weeks).toEqual(recentWeekDomain(utc('2026-07-06')));
  });

  it("falls back to today's domain for a missing or malformed anchor, instead of throwing", () => {
    jest.useFakeTimers({ now: new Date('2026-09-25T12:00:00Z') });
    const today = recentWeekDomain(new Date());
    expect(weekDomainEndingAt(undefined)).toEqual(today);
    expect(weekDomainEndingAt('2026-13-01')).toEqual(today);
    expect(weekDomainEndingAt('not a week')).toEqual(today);
  });
});
```

- [ ] **Step 2: Write the failing chart tests, and update the six empty-state assertions**

**`src/lib/__tests__/unit/timeline-chart.test.tsx`:**
1. Change the import `import { TimelineChart, TimelineTooltip } from '@/components/charts/timeline-chart';` to `import { buildTimelineRows, TimelineChart, TimelineTooltip } from '@/components/charts/timeline-chart';`.
2. In the tests `shows an explicit empty state when no week has data` and `shows the empty state, not a blank card, for an old report whose weeks are all outside the domain`, change both `'No data in the last 90 days'` to `'No data in the 90 days before this report'`.
3. Append:

```tsx
describe('Decision 15: measured weeks', () => {
  it('buildTimelineRows marks each row measured from its data or the covered set, keeping values numeric', () => {
    const data: Row[] = [{ week: '2026-09-21', commits: 5, prs: 2 }];
    const { rows } = buildTimelineRows(weeks, data, { value: d => d.commits, kind: 'count', covered: new Set(['2026-09-07']) });
    expect(rows.map(r => r.measured)).toEqual([false, true, false, true]);
    expect(rows.map(r => r.value)).toEqual([0, 0, 0, 5]);
  });

  it('the tooltip reads "Not measured", not a value, for an unmeasured week', () => {
    const row = { week: '2026-08-31', value: 0, shipped: 0, inFlight: 0, measured: false };
    const { container } = render(<TimelineTooltip active payload={[{ payload: row }] as never} split />);
    expect(container.textContent).toContain('Aug 31');
    expect(container.textContent).toContain('Not measured');
    expect(container.textContent).not.toContain('0');
  });

  it('the tooltip still shows a measured zero as 0', () => {
    const row = { week: '2026-09-14', value: 0, shipped: 0, inFlight: 0, measured: true };
    const { container } = render(<TimelineTooltip active payload={[{ payload: row }] as never} />);
    expect(container.textContent).toContain('0');
    expect(container.textContent).not.toContain('Not measured');
  });

  it("a real unmeasured row from the chart's own builder reaches the tooltip as \"Not measured\"", () => {
    const data: Row[] = [{ week: '2026-09-21', commits: 5, prs: 2 }];
    const { rows } = buildTimelineRows(weeks, data, { value: d => d.commits, kind: 'count', covered: new Set<string>() });
    const { container } = render(<TimelineTooltip active payload={[{ payload: rows[0] }] as never} />);
    expect(container.textContent).toContain('Not measured');
  });
});
```

**`src/lib/__tests__/unit/lines-changed-chart.test.tsx`:**
1. In the tests `shows an explicit empty state when every week is zero` and `shows the empty state for an old report whose weeks are all outside the domain`, change both `'No line changes in the last 90 days'` to `'No line changes in the 90 days before this report'`.
2. Append:

```tsx
describe('Decision 15: measured weeks', () => {
  it('buildLinesRows marks each row measured from its data or the covered set, keeping values numeric', () => {
    const rows = buildLinesRows([{ week: '2026-09-21', linesP95Added: 5, linesP95Removed: 1 }], weeks, new Set(['2026-09-07']));
    expect(rows.map(r => r.measured)).toEqual([true, false, true]);
    expect(rows.map(r => r.added)).toEqual([0, 0, 5]);
  });

  it('buildLinesRows with no covered set marks every week measured', () => {
    expect(buildLinesRows([], weeks).map(r => r.measured)).toEqual([true, true, true]);
  });

  it('the lines tooltip reads "Not measured", not zero counts, for an unmeasured week', () => {
    const row = buildLinesRows([], weeks, new Set<string>())[0];
    const { container } = render(<LinesTooltip active payload={[{ payload: row }] as never} />);
    expect(container.textContent).toContain('Sep 7');
    expect(container.textContent).toContain('Not measured');
    expect(container.textContent).not.toContain('added');
    expect(container.textContent).not.toContain('total');
  });
});
```

**`src/lib/__tests__/unit/stacked-types-chart.test.tsx`:**
1. Change the import `import { StackedTypesChart, StackedTypesTooltip } from '@/components/charts/stacked-types-chart';` to `import { buildStackRows, StackedTypesChart, StackedTypesTooltip } from '@/components/charts/stacked-types-chart';`.
2. In the tests `shows an explicit empty state when no week has commits` and `shows the empty state for an old report whose weeks are all outside the domain`, change both `'No commits in the last 90 days'` to `'No commits in the 90 days before this report'`.
3. Append:

```tsx
describe('Decision 15: measured weeks', () => {
  it('buildStackRows marks each row measured from its data or the covered set, keeping values numeric', () => {
    const rows = buildStackRows([{ week: '2026-09-21', types: { feature: 2 } }], weeks, new Set(['2026-09-07']));
    expect(rows.map(r => r.measured)).toEqual([true, false, true]);
    expect(rows.map(r => r.total)).toEqual([0, 0, 2]);
  });

  it('buildStackRows with no covered set marks every week measured', () => {
    expect(buildStackRows([], weeks).map(r => r.measured)).toEqual([true, true, true]);
  });

  it('the stacked tooltip reads "Not measured", not a 0 total, for an unmeasured week', () => {
    const row = buildStackRows([], weeks, new Set<string>())[0];
    const { container } = render(<StackedTypesTooltip active payload={[{ payload: row }] as never} />);
    expect(container.textContent).toContain('Sep 7');
    expect(container.textContent).toContain('Not measured');
    expect(container.textContent).not.toContain('total');
  });
});
```

- [ ] **Step 3: Write the failing page-wiring test**

No existing test renders a report page. This one mocks the chart modules with recorders, so it checks what each page hands its charts, not how the charts draw. I dry-ran this exact harness against the current pages on 2026-09-25:
- Both pages rendered.
- The chart counts (7 and 6) and the single-shared-array check passed.
- Both tests failed only on the week domain, which still ends at today's week.

`jest.config.ts` sets `restoreMocks: true`, so the SWR mock is a plain function, not a `jest.fn()`.

Create `src/lib/__tests__/unit/report-pages-coverage-wiring.test.tsx`:

```tsx
/** @jest-environment jsdom */
// GLOOK-58 Decision 15: both report pages hand every page-grid chart the SAME week domain, ending
// at the response's anchorWeek (not today), plus the response's coveredWeeks. The charts are
// replaced by recorders, so this checks the pages' wiring, not chart rendering (the chart suites
// cover that). Without it, a chart missing its coveredWeeks prop would show up only if the single
// browser hover happened to land on that chart.
import React from 'react';
import { render } from '@testing-library/react';
import { weekDomainEndingAt } from '@/components/charts/chart-format';
import OrgDetailPage from '@/app/report/[id]/org/page';
import DevDetailPage from '@/app/report/[id]/dev/[login]/page';

type Seen = { chart: string; weeks: string[]; coveredWeeks?: string[] };
const mockSeen: Seen[] = [];
let mockSwrData: Record<string, unknown> = {};

// Plain functions, not jest.fn(): jest.config sets restoreMocks, which would strip a jest.fn()'s
// implementation before each test.
jest.mock('swr', () => ({
  __esModule: true,
  default: (key: string | null) => ({ data: key ? mockSwrData[key] : undefined, isLoading: false, error: undefined }),
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'r1', login: 'alice' }),
  useRouter: () => ({ push: () => undefined }),
}));
jest.mock('@/lib/url-state', () => ({ useUrlState: () => ['impact', () => undefined] }));
jest.mock('@/app/chat-panel', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/IntegrityBadge', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/Breadcrumb', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/charts/commit-type-donut', () => ({ CommitTypeDonut: () => null }));
jest.mock('@/components/charts/timeline-chart', () => ({
  TimelineChart: (p: { weeks: string[]; coveredWeeks?: string[] }) => {
    mockSeen.push({ chart: 'TimelineChart', weeks: p.weeks, coveredWeeks: p.coveredWeeks });
    return null;
  },
}));
jest.mock('@/components/charts/lines-changed-chart', () => ({
  LinesChangedChart: (p: { weeks: string[]; coveredWeeks?: string[] }) => {
    mockSeen.push({ chart: 'LinesChangedChart', weeks: p.weeks, coveredWeeks: p.coveredWeeks });
    return null;
  },
}));
jest.mock('@/components/charts/stacked-types-chart', () => ({
  StackedTypesChart: (p: { weeks: string[]; coveredWeeks?: string[] }) => {
    mockSeen.push({ chart: 'StackedTypesChart', weeks: p.weeks, coveredWeeks: p.coveredWeeks });
    return null;
  },
}));

// A historical report: its anchor week is months before any real "today", so a page that still
// built its domain from new Date() cannot pass.
const ANCHOR = '2026-07-06';
const COVERED = ['2026-06-22', '2026-06-29'];
const TIMELINE = [
  { week: '2026-06-22', commits: 3, prs: 1, avgLinesPerPr: 40, linesAdded: 30, linesRemoved: 10, avgComplexity: 3, aiPercent: 0, types: { feature: 3 } },
  { week: '2026-06-29', commits: 2, prs: 1, avgLinesPerPr: 20, linesAdded: 15, linesRemoved: 5, avgComplexity: 2, aiPercent: 50, types: { bug: 2 } },
];
const REPORT = {
  id: 'r1', org: 'acme', period_days: 14, status: 'completed',
  created_at: '2026-06-24T12:00:00Z', completed_at: '2026-07-08T12:00:00Z', run_metadata: null,
};
const DEV = {
  github_login: 'alice', github_name: 'Alice', avatar_url: '',
  total_prs: 2, total_commits: 5, lines_added: 45, lines_removed: 15,
  avg_complexity: 2.5, impact_score: 5, pr_percentage: 100, ai_percentage: 20,
  type_breakdown: { feature: 3, bug: 2 }, active_repos: ['acme/app'],
  total_jira_issues: 0, total_reviews: 0,
};

beforeEach(() => { mockSeen.length = 0; });

function expectEveryChartWired(expectedCharts: string[]) {
  const expectedWeeks = weekDomainEndingAt(ANCHOR);
  expect(expectedWeeks[expectedWeeks.length - 1]).toBe(ANCHOR);
  expect(mockSeen.map(s => s.chart).sort()).toEqual([...expectedCharts].sort());
  // One array per page, so syncId's index matching lines up.
  expect(new Set(mockSeen.map(s => s.weeks)).size).toBe(1);
  for (const s of mockSeen) {
    expect(s.weeks).toEqual(expectedWeeks);
    expect(s.coveredWeeks).toEqual(COVERED);
  }
}

it('the org page passes the anchor-week domain and coveredWeeks to all 7 page-grid charts', () => {
  mockSwrData = {
    '/api/report/r1/org': {
      report: REPORT, developers: [], timeline: TIMELINE, spendWindow: null,
      modelUsage: [], skillsUsage: [], unmergedSummary: null,
      coveredWeeks: COVERED, anchorWeek: ANCHOR,
    },
  };
  render(<OrgDetailPage />);
  expectEveryChartWired([...Array(5).fill('TimelineChart'), 'LinesChangedChart', 'StackedTypesChart']);
});

it('the dev page passes the anchor-week domain and coveredWeeks to all 6 TimelineCharts', () => {
  mockSwrData = {
    '/api/report/r1/dev/alice': {
      report: REPORT, developer: DEV, allDevelopers: [DEV], commits: [], timeline: TIMELINE,
      unmergedWork: { openPrs: [], branchCommits: [] }, skills: [], models: [],
      coveredWeeks: COVERED, anchorWeek: ANCHOR,
    },
  };
  render(<DevDetailPage />);
  expectEveryChartWired(Array(6).fill('TimelineChart'));
});
```

If a page throws on a fixture field it reads, add that field to the fixture and say so in your report. Don't mock another module without reporting why.

- [ ] **Step 4: Run the five test files and confirm they fail**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/chart-format.test.ts src/lib/__tests__/unit/timeline-chart.test.tsx src/lib/__tests__/unit/lines-changed-chart.test.tsx src/lib/__tests__/unit/stacked-types-chart.test.tsx src/lib/__tests__/unit/report-pages-coverage-wiring.test.tsx'`

Expected: FAIL, in these ways:
- `chart-format` and `timeline-chart` don't compile. `weekDomainEndingAt` and `buildTimelineRows` aren't exported (TS2305), and `covered` isn't a known `FillOptions` property.
- `stacked-types-chart` doesn't compile, because `buildStackRows` isn't exported.
- `lines-changed-chart` doesn't compile, because `buildLinesRows` takes 2 arguments, not 3.
- `report-pages-coverage-wiring` compiles only if `weekDomainEndingAt` exists. Until Step 5 it fails to compile too. After Step 5 and before Step 11 it fails on `expect(s.weeks).toEqual(expectedWeeks)`, because the domain still ends at today's week.

- [ ] **Step 5: Implement `chart-format.ts`**

In `src/components/charts/chart-format.ts`:

1. After `recentWeekDomain`, add:

```ts
/**
 * GLOOK-58 Decision 15: the page-wide domain, the `days` days (default 90) ending at the report's
 * own week, `${anchorWeek}T00:00:00Z`. The server computes anchorWeek, so the client never re-parses
 * a DB timestamp. A missing or malformed anchor falls back to today's domain: charts never throw.
 */
export function weekDomainEndingAt(anchorWeek: string | null | undefined, days = 90): string[] {
  const t = utcDay(anchorWeek ?? '');
  return recentWeekDomain(t === null ? new Date() : new Date(t), days);
}
```

2. Replace the `WeekPoint` and `FillOptions` interfaces and `fillWeeks` with:

```ts
export interface WeekPoint<T> {
  week: string;
  value: number | null;
  hasData: boolean;
  /** Decision 15: false when the week has no data AND no report provably measured it. */
  measured: boolean;
  row?: T;
}

export interface FillOptions<T> {
  value: (row: T) => unknown;
  kind: MetricKind;
  isDefined?: (row: T) => boolean;
  /** Decision 15: weeks some report provably measured. Omitted: every week counts as measured. */
  covered?: ReadonlySet<string>;
}

/**
 * GLOOK-58 Decision 15: a week counts as measured when it has data (even outside every report
 * period, e.g. an old in-flight commit) or some report provably measured it. With no `covered`
 * set, every week counts as measured: the behavior before Decision 15.
 */
export function isMeasured(week: string, hasRow: boolean, covered?: ReadonlySet<string>): boolean {
  return hasRow || !covered || covered.has(week);
}

/**
 * One point per domain week. kind 'count': a missing or undefined week is 0.
 * kind 'ratio': a missing or undefined week is null (a gap). Rows outside the domain are ignored.
 * `measured` (Decision 15) never changes a value; tooltips read it.
 */
export function fillWeeks<T extends { week: string }>(weeks: string[], data: T[], opts: FillOptions<T>): WeekPoint<T>[] {
  const byWeek = indexByWeek(data);
  return weeks.map(week => {
    const row = byWeek.get(week);
    const raw = row ? opts.value(row) : undefined;
    const defined = !!row && raw != null && (opts.isDefined ? opts.isDefined(row) : true);
    const measured = isMeasured(week, !!row, opts.covered);
    if (opts.kind === 'count') return { week, row, hasData: !!row, measured, value: defined ? toNum(raw) : 0 };
    return { week, row, hasData: defined, measured, value: defined ? toNum(raw) : null };
  });
}
```

- [ ] **Step 6: Add `NotMeasuredTooltip` to `chart.tsx`**

In `src/components/charts/chart.tsx`:
1. Add `import { formatWeek } from './chart-format';` after `import { cn } from '@/lib/cn';`.
2. Directly after the `CHART_TOOLTIP_CLASS` constant, add:

```tsx
/**
 * GLOOK-58 Decision 15: the tooltip for a week no report measured. Shared by TimelineChart,
 * LinesChangedChart and StackedTypesChart, so the three say it identically.
 */
export function NotMeasuredTooltip({ week }: { week: string }) {
  return (
    <div className={CHART_TOOLTIP_CLASS}>
      <div className="font-medium">{formatWeek(week)}</div>
      <div>Not measured</div>
    </div>
  );
}
```

- [ ] **Step 7: Replace `timeline-chart.tsx`**

Replace the whole of `src/components/charts/timeline-chart.tsx` with:

```tsx
'use client';

// GLOOK-58: the one TimelineChart (it used to exist twice, in the org and dev pages, and the
// copies had diverged). Bars are placed by date on the page's shared week domain, so every chart
// in a grid has the same array and hover sync (syncId, matched by index) lines up.
import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis, type BarShapeProps, type RectangleProps } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS, NotMeasuredTooltip } from './chart';
import { fillWeeks, formatCompact, formatValue, formatWeek, type MetricKind, type WeekPoint } from './chart-format';
import { inFlightFloor, useHatch } from './hatch';

export interface TimelineRow {
  week: string;
}

export interface TimelinePoint {
  week: string;
  value: number | null;
  shipped: number | null;
  inFlight: number | null;
  /** Decision 15: false when the week has no data and no report measured it. */
  measured: boolean;
}

export interface TimelineChartProps<T extends TimelineRow> {
  data: T[];
  /** The page's shared week domain (weekDomainEndingAt(anchorWeek)). */
  weeks: string[];
  /** Decision 15: the weeks some report provably measured. Omitted: every week counts as measured. */
  coveredWeeks?: string[];
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

export interface TimelineRowOptions<T> {
  value: (row: T) => unknown;
  kind: MetricKind;
  isDefined?: (row: T) => boolean;
  inFlightValue?: (row: T) => unknown;
  covered?: ReadonlySet<string>;
}

/**
 * The chart's rows from real week data. In-flight is a portion of the week's total, clamped to
 * [0, value]. Exported so tests can drive real rows into TimelineTooltip, as buildLinesRows does:
 * Recharts never activates its tooltip on a synthetic jsdom mouse event.
 */
export function buildTimelineRows<T extends TimelineRow>(
  weeks: string[],
  data: T[],
  opts: TimelineRowOptions<T>,
): { points: WeekPoint<T>[]; rows: TimelinePoint[] } {
  const points = fillWeeks(weeks, data, { value: opts.value, kind: opts.kind, isDefined: opts.isDefined, covered: opts.covered });
  const inFlight = opts.inFlightValue ? fillWeeks(weeks, data, { value: opts.inFlightValue, kind: 'count' }) : null;
  const rows: TimelinePoint[] = points.map((p, i) => {
    if (p.value === null) return { week: p.week, value: null, shipped: null, inFlight: null, measured: p.measured };
    const f = inFlight ? Math.min(Math.max(0, inFlight[i].value ?? 0), p.value) : 0;
    return { week: p.week, value: p.value, shipped: p.value - f, inFlight: f, measured: p.measured };
  });
  return { points, rows };
}

type TimelineTooltipProps = Partial<TooltipContentProps<TooltipValueType, string | number>> & {
  suffix?: string;
  decimals?: number;
  split?: boolean;
};

export function TimelineTooltip({ active, payload, suffix = '', decimals = 0, split = false }: TimelineTooltipProps) {
  const row = payload?.[0]?.payload as TimelinePoint | undefined;
  if (!active || !row) return null;
  if (row.measured === false) return <NotMeasuredTooltip week={row.week} />;
  if (row.value === null) return null;
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
  data, weeks, coveredWeeks, valueKey, computeValue, kind, isDefined, label, suffix = '', decimals = 0, inFlightValue, syncId,
}: TimelineChartProps<T>) {
  const hatch = useHatch('var(--accent)');
  const read = (row: T): unknown => (computeValue ? computeValue(row) : valueKey ? row[valueKey] : undefined);
  const covered = coveredWeeks ? new Set(coveredWeeks) : undefined;
  const { points, rows } = buildTimelineRows(weeks, data, { value: read, kind, isDefined, inFlightValue, covered });

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
        <p className="text-xs text-chart-axis py-8 text-center">No data in the 90 days before this report</p>
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
                radius={[4, 4, 0, 0]} minPointSize={inFlightFloor(rows, 'inFlight')} isAnimationActive={false} />
            )}
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}
```

The changes from the current file, so a reviewer can diff them quickly:
- `measured` is added to `TimelinePoint`.
- `coveredWeeks` is added to the props.
- The row building moves into the exported `buildTimelineRows`, unchanged except for `measured`.
- The tooltip checks `measured === false` first.
- The empty-state text changes.

- [ ] **Step 8: Replace `lines-changed-chart.tsx`**

Replace the whole of `src/components/charts/lines-changed-chart.tsx` with:

```tsx
'use client';

// GLOOK-58 Decision 12: a diverging chart. Added lines stack above zero, removed lines are negated
// and stack below, in ONE stackOffset="sign" stack. Two stackIds would place them side by side
// instead. Shipped linesP95* and in-flight inFlightLinesP95* are separate additive layers, as today.
import { Bar, BarChart, CartesianGrid, Rectangle, ReferenceLine, XAxis, YAxis, type BarShapeProps, type RectangleProps } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS, NotMeasuredTooltip } from './chart';
import { formatCompact, formatValue, formatWeek, indexByWeek, isMeasured, toNum } from './chart-format';
import { commitTypeColor } from './commit-types';
import { inFlightFloor, TypeSwatch, useHatch } from './hatch';

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
  /** Decision 15: false when the week has no data and no report measured it. */
  measured: boolean;
}

const ADDED = 'var(--chart-lines-added)';
const REMOVED = 'var(--chart-lines-removed)';
const TOP: [number, number, number, number] = [4, 4, 0, 0];
const BOTTOM: [number, number, number, number] = [0, 0, 4, 4];

export function LinesTooltip({ active, payload }: Partial<TooltipContentProps<TooltipValueType, string | number>>) {
  const row = payload?.[0]?.payload as LinesRow | undefined;
  if (!active || !row) return null;
  if (row.measured === false) return <NotMeasuredTooltip week={row.week} />;
  const fmt = (v: number) => formatValue(v);
  // Churn, not net change: "Lines Changed / Week" is added + removed as magnitudes.
  // removed/inFlightRemoved are negated for the diverging stack, so abs() them back.
  const total = row.added + row.inFlightAdded + Math.abs(row.removed) + Math.abs(row.inFlightRemoved);
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

/**
 * Builds the diverging rows from real week data: added/removed magnitudes go through toNum(),
 * then removed and inFlightRemoved are negated for the stackOffset="sign" stack. Exported so
 * tests can exercise this real sign-flip pipeline directly, instead of hand-building a row whose
 * signs the test author has to get right on their own (GLOOK-58 review, fix round 1: a hand-built
 * row is exactly how the tooltip's total-formula bug slipped through the first time).
 * `covered` (Decision 15) sets each row's `measured` and never changes a value.
 */
export function buildLinesRows(data: LinesWeek[], weeks: string[], covered?: ReadonlySet<string>): LinesRow[] {
  const byWeek = indexByWeek(data);
  return weeks.map(week => {
    const r = byWeek.get(week);
    return {
      week,
      added: toNum(r?.linesP95Added),
      inFlightAdded: toNum(r?.inFlightLinesP95Added),
      removed: -toNum(r?.linesP95Removed),
      inFlightRemoved: -toNum(r?.inFlightLinesP95Removed),
      measured: isMeasured(week, !!r, covered),
    };
  });
}

export function LinesChangedChart({ data, weeks, coveredWeeks, syncId }: { data: LinesWeek[]; weeks: string[]; coveredWeeks?: string[]; syncId?: string }) {
  const hatch = useHatch(commitTypeColor('in_flight'));
  const rows = buildLinesRows(data, weeks, coveredWeeks ? new Set(coveredWeeks) : undefined);
  const hasAny = rows.some(r => r.added || r.inFlightAdded || r.removed || r.inFlightRemoved);
  const hasInFlight = rows.some(r => r.inFlightAdded > 0 || r.inFlightRemoved < 0);

  return (
    <div className="bg-gray-900 rounded-xl p-4">
      <p className="text-xs text-gray-500 font-medium mb-2">
        Lines Changed / Week <span className="text-gray-600 font-normal">(outlier commits excluded)</span>
      </p>
      {!hasAny ? (
        <p className="text-xs text-chart-axis py-8 text-center">No line changes in the 90 days before this report</p>
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
            <Bar dataKey="inFlightAdded" stackId="lines" fill={hatch.fill} stroke="var(--chart-surface)" strokeWidth={2} radius={TOP} minPointSize={inFlightFloor(rows, 'inFlightAdded')} isAnimationActive={false} />
            <Bar dataKey="removed" stackId="lines" fill={REMOVED} stroke="var(--chart-surface)" strokeWidth={2} shape={removedShape} isAnimationActive={false} />
            <Bar dataKey="inFlightRemoved" stackId="lines" fill={hatch.fill} stroke="var(--chart-surface)" strokeWidth={2} radius={BOTTOM} minPointSize={inFlightFloor(rows, 'inFlightRemoved')} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
      )}
      <div className="flex gap-4 mt-2 justify-end">
        <span className="flex items-center gap-1.5 text-[11px] text-chart-axis">
          <TypeSwatch colorVar={ADDED} /> Added
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-chart-axis">
          <TypeSwatch colorVar={REMOVED} /> Removed
        </span>
        {hasInFlight && (
          <span className="flex items-center gap-1.5 text-[11px] text-chart-axis">
            <TypeSwatch colorVar={commitTypeColor('in_flight')} hatched /> In flight
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 9: Replace `stacked-types-chart.tsx`**

Replace the whole of `src/components/charts/stacked-types-chart.tsx` with:

```tsx
'use client';

import { type ReactElement } from 'react';
import { Bar, BarChart, CartesianGrid, Rectangle, XAxis, YAxis, type BarShapeProps, type RectangleProps } from 'recharts';
import type { TooltipContentProps, TooltipValueType } from 'recharts';
import { ChartContainer, ChartTooltip, CHART_TOOLTIP_CLASS, NotMeasuredTooltip } from './chart';
import { formatCompact, formatWeek, indexByWeek, isMeasured, isTopOfStack } from './chart-format';
import { COMMIT_TYPE_ORDER, commitTypeColor, foldTypes, type CommitType } from './commit-types';
import { inFlightFloor, TypeSwatch, useHatch } from './hatch';

interface TypesWeek {
  week: string;
  types?: Record<string, unknown>;
}

type StackRow = { week: string; total: number; measured: boolean } & Record<CommitType, number>;

// Built once at module load, not per render (GLOOK-58 review, fix round 1): a fresh shape
// component per type per render remounts the Rectangle each time. COMMIT_TYPE_ORDER (the full
// fixed order, not the per-render `present` list) is safe here — a type excluded from `present`
// is zero in every row, so it always reads as zero in isTopOfStack regardless of which list is
// passed, and it never has its own Bar to apply this shape to anyway.
const typeShapes = Object.fromEntries(
  COMMIT_TYPE_ORDER.map(t => [
    t,
    (props: BarShapeProps): ReactElement => (
      <Rectangle {...(props as RectangleProps)} radius={isTopOfStack(props.payload, COMMIT_TYPE_ORDER, t) ? [4, 4, 0, 0] : 0} />
    ),
  ]),
) as Record<CommitType, (props: BarShapeProps) => ReactElement>;

/**
 * One row per domain week: the week's types folded into COMMIT_TYPE_ORDER, their total, and
 * whether the week was measured (Decision 15; `covered` never changes a value). Exported so tests
 * can drive real rows into StackedTypesTooltip, as buildLinesRows does.
 */
export function buildStackRows(data: TypesWeek[], weeks: string[], covered?: ReadonlySet<string>): StackRow[] {
  const byWeek = indexByWeek(data);
  return weeks.map(week => {
    const row = byWeek.get(week);
    const folded = foldTypes([row?.types ?? {}]);
    const total = COMMIT_TYPE_ORDER.reduce((s, t) => s + folded[t], 0);
    return { week, total, measured: isMeasured(week, !!row, covered), ...folded };
  });
}

export function StackedTypesTooltip({ active, payload }: Partial<TooltipContentProps<TooltipValueType, string | number>>) {
  const row = payload?.[0]?.payload as StackRow | undefined;
  if (!active || !row) return null;
  if (row.measured === false) return <NotMeasuredTooltip week={row.week} />;
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

export function StackedTypesChart({ data, weeks, coveredWeeks }: { data: TypesWeek[]; weeks: string[]; coveredWeeks?: string[] }) {
  const hatch = useHatch(commitTypeColor('in_flight'));
  const rows = buildStackRows(data, weeks, coveredWeeks ? new Set(coveredWeeks) : undefined);
  const present = COMMIT_TYPE_ORDER.filter(t => rows.some(r => r[t] > 0));
  const fillFor = (t: CommitType) => (t === 'in_flight' ? hatch.fill : commitTypeColor(t));

  return (
    <div className="bg-gray-900 rounded-xl p-4 mb-6">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
        <p className="text-xs text-gray-500 font-medium">Commit Types Over Time (weekly)</p>
        <div className="flex flex-wrap gap-3">
          {present.map(t => (
            <span key={t} className="flex items-center gap-1.5 text-[11px] text-chart-axis">
              <TypeSwatch colorVar={commitTypeColor(t)} hatched={t === 'in_flight'} />
              {t}
            </span>
          ))}
        </div>
      </div>
      {present.length === 0 ? (
        <p className="text-xs text-chart-axis py-8 text-center">No commits in the 90 days before this report</p>
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
                shape={typeShapes[t]} minPointSize={t === 'in_flight' ? inFlightFloor(rows, t) : undefined}
                isAnimationActive={false} />
            ))}
          </BarChart>
        </ChartContainer>
      )}
    </div>
  );
}
```

- [ ] **Step 10: Run the four chart test files and the alignment test**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/chart-format.test.ts src/lib/__tests__/unit/timeline-chart.test.tsx src/lib/__tests__/unit/lines-changed-chart.test.tsx src/lib/__tests__/unit/stacked-types-chart.test.tsx src/lib/__tests__/unit/chart-domain-alignment.test.tsx src/lib/__tests__/unit/chart-no-literal-colors.test.ts'`

Expected: PASS, 6 suites.
- `chart-domain-alignment` passes unchanged, because `coveredWeeks` is optional and never changes the domain.
- `chart-no-literal-colors` passes, because none of the new code contains a hex literal.

- [ ] **Step 11: Wire the org page**

In `src/app/report/[id]/org/page.tsx`:

1. Change `import { recentWeekDomain, toNum } from '@/components/charts/chart-format';` to `import { toNum, weekDomainEndingAt } from '@/components/charts/chart-format';`.
2. After `const skillsUsage: SkillsUsageRow[] = data?.skillsUsage ?? [];`, add:

```tsx
  // GLOOK-58 Decision 15: the weeks some completed report measured, and the week this report's
  // charts end at. Both come from the server; the client never re-parses a DB timestamp. A
  // response without coveredWeeks gives [], so unmeasured weeks never claim a zero.
  const coveredWeeks: string[] = data?.coveredWeeks ?? [];
  const anchorWeek: string | undefined = data?.anchorWeek;
```

3. Replace:

```tsx
  // One week domain per render, shared by every chart below so hover sync (syncId) lines up.
  const weeks = recentWeekDomain(new Date());
```

with:

```tsx
  // One week domain per render, ending at this report's own week (Decision 15), shared by every
  // chart below so hover sync (syncId) lines up.
  const weeks = weekDomainEndingAt(anchorWeek);
```

4. Replace the timeline grid, from `<TimelineChart` (the Commits / Week one) through the AI Assisted % chart's closing `/>`, with:

```tsx
            <TimelineChart
              data={timeline}
              weeks={weeks}
              coveredWeeks={coveredWeeks}
              valueKey="commits"
              kind="count"
              label="Commits / Week"
              inFlightValue={d => d.types?.in_flight ?? 0}
              syncId="org-timeline"
            />
            <TimelineChart data={timeline} weeks={weeks} coveredWeeks={coveredWeeks} valueKey="prs" kind="count" label="PRs / Week" syncId="org-timeline" />
            <TimelineChart
              data={timeline}
              weeks={weeks}
              coveredWeeks={coveredWeeks}
              valueKey="avgLinesPerPr"
              kind="ratio"
              isDefined={d => toNum(d.prs) > 0}
              label="Avg Lines Changed / PR (outliers excluded)"
              suffix=" lines"
              syncId="org-timeline"
            />
            <TimelineChart data={timeline} weeks={weeks} coveredWeeks={coveredWeeks} valueKey="avgImpact" kind="ratio" label="Avg Impact Score / Week" decimals={1} syncId="org-timeline" />
            <LinesChangedChart data={timeline} weeks={weeks} coveredWeeks={coveredWeeks} syncId="org-timeline" />
            <TimelineChart
              data={timeline}
              weeks={weeks}
              coveredWeeks={coveredWeeks}
              valueKey="aiPercent"
              kind="ratio"
              isDefined={d => toNum(d.commits) > 0}
              label="AI Assisted %"
              suffix="%"
              syncId="org-timeline"
            />
```

5. Replace `{timeline.length >= 2 && <StackedTypesChart data={timeline} weeks={weeks} />}` with:

```tsx
      {timeline.length >= 2 && <StackedTypesChart data={timeline} weeks={weeks} coveredWeeks={coveredWeeks} />}
```

- [ ] **Step 12: Wire the dev page**

In `src/app/report/[id]/dev/[login]/page.tsx`:

1. Change `import { recentWeekDomain, toNum } from '@/components/charts/chart-format';` to `import { toNum, weekDomainEndingAt } from '@/components/charts/chart-format';`.
2. After `const models: ModelRow[] = devData?.models ?? [];`, add:

```tsx
  // GLOOK-58 Decision 15: the weeks some completed report measured for THIS developer, and the
  // week this report's charts end at. Both come from the server. A response without coveredWeeks
  // gives [], so unmeasured weeks never claim a zero.
  const coveredWeeks: string[] = devData?.coveredWeeks ?? [];
  const anchorWeek: string | undefined = devData?.anchorWeek;
```

3. Replace:

```tsx
  // One week domain per render, shared by every chart below so hover sync (syncId) lines up.
  const weeks = recentWeekDomain(new Date());
```

with:

```tsx
  // One week domain per render, ending at this report's own week (Decision 15), shared by every
  // chart below so hover sync (syncId) lines up.
  const weeks = weekDomainEndingAt(anchorWeek);
```

4. Replace the six `TimelineChart`s inside the `Activity Over Time (weekly)` grid with:

```tsx
            <TimelineChart data={timeline} weeks={weeks} coveredWeeks={coveredWeeks} valueKey="commits" kind="count" label="Commits / Week" syncId="dev-timeline" />
            <TimelineChart data={timeline} weeks={weeks} coveredWeeks={coveredWeeks} valueKey="prs" kind="count" label="PRs / Week" syncId="dev-timeline" />
            <TimelineChart
              data={timeline}
              weeks={weeks}
              coveredWeeks={coveredWeeks}
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
              coveredWeeks={coveredWeeks}
              kind="count"
              label="Lines Changed / Week"
              computeValue={d => toNum(d.linesAdded) + toNum(d.linesRemoved)}
              syncId="dev-timeline"
            />
            <TimelineChart data={timeline} weeks={weeks} coveredWeeks={coveredWeeks} valueKey="avgComplexity" kind="ratio" label="Avg Complexity / Week" decimals={1} syncId="dev-timeline" />
            <TimelineChart
              data={timeline}
              weeks={weeks}
              coveredWeeks={coveredWeeks}
              valueKey="aiPercent"
              kind="ratio"
              isDefined={d => toNum(d.commits) > 0}
              label="AI Assisted %"
              suffix="%"
              syncId="dev-timeline"
            />
```

Neither page gains an export. Both keep `export default function …` as their only export.

- [ ] **Step 13: Run the page-wiring test**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest src/lib/__tests__/unit/report-pages-coverage-wiring.test.tsx'`

Expected: PASS, 2 tests.

- [ ] **Step 14: Full suite, then build**

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx jest --maxWorkers=3'`

Expected: 0 failed, **191 suites / 1847 tests**. That's Task 12's 190 / 1829 plus 1 suite and 18 tests: 6 in `chart-format`, 4 in `timeline-chart`, 3 in `lines-changed-chart`, 3 in `stacked-types-chart` and 2 in the wiring test. The six edited empty-state assertions are changed tests, not new ones. If the counts differ, record the actual numbers in the commit body and say why.

Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run build'`

Expected: the build succeeds. A failure on a `page.tsx` export means a helper leaked into a page file. Move it to `src/components/charts/`.

- [ ] **Step 15: Commit**

Commit before the browser check, so the check ends on a clean tree. If the check finds a defect, fix it in a separate commit.

```bash
git add src/components/charts/chart-format.ts src/components/charts/chart.tsx src/components/charts/timeline-chart.tsx src/components/charts/lines-changed-chart.tsx src/components/charts/stacked-types-chart.tsx "src/app/report/[id]/org/page.tsx" "src/app/report/[id]/dev/[login]/page.tsx" src/lib/__tests__/unit/chart-format.test.ts src/lib/__tests__/unit/timeline-chart.test.tsx src/lib/__tests__/unit/lines-changed-chart.test.tsx src/lib/__tests__/unit/stacked-types-chart.test.tsx src/lib/__tests__/unit/report-pages-coverage-wiring.test.tsx
git commit -F - <<'EOF'
GLOOK-58: unmeasured weeks read "Not measured"; charts end at the report's week

Decision 15, client side. Rows of the three page-grid charts carry a
measured flag (data, or a covered week), their tooltips say "Not measured"
for an unmeasured week, and both pages build one domain with
weekDomainEndingAt(anchorWeek) and pass coveredWeeks to every grid chart
(org: 7, dev: 6). Empty states read "in the 90 days before this report".

Full suite: <N> suites / <M> tests green. Build green.

Co-Authored-By: Claude <Model> <noreply@anthropic.com>
EOF
```

Before committing:
- Replace `<N>` and `<M>` with Step 14's counts.
- Replace `Claude <Model>` with the model you are running as.

- [ ] **Step 16: Browser check, one real hover over an unmeasured week**

This check uses port 3001, because the user's Docker holds port 3000. It uses a throwaway Chrome profile.

1. Clear the build cache. CLAUDE.md says `next build` artifacts conflict with `next dev`, and Step 14 ran a build.

   Run: `rm -rf /Users/maes/Documents/1macmount/code/glooker/.claude/worktrees/GLOOK-58-recharts/.next`

2. Seed.

   Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run seed:reset'`

3. Confirm port 3001 is free.

   Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/api/health`

   Expected: `000`. If it prints anything else, stop and report. Don't kill a server you didn't start.

4. Start the mock server in the background, with Bash `run_in_background: true`.

   Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npm run dev:mock -- -p 3001'`

   Then re-run `curl -s http://localhost:3001/api/health` every few seconds. With the Monitor tool, use an until-loop. Continue once it returns `{"status":"ok",…}`.

5. Check the live API has an unmeasured week inside the org page's window. Write this to your scratchpad as `coverage-check.ts`:

```ts
import { formatWeek, weekDomainEndingAt } from '/Users/maes/Documents/1macmount/code/glooker/.claude/worktrees/GLOOK-58-recharts/src/components/charts/chart-format';

async function main() {
  const res = await fetch('http://localhost:3001/api/report/00000000-0000-4000-a000-000000000001/org');
  const body = await res.json();
  const weeks = weekDomainEndingAt(body.anchorWeek);
  const covered = new Set<string>(body.coveredWeeks);
  const withData = new Set<string>(body.timeline.map((w: { week: string }) => w.week));
  const unmeasured = weeks.filter(w => !covered.has(w) && !withData.has(w));
  console.log('anchorWeek', body.anchorWeek);
  console.log('coveredWeeks', body.coveredWeeks.join(','));
  console.log('domain', weeks[0], '..', weeks[weeks.length - 1], `(${weeks.length} weeks)`);
  console.log('unmeasured', unmeasured.join(','));
  console.log('slot 0', weeks[0], formatWeek(weeks[0]), unmeasured.includes(weeks[0]) ? 'UNMEASURED' : 'MEASURED');
}
main();
```

   Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'npx tsx <scratchpad>/coverage-check.ts'`, replacing `<scratchpad>` with the scratchpad path.

   What must hold on any day:
   - `anchorWeek` is the UTC week containing yesterday, because R1 completes `daysAgo(1)`.
   - The domain has 14 weeks.
   - `slot 0` prints `UNMEASURED`.

   On 2026-09-25, on this America/New_York host, the expected output is:
   - `anchorWeek 2026-09-21`
   - `coveredWeeks 2026-08-17,2026-08-24,2026-08-31,2026-09-14`
   - `domain 2026-06-22 .. 2026-09-21 (14 weeks)`
   - `slot 0 2026-06-22 Jun 22 UNMEASURED`

   **Why the week of Sep 7 is missing from `coveredWeeks`.** The zone-less seed timestamps parse as local time, so R2's window ends at 04:00Z on Sep 10, and R1's starts there. Sep 10 is split between the two windows, and neither window holds it whole. This is the per-window under-claim in addendum review focus 5. It's expected, not a bug.

   If `slot 0` prints `MEASURED`, stop and report. The seed would need a coverage gap, and that's a seed change needing sign-off.

6. Create a throwaway Chrome profile.

   Run: `mktemp -d <scratchpad>/chrome-profile-XXXXXX`

   Note the printed path, `<profile>`, and use it literally below.

7. Confirm port 9333 is free.

   Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:9333/json/version`

   Expected: `000`. If it's taken, use 9334 in this step and the next two.

8. Start headless Chrome in the background, with `run_in_background: true`.

   Run: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --remote-debugging-port=9333 --user-data-dir=<profile> --window-size=1400,1000 --no-first-run --no-default-browser-check about:blank`

   Then check that `curl -s http://localhost:9333/json/version` returns JSON with a `webSocketDebuggerUrl`.

9. Write this DevTools driver to your scratchpad as `hover-unmeasured.mjs`. It needs Node 24, whose global `WebSocket` and `fetch` it uses.
   - It opens the org page and finds the **Commits / Week** card.
   - It aims at the centre of category slot 0, the domain's first week, which Step 5 confirmed is unmeasured. The point is computed from the plot grid's box and the slot count, because an unmeasured week draws no bar to aim at.
   - It performs one real mouse move there and reads the tooltip text.
   - It saves a screenshot.

```js
// GLOOK-58 Task 13: ONE real hover over an unmeasured week on the org page.
// Usage: node hover-unmeasured.mjs <app-port> <cdp-port> <report-id> <screenshot-path>
import fs from 'node:fs';

const [appPort, cdpPort, reportId, shot] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const version = await (await fetch(`http://localhost:${cdpPort}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 0;
const pending = new Map();
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (!m.id || !pending.has(m.id)) return;
  const p = pending.get(m.id);
  pending.delete(m.id);
  if (m.error) p.reject(new Error(JSON.stringify(m.error)));
  else p.resolve(m.result);
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const evaluate = async expression =>
  (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
await send('Page.enable', {}, sessionId);
await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
await send('Page.navigate', { url: `http://localhost:${appPort}/report/${reportId}/org` }, sessionId);
for (let i = 0; i < 60 && !(await evaluate(`!!document.querySelector('.recharts-cartesian-grid')`)); i++) await sleep(500);
await sleep(800);

const CARD = `[...document.querySelectorAll('p')].find(p => p.textContent.trim() === 'Commits / Week')?.closest('.rounded-xl')`;
const target = await evaluate(`(() => {
  const card = ${CARD};
  if (!card) return { error: 'no Commits / Week card' };
  card.scrollIntoView({ block: 'center' });
  const grid = card.querySelector('.recharts-cartesian-grid');
  const slots = card.querySelector('.recharts-bar')?.querySelectorAll('.recharts-bar-rectangle').length ?? 0;
  if (!grid || !slots) return { error: 'no plot grid or no category slots', slots };
  const b = grid.getBoundingClientRect();
  return { x: b.left + b.width / slots / 2, y: b.top + b.height / 2, slots };
})()`);
if (target.error) { console.log('FAIL', JSON.stringify(target)); process.exit(1); }

await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y, button: 'none' }, sessionId);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x + 1, y: target.y, button: 'none' }, sessionId);
await sleep(600);
const tip = await evaluate(`(() => { const w = ${CARD}?.querySelector('.recharts-tooltip-wrapper'); return w ? w.textContent : null; })()`);
console.log('slots', target.slots, 'tooltip:', JSON.stringify(tip));

const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
fs.writeFileSync(shot, Buffer.from(data, 'base64'));
console.log('SAVED', shot);
await send('Target.closeTarget', { targetId });
ws.close();
const ok = typeof tip === 'string' && tip.includes('Not measured');
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
```

10. Run it.

    Run: `env PATH="/opt/homebrew/Cellar/node@24/24.16.0/bin:/usr/bin:/bin:/usr/sbin:/sbin" sh -c 'node <scratchpad>/hover-unmeasured.mjs 3001 9333 00000000-0000-4000-a000-000000000001 <scratchpad>/task13-not-measured.png'`

    Expected, with the slot count equal to Step 5's domain length:
    - `slots 14 tooltip: "Jun 22Not measured"`, where the label is Step 5's `slot 0` label.
    - `SAVED …`
    - `PASS`

    Then open `<scratchpad>/task13-not-measured.png` with the Read tool. Confirm that the Commits / Week card shows a tooltip reading the week label and "Not measured". The synced charts in the grid may show their own tooltips too.

    **If it prints `FAIL`,** report the printed tooltip text. Don't adjust the aim until it passes: a tooltip showing a value there is the bug this check exists to catch. A `null` tooltip means the hover didn't land on the plot. Report that as well.

11. Clean up.
    1. Stop both background tasks, the dev server and Chrome, with TaskStop.
    2. Run `lsof -ti tcp:3001` and `lsof -ti tcp:9333`. Both must print nothing. If either prints PIDs, run `kill <pid>` for each, then re-check. Don't use `pkill -f`, which can hit other sessions' servers.
    3. Run `rm -rf /Users/maes/Documents/1macmount/code/glooker/.claude/worktrees/GLOOK-58-recharts/.next`
    4. Run `rm -f /Users/maes/Documents/1macmount/code/glooker/.claude/worktrees/GLOOK-58-recharts/glooker.db /Users/maes/Documents/1macmount/code/glooker/.claude/worktrees/GLOOK-58-recharts/glooker.db-wal /Users/maes/Documents/1macmount/code/glooker/.claude/worktrees/GLOOK-58-recharts/glooker.db-shm`
    5. Run `rm -rf <profile>`
    6. Run `git status --short`. Expected: no output, a clean tree. The screenshot and scripts live in the scratchpad, not the repo.

    Report the tooltip text, the screenshot path and the `git status` result.
