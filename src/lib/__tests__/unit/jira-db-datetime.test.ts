import { toDbDateTime } from '@/lib/jira/client';

it('converts a Jira offset timestamp to UTC DATETIME text', () => {
  expect(toDbDateTime('2026-10-01T12:34:56.000-0400')).toBe('2026-10-01 16:34:56');
  expect(toDbDateTime('2026-10-01T23:30:00.000+0530')).toBe('2026-10-01 18:00:00');
  expect(toDbDateTime('2026-03-25T16:00:00.000Z')).toBe('2026-03-25 16:00:00');
});

it('maps empty or unparseable input to null', () => {
  expect(toDbDateTime(null)).toBeNull();
  expect(toDbDateTime(undefined)).toBeNull();
  expect(toDbDateTime('')).toBeNull();
  expect(toDbDateTime('not a date')).toBeNull();
});
