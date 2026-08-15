/**
 * Pending-transitions registry helper used by the Projects page to keep
 * optimistic status moves applied across every incoming tabData payload.
 *
 * Why this exists: Jira's JQL search index is eventually consistent. After a
 * successful status transition, any immediate refetch (preload, useSWR,
 * reload of the destination tab) can return a list that either still
 * includes the epic on its old tab or does not yet include it on the new
 * one. The Projects page records each successful transition in a
 * `Map<epicKey, PendingTransition>` and runs every fetch response through
 * `applyPendingTransitions` before populating its in-component tabCache.
 */
import type { BoardTab } from '@/lib/teams/board-config';

/**
 * Tabs a pending transition may target. Aliased to the board-config tab union
 * (GLOOK-38) so a per-team board's Backlog tab participates in optimistic moves
 * exactly as Rollout does on the default board.
 */
export type StatusTab = BoardTab;

/**
 * Minimum shape required for the transition logic. Callers may pass any
 * richer epic type so long as it has a string `key`.
 */
export interface EpicLike {
  key: string;
}

export interface PendingTransition<E extends EpicLike = EpicLike> {
  targetTab: StatusTab;
  movedEpic: E;
}

/**
 * Return a copy of `epics` reconciled against the pending-transitions map
 * for the given `activeTab`:
 *
 *  - If a pending transition targets `activeTab` and its epic is missing
 *    from `epics`, prepend it (preserves the "just moved here" UX).
 *  - If a pending transition targets some other tab and its epic appears
 *    in `epics`, strip it (it should not show on the source tab).
 *
 * `epics` is never mutated.
 */
export function applyPendingTransitions<E extends EpicLike>(
  epics: readonly E[],
  activeTab: StatusTab,
  pending: ReadonlyMap<string, PendingTransition<E>>,
): E[] {
  if (pending.size === 0) return [...epics];
  let next: E[] = [...epics];
  for (const [key, p] of pending) {
    if (p.targetTab === activeTab) {
      if (!next.some(e => e.key === key)) {
        next = [p.movedEpic, ...next];
      }
    } else {
      next = next.filter(e => e.key !== key);
    }
  }
  return next;
}
