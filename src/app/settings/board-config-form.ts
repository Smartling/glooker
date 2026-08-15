import type { BoardConfig } from '@/lib/teams/board-config';

export interface BoardConfigFormState {
  projectKeysRaw: string;
  hierarchy: BoardConfig['hierarchy'];
  middleTab: BoardConfig['middleTab'];
  ringMode: BoardConfig['ringMode'];
  doneWindowDays: string;
  includeRejected: boolean;
}

/**
 * Turn form state into a PUT payload. Returns null when no Jira project keys are
 * set: without them there is no provenance source, so the team should carry no
 * board_config at all rather than a half-configured one.
 */
export function buildBoardConfigPayload(form: BoardConfigFormState): BoardConfig | null {
  const jiraProjectKeys = form.projectKeysRaw
    .split(',')
    .map(k => k.trim().toUpperCase())
    .filter(Boolean);

  if (jiraProjectKeys.length === 0) return null;

  const parsed = parseInt(form.doneWindowDays, 10);
  return {
    jiraProjectKeys,
    hierarchy: form.hierarchy,
    middleTab: form.middleTab,
    ringMode: form.ringMode,
    doneWindowDays: Number.isFinite(parsed) && parsed >= 1 && parsed <= 365 ? parsed : 30,
    includeRejected: form.includeRejected,
  };
}
