import {
  applyPendingTransitions,
  type PendingTransition,
  type StatusTab,
} from '@/lib/projects/transition-state';

// Test fixture: an "epic" shape sufficient for transition-state logic.
// The real ProjectEpic has more fields; we only need `key` here and let the
// extra fields ride along via the `[extra]: unknown` index signature.
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

describe('applyPendingTransitions', () => {
  describe('empty pending map', () => {
    it('returns a shallow copy of the input array unchanged', () => {
      const epics = [SPS_1, SPS_2];
      const out = applyPendingTransitions(epics, 'In Progress', new Map());
      expect(out).toEqual([SPS_1, SPS_2]);
      // Must be a new array — caller may mutate it.
      expect(out).not.toBe(epics);
    });
  });

  describe('epic targeted at the active tab', () => {
    it('prepends the moved epic when it is missing from the response', () => {
      // Scenario: user moved SPS-3 to In Progress, then switches there before
      // Jira's index has propagated, so Jira still returns the old list.
      const movedEpic: Epic = { ...SPS_3, status: 'In Progress' };
      const out = applyPendingTransitions(
        [SPS_1, SPS_2],
        'In Progress',
        pending(['SPS-3', { targetTab: 'In Progress', movedEpic }]),
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
        'In Progress',
        pending(['SPS-3', { targetTab: 'In Progress', movedEpic }]),
      );
      expect(out.map(e => e.key)).toEqual(['SPS-3', 'SPS-1']);
      expect(out.filter(e => e.key === 'SPS-3')).toHaveLength(1);
    });
  });

  describe('epic targeted at a different tab', () => {
    it('strips the epic from the response for a non-target tab', () => {
      // Scenario: user moved SPS-1 from In Progress to Rollout. The In Progress
      // response still contains SPS-1 because Jira's index has not caught up
      // — strip it so the source tab does not look like it still owns the epic.
      const movedEpic: Epic = { ...SPS_1, status: 'Rollout' };
      const out = applyPendingTransitions(
        [SPS_1, SPS_2],
        'In Progress',
        pending(['SPS-1', { targetTab: 'Rollout', movedEpic }]),
      );
      expect(out.map(e => e.key)).toEqual(['SPS-2']);
    });

    it('is a no-op when the response already excludes the moved epic', () => {
      const movedEpic: Epic = { ...SPS_1, status: 'Rollout' };
      const out = applyPendingTransitions(
        [SPS_2],
        'In Progress',
        pending(['SPS-1', { targetTab: 'Rollout', movedEpic }]),
      );
      expect(out.map(e => e.key)).toEqual(['SPS-2']);
    });
  });

  describe('multiple concurrent pending transitions', () => {
    it('strips source moves and prepends target moves in the same pass', () => {
      // Scenario: user moved SPS-1 → Rollout (source) AND SPS-3 → In Progress (target);
      // the In Progress response from Jira is stale on both counts.
      const sps1Moved: Epic = { ...SPS_1, status: 'Rollout' };
      const sps3Moved: Epic = { ...SPS_3, status: 'In Progress' };
      const out = applyPendingTransitions(
        [SPS_1, SPS_2],
        'In Progress',
        pending(
          ['SPS-1', { targetTab: 'Rollout', movedEpic: sps1Moved }],
          ['SPS-3', { targetTab: 'In Progress', movedEpic: sps3Moved }],
        ),
      );
      expect(out.map(e => e.key)).toEqual(['SPS-3', 'SPS-2']);
    });
  });

  describe('chained / overwritten transitions', () => {
    it('respects the latest target when the same epic was transitioned twice', () => {
      // User moves SPS-1: In Progress → Rollout → Done. The Map only keeps the
      // latest entry; applyPendingTransitions reads that target.
      const finalState: Epic = { ...SPS_1, status: 'Done' };
      const map = pending(['SPS-1', { targetTab: 'Done', movedEpic: finalState }]);

      const inProgress = applyPendingTransitions([SPS_1, SPS_2], 'In Progress', map);
      expect(inProgress.map(e => e.key)).toEqual(['SPS-2']);

      const rollout = applyPendingTransitions([SPS_1, SPS_3], 'Rollout', map);
      expect(rollout.map(e => e.key)).toEqual(['SPS-3']);

      const done = applyPendingTransitions([], 'Done', map);
      expect(done.map(e => e.key)).toEqual(['SPS-1']);
      expect(done[0].status).toBe('Done');
    });
  });

  describe('immutability', () => {
    it('does not mutate the input array', () => {
      const epics = [SPS_1, SPS_2];
      const before = JSON.stringify(epics);
      const movedEpic: Epic = { ...SPS_3, status: 'In Progress' };
      applyPendingTransitions(epics, 'In Progress', pending(['SPS-3', { targetTab: 'In Progress', movedEpic }]));
      expect(JSON.stringify(epics)).toBe(before);
    });

    it('does not mutate the pending map', () => {
      const movedEpic: Epic = { ...SPS_1, status: 'Rollout' };
      const map = pending(['SPS-1', { targetTab: 'Rollout', movedEpic }]);
      const sizeBefore = map.size;
      applyPendingTransitions([SPS_1, SPS_2], 'In Progress', map);
      expect(map.size).toBe(sizeBefore);
      expect(map.get('SPS-1')).toEqual({ targetTab: 'Rollout', movedEpic });
    });
  });

  describe('every StatusTab is a supported activeTab', () => {
    const tabs: StatusTab[] = ['In Progress', 'Rollout', 'Done'];
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
