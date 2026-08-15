import { randomUUID } from 'crypto';
import db from '../db/index';
import { parseBoardConfig, validateBoardConfig } from './board-config';

// ── Types ──────────────────────────────────────────────────────────

export interface TeamInput {
  org: string;
  name: string;
  color?: string;
  members?: string[];
  /** Raw operator input; validated before persisting. Omit to store NULL. */
  boardConfig?: unknown;
}

export interface TeamUpdateInput {
  name?: string;
  color?: string;
  members?: string[];
  /** `undefined` leaves the column untouched; `null` clears it. */
  boardConfig?: unknown;
}

export class TeamNotFoundError extends Error {
  constructor(id: string) {
    super(`Team not found: ${id}`);
    this.name = 'TeamNotFoundError';
  }
}

export class TeamDuplicateError extends Error {
  constructor(name: string) {
    super(`Team "${name}" already exists for this org`);
    this.name = 'TeamDuplicateError';
  }
}

// ── Service functions ──────────────────────────────────────────────

export async function listTeams(org: string) {
  const [teams] = await db.execute(
    `SELECT id, org, name, color, board_config, created_at FROM teams WHERE org = ? ORDER BY name`,
    [org],
  ) as [any[], any];

  for (const team of teams) {
    const [members] = await db.execute(
      `SELECT github_login, added_at FROM team_members WHERE team_id = ? ORDER BY added_at`,
      [team.id],
    ) as [any[], any];
    team.members = members.map((m: any) => m.github_login);
    // Stored NULL — every team predating GLOOK-38 — becomes today's defaults.
    team.board_config = parseBoardConfig(team.board_config);
  }

  return teams;
}

export async function createTeam(input: TeamInput) {
  const { org, name, color, members } = input;
  const id = randomUUID();
  const trimmedName = name.trim();
  const resolvedColor = color || '#3B82F6';

  const boardConfigJson = input.boardConfig === undefined || input.boardConfig === null
    ? null
    : JSON.stringify(validateBoardConfig(input.boardConfig));

  try {
    await db.execute(
      `INSERT INTO teams (id, org, name, color, board_config) VALUES (?, ?, ?, ?, ?)`,
      [id, org, trimmedName, resolvedColor, boardConfigJson],
    );
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY' || err?.message?.includes('UNIQUE')) {
      throw new TeamDuplicateError(trimmedName);
    }
    throw err;
  }

  if (Array.isArray(members)) {
    for (const login of members) {
      await db.execute(
        `INSERT IGNORE INTO team_members (team_id, github_login) VALUES (?, ?)`,
        [id, login],
      );
    }
  }

  return {
    id, org, name: trimmedName, color: resolvedColor,
    members: members || [],
    board_config: parseBoardConfig(boardConfigJson),
  };
}

export async function updateTeam(id: string, input: TeamUpdateInput): Promise<void> {
  const [existing] = await db.execute(`SELECT id FROM teams WHERE id = ?`, [id]) as [any[], any];
  if (existing.length === 0) throw new TeamNotFoundError(id);

  const { name, color, members, boardConfig } = input;

  if (name || color || boardConfig !== undefined) {
    const sets: string[] = [];
    const vals: any[] = [];
    if (boardConfig !== undefined) {
      sets.push('board_config = ?');
      vals.push(boardConfig === null ? null : JSON.stringify(validateBoardConfig(boardConfig)));
    }
    if (name) { sets.push('name = ?'); vals.push(name.trim()); }
    if (color) { sets.push('color = ?'); vals.push(color); }
    vals.push(id);
    await db.execute(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`, vals);
  }

  if (Array.isArray(members)) {
    await db.execute(`DELETE FROM team_members WHERE team_id = ?`, [id]);
    for (const login of members) {
      await db.execute(
        `INSERT IGNORE INTO team_members (team_id, github_login) VALUES (?, ?)`,
        [id, login],
      );
    }
  }
}

export async function deleteTeam(id: string): Promise<void> {
  await db.execute(`DELETE FROM teams WHERE id = ?`, [id]);
}
