import { extractJiraKeys, findFirstJiraKey } from '@/lib/jira-key-utils';

describe('extractJiraKeys', () => {
  it('extracts standard dash-separated keys', () => {
    expect(extractJiraKeys('TQCT-1576 fixed the bug')).toEqual(['TQCT-1576']);
  });

  it('extracts space-separated keys', () => {
    expect(extractJiraKeys('Tqct 1576 (#361)')).toEqual(['TQCT-1576']);
  });

  it('normalizes to uppercase with dash', () => {
    expect(extractJiraKeys('tqct-1576')).toEqual(['TQCT-1576']);
    expect(extractJiraKeys('tqct 1576')).toEqual(['TQCT-1576']);
    expect(extractJiraKeys('Tqct 1576')).toEqual(['TQCT-1576']);
  });

  it('extracts multiple keys', () => {
    expect(extractJiraKeys('SPS-574 and PARSER-42 done')).toEqual(['SPS-574', 'PARSER-42']);
  });

  it('deduplicates same key', () => {
    expect(extractJiraKeys('SPS-574 see SPS-574')).toEqual(['SPS-574']);
  });

  it('handles mixed formats', () => {
    expect(extractJiraKeys('Sps 574 and PARSER-42')).toEqual(['SPS-574', 'PARSER-42']);
  });

  it('returns empty for no matches', () => {
    expect(extractJiraKeys('just a normal commit message')).toEqual([]);
  });

  it('filters out common false positives', () => {
    expect(extractJiraKeys('fix: node 20 upgrade')).toEqual([]);
    expect(extractJiraKeys('feat: http 200 ok')).toEqual([]);
  });

  it('handles keys at start, middle, and end', () => {
    expect(extractJiraKeys('TQCT-100 middle DT-200 end SPS-300')).toEqual(['TQCT-100', 'DT-200', 'SPS-300']);
  });
});

describe('findFirstJiraKey', () => {
  it('returns first key with position', () => {
    const result = findFirstJiraKey('Tqct 1576 (#361)');
    expect(result).toEqual({ key: 'TQCT-1576', start: 0, end: 9 });
  });

  it('returns key with correct position in middle of string', () => {
    const result = findFirstJiraKey('fix: SPS-574 parser bug');
    expect(result).toEqual({ key: 'SPS-574', start: 5, end: 12 });
  });

  it('handles dash separator', () => {
    const result = findFirstJiraKey('PARSER-42 done');
    expect(result).toEqual({ key: 'PARSER-42', start: 0, end: 9 });
  });

  it('returns null for no match', () => {
    expect(findFirstJiraKey('no jira key here')).toBeNull();
  });

  it('returns null for false positives', () => {
    expect(findFirstJiraKey('fix node 20')).toBeNull();
  });
});
