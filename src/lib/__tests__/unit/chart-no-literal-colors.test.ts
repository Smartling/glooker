// src/lib/__tests__/unit/chart-no-literal-colors.test.ts
// GLOOK-58 guard test 1 (Decision 5): chart modules contain no hex colour and no fill-gray-*/
// stroke-gray-* class. Every colour comes from a CSS variable defined for both theme modes.
// Static scan in the style of logger-enforcement.test.ts.
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '../../../..');
const CHART_DIR = path.join(root, 'src/components/charts');
const EXTRA = [
  'src/app/vulnerabilities/trend-card.tsx',
  'src/app/vulnerabilities/sparkline.tsx',
  'src/app/vulnerabilities/team-colors.ts',
  'src/app/projects/progress-ring.tsx',
];

// The ported shadcn wrapper restyles the default colours Recharts emits by attribute selector,
// e.g. [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-chart-grid. Those match a colour;
// they never set one. They are stripped before scanning.
const ATTRIBUTE_SELECTOR = /\[(?:stroke|fill)='#[0-9a-fA-F]{3,8}'\]/g;
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const GRAY_CLASS = /\b(?:fill|stroke)-gray-\d{2,3}\b/g;

function findLiteralColors(source: string): string[] {
  const s = source.replace(ATTRIBUTE_SELECTOR, '');
  return [...(s.match(HEX) ?? []), ...(s.match(GRAY_CLASS) ?? [])];
}

function chartFiles(): string[] {
  const files = fs.readdirSync(CHART_DIR).filter(f => /\.tsx?$/.test(f)).map(f => path.join(CHART_DIR, f));
  return [...files, ...EXTRA.map(f => path.join(root, f))];
}

describe('findLiteralColors (the scanner itself)', () => {
  it('flags a bare hex fill', () => {
    expect(findLiteralColors('<rect fill="#123456" />')).toEqual(['#123456']);
  });
  it('flags gray fill and stroke classes', () => {
    expect(findLiteralColors('className="fill-gray-600 stroke-gray-800"')).toEqual(['fill-gray-600', 'stroke-gray-800']);
  });
  it("ignores Recharts default-colour attribute selectors like [stroke='#ccc']", () => {
    expect(findLiteralColors("[&_.recharts-dot[stroke='#fff']]:stroke-transparent")).toEqual([]);
  });
  it('still flags a hex next to an attribute selector', () => {
    expect(findLiteralColors("[stroke='#ccc'] color: #abcdef")).toEqual(['#abcdef']);
  });
  it('ignores url(#hatch-…) pattern references', () => {
    expect(findLiteralColors('fill="url(#hatch-r1)"')).toEqual([]);
  });
});

it('scans every chart module', () => {
  const names = chartFiles().map(f => path.relative(root, f)).sort();
  expect(names).toEqual([
    'src/app/projects/progress-ring.tsx',
    'src/app/vulnerabilities/sparkline.tsx',
    'src/app/vulnerabilities/team-colors.ts',
    'src/app/vulnerabilities/trend-card.tsx',
    'src/components/charts/chart-format.ts',
    'src/components/charts/chart.tsx',
    'src/components/charts/commit-type-donut.tsx',
    'src/components/charts/commit-types.ts',
    'src/components/charts/hatch.tsx',
    'src/components/charts/lines-changed-chart.tsx',
    'src/components/charts/spend-impact-scatter.tsx',
    'src/components/charts/stacked-types-chart.tsx',
    'src/components/charts/timeline-chart.tsx',
  ]);
});

it('no chart module contains a literal colour', () => {
  const offenders = chartFiles().flatMap(f =>
    findLiteralColors(fs.readFileSync(f, 'utf8')).map(c => `${path.relative(root, f)}: ${c}`),
  );
  expect(offenders).toEqual([]);
});
