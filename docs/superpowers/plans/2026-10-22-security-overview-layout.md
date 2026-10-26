# Security Tab Filter Chips and Side-by-Side Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the Security tab, show active filters as removable chips and lay out the Overview with the ownership card beside the trend card. The ownership card is sized to the org's team count, so 10 teams fit without scrolling.

**Architecture:**
- All sizes stay in `src/app/vulnerabilities/dimensions.ts`. The ownership body height becomes a pure function, `ownershipBodyH(teamCount)`, fed from `summary.knownTeams.length`, never from filtered rows.
- The filter bar gains a fixed-height chip row built from a new `FilterChip` component.
- The Overview wraps `OwnershipCard` and `TrendCard` in a CSS grid that becomes two columns at `min-[1100px]`. `TrendCard` switches to a compact layout in the same way, through CSS classes only.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind, Jest with ts-jest, and @testing-library/react (jsdom docblock for `.tsx` tests).

**Spec:** `docs/superpowers/specs/2026-10-22-security-overview-layout-design.md`

## Global Constraints

- **The page must not jump.** A filter change may change what a slot shows, never a slot's size or a control's position. Every size is a named constant in `dimensions.ts` and is applied as an inline style. Tests compare rendered styles to those names.
- **Reserved slots, not removed controls.** An empty line keeps its height with an `aria-hidden` non-breaking space.
- **Text too long for its slot** is cut with "…" and carries its full text in `title`.
- **Light theme:** `bg-gray-900` is for card shells only. Inner surfaces use `bg-chart-surface`.
- **Ignore duplicate files.** Any file whose name ends in ` 2.ts` / ` 2.tsx` / ` 2.md` is an untracked duplicate. Never edit, stage or import them. `git add` only the exact paths you changed.
- **Commits** end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **Run tests** with `npx jest <path>`. Known unrelated failures in a full run are `chart-no-literal-colors` and `vuln-docs-references` (the latter only from untracked " 2" files). Before Task 4, check that any `vuln-docs-references` failure names only " 2" files.
- **Don't let `next dev` rewrite tracked files.** If you start `next dev`, run `git checkout CLAUDE.md next-env.d.ts` afterwards.
- **New constants** (exact values):
  - `TEAM_ROW_H = 40`
  - `OWNERSHIP_MIN_ROWS = 5`
  - `OWNERSHIP_MAX_ROWS = 12`
  - `FILTER_CHIP_ROW_H = 28`
  - `FILTER_CHIP_ROW_GAP = 8`
  - `CHIP_MAX_W = 240`
  - `OVERVIEW_STACK_BP = 1100`
  - `TREND_LEGEND_COMPACT_H = 7 * 16` (112)
  - `TREND_PLOT_COMPACT_MIN_H = 160`
  - `FILTER_BAR_H` becomes 163
- **Remove `RESET_SLOT_W`.**

## Review Focus

1. **Filtering to one team must not shrink the ownership card.** The height comes from `knownTeams`, not `pivot.rows`. Pinned in Task 1 by a test that re-renders with a team filter.
2. **The URL names a repo, so the Repo chip shows on first load**, even before the rail loads. Pinned in Task 2.
3. **`Compare to` holds a date.** The chip reads `Compare to: <YYYY-MM-DD>`, not `A date…`. Pinned in Task 2.
4. **0 known teams (summary not loaded, or an empty org)** uses `OWNERSHIP_MIN_ROWS` rather than collapsing. Pinned in Task 1.
5. **Below 1100px the cards stack** and the trend card keeps its 220px plot. This is pinned by class assertions in Task 3, because jsdom has no layout, and checked in the browser in Task 4.

---

### Task 1: Ownership card sized to the org's team count

**Files:**
- Modify: `src/app/vulnerabilities/dimensions.ts`
  - `OWNERSHIP_BODY_H` at line 24 is removed.
  - `TEAM_ROW_H` at line 25 changes from 50 to 40.
- Modify: `src/app/vulnerabilities/ownership-model.ts:50-61`. `teamRowsOverflow` and `teamRowsRoom` take the body height.
- Modify: `src/app/vulnerabilities/ownership-card.tsx`. Compute and apply the body height, and pass it to `teamRowsOverflow`.
- Modify: `src/app/vulnerabilities/repo-table.tsx`. No logic change; it already uses `TEAM_ROW_H`. Check that nothing else depends on 50.
- Tests to modify:
  - `src/lib/__tests__/unit/vuln-security-dimensions.test.ts`
  - `vuln-ownership-model.test.ts`
  - `vuln-ownership-card.test.tsx`
  - `vuln-security-page.test.tsx` (line 86)
  - `vuln-team-table.test.tsx`, if it asserts 50
  - `vuln-docs-references.test.ts:141`: replace the `OWNERSHIP_BODY_H` entry with `['TEAM_ROW_H', D.TEAM_ROW_H, ...]` if it is not already listed. Otherwise delete the entry. The doc wording itself is updated in Task 4.

**Interfaces:**
- **Produces:**
  - `export const OWNERSHIP_MIN_ROWS = 5`
  - `export const OWNERSHIP_MAX_ROWS = 12`
  - `export function ownershipBodyH(teamCount: number): number`
  - `teamRowsOverflow(rowCount: number, hasFootnote: boolean, bodyH: number): boolean`
  - `teamRowsRoom(hasFootnote: boolean, bodyH: number): number`
- The card reads `summary.knownTeams` from `SecurityViewProps`. Check `view-props.ts` for the exact field holding the summary. The page passes `s.knownTeams` to FilterBar, which is the same object.
- **Ruling:** `knownTeams` already includes the "no team" bucket (it maps `teamOf`), so the team count is `knownTeams.length` with no +1. This corrects the spec's "+1 for No team"; the two mean the same thing.

- [ ] **Step 1: Write the failing tests** in `vuln-security-dimensions.test.ts`:

```ts
import { ownershipBodyH, OWNERSHIP_MIN_ROWS, OWNERSHIP_MAX_ROWS, TEAM_ROW_H, TEAM_HEAD_H, TEAM_FOOTNOTE_H } from '@/app/vulnerabilities/dimensions';

describe('ownershipBodyH', () => {
  const chrome = TEAM_HEAD_H + TEAM_ROW_H /* Total */ + TEAM_FOOTNOTE_H;
  it('uses 40px team rows', () => expect(TEAM_ROW_H).toBe(40));
  it.each([
    [0, OWNERSHIP_MIN_ROWS], [3, OWNERSHIP_MIN_ROWS], [5, 5], [10, 10], [12, 12], [30, OWNERSHIP_MAX_ROWS],
  ])('%i teams -> %i visible rows', (teams, rows) => {
    expect(ownershipBodyH(teams)).toBe(chrome + rows * TEAM_ROW_H);
  });
  it('10 teams fit with no scroll, even with the footnote', () => {
    expect(10 * TEAM_ROW_H).toBeLessThanOrEqual(ownershipBodyH(10) - TEAM_HEAD_H - TEAM_ROW_H - TEAM_FOOTNOTE_H);
  });
  it('treats NaN/negative as the minimum', () => {
    expect(ownershipBodyH(Number.NaN)).toBe(ownershipBodyH(0));
    expect(ownershipBodyH(-4)).toBe(ownershipBodyH(0));
  });
});
```

  Remove the old `expect(OWNERSHIP_BODY_H).toBe(330)` and its import.

- [ ] **Step 2: Run it.** Run `npx jest src/lib/__tests__/unit/vuln-security-dimensions.test.ts`. It should FAIL, because `ownershipBodyH` is not exported.

- [ ] **Step 3: Implement in `dimensions.ts`.** Replace lines 24-25 with:

```ts
/** Team rows: 40px, so an org's teams (10 today) fit the card beside the trend without scrolling. */
export const TEAM_ROW_H = 40;
/** The ownership body shows between these many team rows; more scroll inside it, header and Total row pinned. */
export const OWNERSHIP_MIN_ROWS = 5;
export const OWNERSHIP_MAX_ROWS = 12;
```

  After the `TEAM_FOOTNOTE_H` line, add:

```ts
/**
 * The ownership card body's height, from the ORG's known-team count (summary.knownTeams.length), never the filtered row
 * count, so a filter change never resizes the card. It settles once when the summary first loads (0 → real count); that
 * is the one accepted size change (docs/vulnerabilities-page.md, "Layout stability"). Room for the pinned header, the
 * visible rows, the pinned Total row and the † footnote line, whether or not the footnote shows.
 */
export function ownershipBodyH(teamCount: number): number {
  const n = Number.isFinite(teamCount) ? teamCount : 0;
  const rows = Math.min(Math.max(n, OWNERSHIP_MIN_ROWS), OWNERSHIP_MAX_ROWS);
  return TEAM_HEAD_H + rows * TEAM_ROW_H + TEAM_ROW_H + TEAM_FOOTNOTE_H;
}
```

  `TEAM_HEAD_H` and `TEAM_FOOTNOTE_H` must be declared above the function. Move the function below them.

- [ ] **Step 4: Update `ownership-model.ts`:**

```ts
export function teamRowsOverflow(rowCount: number, hasFootnote: boolean, bodyH: number): boolean {
  return rowCount * TEAM_ROW_H > teamRowsRoom(hasFootnote, bodyH);
}
export const teamRowsRoom = (hasFootnote: boolean, bodyH: number): number =>
  bodyH - TEAM_HEAD_H - TEAM_ROW_H - (hasFootnote ? TEAM_FOOTNOTE_H : 0);
```

  - Drop the `OWNERSHIP_BODY_H` import.
  - Update `vuln-ownership-model.test.ts:298-315` to pass `ownershipBodyH(10)` as the body (and import it).

- [ ] **Step 5: Update `ownership-card.tsx`:**
  - Compute `const bodyH = ownershipBodyH(summary?.knownTeams?.length ?? 0);`, using whatever name the summary has in `SecurityViewProps`.
  - Apply `style={{ height: bodyH }}` on `ownership-card-body`.
  - Pass `bodyH` to the `teamRowsOverflow(...)` call.
  - Add a `data-team-count` attribute on the body, carrying the count, to make tests readable.

- [ ] **Step 6: Write the card tests** in `vuln-ownership-card.test.tsx`, following the file's existing render helpers:

```ts
it('sizes the body from the org team count', () => {
  renderCard({ knownTeams: Array.from({ length: 10 }, (_, i) => `T${i}`) });
  expect(body().style.height).toBe(`${ownershipBodyH(10)}px`);
});
it('keeps its height when a team filter narrows the rows', () => {
  const teams = Array.from({ length: 10 }, (_, i) => `T${i}`);
  const { rerender } = renderCard({ knownTeams: teams });
  const before = body().style.height;
  rerenderCard(rerender, { knownTeams: teams, team: 'T3' });
  expect(body().style.height).toBe(before);
});
it('uses the minimum before the summary lists any team', () => {
  renderCard({ knownTeams: [] });
  expect(body().style.height).toBe(`${ownershipBodyH(0)}px`);
});
```

  - Adapt `renderCard`/`rerenderCard` to the file's real fixture builders. If the fixture has no `knownTeams`, set it on the summary fixture.
  - Replace the old `${OWNERSHIP_BODY_H}px` assertion at line 34.
  - Update `vuln-security-page.test.tsx:86` to expect `ownershipBodyH(<fixture's knownTeams length>)`.

- [ ] **Step 7: Run all `vuln-` tests.** Run `npx jest src/lib/__tests__/unit/vuln-`. Expected: PASS, apart from `vuln-docs-references` while the doc still names `OWNERSHIP_BODY_H`. If that is its only failure, fix that test's table entry as described under Files. If it still fails because the doc names 330, note it for Task 4.

- [ ] **Step 8: Commit:**

```bash
git add src/app/vulnerabilities/dimensions.ts src/app/vulnerabilities/ownership-model.ts src/app/vulnerabilities/ownership-card.tsx src/lib/__tests__/unit/vuln-*.test.ts src/lib/__tests__/unit/vuln-*.test.tsx
git commit -m "Security: size the ownership card to the org's team count (40px rows, 5-12 rows)"
```

  Stage only the test files you actually changed. Name them explicitly.

---

### Task 2: Filter chips in the sticky bar

**Files:**
- Create: `src/components/filter-chip.tsx`
- Modify: `src/app/vulnerabilities/dimensions.ts:87-103` (the bar constants)
- Modify: `src/app/vulnerabilities/filter-bar.tsx`
- Tests:
  - Modify `src/lib/__tests__/unit/vuln-filter-bar.test.tsx`
  - Modify `vuln-security-dimensions.test.ts`
  - Modify `vuln-docs-references.test.ts` (drop `RESET_SLOT_W` if listed)
  - Create `src/lib/__tests__/unit/filter-chip.test.tsx`

**Interfaces:**
- **Produces:**
  - `export default function FilterChip(props: { label: string; onRemove: () => void; maxWidth?: number; title?: string; removeRef?: Ref<HTMLButtonElement> }): JSX.Element`
  - Constants: `FILTER_CHIP_ROW_H = 28`, `FILTER_CHIP_ROW_GAP = 8`, `CHIP_MAX_W = 240`, `FILTER_ROW_H = 103`, `FILTER_BAR_H = 163`
  - `RESET_SLOT_W` is removed.
- **Consumes:** `FilterBarUrl` gains `'repo' | 'setRepo'` (both exist on `SecurityUrl`).

- [ ] **Step 1: Write the FilterChip test** in `filter-chip.test.tsx`:

```tsx
/** @jest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import FilterChip from '@/components/filter-chip';

it('shows the label, truncates with a title, and removes on ×', () => {
  const onRemove = jest.fn();
  render(<FilterChip label="Team: Platform" onRemove={onRemove} maxWidth={240} />);
  const chip = screen.getByTestId('filter-chip');
  expect(chip).toHaveTextContent('Team: Platform');
  expect(chip.style.maxWidth).toBe('240px');
  expect(screen.getByText('Team: Platform')).toHaveAttribute('title', 'Team: Platform');
  fireEvent.click(screen.getByRole('button', { name: 'Remove Team: Platform filter' }));
  expect(onRemove).toHaveBeenCalledTimes(1);
});
```

  If `toHaveTextContent` is unavailable (no jest-dom), use `chip.textContent` and `getAttribute`. Check how other `.tsx` tests in this folder assert.

- [ ] **Step 2: Run it.** Run `npx jest src/lib/__tests__/unit/filter-chip.test.tsx`. It should FAIL, because the module is not found.

- [ ] **Step 3: Implement `src/components/filter-chip.tsx`:**

```tsx
// src/components/filter-chip.tsx
// A removable filter chip, styled as the Projects / Team / Settings chips. Only the Security tab uses it so far;
// moving those pages onto it is a separate change.
'use client';
import type { Ref } from 'react';

export interface FilterChipProps {
  label: string;
  onRemove: () => void;
  /** px; a longer label is cut with "…" and keeps its full text in a title. */
  maxWidth?: number;
  title?: string;
  removeRef?: Ref<HTMLButtonElement>;
}

export default function FilterChip({ label, onRemove, maxWidth, title, removeRef }: FilterChipProps) {
  return (
    <span
      data-testid="filter-chip"
      className="inline-flex min-w-0 shrink items-center gap-1.5 bg-accent/20 text-accent-lighter text-xs font-medium px-2.5 py-1 rounded-lg border border-accent/30"
      style={maxWidth ? { maxWidth } : undefined}
    >
      <span className="truncate" title={title ?? label}>{label}</span>
      <button
        type="button" ref={removeRef} onClick={onRemove} aria-label={`Remove ${label} filter`}
        className="shrink-0 text-accent-light hover:text-white ml-0.5"
      >
        &times;
      </button>
    </span>
  );
}
```

- [ ] **Step 4: Run the FilterChip test.** Expected: PASS.

- [ ] **Step 5: Write the dimension tests** in `vuln-security-dimensions.test.ts`:

```ts
it('the bar adds a 28px chip row 8px under the selects', () => {
  expect(FILTER_CHIP_ROW_H).toBe(28);
  expect(FILTER_CHIP_ROW_GAP).toBe(8);
  expect(FILTER_ROW_H).toBe(FILTER_CONTROLS_H + FILTER_CHIP_ROW_GAP + FILTER_CHIP_ROW_H + FILTER_PAD_BOTTOM + FILTER_RULE_H); // 103
  expect(FILTER_BAR_H).toBe(163);
  expect(FILTER_ROW_W).toBe(SELECT_W.codebase + SELECT_W.team + SELECT_W.severity + SELECT_W.baseline + SELECT_W.date + 4 * FILTER_ROW_GAP);
});
```

  Remove any existing `FILTER_BAR_H` 127 / `FILTER_ROW_H` 67 / `RESET_SLOT_W` assertions.

- [ ] **Step 6: Update `dimensions.ts`:**

```ts
export const FILTER_CHIP_ROW_GAP = 8;         // from the selects to the chip row
export const FILTER_CHIP_ROW_H = 28;          // one line of chips; always rendered (a nbsp when no filter is active)
/** A chip's maximum width; a longer label is cut with "…" (the full text is in its title). */
export const CHIP_MAX_W = 240;
export const FILTER_ROW_H =
  FILTER_CONTROLS_H + FILTER_CHIP_ROW_GAP + FILTER_CHIP_ROW_H + FILTER_PAD_BOTTOM + FILTER_RULE_H; // 103
export const FILTER_BAR_H = BAR_PAD_TOP + BAR_ROW_H + BAR_ROW_GAP + FILTER_ROW_H; // 163
export const FILTER_ROW_W =
  SELECT_W.codebase + SELECT_W.team + SELECT_W.severity + SELECT_W.baseline + SELECT_W.date + 4 * FILTER_ROW_GAP;
```

  Delete `RESET_SLOT_W` and grep for other users of it with `grep -rn RESET_SLOT_W src docs --include=*.ts --include=*.tsx --include=*.md | grep -v ' 2\.'`.

- [ ] **Step 7: Write the filter bar tests** in `vuln-filter-bar.test.tsx`, using its existing `url` fixture and builder (add `repo: null`, `setRepo: jest.fn()` and `isDefault.repo` to it):

```tsx
const chips = () => screen.queryAllByTestId('filter-chip').map(c => c.querySelector('span')!.textContent);

it('shows no chips at the defaults, but keeps the chip row', () => {
  renderBar(defaultUrl());
  expect(chips()).toEqual([]);
  const row = screen.getByTestId('chip-row');
  expect(row.style.height).toBe(`${FILTER_CHIP_ROW_H}px`);
  expect(screen.getByTestId('clear-all-slot').querySelector('button')!.className).toMatch(/invisible/);
});

it('shows one chip per non-default filter, in order', () => {
  renderBar(urlWith({ codebase: 'frontend', team: 'Platform', repo: 'billing-api', severity: 'critical', baseline: '30d' }));
  expect(chips()).toEqual(['Codebase: Frontend', 'Team: Platform', 'Repo: billing-api', 'Severity: Critical', 'Compare to: 30 days ago']);
});

it('labels a dated baseline with its date', () => {
  renderBar(urlWith({ baseline: '2026-09-01' }));
  expect(chips()).toEqual(['Compare to: 2026-09-01']);
});

it('shows the Repo chip from the URL alone', () => {
  renderBar(urlWith({ repo: 'billing-api' }));
  expect(chips()).toEqual(['Repo: billing-api']);
});

it('× resets only its filter and focuses that filter\'s select', () => {
  const url = urlWith({ team: 'Platform', severity: 'high' });
  renderBar(url);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Team: Platform filter' }));
  expect(url.setTeam).toHaveBeenCalledWith(null);
  expect(url.setSeverity).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(document.getElementById('security-team'));
});

it('the Repo chip × clears the repo and focuses Codebase', () => {
  const url = urlWith({ repo: 'billing-api' });
  renderBar(url);
  fireEvent.click(screen.getByRole('button', { name: 'Remove Repo: billing-api filter' }));
  expect(url.setRepo).toHaveBeenCalledWith(null);
  expect(document.activeElement).toBe(document.getElementById('security-codebase'));
});

it('Clear all resets every filter', () => {
  const url = urlWith({ team: 'Platform' });
  renderBar(url);
  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
  expect(url.resetFilters).toHaveBeenCalled();
});

it('chips cap their width', () => {
  renderBar(urlWith({ team: 'A very long team name that will not fit in the chip' }));
  expect(screen.getByTestId('filter-chip').style.maxWidth).toBe(`${CHIP_MAX_W}px`);
});
```

  - `urlWith(overrides)` must set `isDefault` consistently with the overrides, and `isDefault.all` false when any differ.
  - The Codebase default is `backend`. Use a non-default group from `CODEBASE_GROUPS`, and its label from `CODEBASE_LABELS`, which is the chip label. **Ruling:** the chip shows the group label without the "· N open" count.
  - Remove the old "Reset filters" / `reset-slot` tests.

- [ ] **Step 8: Run them.** Run `npx jest src/lib/__tests__/unit/vuln-filter-bar.test.tsx`. Expected: FAIL.

- [ ] **Step 9: Implement in `filter-bar.tsx`:**
  1. Add `'repo' | 'setRepo'` to `FilterBarUrl`.
  2. Make the existing filters row (the div with `border-b border-gray-800`) `flex-col`.
     - Its first child is a new inner `div className="flex items-end" style={{ height: FILTER_CONTROLS_H, gap: FILTER_ROW_GAP }}` holding the four `Field`s and the date slot, unchanged except that refs are added.
     - Its second child is the chip row, with `marginTop: FILTER_CHIP_ROW_GAP`.
     - The row keeps `height: FILTER_ROW_H`, `paddingBottom: FILTER_PAD_BOTTOM` and its border, and drops `items-end`.
  3. Delete the `reset-slot` block. Add refs `teamRef`, `severityRef` and `compareRef` on the selects (`codebaseRef` already exists).
  4. Build the chips:

```tsx
const COMPARE_CHIP: Record<string, string> = { '7d': '7 days ago', '30d': '30 days ago' };
const chips: Array<{ key: string; label: string; remove: () => void; focus: () => void }> = [];
if (!url.isDefault.codebase) chips.push({ key: 'codebase', label: `Codebase: ${CODEBASE_LABELS[url.codebase]}`, remove: () => url.setCodebase(CODEBASE_SCHEMA.default), focus: () => codebaseRef.current?.focus() });
if (!url.isDefault.team && url.team) chips.push({ key: 'team', label: `Team: ${url.team}`, remove: () => url.setTeam(null), focus: () => teamRef.current?.focus() });
if (!url.isDefault.repo && url.repo) chips.push({ key: 'repo', label: `Repo: ${url.repo}`, remove: () => url.setRepo(null), focus: () => codebaseRef.current?.focus() });
if (!url.isDefault.severity) chips.push({ key: 'severity', label: `Severity: ${url.severity === 'critical' ? 'Critical' : 'High'}`, remove: () => url.setSeverity('both'), focus: () => severityRef.current?.focus() });
if (!url.isDefault.baseline) chips.push({ key: 'baseline', label: `Compare to: ${isDate ? url.baseline : COMPARE_CHIP[url.baseline] ?? url.baseline}`, remove: () => url.setBaseline('last'), focus: () => compareRef.current?.focus() });
```

     Import `CODEBASE_SCHEMA` from `./security-state`. It is exported at line 33.

  5. Render the chip row:

```tsx
<div data-testid="chip-row" className="flex min-w-0 flex-nowrap items-center overflow-hidden" style={{ height: FILTER_CHIP_ROW_H, marginTop: FILTER_CHIP_ROW_GAP, gap: FILTER_ROW_GAP }}>
  {chips.length === 0 && <span aria-hidden="true">&nbsp;</span>}
  {chips.map(c => (
    <FilterChip key={c.key} label={c.label} maxWidth={CHIP_MAX_W} onRemove={() => { c.remove(); c.focus(); }} />
  ))}
  {/* Reserved: always rendered, hidden at the defaults, so the chips never move when it appears. */}
  <span data-testid="clear-all-slot" className="shrink-0">
    <button
      type="button"
      onClick={() => { url.resetFilters(); codebaseRef.current?.focus(); }}
      disabled={url.isDefault.all} tabIndex={url.isDefault.all ? -1 : 0} aria-hidden={url.isDefault.all ? true : undefined}
      className={`text-xs text-gray-600 hover:text-gray-400 ${url.isDefault.all ? 'invisible' : ''}`}
    >
      Clear all
    </button>
  </span>
</div>
```

  6. Remove `RESET_SLOT_W` from the import, and add `CHIP_MAX_W`, `FILTER_CHIP_ROW_GAP`, `FILTER_CHIP_ROW_H` and `FILTER_CONTROLS_H`.

- [ ] **Step 10: Pass `repo`/`setRepo` through.** `vulnerabilities-content.tsx` already passes the full `url`, so check that it type-checks: `npx tsc --noEmit -p . 2>&1 | grep -v ' 2\.' | head`.

- [ ] **Step 11: Run the tests.** Run `npx jest src/lib/__tests__/unit/vuln- src/lib/__tests__/unit/filter-chip`. Expected: PASS. A `vuln-docs-references` failure that names only `FILTER_BAR_H`/`RESET_SLOT_W` wording in the doc is fixed in Task 4. Note it in the report.

- [ ] **Step 12: Commit:**

```bash
git add src/components/filter-chip.tsx src/app/vulnerabilities/filter-bar.tsx src/app/vulnerabilities/dimensions.ts <the test files you changed>
git commit -m "Security: show active filters as removable chips; Clear all replaces Reset filters"
```

---

### Task 3: Overview grid, with the trend card beside the ownership card

**Files:**
- Modify: `src/app/vulnerabilities/vulnerabilities-content.tsx:136-142`
- Modify: `src/app/vulnerabilities/trend-card.tsx`
- Modify: `src/app/vulnerabilities/ownership-card.tsx` (outer `section`: `h-full`, and the card fills it)
- Modify: `src/app/vulnerabilities/dimensions.ts` (add the constants below)
- Tests: modify `src/lib/__tests__/unit/vuln-security-page.test.tsx`, and add to `vuln-trend-card` tests if a trend test file exists (`ls src/lib/__tests__/unit | grep -i trend`).

**Interfaces:**
- **Consumes:** Task 1's `ownershipBodyH`, which already sizes the card.
- **Produces:** constants `OVERVIEW_STACK_BP = 1100`, `TREND_LEGEND_COMPACT_H = 7 * 16`, `TREND_PLOT_COMPACT_MIN_H = 160`, and `OVERVIEW_GRID_COLS = 'minmax(0, 3fr) minmax(0, 2fr)'`.
- **Ruling:** Tailwind cannot use a JS constant in a class name. The breakpoint class is the literal `min-[1100px]:` and a test asserts that the literal matches `OVERVIEW_STACK_BP`. The column template is applied with the arbitrary class `min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]`, and the test checks that it encodes `OVERVIEW_GRID_COLS`.

- [ ] **Step 1: Write the page tests** in `vuln-security-page.test.tsx`, using the file's existing Overview render:

```tsx
it('puts the ownership and trend cards in one two-column grid, ownership first', () => {
  renderOverview();
  const grid = screen.getByTestId('overview-grid');
  expect(grid.className).toContain(`min-[${OVERVIEW_STACK_BP}px]:grid-cols-[${OVERVIEW_GRID_COLS.replace(/ /g, '_').replace(/,_/g, ',')}]`);
  expect(grid.className).toMatch(/\bgrid\b/);
  const kids = Array.from(grid.children).map(c => c.getAttribute('data-testid'));
  expect(kids).toEqual(['ownership-card', 'trend-card']);
});
it('the KPI row stays outside the grid, full width', () => {
  renderOverview();
  expect(screen.getByTestId('overview-grid').contains(screen.getByTestId('kpi-tiles'))).toBe(false);
});
```

  - Use the real test ids. Check `ownership-card.tsx` and `kpi-tiles.tsx` for theirs and add `data-testid="ownership-card"` to the section if it is missing.
  - The class-string helper must produce `min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]`. Simplify the assertion to that literal if you prefer, and keep a separate `expect(OVERVIEW_STACK_BP).toBe(1100)`.

- [ ] **Step 2: Write the trend card tests** (in its test file, or in the page test):

```tsx
it('compact parts switch at the breakpoint, stacked layout unchanged', () => {
  renderOverview();
  const plot = screen.getByTestId('trend-plot');
  expect(plot.style.height).toBe(`${TREND_PLOT_H}px`);          // stacked default
  expect(plot.className).toContain('min-[1100px]:!h-auto');
  expect(plot.className).toContain('min-[1100px]:flex-1');
  expect(plot.className).toContain(`min-[1100px]:min-h-[${TREND_PLOT_COMPACT_MIN_H}px]`);
  const legend = screen.getByTestId('trend-legend');
  expect(legend.className).toContain(`min-[1100px]:max-h-[${TREND_LEGEND_COMPACT_H}px]`);
  expect(legend.className).toContain('min-[1100px]:overflow-y-auto');
});
```

  Check the legend's current test id in `trend-card.tsx` near line 138. If the legend has none, add `data-testid="trend-legend"`.

- [ ] **Step 3: Run them.** Run `npx jest src/lib/__tests__/unit/vuln-security-page.test.tsx`. Expected: FAIL.

- [ ] **Step 4: Implement in `vulnerabilities-content.tsx`:**

```tsx
<KpiTiles {...viewProps} />
{/* Below 1100px the cards stack (the trend card's full-width layout); from 1100px they sit side by side, the same height:
    the ownership card's body (sized to the org's teams) sets the row, and the trend card stretches to it. */}
<div data-testid="overview-grid" className="grid grid-cols-1 items-stretch min-[1100px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" style={{ gap: PAGE_GAP }}>
  <OwnershipCard {...viewProps} />
  <TrendCard {...viewProps} />
</div>
```

- [ ] **Step 5: Implement in `trend-card.tsx`.** All changes are CSS classes; the stacked layout is unchanged.
  - The outer `section`: add `h-full`. The inner card `div` (`bg-gray-900 p-4`): add `flex flex-col min-[1100px]:flex-1`.
  - The header row (`flex items-start justify-between gap-4`): add `min-[1100px]:flex-col min-[1100px]:items-stretch`.
  - The header's right block (`flex shrink-0 items-center gap-4`): add `min-[1100px]:justify-between`. The range select and the figures keep their fixed widths.
  - The plot (`data-testid="trend-plot"`): keep `style={{ height: TREND_PLOT_H }}` and add `min-[1100px]:!h-auto min-[1100px]:flex-1 min-[1100px]:min-h-[160px]`. The `!` overrides the inline height at the breakpoint; Tailwind's important modifier beats inline style only with `!important`, which is what `!` emits.
  - The legend grid: add `min-[1100px]:max-h-[112px] min-[1100px]:overflow-y-auto`. `TREND_LEGEND_MIN_W` already gives 2 columns at about 500px. Keep its reserved 3-line minimum.
  - The values in the class names must be the literals 1100, 160 and 112. Add a comment naming the constants, and add `expect` lines in the tests from Steps 1-2 pinning `OVERVIEW_STACK_BP === 1100`, `TREND_PLOT_COMPACT_MIN_H === 160` and `TREND_LEGEND_COMPACT_H === 112`.

- [ ] **Step 6: Make the ownership card fill its grid cell.** In `ownership-card.tsx`:
  - Add `h-full flex flex-col` to the outer section.
  - Add `flex-1` to the `bg-gray-900` card.
  - The body keeps its computed fixed height. Only the card shell stretches, which happens only when the trend card is taller, for example with a long legend.

- [ ] **Step 7: Run all `vuln-` tests.** Run `npx jest src/lib/__tests__/unit/vuln-`. Expected: PASS, with the doc-reference exception noted in Task 2.

- [ ] **Step 8: Commit:**

```bash
git add src/app/vulnerabilities/vulnerabilities-content.tsx src/app/vulnerabilities/trend-card.tsx src/app/vulnerabilities/ownership-card.tsx src/app/vulnerabilities/dimensions.ts <the test files you changed>
git commit -m "Security Overview: ownership and trend cards side by side from 1100px"
```

---

### Task 4: Docs, the full suite, and the browser check

**Files:**
- Modify: `docs/vulnerabilities-page.md`, the "Layout stability" section (lines 166-196)
- Modify: `src/lib/__tests__/unit/vuln-docs-references.test.ts`, if its table needs the new names

- [ ] **Step 1: Update the doc table rows:**
  - **Sticky bar:** 163px. The filters row is now 103px: the 52px controls block, 8px, a 28px chip row, 14px to the rule, and the 1px rule.
  - **Bar reserved slots:**
    - The "Reset filters" text is replaced with: "Clear all at the end of the chip row: hidden, never removed".
    - Add: "the chip row (28px) renders in every state; chips are at most 240px (`CHIP_MAX_W`), cut with '…' and a title; the row is one line and clips overflow at narrow widths".
  - **Ownership card body:** `ownershipBodyH(teamCount)`. The header is 56px, then 5 to 12 team rows at 40px, a 40px Total row and the 20px footnote line. `teamCount` is the org's known-team count, never the filtered rows. Add: "It settles once when the summary first loads; this is the one accepted size change, and it never happens on a filter change."
  - **Trend plot:** add "From 1100px the card sits beside the ownership card (grid `minmax(0,3fr) minmax(0,2fr)`), its header takes two lines, the plot fills the remaining height (at least 160px) and the legend scrolls past 112px (seven lines)".
  - **Rules:** in "Reserved slots, not removed controls", replace "The Reset button" with "Clear all and the chip row". In "Every region keeps its height", append the first-load exception sentence.

- [ ] **Step 2: Run the doc-reference test.** Run `npx jest src/lib/__tests__/unit/vuln-docs-references.test.ts`. Expected: PASS, apart from failures that name only untracked " 2" files. Fix any table entries that reference removed names.

- [ ] **Step 3: Run the full suite.** Run `npx jest 2>&1 | tail -15`. Expected: everything passes except `chart-no-literal-colors` and the " 2"-file `vuln-docs-references` cases, as on main. Record the counts.

- [ ] **Step 4: Type-check and lint.** Run `npx tsc --noEmit -p . 2>&1 | grep -v ' 2\.' | head` (expected: no output), then `npm run lint 2>&1 | tail -5`.

- [ ] **Step 5: Commit:**

```bash
git add docs/vulnerabilities-page.md src/lib/__tests__/unit/vuln-docs-references.test.ts
git commit -m "Docs: Security layout stability for filter chips and the side-by-side Overview"
```

- [ ] **Step 6: Browser check.** The controller does this step, not a subagent.
  - Start `npm run dev:mock` on a spare port.
  - With Playwright, screenshot `/vulnerabilities` at 1440×900 and 1024×800.
  - Check these:
    - The seeded teams fit with no scroll.
    - The ownership and trend cards are side by side at 1440 and stacked at 1024.
    - Chips appear when filters are set and clear one at a time.
    - Changing team and severity does not move the cards' positions or sizes. Compare `getBoundingClientRect` of `ownership-card-body` and `trend-card` before and after.
  - Restore `CLAUDE.md` and `next-env.d.ts` afterwards.
