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
import type { BoardTabKind, JiraProject } from '@/lib/jira-projects/types';

/**
 * Tabs a pending transition may target. Aliased to the board's tab union
 * (GLOOK-38): the tabs are `active` / `middle` / `done`, and which Jira status
 * each one names is a per-project setting this module never needs to see.
 */
export type StatusTab = BoardTabKind;

/** Jira's status-category key for the Done category. Its three categories are
 *  `new`, `indeterminate` and `done`; only the last one is a board tab. */
export const DONE_CATEGORY = 'done';

/**
 * Which of the board's tabs a Jira status belongs on, or `null` when it belongs
 * on none of them.
 *
 * The three-way resolution is the board's whole status vocabulary: the project
 * names one status for its active tab and (optionally) one for its middle tab,
 * and the Done tab's JQL is `statusCategory = "Done"` — so a Done *category*,
 * not a status name, is what puts an epic there.
 *
 * `null` is a real, common answer, not an error case. Jira offers a transition
 * to every status its workflow allows: on SPS that is nine destinations, of
 * which five (Backlog, Discovery, Blocked, Specs & Design, Ready for Dev) have
 * no tab on the board at all. Treating those as Done put the epic at the top of
 * the Done tab where Jira's Done JQL would never return it, so it was
 * re-injected on every fetch until reload.
 *
 * @param statusName     the destination's Jira status *name*
 * @param statusCategory the destination's status-category key, or null when
 *                       unknown — an unknown category can never resolve to Done
 */
export function resolveStatusTab(
  project: Pick<JiraProject, 'activeStatus' | 'middleStatus'> | null,
  statusName: string,
  statusCategory: string | null,
): StatusTab | null {
  if (project) {
    if (statusName === project.activeStatus) return 'active';
    if (project.middleStatus && statusName === project.middleStatus) return 'middle';
  }
  return statusCategory === DONE_CATEGORY ? 'done' : null;
}

/**
 * Minimum shape required for the transition logic. Callers may pass any
 * richer epic type so long as it has a string `key`.
 */
export interface EpicLike {
  key: string;
}

export interface PendingTransition<E extends EpicLike = EpicLike> {
  /**
   * The tab the epic moved onto, or `null` when its new status has no tab on
   * this board — see `resolveStatusTab`. A null target means "strip from every
   * tab, inject nowhere": the epic leaves the tab the user was looking at, and
   * the next fetch decides where it belongs rather than this registry guessing.
   */
  targetTab: StatusTab | null;
  movedEpic: E;
}

/**
 * Return a copy of `epics` reconciled against the pending-transitions map
 * for the given `activeTab`:
 *
 *  - If a pending transition targets `activeTab` and its epic is missing
 *    from `epics`, prepend it (preserves the "just moved here" UX).
 *  - Otherwise — a different tab, or no tab at all — strip its epic from
 *    `epics` if present, so the source tab stops claiming it.
 *
 * A `null` target therefore only ever removes. That is the point: injecting it
 * somewhere as a guess is what pinned epics to the Done tab indefinitely, since
 * a tab's JQL will never return an epic whose status does not match it.
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
    // `p.targetTab === activeTab` already excludes null, since activeTab is
    // always one of the three tab ids — the explicit check documents that.
    if (p.targetTab !== null && p.targetTab === activeTab) {
      if (!next.some(e => e.key === key)) {
        next = [p.movedEpic, ...next];
      }
    } else {
      next = next.filter(e => e.key !== key);
    }
  }
  return next;
}
