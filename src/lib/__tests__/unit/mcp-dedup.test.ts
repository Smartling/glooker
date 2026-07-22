import { dedupByKeyEarliest, bucketByPeriod } from '@/lib/mcp/dedup';

describe('dedupByKeyEarliest', () => {
  it('keeps the earliest-timestamp row per key', () => {
    const rows = [
      { sha: 'a', ts: '2026-03-10T00:00:00Z', v: 'late' },
      { sha: 'a', ts: '2026-01-05T00:00:00Z', v: 'early' },
      { sha: 'b', ts: '2026-02-01T00:00:00Z', v: 'only' },
    ];
    const out = dedupByKeyEarliest(rows, 'sha', 'ts');
    expect(out).toHaveLength(2);
    expect(out.find(r => r.sha === 'a')?.v).toBe('early');
    expect(out.find(r => r.sha === 'b')?.v).toBe('only');
  });

  it('does not collapse rows whose key is null or empty', () => {
    const rows = [
      { key: null, ts: '2026-01-01T00:00:00Z' },
      { key: '',   ts: '2026-01-02T00:00:00Z' },
      { key: null, ts: '2026-01-03T00:00:00Z' },
    ];
    expect(dedupByKeyEarliest(rows, 'key', 'ts')).toHaveLength(3);
  });

  it('treats a null timestamp as latest (loses to any real timestamp)', () => {
    const rows = [
      { sha: 'a', ts: null, v: 'null-ts' },
      { sha: 'a', ts: '2026-01-01T00:00:00Z', v: 'real' },
    ];
    expect(dedupByKeyEarliest(rows, 'sha', 'ts')[0].v).toBe('real');
  });
});

describe('bucketByPeriod', () => {
  it('buckets by ISO week (Monday start) ascending', () => {
    const rows = [
      { ts: '2026-01-14T12:00:00Z' }, // Wed → week of Mon 2026-01-12
      { ts: '2026-01-12T00:00:00Z' }, // Mon → same week
      { ts: '2026-01-05T00:00:00Z' }, // Mon → week of 2026-01-05
    ];
    const out = bucketByPeriod(rows, 'ts', 'week');
    expect(out.map(b => b.bucket)).toEqual(['2026-01-05', '2026-01-12']);
    expect(out[1].count).toBe(2);
  });

  it('buckets by month (first-of-month) ascending', () => {
    const rows = [
      { ts: '2026-02-20T00:00:00Z' },
      { ts: '2026-01-31T00:00:00Z' },
      { ts: '2026-02-01T00:00:00Z' },
    ];
    const out = bucketByPeriod(rows, 'ts', 'month');
    expect(out.map(b => b.bucket)).toEqual(['2026-01-01', '2026-02-01']);
    expect(out[1].count).toBe(2);
  });

  it('drops rows with an unparseable timestamp', () => {
    const rows = [{ ts: 'not-a-date' }, { ts: '2026-01-05T00:00:00Z' }];
    expect(bucketByPeriod(rows, 'ts', 'week')).toHaveLength(1);
  });
});
