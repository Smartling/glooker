import fs from 'fs';
import path from 'path';
import {
  COMMIT_TYPE_ORDER, commitTypeBadge, commitTypeBg, commitTypeColor, foldTypes, normalizeType, typeEntriesFrom,
} from '@/components/charts/commit-types';

it('stacks types in the spec order', () => {
  expect([...COMMIT_TYPE_ORDER]).toEqual(['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other', 'in_flight']);
});

it('maps each type to its own mark token and mark background class', () => {
  expect(commitTypeColor('feature')).toBe('var(--chart-type-feature)');
  expect(commitTypeColor('in_flight')).toBe('var(--chart-type-in-flight)');
  expect(commitTypeBg('bug')).toBe('bg-chart-type-bug');
  expect(commitTypeBg('in_flight')).toBe('bg-chart-type-in-flight');
});

it('every type returns a badge fill and a badge text colour, separate from the mark colour', () => {
  for (const t of COMMIT_TYPE_ORDER) {
    const slug = t === 'in_flight' ? 'in-flight' : t;
    expect(commitTypeBadge(t)).toEqual({ bg: `bg-chart-badge-${slug}-bg`, text: `text-chart-badge-${slug}-text` });
  }
});

it('maps unknown types to other, for marks and badges alike', () => {
  expect(normalizeType('chore')).toBe('other');
  expect(commitTypeColor('chore')).toBe('var(--chart-type-other)');
  expect(commitTypeBg('')).toBe('bg-chart-type-other');
  expect(commitTypeBadge('chore')).toEqual(commitTypeBadge('other'));
});

it('foldTypes sums across weeks, folds unknown types into other, and tolerates string counts', () => {
  const folded = foldTypes([{ feature: 2, chore: 1 }, { feature: '3', other: 1, in_flight: 4 }]);
  expect(folded.feature).toBe(5);
  expect(folded.other).toBe(2);
  expect(folded.in_flight).toBe(4);
  expect(folded.bug).toBe(0);
});

it('typeEntriesFrom gives one row per non-zero type in fixed COMMIT_TYPE_ORDER, not by count, with unknown types in a single other row', () => {
  expect(typeEntriesFrom([{ feature: 2, chore: 1, other: 1 }, { bug: 3 }, { in_flight: 9 }])).toEqual([
    ['feature', 2], ['bug', 3], ['other', 2], ['in_flight', 9],
  ]);
  expect(typeEntriesFrom([])).toEqual([]);
});

// The palette gate could move a hue in the charts while a page kept an old copy of the map.
it.skip('no report page keeps its own commit-type colour map', () => {
  const files = [
    'src/app/report/[id]/org/page.tsx',
    'src/app/report/[id]/dev/[login]/page.tsx',
    'src/app/report/[id]/team/dev-table.tsx',
  ];
  const offenders = files.filter(f =>
    /const\s+TYPE_(COLORS|HEX|TEXT_COLORS)\b/.test(fs.readFileSync(path.join(__dirname, '../../../..', f), 'utf8')),
  );
  expect(offenders).toEqual([]);
});
