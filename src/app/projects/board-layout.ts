import type { JiraProject, BoardHierarchy, BoardTabKind } from '@/lib/jira-projects/types';
import { DONE_WINDOW_DAYS } from '@/lib/jira-projects/jql';
import { resolveStatusTab, DONE_CATEGORY } from '@/lib/projects/transition-state';

/** Every tab kind the URL may legally carry. */
export const ALL_TABS: BoardTabKind[] = ['active', 'middle', 'done'];

/**
 * The tabs a given project shows. A project with no middle status has a
 * two-tab board — there is no third status worth a permanently empty tab.
 */
export function visibleTabs(project: JiraProject | null): BoardTabKind[] {
  return project?.middleStatus
    ? ['active', 'middle', 'done']
    : ['active', 'done'];
}

/** Tabs are labelled with the project's own status names, so a board reads in
 *  the vocabulary of its Jira workflow rather than SPS's. */
export function tabLabel(project: JiraProject | null, tab: BoardTabKind): string {
  if (tab === 'done') return `Done (${DONE_WINDOW_DAYS}d)`;
  if (tab === 'middle') return project?.middleStatus || 'Middle';
  return project?.activeStatus || 'In Progress';
}

/**
 * Status-dot colours, keyed by the board role a status plays. These are the
 * pre-GLOOK-38 SPS colours, re-pointed from the literals `In Progress` /
 * `Rollout` / `Done` to the roles those three used to be the only names for —
 * so the SPS board looks unchanged while a board configured with any other
 * vocabulary now gets the same colouring instead of three grey dots.
 */
const TAB_DOT_COLOR: Record<BoardTabKind, string> = {
  active: '#D97706',
  middle: '#3B82F6',
  done: '#10B981',
};

/** A status with no place on this board — grey, as it always was. */
export const NO_TAB_DOT_COLOR = '#6B7280';

/**
 * Colour for the dot beside a status name.
 *
 * `statusCategory` is the destination's status-category key where it is known
 * (every transition in the dropdown carries one). Pass `DONE_CATEGORY` for a
 * status the board is already showing — see `boardRowDotColor`.
 */
export function statusDotColor(
  project: Pick<JiraProject, 'activeStatus' | 'middleStatus'> | null,
  statusName: string,
  statusCategory: string | null,
): string {
  const tab = resolveStatusTab(project, statusName, statusCategory);
  return tab ? TAB_DOT_COLOR[tab] : NO_TAB_DOT_COLOR;
}

/**
 * Colour for the status of an epic already on the board. Every tab's JQL pins
 * the status it admits — the active status, the middle status, or anything in
 * the Done category — so a name that is neither of the first two is Done, and
 * the row needs no category of its own to say so.
 */
export function boardRowDotColor(
  project: Pick<JiraProject, 'activeStatus' | 'middleStatus'> | null,
  statusName: string,
): string {
  return statusDotColor(project, statusName, DONE_CATEGORY);
}

export interface ColumnLayout {
  headers: string[];
  widths: number[];
  showHierarchy: boolean;
  showOwnerColumn: boolean;
}

export function columnLayout(project: JiraProject | null): ColumnLayout {
  if (project?.hierarchy === 'owner') {
    return {
      headers: ['Owner', '', 'Epic', 'Due', 'Status', 'Team'],
      widths: [18, 4, 43, 11, 11, 13],
      showHierarchy: false,
      showOwnerColumn: true,
    };
  }
  return {
    headers: ['Business Goal', 'Initiative', '', 'Epic', 'Due', 'Lead', 'Team'],
    widths: [14, 14, 4, 34, 10, 13, 11],
    showHierarchy: true,
    showOwnerColumn: false,
  };
}

export interface RowSpan {
  primarySpan: number;
  secondarySpan: number;
  showPrimary: boolean;
  showSecondary: boolean;
  primaryGroupId: string;
  secondaryGroupId: string;
}

interface SpannableRow {
  assignee: string | null;
  goal: { summary: string } | null;
  initiative: { summary: string } | null;
}

/**
 * Run-length merging over *consecutive* rows — non-adjacent rows sharing a key
 * are deliberately not merged, matching the existing board's behaviour.
 *
 * In 'goal-initiative' mode primary = goal, secondary = initiative. In 'owner'
 * mode primary = assignee and there is no secondary column.
 */
export function computeSpans<T extends SpannableRow>(rows: T[], mode: BoardHierarchy): RowSpan[] {
  const primaryOf = (r: T) => mode === 'owner'
    ? (r.assignee || '—')
    : (r.goal?.summary || '—');
  const secondaryOf = (r: T) => mode === 'owner'
    ? ''
    : (r.goal?.summary || '—') + '|' + (r.initiative?.summary || '—');

  const result: RowSpan[] = [];
  for (let i = 0; i < rows.length; i++) {
    const pKey = primaryOf(rows[i]);
    const sKey = secondaryOf(rows[i]);

    let primarySpan = 0;
    for (let j = i; j < rows.length; j++) {
      if (primaryOf(rows[j]) === pKey) primarySpan++;
      else break;
    }

    let secondarySpan = 0;
    for (let j = i; j < rows.length; j++) {
      if (secondaryOf(rows[j]) === sKey) secondarySpan++;
      else break;
    }

    const showPrimary = i === 0 || primaryOf(rows[i - 1]) !== pKey;
    const showSecondary = mode === 'owner'
      ? false
      : (i === 0 || secondaryOf(rows[i - 1]) !== sKey);

    result.push({
      primarySpan,
      secondarySpan,
      showPrimary,
      showSecondary,
      primaryGroupId: `p-${pKey}`,
      secondaryGroupId: `s-${sKey}`,
    });
  }
  return result;
}
