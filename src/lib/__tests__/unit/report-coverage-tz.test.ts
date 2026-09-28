// GLOOK-58 Decision 15 final review: SQLite stores created_at/completed_at as zone-less LOCAL
// strings ('YYYY-MM-DD HH:MM:SS', datetime('now','localtime')), and completedReportWindows /
// anchorWeekFor must read them as host local time. The DB fixtures elsewhere all use ISO Z, so
// nothing else would catch a regression that parses them as UTC, which over-claims coverage on a
// host east of UTC. Assigning process.env.TZ inside Jest doesn't change Date's zone (see
// week-key-utc.test.ts), so this runs the computation in a child process started with
// TZ=Asia/Tokyo (UTC+9, no DST).
//
// The input: a report created and completed at Tokyo-local Monday midnight, 2026-03-23 00:00:00,
// period 15 days.
// - Read as Tokyo local (correct): that is 2026-03-22T15:00Z, a Sunday afternoon in UTC. The window
//   [2026-03-07T15:00Z, 2026-03-22T15:00Z] holds whole UTC days Mar 8..21, so only the week of Mar 9
//   is whole: the week of Mar 16 lacks Sunday the 22nd. The anchor is Sunday's week, Mar 16.
// - Read as UTC (the regression): the window becomes [Mar 8 00:00Z, Mar 23 00:00Z], which also
//   claims the week of Mar 16 (over-claiming the 9 hours of Sunday that were never searched), and
//   the anchor jumps to the week of Mar 23.
import { execFileSync } from 'child_process';
import path from 'path';

const root = path.join(__dirname, '../../../..');
const ZONELESS_TOKYO_MONDAY_MIDNIGHT = '2026-03-23 00:00:00';

function runUnderTz(tz: string): { covered: string[]; anchor: string } {
  const script = [
    "import { anchorWeekFor, completedReportWindows, coveredWeeksFromWindows } from './src/lib/report/timeline';",
    `const at = '${ZONELESS_TOKYO_MONDAY_MIDNIGHT}';`,
    "const windows = completedReportWindows([{ status: 'completed', period_days: 15, completed_at: at, created_at: at }]);",
    "console.log(JSON.stringify({ covered: coveredWeeksFromWindows(windows), anchor: anchorWeekFor('completed', at, at) }));",
  ].join(' ');
  const out = execFileSync(path.join(root, 'node_modules/.bin/tsx'), ['-e', script], {
    cwd: root,
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
  return JSON.parse(out.trim());
}

it('REGRESSION GUARD (east of UTC): under TZ=Asia/Tokyo, zone-less SQLite timestamps are read as local time, never over-claiming a week', () => {
  const { covered, anchor } = runUnderTz('Asia/Tokyo');
  expect(covered).toEqual(['2026-03-09']);
  expect(anchor).toBe('2026-03-16');
}, 30_000);
