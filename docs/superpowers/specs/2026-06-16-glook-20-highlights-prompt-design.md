# GLOOK-20: Fix Hallucinated Narrative in Home Page Report Highlights

## Goal

Stop the report comparison summary from labeling raw metric changes (complexity, commits, AI%) as "improved" or "worse" by grounding all evaluative language in the `impact_score` formula.

## Problem

`report-highlights-system.txt` instructs `"positive" for improvements, "warning" for regressions` without defining what "improvement" means. The LLM naively infers direction from raw metric changes — e.g., complexity dropping from 3.1 → 3.0 is labeled "improved" even though complexity is an input to the formula, not independently directional.

## Architecture

Two-part fix: (1) rewrite the system prompt to anchor sentiment on `impact_score`; (2) add `avgImpact` to both report totals so the LLM has the aggregate signal; (3) add a `_v: 2` cache guard so stale cached results are not served after deployment.

---

## Section 1: Prompt Rewrite

**`prompts/report-highlights-system.txt`** — full replacement:

```
You are a concise engineering analytics assistant for Glooker (GitHub org analytics).
Compare two reports for the same org and period. Return JSON:
{ "highlights": [{ "icon": "emoji", "text": "one sentence", "sentiment": "positive|neutral|warning" }] }

PERFORMANCE FORMULA:
impact_score = Commits (×2.0) + PRs (×2.7) + Complexity (×3.5) + PR% (×1.1) + Jira (×0.5) + Reviews (×0.5). Max: 9.3
impact_score is the ONLY authoritative measure of developer/org performance. Higher is better.

RULES FOR SENTIMENT:
- "positive": use ONLY when avg_impact or individual impact_score improved.
- "warning": use ONLY when avg_impact or individual impact_score declined.
- "neutral": use for ALL other observations — including changes to commits, PRs, complexity, AI%, lines changed.
- NEVER apply "positive" or "warning" to raw metric changes (commits up, complexity down, AI% up, etc.) unless impact_score confirms the direction.
- Complexity changes are NOT independently directional. Do not call a complexity drop "improved" or a rise "worse".

OTHER RULES:
- 3-5 bullet highlights max. Be specific — name developers, cite numbers.
- Focus on: biggest movers (rank changes, impact delta), org-wide impact trend, newly active or recently inactive developers.
- Developers missing from the latest report are NOT "departed" — they are simply inactive this period. Never use "departed" or "left".
- If nothing significant changed, return 1 bullet: "Steady state — no major shifts in the leaderboard or metrics."
- Keep each bullet under 20 words. No fluff.
Return ONLY raw JSON.
```

---

## Section 2: Data Change

**`src/lib/report-highlights/service.ts`** — add `avgImpact` to both totals:

```typescript
avgImpact: statsX.length
  ? (statsX.reduce((s, d) => s + Number(d.impact_score), 0) / statsX.length).toFixed(2)
  : '0',
```

Pass it in the user message TOTALS strings:

```
TOTALS_A: `... avg_impact=${totalA.avgImpact}`
TOTALS_B: `... avg_impact=${totalB.avgImpact}`
```

---

## Section 3: Cache Invalidation

Stored format changes from `JSON.stringify(highlights)` (bare array) to `JSON.stringify({ _v: 2, highlights })`.

On read, check `data._v === 2`; if missing or wrong, fall through to regenerate. Strip `_v` before returning to callers.

On write, store `{ _v: 2, highlights }`.

This ensures any comparison cached with the old prompt is transparently regenerated on the next page load.

---

## Section 4: Snapshot Test

`prompts/report-highlights-system.txt` is covered by a snapshot test in `src/lib/__tests__/unit/prompts.test.ts`. After editing the file, run `npm test -- --testPathPatterns="prompts" -u` to update the snapshot. Review the diff to confirm only the expected changes.

---

## Files Changed

| File | Change |
|---|---|
| `prompts/report-highlights-system.txt` | Rewrite — formula context + sentiment rules |
| `src/lib/report-highlights/service.ts` | Add `avgImpact` to totals; add `_v: 2` cache guard |
| `src/lib/__tests__/unit/__snapshots__/prompts.test.ts.snap` | Update snapshot |
