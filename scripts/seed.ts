// scripts/seed.ts
// Populates the SQLite DB with mock data for local development.
// Run: npm run seed  |  Reset: npm run seed:reset

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed in production. Unset NODE_ENV or set it to development.');
  process.exit(1);
}

import * as data from './seed-data';

async function main() {
  const dbModule = await import('../src/lib/db/index');
  const db = dbModule.default;

  console.log('Seeding database...\n');

  async function seed(table: string, rows: Record<string, any>[]) {
    if (rows.length === 0) return;
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map(() => '?').join(', ');
    const sql = `INSERT IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;

    for (const row of rows) {
      await db.execute(sql, cols.map(c => row[c]));
    }
    console.log(`  ${table}: ${rows.length} rows`);
  }

  await seed('reports', data.seedReports);
  await seed('developer_stats', data.seedDeveloperStats);
  await seed('commit_analyses', data.seedCommitAnalyses);
  await seed('jira_issues', data.seedJiraIssues);
  await seed('teams', data.seedTeams);
  await seed('team_members', data.seedTeamMembers);
  await seed('user_mappings', data.seedUserMappings);
  await seed('developer_summaries', data.seedDeveloperSummaries);
  await seed('report_comparisons', data.seedReportComparisons);
  await seed('epic_summaries', data.seedEpicSummaries);
  await seed('untracked_summaries', data.seedUntrackedSummaries);
  await seed('schedules', data.seedSchedules);
  await seed('release_notes', data.seedReleaseNotes);

  console.log('\nDone! Run `npm run dev:mock` to start the app with mock providers.');
}

main().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
