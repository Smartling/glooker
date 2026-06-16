# GLOOK-20: Fix Hallucinated Narrative in Report Highlights

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground report highlight sentiment in `impact_score` instead of naive metric direction, and add a `_v: 2` cache guard so stale pre-fix results are transparently regenerated.

**Architecture:** The prompt rewrite and `avgImpact` addition were already validated via a live test during brainstorming — those changes live in the working tree but are not yet committed. This plan formalises them (adds the missing `_v: 2` cache guard, updates tests, updates the snapshot), then commits everything.

**Tech Stack:** TypeScript, Jest + ts-jest, `loadPrompt` prompt-loader, `report_comparisons` MySQL/SQLite table

---

## File Map

| File | Change |
|---|---|
| `prompts/report-highlights-system.txt` | Already rewritten (uncommitted) — commit in Task 2 |
| `src/lib/report-highlights/service.ts` | `avgImpact` already added (uncommitted); add `_v: 2` guard in Task 1 |
| `src/lib/__tests__/unit/report-highlights-service.test.ts` | Update cache tests; add stale-cache test; add `avg_impact` assertion |
| `src/lib/__tests__/unit/__snapshots__/` | Snapshot update in Task 2 |

---

### Task 1: `_v: 2` cache guard in service.ts + test updates (TDD)

**Files:**
- Modify: `src/lib/report-highlights/service.ts`
- Modify: `src/lib/__tests__/unit/report-highlights-service.test.ts`

**Context:** The cache read/write in `service.ts` currently stores highlights as a bare JSON array and returns it on any cache hit. After this task, it stores `{ _v: 2, highlights: [...] }` and treats any row without `_v === 2` as stale (falls through to regenerate). This mirrors the pattern used for `project-insights/route.ts`.

The `avgImpact` addition is already in the working tree — do NOT revert it. Leave it as-is and commit it together with the `_v: 2` changes in this task.

The three existing cache tests need updating; one new stale-cache test is added.

- [ ] **Step 1: Update the two existing cached-highlights tests to use `_v: 2` format**

In `src/lib/__tests__/unit/report-highlights-service.test.ts`, find the `describe('cached highlights'` block and update both tests:

```typescript
  describe('cached highlights', () => {
    it('returns cached data with cached: true and does NOT call LLM', async () => {
      const cachedHighlights = [{ icon: '✅', text: 'Steady state', sentiment: 'neutral' }];
      const cachedRow = {
        highlights_json: JSON.stringify({ _v: 2, highlights: cachedHighlights }),
        generated_at: '2026-03-16T08:00:00Z',
      };

      mockDbExecute
        .mockResolvedValueOnce([[latestReport], null])  // latest
        .mockResolvedValueOnce([[prevReport], null])    // prev
        .mockResolvedValueOnce([[cachedRow], null]);    // cache hit

      const result = await getReportHighlights();

      expect(result).toEqual({
        available: true,
        org: 'acme',
        periodDays: 30,
        reportDateA: prevReport.created_at,
        reportDateB: latestReport.created_at,
        highlights: cachedHighlights,
        cached: true,
      });
      expect(mockGetLLMClient).not.toHaveBeenCalled();
      expect(mockDbExecute).toHaveBeenCalledTimes(3);
    });

    it('handles highlights_json already parsed as object (not string)', async () => {
      const cachedHighlights = [{ icon: '📊', text: 'Metrics stable', sentiment: 'neutral' }];
      const cachedRow = {
        highlights_json: { _v: 2, highlights: cachedHighlights }, // already parsed
        generated_at: '2026-03-16T08:00:00Z',
      };

      mockDbExecute
        .mockResolvedValueOnce([[latestReport], null])
        .mockResolvedValueOnce([[prevReport], null])
        .mockResolvedValueOnce([[cachedRow], null]);

      const result = await getReportHighlights();

      expect(result).toMatchObject({
        available: true,
        highlights: cachedHighlights,
        cached: true,
      });
      expect(mockGetLLMClient).not.toHaveBeenCalled();
    });

    it('treats stale cache (bare array, no _v) as miss and regenerates via LLM', async () => {
      // Old format stored before the _v: 2 migration
      const staleRow = {
        highlights_json: JSON.stringify([{ icon: '📊', text: 'Old result', sentiment: 'neutral' }]),
        generated_at: '2026-03-16T08:00:00Z',
      };

      const mockClient = makeMockLLMClient();
      mockGetLLMClient.mockResolvedValue(mockClient);

      mockDbExecute
        .mockResolvedValueOnce([[latestReport], null])  // latest
        .mockResolvedValueOnce([[prevReport], null])    // prev
        .mockResolvedValueOnce([[staleRow], null])      // cache hit (stale)
        .mockResolvedValueOnce([devStatsA, null])       // statsA
        .mockResolvedValueOnce([devStatsB, null])       // statsB
        .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT

      const result = await getReportHighlights();

      // Should NOT return the stale text — must have called LLM
      expect(mockGetLLMClient).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ available: true, highlights: llmHighlights, cached: false });
      expect((result as any).highlights[0].text).not.toContain('Old result');
    });
  });
```

- [ ] **Step 2: Update the user message `toContain` assertions to check for `avg_impact`**

In the `describe('prompt and settings snapshots'` block, find the test `'sends correct user message structure'` and add one assertion after the existing ones:

```typescript
      expect(content).toContain('avg_impact=');
```

Also add two new assertions to the system prompt test to check for the formula content (keep the existing `toContain` lines, just add these two):

```typescript
      expect(content).toContain('PERFORMANCE FORMULA:');
      expect(content).toContain('impact_score is the ONLY authoritative measure');
```

- [ ] **Step 3: Run tests to verify they fail as expected**

```bash
npm test -- --testPathPatterns="report-highlights-service" --no-coverage
```

Expected: Multiple FAIL — stale-cache test fails (current code returns cached result instead of regenerating), `avg_impact` assertion fails (not yet in message), system prompt assertions fail (old text).

- [ ] **Step 4: Add `_v: 2` to the cache read in `service.ts`**

Find the cache-hit block (lines ~45–58):

```typescript
  if (cached.length > 0) {
    const highlights = typeof cached[0].highlights_json === 'string'
      ? JSON.parse(cached[0].highlights_json)
      : cached[0].highlights_json;
    return {
      available: true,
      org: latest.org,
      periodDays: latest.period_days,
      reportDateA: prev.created_at,
      reportDateB: latest.created_at,
      highlights,
      cached: true,
    };
  }
```

Replace with:

```typescript
  if (cached.length > 0) {
    const data = typeof cached[0].highlights_json === 'string'
      ? JSON.parse(cached[0].highlights_json)
      : cached[0].highlights_json;
    if (!Array.isArray(data) && data._v === 2) {
      const { _v: _, highlights } = data;
      return {
        available: true,
        org: latest.org,
        periodDays: latest.period_days,
        reportDateA: prev.created_at,
        reportDateB: latest.created_at,
        highlights,
        cached: true,
      };
    }
    // _v !== 2 or bare array (stale pre-migration format) — fall through to regenerate
  }
```

- [ ] **Step 5: Wrap the cache write in `_v: 2` in `service.ts`**

Find the INSERT at the bottom of `getReportHighlights` (it uses `JSON.stringify(highlights)`):

```typescript
  await db.execute(
    `INSERT INTO report_comparisons (report_id_a, report_id_b, highlights_json)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE highlights_json = VALUES(highlights_json), generated_at = NOW()`,
    [reportIdA, reportIdB, JSON.stringify(highlights)],
  );
```

Replace with:

```typescript
  await db.execute(
    `INSERT INTO report_comparisons (report_id_a, report_id_b, highlights_json)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE highlights_json = VALUES(highlights_json), generated_at = NOW()`,
    [reportIdA, reportIdB, JSON.stringify({ _v: 2, highlights })],
  );
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npm test -- --testPathPatterns="report-highlights-service" --no-coverage
```

Expected: All tests PASS except the two snapshot tests (`highlights-system-prompt` and `highlights-user-message`) — those will fail because the prompt and user message changed. That's correct; the snapshots are updated in Task 2.

- [ ] **Step 7: Commit service.ts and test changes**

```bash
git add src/lib/report-highlights/service.ts src/lib/__tests__/unit/report-highlights-service.test.ts
git commit -m "feat(glook-20): _v:2 cache guard + avgImpact in highlights service"
```

---

### Task 2: Commit prompt rewrite + update snapshot

**Files:**
- Modify: `prompts/report-highlights-system.txt` (already updated, uncommitted)
- Update: `src/lib/__tests__/unit/__snapshots__/` (via `-u` flag)

**Context:** The prompt file was rewritten during brainstorming validation and is currently uncommitted. The snapshot tests will be stale — they need to be regenerated with `npm test -- -u`.

After updating, review the diff to confirm only the expected additions appear: the PERFORMANCE FORMULA section, the RULES FOR SENTIMENT section replacing the old "improvements/regressions" rule, and `avg_impact=` in the user message snapshot.

- [ ] **Step 1: Update the snapshot**

```bash
npm test -- --testPathPatterns="report-highlights-service" --no-coverage -u
```

Expected: `2 snapshots updated`. Output shows `highlights-system-prompt` and `highlights-user-message` updated.

- [ ] **Step 2: Review the snapshot diff**

```bash
git diff src/lib/__tests__/unit/__snapshots__/
```

Confirm the diff shows:
- `highlights-system-prompt`: adds `PERFORMANCE FORMULA:` block, `RULES FOR SENTIMENT:` block, removes old `sentiment: "positive" for improvements` line
- `highlights-user-message`: adds `avg_impact=X.XX` in both TOTALS lines

- [ ] **Step 3: Run the full test suite**

```bash
npm test --no-coverage
```

Expected: All tests pass.

- [ ] **Step 4: Commit prompt + snapshot**

```bash
git add prompts/report-highlights-system.txt src/lib/__tests__/unit/__snapshots__/
git commit -m "feat(glook-20): anchor highlights sentiment on impact_score formula, update snapshot"
```
