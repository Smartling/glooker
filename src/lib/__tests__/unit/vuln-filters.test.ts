import { parseVulnFilters } from '@/lib/vulnerabilities/filters';

it('applies defaults: backend, open, last', () => {
  const r = parseVulnFilters({});
  expect(r).toEqual({ ok: true, value: expect.objectContaining({ codebase: 'backend', state: 'open', baseline: 'last' }) });
});
it('accepts snake_case (MCP) and camel/UI names for the same filter', () => {
  const r = parseVulnFilters({ codebase: 'all', due_before: '2026-12-01', created_since: '2026-09-01', dependency_scope: 'runtime', package: 'lodash', overdue: 'true', limit: '50' });
  expect(r.ok && r.value).toMatchObject({ codebase: 'all', dueBefore: '2026-12-01', createdSince: '2026-09-01', dependencyScope: 'runtime', packageName: 'lodash', overdue: true, limit: 50 });
});
it('rejects bad values with a message', () => {
  expect(parseVulnFilters({ codebase: 'mobile' })).toEqual({ ok: false, error: expect.stringMatching(/codebase/) });
  expect(parseVulnFilters({ baseline: 'yesterday' })).toEqual({ ok: false, error: expect.stringMatching(/baseline/) });
  expect(parseVulnFilters({ severity: 'medium' })).toEqual({ ok: false, error: expect.stringMatching(/severity/) });
  expect(parseVulnFilters({ created_since: '9/1/2026' })).toEqual({ ok: false, error: expect.stringMatching(/created_since/) });
});

describe('boolOf only accepts true/false/1/0 (case-insensitive)', () => {
  it('accepts true/false/1/0 in any case', () => {
    expect(parseVulnFilters({ overdue: 'TRUE' })).toMatchObject({ ok: true, value: { overdue: true } });
    expect(parseVulnFilters({ overdue: 'False' })).toMatchObject({ ok: true, value: { overdue: false } });
    expect(parseVulnFilters({ overdue: '1' })).toMatchObject({ ok: true, value: { overdue: true } });
    expect(parseVulnFilters({ overdue: '0' })).toMatchObject({ ok: true, value: { overdue: false } });
  });
  it('rejects anything else instead of silently reading it as false', () => {
    expect(parseVulnFilters({ overdue: 'yes' })).toEqual({ ok: false, error: expect.stringMatching(/overdue/) });
    expect(parseVulnFilters({ reopened: 'yes' })).toEqual({ ok: false, error: expect.stringMatching(/reopened/) });
    expect(parseVulnFilters({ due_soon: 'yes' })).toEqual({ ok: false, error: expect.stringMatching(/due_soon/) });
  });
});

it('due_soon parses to dueSoon', () => {
  expect(parseVulnFilters({ due_soon: 'true' })).toMatchObject({ ok: true, value: { dueSoon: true } });
  expect(parseVulnFilters({})).toMatchObject({ ok: true, value: { dueSoon: undefined } });
});

it('limit must be an integer', () => {
  expect(parseVulnFilters({ limit: '50' })).toMatchObject({ ok: true, value: { limit: 50 } });
  expect(parseVulnFilters({ limit: '50.5' })).toEqual({ ok: false, error: expect.stringMatching(/limit/) });
  expect(parseVulnFilters({ limit: '0' })).toEqual({ ok: false, error: expect.stringMatching(/limit/) });
});

it('date fields must be real calendar dates, not just YYYY-MM-DD shaped', () => {
  expect(parseVulnFilters({ due_before: '2026-02-30' })).toEqual({ ok: false, error: expect.stringMatching(/due_before/) });
  expect(parseVulnFilters({ resolved_since: '2026-13-01' })).toEqual({ ok: false, error: expect.stringMatching(/resolved_since/) });
  expect(parseVulnFilters({ since: '2026-04-31' })).toEqual({ ok: false, error: expect.stringMatching(/since/) });
  expect(parseVulnFilters({ due_before: '2026-02-28' })).toMatchObject({ ok: true, value: { dueBefore: '2026-02-28' } });
});

it('a YYYY-MM-DD baseline gets the same calendar round-trip check as the other date filters', () => {
  expect(parseVulnFilters({ baseline: '2026-02-30' })).toEqual({ ok: false, error: expect.stringMatching(/baseline/) });
  expect(parseVulnFilters({ baseline: '2026-02-28' })).toMatchObject({ ok: true, value: { baseline: '2026-02-28' } });
});

it('overdue and due_soon are disjoint buckets — passing both together is rejected', () => {
  expect(parseVulnFilters({ overdue: 'true', due_soon: 'true' })).toEqual({
    ok: false, error: 'overdue and due_soon are disjoint buckets — use one',
  });
  // camelCase (UI) spelling of due_soon must be checked too, not just the snake_case MCP name.
  expect(parseVulnFilters({ overdue: 'true', dueSoon: 'true' })).toEqual({
    ok: false, error: 'overdue and due_soon are disjoint buckets — use one',
  });
  // Either alone, or both explicitly false, is fine.
  expect(parseVulnFilters({ overdue: 'true' })).toMatchObject({ ok: true, value: { overdue: true, dueSoon: undefined } });
  expect(parseVulnFilters({ due_soon: 'true' })).toMatchObject({ ok: true, value: { overdue: undefined, dueSoon: true } });
  expect(parseVulnFilters({ overdue: 'false', due_soon: 'false' })).toMatchObject({ ok: true, value: { overdue: false, dueSoon: false } });
});

describe('offset and sort (GLOOK-64)', () => {
  it('default to undefined, and accept a non-negative integer offset in string or number form', () => {
    expect(parseVulnFilters({})).toMatchObject({ ok: true, value: { offset: undefined, sort: undefined } });
    expect(parseVulnFilters({ offset: '0' })).toMatchObject({ ok: true, value: { offset: 0 } });
    expect(parseVulnFilters({ offset: '20' })).toMatchObject({ ok: true, value: { offset: 20 } });
    expect(parseVulnFilters({ offset: 40 })).toMatchObject({ ok: true, value: { offset: 40 } }); // MCP passes numbers
  });

  it.each(['-1', '1.5', '1e3', 'abc', ' ', '0x10', '9007199254740993'])('rejects offset %p', (offset) => {
    expect(parseVulnFilters({ offset })).toEqual({ ok: false, error: 'offset must be a non-negative integer' });
  });

  it.each(['severity', 'advisory', 'repo', 'age', 'due', 'state'])('accepts sort=%s:asc and :desc and echoes the validated string', (key) => {
    expect(parseVulnFilters({ sort: `${key}:asc` })).toMatchObject({ ok: true, value: { sort: `${key}:asc` } });
    expect(parseVulnFilters({ sort: `${key}:desc` })).toMatchObject({ ok: true, value: { sort: `${key}:desc` } });
  });

  it.each(['due', 'due:', 'due:up', ':asc', 'cvss:asc', 'Due:asc', 'due:ASC', 'due:asc:desc', 'due asc'])('rejects sort %p with the list of valid keys', (sort) => {
    expect(parseVulnFilters({ sort })).toEqual({
      ok: false, error: 'sort must be <key>:<asc|desc> with key one of severity, advisory, repo, age, due, state',
    });
  });
});
