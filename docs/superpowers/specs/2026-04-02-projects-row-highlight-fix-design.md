# Projects Page — Uniform Row Highlight Fix

**Date:** 2026-04-02
**Status:** Approved

## Problem

The Projects table uses `rowSpan` on Goal and Initiative columns to merge cells across grouped rows. The current two-tier hover system (`bg-gray-900/30` for group, `bg-gray-800/30` for direct row) causes inconsistent highlighting because:

1. Semi-transparent `<td>` and `<tr>` backgrounds **stack** — hovering row 1 makes merged cells ~14% tint (darker than intended) while other cells are 10%.
2. Moving hover to row 2 drops merged cells to ~8% (row 1's `<tr>` group bg + `<td>` group bg) — a visible "lightening" jump.
3. Particularly noticeable on light themes where the tint difference is more apparent.

## Solution — Single-tier highlight (Approach B)

Replace the two-tier group/row highlight with a single uniform highlight:

- **Remove** `hoveredGoal` and `hoveredInit` state variables
- **Keep** `hoveredEpic` state to track which row is hovered
- **Merged `<td>` cells**: derive highlight from whether ANY row in their group is hovered (check if `hoveredEpic` belongs to the same goal/initiative group)
- **Highlight class**: use `bg-gray-800/30` uniformly on both the hovered `<tr>` and its merged `<td>` cells — no stacking (merged cells set bg, `<tr>` for non-first rows uses transparent or the same class but NOT both on the same visual area)
- **Non-hovered rows**: no background at all (drop the group glow)

### Key constraint

The merged `<td>` background paints on top of its parent `<tr>` background. To avoid stacking:
- Hovered `<tr>` (first row of group, owns the merged `<td>`): set bg on `<td>`, leave `<tr>` transparent or ensure they don't compound
- Hovered `<tr>` (non-first row): set bg on `<tr>` only (no merged `<td>` to conflict)
- OR simpler: always set merged `<td>` bg when group is active, and for the directly hovered `<tr>`, set bg only on non-merged columns via individual `<td>` styles

**Simplest correct approach**: Set background on the `<tr>` for the hovered row, and on merged `<td>` cells. For the first row of a group (which owns the merged cells), the `<td>` bg will override the `<tr>` bg in the merged area — which is fine since they're the same color. For non-first rows, the `<tr>` bg applies to columns 3-7 while merged cells handle columns 1-2 independently.

## Files changed

- `src/app/projects/projects-content.tsx` — state + className logic
- `src/app/globals.css` — potentially remove unused light-mode overrides for `bg-gray-900/30` if no longer used elsewhere
