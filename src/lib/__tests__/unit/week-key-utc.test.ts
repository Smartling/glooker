// GLOOK-58 Decision 10: weekKeyForDate keys by the containing UTC week, whatever the server's
// time zone. Assigning process.env.TZ inside a Jest test does not change Date's zone (Jest gives
// the test a copy of process.env, and Node resets its zone cache only on the real one), so the
// time-zone case runs in a child process that starts with TZ set.
import { execFileSync } from 'child_process';
import path from 'path';
import { weekKeyForDate } from '@/lib/report/timeline';

const root = path.join(__dirname, '../../../..');
// Monday 2026-09-21 21:00 in New York (EDT, UTC-4) is Tuesday 2026-09-22 01:00 UTC.
const MONDAY_9PM_NEW_YORK = '2026-09-22T01:00:00Z';

function keyUnderTz(tz: string, iso: string): string {
  const script = `import { weekKeyForDate } from './src/lib/report/timeline'; console.log(weekKeyForDate(new Date('${iso}')));`;
  return execFileSync(path.join(root, 'node_modules/.bin/tsx'), ['-e', script], {
    cwd: root,
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  }).trim();
}

it('a Monday-21:00 commit under TZ=America/New_York keys to that UTC week, not the next day', () => {
  expect(keyUnderTz('America/New_York', MONDAY_9PM_NEW_YORK)).toBe('2026-09-21');
}, 30_000);

it('the same instant keys identically in every server time zone', () => {
  expect(keyUnderTz('Asia/Tokyo', MONDAY_9PM_NEW_YORK)).toBe('2026-09-21');
  expect(keyUnderTz('UTC', MONDAY_9PM_NEW_YORK)).toBe('2026-09-21');
}, 30_000);

it('keys a UTC Monday, midweek day and Sunday to that UTC Monday (in-process)', () => {
  expect(weekKeyForDate(new Date('2026-09-21T00:00:00Z'))).toBe('2026-09-21');
  expect(weekKeyForDate(new Date('2026-09-24T12:00:00Z'))).toBe('2026-09-21');
  expect(weekKeyForDate(new Date('2026-09-27T23:59:59Z'))).toBe('2026-09-21');
});
