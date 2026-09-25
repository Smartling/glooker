// GLOOK-58 Decision 10: weekKeyForDate keys by the containing UTC week, whatever the server's
// time zone. Assigning process.env.TZ inside a Jest test does not change Date's zone (Jest gives
// the test a copy of process.env, and Node resets its zone cache only on the real one), so the
// time-zone cases run in a child process that starts with TZ set.
//
// Fix round 1: the original Tokyo/UTC case below used an instant that happens to pass on the OLD
// buggy (local-time) weekKeyForDate too, so it guarded nothing east of UTC. CI runs in UTC with no
// TZ set, so the New York case was the only real regression guard. A second Tokyo case is added
// below with an instant chosen specifically to fail on the old code: see that test for the RED
// evidence.
import { execFileSync } from 'child_process';
import path from 'path';
import { weekKeyForDate } from '@/lib/report/timeline';
import { mondayOf } from '@/components/charts/chart-format';

const root = path.join(__dirname, '../../../..');
// Monday 2026-09-21 21:00 in New York (EDT, UTC-4) is Tuesday 2026-09-22 01:00 UTC.
const MONDAY_9PM_NEW_YORK = '2026-09-22T01:00:00Z';
// Sunday 2026-09-27 20:00 UTC is already Monday 2026-09-28 05:00 in Tokyo (JST, UTC+9).
const SUNDAY_8PM_UTC_ALREADY_MONDAY_IN_TOKYO = '2026-09-27T20:00:00Z';

function keyUnderTz(tz: string, iso: string): string {
  const script = `import { weekKeyForDate } from './src/lib/report/timeline'; console.log(weekKeyForDate(new Date('${iso}')));`;
  return execFileSync(path.join(root, 'node_modules/.bin/tsx'), ['-e', script], {
    cwd: root,
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  }).trim();
}

it('REGRESSION GUARD (west of UTC): a Monday-21:00 commit under TZ=America/New_York keys to that UTC week, not the next day', () => {
  expect(keyUnderTz('America/New_York', MONDAY_9PM_NEW_YORK)).toBe('2026-09-21');
}, 30_000);

it('non-discriminating (documented, not a regression guard): this particular instant is Monday everywhere, so Tokyo and UTC agree with the old code too', () => {
  expect(keyUnderTz('Asia/Tokyo', MONDAY_9PM_NEW_YORK)).toBe('2026-09-21');
  expect(keyUnderTz('UTC', MONDAY_9PM_NEW_YORK)).toBe('2026-09-21');
}, 30_000);

it('REGRESSION GUARD (east of UTC): a UTC-Sunday commit that is already Monday in Tokyo still keys to the UTC week, not the local one', () => {
  // Confirmed RED on the old local-time weekKeyForDate (getDay/setDate) by running its exact body
  // in a scratch script under TZ=Asia/Tokyo against this instant: it printed "2026-09-27" (Tokyo's
  // local Monday date, re-serialized through toISOString()), one week later than the correct UTC
  // key. The fixed (UTC) implementation must print "2026-09-21" here.
  expect(keyUnderTz('Asia/Tokyo', SUNDAY_8PM_UTC_ALREADY_MONDAY_IN_TOKYO)).toBe('2026-09-21');
}, 30_000);

it('keys a UTC Monday, midweek day and Sunday to that UTC Monday (in-process)', () => {
  expect(weekKeyForDate(new Date('2026-09-21T00:00:00Z'))).toBe('2026-09-21');
  expect(weekKeyForDate(new Date('2026-09-24T12:00:00Z'))).toBe('2026-09-21');
  expect(weekKeyForDate(new Date('2026-09-27T23:59:59Z'))).toBe('2026-09-21');
});

// Fix round 1, item 3: fillWeeks() matches server rows to client-built weeks by exact string key
// (chart-format.ts's indexByWeek), so the server's weekKeyForDate and the client's mondayOf must
// never disagree, not even at a year boundary or a DST-change date (irrelevant in UTC, but checked
// anyway since a future edit could reintroduce local-time arithmetic on either side).
describe('weekKeyForDate (server) and mondayOf (client) agree exactly', () => {
  it('for every day of one week, at 00:00Z, 12:00Z and 23:59:59Z', () => {
    const days = ['21', '22', '23', '24', '25', '26', '27'];
    const times = ['00:00:00', '12:00:00', '23:59:59'];
    for (const day of days) {
      for (const time of times) {
        const d = new Date(`2026-09-${day}T${time}Z`);
        expect(weekKeyForDate(d)).toBe(mondayOf(d));
      }
    }
  });

  it('across a year boundary', () => {
    for (const iso of ['2026-12-31T12:00:00Z', '2027-01-01T00:00:00Z', '2027-01-04T23:59:59Z']) {
      const d = new Date(iso);
      expect(weekKeyForDate(d)).toBe(mondayOf(d));
    }
  });

  it('across DST-change dates (irrelevant to UTC math, but pinned so it stays that way)', () => {
    for (const iso of ['2026-03-08T00:00:00Z', '2026-03-08T12:00:00Z', '2026-11-01T00:00:00Z', '2026-11-01T12:00:00Z']) {
      const d = new Date(iso);
      expect(weekKeyForDate(d)).toBe(mondayOf(d));
    }
  });
});
