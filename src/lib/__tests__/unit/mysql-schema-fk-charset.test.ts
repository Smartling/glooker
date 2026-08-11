/**
 * Guard for the 2026-08-11 org-report outage.
 *
 * `cc_skills_usage` and `cc_model_usage` were declared with an explicit
 * `DEFAULT CHARSET=utf8mb4`, while every other table here — including the
 * `reports` table they reference — inherits the database default. MySQL
 * rejects a foreign key whose string column differs in charset/collation from
 * the column it references (ER_FK_INCOMPATIBLE_COLUMNS, errno 3780), so on
 * dev's older utf8mb3 database CREATE TABLE failed. The failure is caught and
 * logged rather than thrown, so the tables were simply absent until the org
 * report queried them and returned a 500 — surfacing in the UI as the generic
 * "Error: Not found".
 *
 * Reproduced locally: the same DDL against a utf8mb3 schema errors 3780;
 * without the charset clause the table creates with a matching collation.
 *
 * This is a source-text check (same approach as logger-enforcement.test.ts)
 * because the bug is invisible to every SQLite-backed test, and a MySQL
 * instance whose default charset is utf8mb4 — which includes a stock local
 * MySQL 8/9 — would not reproduce it either.
 */
import fs from 'fs';
import path from 'path';

const MYSQL_SCHEMA_FILE = 'src/lib/db/mysql.ts';

function isComment(line: string): boolean {
  return line.startsWith('//') || line.startsWith('--') || line.startsWith('*');
}

it('pins no charset or collation in the MySQL schema, so FKs to reports(id) stay compatible', () => {
  const source = fs.readFileSync(path.join(process.cwd(), MYSQL_SCHEMA_FILE), 'utf8');

  const offenders = source
    .split('\n')
    .map((text, i) => ({ text: text.trim(), line: i + 1 }))
    .filter(({ text }) => !isComment(text))
    .filter(({ text }) => /\b(DEFAULT\s+CHARSET|CHARACTER\s+SET|COLLATE)\b/i.test(text))
    .map(({ text, line }) => `${MYSQL_SCHEMA_FILE}:${line}: ${text}`);

  // Failure means a table pins a charset. Tables referencing reports(id) must
  // inherit the database default or their foreign key will not be created —
  // and because that error is logged rather than thrown, the table goes
  // missing silently. Match reports.id (which inherits) instead of pinning.
  expect(offenders).toEqual([]);
});
