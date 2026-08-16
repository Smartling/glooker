import type { JiraProject, BoardHierarchy, BoardTabKind } from '@/lib/jira-projects/types';
import { DONE_WINDOW_DAYS } from '@/lib/jira-projects/jql';

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
