import {
  applyPendingTransitions,
  resolveStatusTab,
  DONE_CATEGORY,
  type PendingTransition,
  type StatusTab,
} from '@/lib/projects/transition-state';
import type { JiraProject } from '@/lib/jira-projects/types';

// Test fixture: an "epic" shape sufficient for transition-state logic.
// The real ProjectEpic has more fields; we only need `key` here and let the
// extra fields ride along via the `[extra]: unknown` index signature.
//
// Note the two vocabularies in play: `status` holds a Jira status name (what
// the board displays), while a tab id is `active` / `middle` / `done` (what
// this module compares). Which status a tab shows is per-project config that
// transition-state never sees.
interface Epic {
  key: string;
  status: string;
  team: { name: string } | null;
}

const SPS_1: Epic = { key: 'SPS-1', status: 'In Progress', team: { name: 'Alpha' } };
const SPS_2: Epic = { key: 'SPS-2', status: 'In Progress', team: { name: 'Beta' } };
const SPS_3: Epic = { key: 'SPS-3', status: 'Rollout', team: { name: 'Gamma' } };

function pending(...entries: Array<[string, PendingTransition<Epic>]>): Map<string, PendingTransition<Epic>> {
  return new Map(entries);
}

// The live SPS board: two named tab statuses out of a nine-transition workflow.
const SPS: JiraProject = {
  id: 'a', org: 'Smartling', projectKey: 'SPS', displayName: 'Smartling Platform',
  activeStatus: 'In Progress', middleStatus: 'Rollout',
  hierarchy: 'goal-initiative', position: 0,
};

describe('resolveStatusTab', () => {
  it('resolves the project\'s active status to the active tab', () => {
    expect(resolveStatusTab(SPS, 'In Progress', 'indeterminate')).toBe('active');
  });

  it('resolves the project\'s middle status to the middle tab', () => {
    expect(resolveStatusTab(SPS, 'Rollout', 'indeterminate')).toBe('middle');
  });

  it('resolves a genuine Done-category status to the done tab', () => {
    // The Done tab's JQL is `statusCategory = "Done"`, so the category — not
    // the name — is what earns a place there. "Won't Do" is Done-category on
    // live SPS and belongs on the tab even though nothing is named "Done".
    expect(resolveStatusTab(SPS, 'Done', DONE_CATEGORY)).toBe('done');
    expect(resolveStatusTab(SPS, "Won't Do", DONE_CATEGORY)).toBe('done');
  });

  // The regression this whole path exists for. Each of these was resolving to
  // 'done' and pinning the epic to the top of the Done tab indefinitely.
  it.each([
    ['Backlog', 'new'],
    ['Discovery', 'indeterminate'],
    ['Blocked', 'new'],
    ['Specs & Design', 'indeterminate'],
    ['Ready for Dev', 'indeterminate'],
  ])('resolves %s (category %s) to no tab at all', (name, category) => {
    expect(resolveStatusTab(SPS, name, category)).toBeNull();
  });

  it('never resolves to done on an unknown category', () => {
    // A missing category cannot be assumed to be Done — that assumption is the
    // bug in a different disguise.
    expect(resolveStatusTab(SPS, 'Blocked', null)).toBeNull();
  });

  it('honours the project\'s own vocabulary, not the SPS one', () => {
    const research: JiraProject = {
      ...SPS, projectKey: 'RND', activeStatus: 'Discovery', middleStatus: 'Ready for Dev',
    };
    expect(resolveStatusTab(research, 'Discovery', 'indeterminate')).toBe('active');
    expect(resolveStatusTab(research, 'Ready for Dev', 'indeterminate')).toBe('middle');
    // The literal SPS statuses now have no place on this board.
    expect(resolveStatusTab(research, 'In Progress', 'indeterminate')).toBeNull();
    expect(resolveStatusTab(research, 'Rollout', 'indeterminate')).toBeNull();
  });

  it('has no middle tab to resolve to on a two-tab board', () => {
    const twoTab: JiraProject = { ...SPS, middleStatus: null };
    expect(resolveStatusTab(twoTab, 'Rollout', 'indeterminate')).toBeNull();
    expect(resolveStatusTab(twoTab, 'In Progress', 'indeterminate')).toBe('active');
  });

  it('falls back to the category alone when the project has not loaded yet', () => {
    expect(resolveStatusTab(null, 'In Progress', 'indeterminate')).toBeNull();
    expect(resolveStatusTab(null, 'Done', DONE_CATEGORY)).toBe('done');
  });

  it('does not match a null middleStatus against an empty status name', () => {
    const twoTab: JiraProject = { ...SPS, middleStatus: null };
    expect(resolveStatusTab(twoTab, '', null)).toBeNull();
  });
});

describe('applyPendingTransitions', () => {
  describe('empty pending map', () => {
    it('returns a shallow copy of the input array unchanged', () => {
      const epics = [SPS_1, SPS_2];
      const out = applyPendingTransitions(epics, 'active', new Map());
      expect(out).toEqual([SPS_1, SPS_2]);
      // Must be a new array — caller may mutate it.
      expect(out).not.toBe(epics);
    });
  });

  describe('epic targeted at the active tab', () => {
    it('prepends the moved epic when it is missing from the response', () => {
      // Scenario: user moved SPS-3 to the active tab, then switches there
      // before Jira's index has propagated, so Jira still returns the old list.
      const movedEpic: Epic = { ...SPS_3, status: 'In Progress' };
      const out = applyPendingTransitions(
        [SPS_1, SPS_2],
        'active',
        pending(['SPS-3', { targetTab: 'active', movedEpic }]),
      );
      expect(out.map(e => e.key)).toEqual(['SPS-3', 'SPS-1', 'SPS-2']);
      // The injected entry carries the optimistic status, not the stale one.
      expect(out[0].status).toBe('In Progress');
    });

    it('does not duplicate when the response already contains the moved epic', () => {
      // Scenario: same transition as above, but Jira has already caught up
      // and the response now includes the moved epic in the right place.
      const movedEpic: Epic = { ...SPS_3, status: 'In Progress' };
      const out = applyPendingTransitions(
        [SPS_3, SPS_1],
        'active',
        pending(['SPS-3', { targetTab: 'active', movedEpic }]),
      );
      expect(out.map(e => e.key)).toEqual(['SPS-3', 'SPS-1']);
      expect(out.filter(e => e.key === 'SPS-3')).toHaveLength(1);
    });
  });

  describe('epic targeted at a different tab', () => {
    it('strips the epic from the response for a non-target tab', () => {
      // Scenario: user moved SPS-1 from the active tab to the middle one. The
      // active response still contains SPS-1 because Jira's index has not
      // caught up — strip it so the source tab does not look like it still
      // owns the epic.
      const movedEpic: Epic = { ...SPS_1, status: 'Rollout' };
      const out = applyPendingTransitions(
        [SPS_1, SPS_2],
        'active',
        pending(['SPS-1', { targetTab: 'middle', movedEpic }]),
      );
      expect(out.map(e => e.key)).toEqual(['SPS-2']);
    });

    it('is a no-op when the response already excludes the moved epic', () => {
      const movedEpic: Epic = { ...SPS_1, status: 'Rollout' };
      const out = applyPendingTransitions(
        [SPS_2],
        'active',
        pending(['SPS-1', { targetTab: 'middle', movedEpic }]),
      );
      expect(out.map(e => e.key)).toEqual(['SPS-2']);
    });
  });

  describe('epic targeted at no tab at all', () => {
    // The regression: an epic moved to a status this board shows no tab for
    // used to be recorded as `targetTab: 'done'`, so it was prepended to the
    // Done tab on every fetch — Jira's Done JQL never returns it, so the
    // injection repeated until reload, showing e.g. "Blocked" atop Done.
    const blocked: Epic = { ...SPS_1, status: 'Blocked' };
    const map = pending(['SPS-1', { targetTab: null, movedEpic: blocked }]);

    it('strips it from the tab the user was looking at', () => {
      const out = applyPendingTransitions([SPS_1, SPS_2], 'active', map);
      expect(out.map(e => e.key)).toEqual(['SPS-2']);
    });

    it('injects it into no tab, the Done tab included', () => {
      for (const tab of ['active', 'middle', 'done'] as StatusTab[]) {
        const out = applyPendingTransitions([], tab, map);
        expect(out).toEqual([]);
      }
    });

    it('leaves Jira free to place it: a later response is passed through', () => {
      // Once Jira's index catches up the epic simply arrives on whatever tab
      // owns it, and the registry — which only ever removes — does not fight it.
      // (Same key, so the registry strips it; on a real board the entry is
      // dropped when the board changes or the page reloads. What matters is
      // that nothing is *added* anywhere.)
      const out = applyPendingTransitions([SPS_2, SPS_3], 'done', map);
      expect(out.map(e => e.key)).toEqual(['SPS-2', 'SPS-3']);
    });
  });

  describe('multiple concurrent pending transitions', () => {
    it('strips source moves and prepends target moves in the same pass', () => {
      // Scenario: user moved SPS-1 → middle (source) AND SPS-3 → active
      // (target); the active response from Jira is stale on both counts.
      const sps1Moved: Epic = { ...SPS_1, status: 'Rollout' };
      const sps3Moved: Epic = { ...SPS_3, status: 'In Progress' };
      const out = applyPendingTransitions(
        [SPS_1, SPS_2],
        'active',
        pending(
          ['SPS-1', { targetTab: 'middle', movedEpic: sps1Moved }],
          ['SPS-3', { targetTab: 'active', movedEpic: sps3Moved }],
        ),
      );
      expect(out.map(e => e.key)).toEqual(['SPS-3', 'SPS-2']);
    });
  });

  describe('chained / overwritten transitions', () => {
    it('respects the latest target when the same epic was transitioned twice', () => {
      // User moves SPS-1: active → middle → done. The Map only keeps the
      // latest entry; applyPendingTransitions reads that target.
      const finalState: Epic = { ...SPS_1, status: 'Done' };
      const map = pending(['SPS-1', { targetTab: 'done', movedEpic: finalState }]);

      const active = applyPendingTransitions([SPS_1, SPS_2], 'active', map);
      expect(active.map(e => e.key)).toEqual(['SPS-2']);

      const middle = applyPendingTransitions([SPS_1, SPS_3], 'middle', map);
      expect(middle.map(e => e.key)).toEqual(['SPS-3']);

      const done = applyPendingTransitions([], 'done', map);
      expect(done.map(e => e.key)).toEqual(['SPS-1']);
      expect(done[0].status).toBe('Done');
    });
  });

  describe('immutability', () => {
    it('does not mutate the input array', () => {
      const epics = [SPS_1, SPS_2];
      const before = JSON.stringify(epics);
      const movedEpic: Epic = { ...SPS_3, status: 'In Progress' };
      applyPendingTransitions(epics, 'active', pending(['SPS-3', { targetTab: 'active', movedEpic }]));
      expect(JSON.stringify(epics)).toBe(before);
    });

    it('does not mutate the pending map', () => {
      const movedEpic: Epic = { ...SPS_1, status: 'Rollout' };
      const map = pending(['SPS-1', { targetTab: 'middle', movedEpic }]);
      const sizeBefore = map.size;
      applyPendingTransitions([SPS_1, SPS_2], 'active', map);
      expect(map.size).toBe(sizeBefore);
      expect(map.get('SPS-1')).toEqual({ targetTab: 'middle', movedEpic });
    });
  });

  describe('every StatusTab is a supported activeTab', () => {
    const tabs: StatusTab[] = ['active', 'middle', 'done'];
    it.each(tabs)('handles activeTab=%s as the target', (tab) => {
      const movedEpic: Epic = { ...SPS_1, status: tab };
      const out = applyPendingTransitions(
        [],
        tab,
        pending(['SPS-1', { targetTab: tab, movedEpic }]),
      );
      expect(out).toEqual([movedEpic]);
    });
  });
});
