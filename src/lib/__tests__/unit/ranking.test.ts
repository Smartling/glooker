import { competitionRanks, rankOfValue } from '@/lib/ranking';

describe('competitionRanks', () => {
  it('gives tied items the same place and skips the following ones', () => {
    const items = [9, 9, 9, 7, 5, 5, 1].map(v => ({ v }));
    expect(competitionRanks(items, i => i.v)).toEqual([1, 1, 1, 4, 5, 5, 7]);
  });
  it('handles empty, single and all-equal lists', () => {
    expect(competitionRanks([], () => 0)).toEqual([]);
    expect(competitionRanks([{ v: 3 }], i => i.v)).toEqual([1]);
    expect(competitionRanks([{ v: 3 }, { v: 3 }], i => i.v)).toEqual([1, 1]);
  });
  it('compares DECIMAL strings numerically and treats null as 0', () => {
    expect(competitionRanks(['7.3', 7.3, null, '0'], v => v)).toEqual([1, 1, 3, 3]);
  });
  it('also works for ascending order', () => {
    expect(competitionRanks([1, 1, 2], v => v)).toEqual([1, 1, 3]);
  });
});

describe('competitionRanks with a tuple key', () => {
  it('ties only when every part is equal', () => {
    const items = [[5, 3], [5, 3], [5, 2], [4, 9]];
    expect(competitionRanks(items, k => k)).toEqual([1, 1, 3, 4]);
  });
  it('never ties NaN keys', () => {
    expect(competitionRanks([NaN, NaN, 1], v => v)).toEqual([1, 2, 3]);
  });
});

describe('rankOfValue', () => {
  it('is 1 + the count of strictly higher values', () => {
    expect(rankOfValue([9, 9, 9, 7], 9)).toBe(1);
    expect(rankOfValue([9, 9, 9, 7], 7)).toBe(4);
    expect(rankOfValue(['7.3', '7.3'], 7.3)).toBe(1);
  });
});
