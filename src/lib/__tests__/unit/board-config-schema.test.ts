import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('teams.board_config exists in every schema location', () => {
  it('is in the MySQL base schema (schema.sql teams table)', () => {
    const sql = read('schema.sql');
    const teamsBlock = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS teams ('),
      sql.indexOf('CREATE TABLE IF NOT EXISTS team_members ('),
    );
    expect(teamsBlock).toMatch(/board_config\s+JSON\s+NULL/i);
  });

  it('is in the SQLite SCHEMA literal', () => {
    const src = read('src/lib/db/sqlite.ts');
    const teamsBlock = src.slice(
      src.indexOf('CREATE TABLE IF NOT EXISTS teams ('),
      src.indexOf('CREATE TABLE IF NOT EXISTS team_members ('),
    );
    expect(teamsBlock).toMatch(/board_config\s+TEXT/i);
  });

  it('has a guarded ALTER for existing SQLite databases', () => {
    expect(read('src/lib/db/sqlite.ts'))
      .toMatch(/ALTER TABLE teams ADD COLUMN board_config TEXT/i);
  });

  it('has a guarded ALTER for existing MySQL databases', () => {
    expect(read('src/lib/db/mysql.ts'))
      .toMatch(/ALTER TABLE teams ADD COLUMN board_config JSON NULL/i);
  });

  it('does not pin a charset on the teams table', () => {
    const sql = read('schema.sql');
    const teamsBlock = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS teams ('),
      sql.indexOf('CREATE TABLE IF NOT EXISTS team_members ('),
    );
    expect(teamsBlock).not.toMatch(/DEFAULT CHARSET/i);
  });
});
