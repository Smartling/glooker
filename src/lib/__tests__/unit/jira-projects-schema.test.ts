import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '../../../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('jira_projects exists in every schema location', () => {
  it('is in the MySQL base schema', () => {
    expect(read('schema.sql')).toMatch(/CREATE TABLE IF NOT EXISTS jira_projects/i);
  });

  it('is created by the SQLite schema', () => {
    expect(read('src/lib/db/sqlite.ts')).toMatch(/CREATE TABLE IF NOT EXISTS jira_projects/i);
  });

  it('is created by the MySQL migration path', () => {
    expect(read('src/lib/db/mysql.ts')).toMatch(/CREATE TABLE IF NOT EXISTS jira_projects/i);
  });

  it('does not pin a charset on jira_projects', () => {
    const sql = read('schema.sql');
    const block = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS jira_projects'));
    expect(block.slice(0, block.indexOf(');'))).not.toMatch(/DEFAULT CHARSET/i);
  });

  it('no longer declares board_config on the teams table', () => {
    const sql = read('schema.sql');
    const teams = sql.slice(
      sql.indexOf('CREATE TABLE IF NOT EXISTS teams ('),
      sql.indexOf('CREATE TABLE IF NOT EXISTS team_members ('),
    );
    expect(teams).not.toMatch(/board_config/i);
  });

  it('does not run a DROP COLUMN board_config migration in either dialect', () => {
    // board_config never existed at the merge base — it was added and
    // dropped entirely inside this branch, so no released deployment ever
    // had it. The DDL would fail on every boot, forever, on every real DB.
    expect(read('src/lib/db/sqlite.ts')).not.toMatch(/DROP COLUMN board_config/i);
    expect(read('src/lib/db/mysql.ts')).not.toMatch(/DROP COLUMN board_config/i);
  });
});
