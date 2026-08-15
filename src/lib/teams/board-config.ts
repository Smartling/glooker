/**
 * Per-team board behaviour for the /projects page (GLOOK-38).
 *
 * Stored as one nullable JSON column on `teams`. A NULL column — every team
 * that predates this feature — parses to DEFAULT_BOARD_CONFIG, which is
 * exactly today's behaviour. Keys are individually optional for the same
 * reason: adding a key later must not invalidate stored rows.
 */

export type BoardHierarchy = 'goal-initiative' | 'owner';
export type BoardMiddleTab = 'Rollout' | 'Backlog';
export type BoardRingMode = 'commits' | 'jira';
export type BoardTab = 'In Progress' | 'Rollout' | 'Backlog' | 'Done';

export interface BoardConfig {
  /** Jira project keys owned by this team. Non-empty enables provenance attribution. */
  jiraProjectKeys: string[];
  hierarchy: BoardHierarchy;
  middleTab: BoardMiddleTab;
  ringMode: BoardRingMode;
  doneWindowDays: number;
  includeRejected: boolean;
}

export const DEFAULT_BOARD_CONFIG: BoardConfig = {
  jiraProjectKeys: [],
  hierarchy: 'goal-initiative',
  middleTab: 'Rollout',
  ringMode: 'commits',
  doneWindowDays: 30,
  includeRejected: false,
};

const HIERARCHIES: BoardHierarchy[] = ['goal-initiative', 'owner'];
const MIDDLE_TABS: BoardMiddleTab[] = ['Rollout', 'Backlog'];
const RING_MODES: BoardRingMode[] = ['commits', 'jira'];

/** Jira project keys are letters, digits and underscores only. Anything else
 *  could break out of the quoted JQL literal we interpolate them into. */
export const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export class BoardConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoardConfigError';
  }
}

/**
 * Read a stored value into a complete BoardConfig. Never throws: bad stored
 * data degrades to defaults so one corrupt row cannot take the board down.
 * Accepts a JSON string (SQLite TEXT) or an already-parsed object (mysql2 JSON).
 */
export function parseBoardConfig(raw: unknown): BoardConfig {
  if (raw === null || raw === undefined || raw === '') return { ...DEFAULT_BOARD_CONFIG };

  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return { ...DEFAULT_BOARD_CONFIG };
    }
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return { ...DEFAULT_BOARD_CONFIG };
  }

  const src = obj as Record<string, unknown>;
  const cfg: BoardConfig = { ...DEFAULT_BOARD_CONFIG };

  if (Array.isArray(src.jiraProjectKeys)) {
    cfg.jiraProjectKeys = src.jiraProjectKeys
      .filter((k): k is string => typeof k === 'string' && k.trim() !== '')
      .map(k => k.trim().toUpperCase());
  }
  if (typeof src.hierarchy === 'string' && HIERARCHIES.includes(src.hierarchy as BoardHierarchy)) {
    cfg.hierarchy = src.hierarchy as BoardHierarchy;
  }
  if (typeof src.middleTab === 'string' && MIDDLE_TABS.includes(src.middleTab as BoardMiddleTab)) {
    cfg.middleTab = src.middleTab as BoardMiddleTab;
  }
  if (typeof src.ringMode === 'string' && RING_MODES.includes(src.ringMode as BoardRingMode)) {
    cfg.ringMode = src.ringMode as BoardRingMode;
  }
  if (typeof src.doneWindowDays === 'number' && Number.isInteger(src.doneWindowDays)
      && src.doneWindowDays >= 1 && src.doneWindowDays <= 365) {
    cfg.doneWindowDays = src.doneWindowDays;
  }
  if (typeof src.includeRejected === 'boolean') {
    cfg.includeRejected = src.includeRejected;
  }

  return cfg;
}

/**
 * Validate operator input from the Settings UI / API. Unlike parseBoardConfig
 * this is strict and throws, so a typo is reported instead of silently ignored.
 */
export function validateBoardConfig(input: unknown): BoardConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new BoardConfigError('board_config must be an object');
  }
  const src = input as Record<string, unknown>;

  const allowed = new Set<keyof BoardConfig>([
    'jiraProjectKeys', 'hierarchy', 'middleTab', 'ringMode', 'doneWindowDays', 'includeRejected',
  ]);
  for (const key of Object.keys(src)) {
    if (!allowed.has(key as keyof BoardConfig)) {
      throw new BoardConfigError(`Unknown board_config key: ${key}`);
    }
  }

  const cfg: BoardConfig = { ...DEFAULT_BOARD_CONFIG };

  if (src.jiraProjectKeys !== undefined) {
    if (!Array.isArray(src.jiraProjectKeys)) {
      throw new BoardConfigError('jiraProjectKeys must be an array of project keys');
    }
    cfg.jiraProjectKeys = src.jiraProjectKeys.map(k => {
      if (typeof k !== 'string' || k.trim() === '') {
        throw new BoardConfigError('jiraProjectKeys must contain non-empty strings');
      }
      const key = k.trim().toUpperCase();
      if (!PROJECT_KEY_RE.test(key)) {
        throw new BoardConfigError(`jiraProjectKeys contains an invalid project key: ${k}`);
      }
      return key;
    });
  }

  if (src.hierarchy !== undefined) {
    if (!HIERARCHIES.includes(src.hierarchy as BoardHierarchy)) {
      throw new BoardConfigError(`hierarchy must be one of: ${HIERARCHIES.join(', ')}`);
    }
    cfg.hierarchy = src.hierarchy as BoardHierarchy;
  }

  if (src.middleTab !== undefined) {
    if (!MIDDLE_TABS.includes(src.middleTab as BoardMiddleTab)) {
      throw new BoardConfigError(`middleTab must be one of: ${MIDDLE_TABS.join(', ')}`);
    }
    cfg.middleTab = src.middleTab as BoardMiddleTab;
  }

  if (src.ringMode !== undefined) {
    if (!RING_MODES.includes(src.ringMode as BoardRingMode)) {
      throw new BoardConfigError(`ringMode must be one of: ${RING_MODES.join(', ')}`);
    }
    cfg.ringMode = src.ringMode as BoardRingMode;
  }

  if (src.doneWindowDays !== undefined) {
    const d = src.doneWindowDays;
    if (typeof d !== 'number' || !Number.isInteger(d) || d < 1 || d > 365) {
      throw new BoardConfigError('doneWindowDays must be an integer between 1 and 365');
    }
    cfg.doneWindowDays = d;
  }

  if (src.includeRejected !== undefined) {
    if (typeof src.includeRejected !== 'boolean') {
      throw new BoardConfigError('includeRejected must be a boolean');
    }
    cfg.includeRejected = src.includeRejected;
  }

  return cfg;
}
