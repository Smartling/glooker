// GLOOK-64: docs/vulnerabilities-page.md names files and tests; a name that no longer exists, or a
// retired module that creeps back in, makes the document lie to the next reader. This reads the
// document, so it fails the day a file is renamed or deleted without the document being updated.
import fs from 'fs';
import path from 'path';
import { KNOWN_VULN_ENV_VARS } from '@/lib/vulnerabilities/config';
import * as D from '@/app/vulnerabilities/dimensions';
// Widths that belong to one component are exported from it (the document's Layout stability intro says so).
import { ALERT_COLUMN_GAP, ALERT_COLUMN_PAD, ALERT_HEAD_H, ALERT_TOOLBAR_GAP, ALERT_TOOLBAR_ROW_H } from '@/app/vulnerabilities/alert-list';
import { ALERTS_STRIP_OPEN_MIN_W, ALERTS_STRIP_OVERDUE_MIN_W, ALERTS_STRIP_TITLE_W } from '@/app/vulnerabilities/alerts-strip';
import { OWN_TAB_COUNT_MIN_W } from '@/app/vulnerabilities/ownership-card';
import { PAGER_H } from '@/app/vulnerabilities/pager';

const root = path.join(__dirname, '../../../..');
const doc = fs.readFileSync(path.join(root, 'docs/vulnerabilities-page.md'), 'utf8');
const ticked = [...new Set([...doc.matchAll(/`([^`\n]+)`/g)].map(m => m[1]))];

const RETIRED = ['alerts-table', 'AlertsTable', 'AlertsPanel', 'team-pivot', 'TeamPivot', 'trend-chart', 'TrendChart', 'coverage-panel', 'CoveragePanel', 'policy-panel', 'PolicyPanel'];

it('every src/, scripts/ and docs/ path the document names exists', () => {
  const paths = ticked.filter(t => /^(src|scripts|docs)\/[\w./[\]-]+\.(ts|tsx|md|css|json|sql)$/.test(t));
  expect(paths.filter(p => !fs.existsSync(path.join(root, p)))).toEqual([]);
  expect(paths.length).toBeGreaterThan(40); // the extractor really found the Key files table and the prose
});

const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.relative(root, path.join(dir, e.name))]));
// Root-level files (schema.sql, CLAUDE.md) are named bare too, so they count alongside src/, scripts/ and docs/.
const rootFiles = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isFile()).map(e => e.name);
const sourceFiles = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts')), ...walk(path.join(root, 'docs')), ...rootFiles];

it('every bare file name in the Key files and Page modules tables exists somewhere under src/, scripts/ or docs/, or at the repo root', () => {
  const bare = ticked.filter(t => /^[\w./[\]-]+\.(ts|tsx|css|sql|md)$/.test(t) && !/^(src|scripts|docs)\//.test(t) && !/\.test\.tsx?$/.test(t));
  expect(bare.filter(b => !sourceFiles.some(f => f === b || f.endsWith('/' + b)))).toEqual([]);
  expect(bare.length).toBeGreaterThan(20);
});

it('every VULN_* / VULNERABILITIES_* variable the document names is read by config.ts, and every one config.ts reads is documented', () => {
  const CODE_CONSTANTS = ['VULN_COMMON', 'VULN_GITHUB_TIMEOUT_MS']; // named in the document, but constants, not env vars
  const named = ticked.filter(t => /^VULN(ERABILITIES)?_[A-Z_]+$/.test(t) && !CODE_CONSTANTS.includes(t));
  expect(named.filter(v => !KNOWN_VULN_ENV_VARS.has(v))).toEqual([]);
  expect([...KNOWN_VULN_ENV_VARS].filter(v => !named.includes(v))).toEqual([]);
});

it('every test file the document names exists', () => {
  const tests = ticked.filter(t => /^[\w-]+\.test\.tsx?$/.test(t));
  expect(tests.filter(t => !fs.existsSync(path.join(root, 'src/lib/__tests__/unit', t)))).toEqual([]);
  expect(tests.length).toBeGreaterThan(10);
});

it('does not mention a module the redesign retired', () => {
  expect(RETIRED.filter(name => doc.includes(name))).toEqual([]);
});

// ── Layout stability: every number in the section is either tied to its constant or explained.
const layoutStart = doc.indexOf('## Layout stability');
const layoutSection = doc.slice(layoutStart, doc.indexOf('\n## ', layoutStart + 1));
// A number token stands alone: "280" is not found in "1280", nor "5" in "1.5". "2ch", "24px" and "92%" give 2, 24 and 92.
const numbersIn = (s: string) => [...s.matchAll(/(?<![\w.])\d+(?:\.\d+)?/g)].map(m => m[0]);
const tableRows = new Map(layoutSection.split('\n').filter(l => l.startsWith('|')).map(l => [l.split('|')[1].trim(), l] as const));

// [constant, its value, the table row (first cell) that must state it]. A row, not the whole section, so a number that two rows
// share (24px: the page gap and the sparkline; 56px: a team header and an alert row) cannot be satisfied by the wrong one.
const sizes: Array<[string, number, string]> = [
  ['PAGE_MAX_W', D.PAGE_MAX_W, 'Page container'],
  ['PAGE_PAD.top', D.PAGE_PAD.top, 'Page container'],
  ['PAGE_PAD.x', D.PAGE_PAD.x, 'Page container'],
  ['PAGE_PAD.bottom', D.PAGE_PAD.bottom, 'Page container'],
  ['PAGE_GAP', D.PAGE_GAP, 'Page container'],
  ['COVERAGE_LINE_MIN_H', D.COVERAGE_LINE_MIN_H, 'Header coverage line'],
  ['COVERAGE_BADGE_SLOT_W', D.COVERAGE_BADGE_SLOT_W, 'Header coverage line'],
  ['COVERAGE_EXCLUDED_SLOT_W', D.COVERAGE_EXCLUDED_SLOT_W, 'Header coverage line'],
  ['COVERAGE_TAGGING_SLOT_W', D.COVERAGE_TAGGING_SLOT_W, 'Header coverage line'],
  ['COVERAGE_RULE_PAD', D.COVERAGE_RULE_PAD, 'Header coverage line'],
  ['FILTER_BAR_H', D.FILTER_BAR_H, 'Sticky bar'],
  ['BAR_ROW_H', D.BAR_ROW_H, 'Sticky bar'],
  ['FILTER_ROW_H', D.FILTER_ROW_H, 'Sticky bar'],
  ['FILTER_CAPTION_H', D.FILTER_CAPTION_H, 'Sticky bar'],
  ['FILTER_CAPTION_GAP', D.FILTER_CAPTION_GAP, 'Sticky bar'],
  ['FILTER_SELECT_H', D.FILTER_SELECT_H, 'Sticky bar'],
  ['BAR_PAD_TOP', D.BAR_PAD_TOP, 'Sticky bar'],
  ['BAR_ROW_GAP', D.BAR_ROW_GAP, 'Sticky bar'],
  ['FILTER_CONTROLS_H', D.FILTER_CONTROLS_H, 'Sticky bar'],
  ['FILTER_PAD_BOTTOM', D.FILTER_PAD_BOTTOM, 'Sticky bar'],
  ['FILTER_RULE_H', D.FILTER_RULE_H, 'Sticky bar'],
  ['SELECT_W.codebase', D.SELECT_W.codebase, 'Bar selects'],
  ['SELECT_W.team', D.SELECT_W.team, 'Bar selects'],
  ['SELECT_W.severity', D.SELECT_W.severity, 'Bar selects'],
  ['SELECT_W.baseline', D.SELECT_W.baseline, 'Bar selects'],
  ['SELECT_W.date', D.SELECT_W.date, 'Bar selects'],
  ['RESET_SLOT_W', D.RESET_SLOT_W, 'Bar reserved slots'],
  ['SELECT_W.date', D.SELECT_W.date, 'Bar reserved slots'],
  ['ALERTS_TAB_COUNT_W', D.ALERTS_TAB_COUNT_W, 'Bar reserved slots'],
  ['KPI_ROW_H', D.KPI_ROW_H, 'KPI tile row'],
  ['KPI_PAD_Y', D.KPI_PAD_Y, 'KPI tile row'],
  ['KPI_PAD_X', D.KPI_PAD_X, 'KPI tile row'],
  ['KPI_SINCE_ROW_H', D.KPI_SINCE_ROW_H, 'KPI tile row'],
  ['KPI_NOTE_H', D.KPI_NOTE_H, 'KPI tile row'],
  ['KPI_SLA_ROW_H', D.KPI_SLA_ROW_H, 'KPI tile row'],
  ['OWNERSHIP_BODY_H', D.OWNERSHIP_BODY_H, 'Ownership card body'],
  ['TEAM_ROW_H', D.TEAM_ROW_H, 'Ownership card body'],
  ['TEAM_HEAD_H', D.TEAM_HEAD_H, 'Ownership card body'],
  ['TEAM_FOOTNOTE_H', D.TEAM_FOOTNOTE_H, 'Ownership card body'],
  ['OWN_TAB_COUNT_MIN_W', parseInt(OWN_TAB_COUNT_MIN_W, 10), 'Ownership card body'],
  ['SPARK_H', D.SPARK_H, 'Sparkline slot'],
  ['TREND_PLOT_H', D.TREND_PLOT_H, 'Trend plot'],
  ['TREND_RANGE_W', D.TREND_RANGE_W, 'Trend plot'],
  ['TREND_LEGEND_MIN_W', D.TREND_LEGEND_MIN_W, 'Trend plot'],
  ['TREND_FOOT_GAP', D.TREND_FOOT_GAP, 'Trend plot'],
  ['ALERTS_STRIP_H', D.ALERTS_STRIP_H, 'Alerts summary strip'],
  ['ALERTS_STRIP_TITLE_W', ALERTS_STRIP_TITLE_W, 'Alerts summary strip'],
  ['ALERTS_STRIP_OPEN_MIN_W', ALERTS_STRIP_OPEN_MIN_W, 'Alerts summary strip'],
  ['ALERTS_STRIP_OVERDUE_MIN_W', ALERTS_STRIP_OVERDUE_MIN_W, 'Alerts summary strip'],
  ['ALERTS_CARD_H', D.ALERTS_CARD_H, 'Alerts card'],
  ['RAIL_W', D.RAIL_W, 'Alerts card'],
  ['RAIL_W', D.RAIL_W, 'Repository rail'],
  ['RAIL_FOOT_MIN_H', D.RAIL_FOOT_MIN_H, 'Repository rail'],
  ['ALERT_LIST_H', D.ALERT_LIST_H, 'Alert list'],
  ['ALERT_PAGE_SIZE', D.ALERT_PAGE_SIZE, 'Alert list'],
  ['ALERT_ROW_H', D.ALERT_ROW_H, 'Alert list'],
  ['ALERT_HEAD_H', ALERT_HEAD_H, 'Alert list'],
  ['ALERT_TOOLBAR_ROW_H', ALERT_TOOLBAR_ROW_H, 'Alert list'],
  ['ALERT_TOOLBAR_GAP', ALERT_TOOLBAR_GAP, 'Alert list'],
  ['PAGER_H', PAGER_H, 'Alert list'],
  ['PAGER_INDICATOR_W', D.PAGER_INDICATOR_W, 'Alert list'],
  ['ALERT_COLUMN_PAD.top', ALERT_COLUMN_PAD.top, 'Alert list'],
  ['ALERT_COLUMN_PAD.bottom', ALERT_COLUMN_PAD.bottom, 'Alert list'],
  ['ALERT_COLUMN_PAD.x', ALERT_COLUMN_PAD.x, 'Alert list'],
  ['ALERT_COLUMN_GAP', ALERT_COLUMN_GAP, 'Alert list'],
  ['ALERTS_CARD_H', D.ALERTS_CARD_H, 'Alert list'],
  ['DRAWER_W', D.DRAWER_W, 'Drawer'],
  ['DRAWER_MAX_W', parseInt(D.DRAWER_MAX_W, 10), 'Drawer'],
  ['POLICY_LABEL_W', D.POLICY_LABEL_W, 'Drawer'],
];

// Numbers in a table row that are NOT a size constant, each with the reason. A number in neither list fails the test below, so a size
// added to the table without a constant behind it (or a typo in one) cannot slip in unguarded. The value is pinned here too.
const notASize: Array<[row: string, value: number, reason: string]> = [
  ['Page container', D.PAGE_MAX_W + 2 * D.PAGE_PAD.x, 'PAGE_MAX_W + 2 x PAGE_PAD.x: the viewport width from which the cards are 1280px wide (the max width is the content, the padding is outside it)'],
  ['Bar selects', 0, '`shrink-0`: a Tailwind class name'],
  ['Alerts summary strip', 0, '`shrink-0`: a Tailwind class name'],
  ['Trend plot', 48, 'the legend\'s min-h-[48px] is a class literal in trend-card.tsx (3 lines x 16px), not an exported constant'],
  ['Trend plot', 160, 'the legend name cut, a max-w-[160px] class literal in trend-card.tsx'],
  ['KPI tile row', 142, 'KPI_ROW_H - 2 x KPI_PAD_Y: what a tile\'s content may fill (derived and checked in vuln-security-dimensions.test.ts)'],
  ['Repository rail', 10, 'the footer padding, a py-2.5 class: one term of RAIL_FOOT_MIN_H = 1 + 2 x 10 + 16 + 2 + 3 x 16 (dimensions.ts)'],
  ['Repository rail', 16, 'the sort line and the note lines, terms of RAIL_FOOT_MIN_H (dimensions.ts)'],
  ['Repository rail', 2, 'the gap between the footer lines, a term of RAIL_FOOT_MIN_H (dimensions.ts)'],
];
// Numbers in the section's prose (outside the table): either a size above (the prose repeats the table) or one of these.
const notASizeProse: Array<[value: number, reason: string]> = [
  [0, '`minmax(0, …)`: a CSS track minimum'],
  [1024, 'the viewport width the layout is checked at'],
  [1440, 'the second viewport width the layout is checked at'],
  [60, '`opacity-60`: a Tailwind class name'],
  [900, '`bg-gray-900`: a Tailwind class name'],
  [800, '`bg-gray-800`: a Tailwind class name'],
  [1, 'the 1px light-theme card border, and list numbering'],
  [2, 'the header card\'s 2px light-mode difference, and list numbering'],
];

it('the Layout stability table states each size dimensions.ts and the components define, in the row that owns it', () => {
  expect(layoutStart).toBeGreaterThan(-1);
  const missing = sizes.filter(([, px, row]) => !numbersIn(tableRows.get(row) ?? '').includes(String(px))).map(([name, , row]) => `${name} in "${row}"`);
  expect(missing).toEqual([]);
});

it('every number in the Layout stability section is a guarded size or an explained non-size', () => {
  const sizeValues = new Set(sizes.map(([, px]) => String(px)));
  const unexplained: string[] = [];
  for (const [row, line] of tableRows) {
    const ok = new Set([...sizes.filter(([, , r]) => r === row).map(([, px]) => String(px)), ...notASize.filter(([r]) => r === row).map(([, v]) => String(v))]);
    for (const n of numbersIn(line)) if (!ok.has(n)) unexplained.push(`${n} in "${row}"`);
  }
  const proseOk = new Set([...sizeValues, ...notASizeProse.map(([v]) => String(v))]);
  for (const line of layoutSection.split('\n').filter(l => !l.startsWith('|'))) {
    for (const n of numbersIn(line)) if (!proseOk.has(n)) unexplained.push(`${n} in prose: ${line.slice(0, 60)}`);
  }
  expect(unexplained).toEqual([]);
  // The rows the list names exist, so a renamed row cannot silently turn its entries into no-ops.
  expect([...new Set([...sizes.map(([, , r]) => r), ...notASize.map(([r]) => r)])].filter(r => !tableRows.has(r))).toEqual([]);
});
