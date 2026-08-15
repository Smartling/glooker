import type { BoardConfig, BoardHierarchy, BoardTab } from '@/lib/teams/board-config';

/** Every tab the URL may legally carry, across all board configurations. */
export const ALL_TABS: BoardTab[] = ['In Progress', 'Rollout', 'Backlog', 'Done'];

/**
 * The three tabs a given board shows. The middle slot is Rollout by default;
 * a research board swaps it for Backlog, where its queued hypotheses live.
 */
export function visibleTabs(config: BoardConfig | null): BoardTab[] {
  const middle: BoardTab = config?.middleTab === 'Backlog' ? 'Backlog' : 'Rollout';
  return ['In Progress', middle, 'Done'];
}

export interface ColumnLayout {
  headers: string[];
  widths: number[];
  showHierarchy: boolean;
  showOwnerColumn: boolean;
}

/**
 * Column set for the board. Widths must sum to 100 and headers must have the
 * same length as widths — the table is `table-fixed`, so a mismatch silently
 * misaligns every row.
 */
export function columnLayout(config: BoardConfig | null): ColumnLayout {
  if (config?.hierarchy === 'owner') {
    return {
      headers: ['Researcher', '', 'Epic', 'Due', 'Status', 'Team'],
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
