// src/lib/__tests__/unit/vuln-security-dimensions.test.ts
import {
  PAGE_MAX_W, PAGE_PAD, PAGE_GAP, KPI_ROW_H, OWNERSHIP_BODY_H, TEAM_ROW_H, ALERTS_STRIP_H, ALERTS_CARD_H,
  ALERT_ROW_H, ALERT_PAGE_SIZE, ALERT_LIST_H, RAIL_W, TREND_PLOT_H, SPARK_H, DRAWER_W, DRAWER_MAX_W,
  COVERAGE_LINE_MIN_H, SELECT_W, FILTER_ROW_GAP, BAR_ROW_H, FILTER_CAPTION_H, FILTER_CAPTION_GAP, FILTER_SELECT_H, FILTER_ROW_H,
  BAR_PAD_TOP, BAR_ROW_GAP, FILTER_CONTROLS_H, FILTER_PAD_BOTTOM, FILTER_RULE_H,
  COVERAGE_BADGE_SLOT_W, COVERAGE_EXCLUDED_SLOT_W, COVERAGE_TAGGING_SLOT_W, COVERAGE_RULE_PAD,
  KPI_PAD_Y, KPI_PAD_X, KPI_SINCE_ROW_H, KPI_NOTE_H, KPI_SLA_ROW_H, TREND_RANGE_W, TREND_LEGEND_MIN_W,
  FILTER_BAR_H, RESET_SLOT_W, FILTER_ROW_W, Z, TYPE,
} from '@/app/vulnerabilities/dimensions';

it('matches the spec Dimensions table', () => {
  expect(PAGE_MAX_W).toBe(1280);
  expect(PAGE_PAD).toEqual({ top: 32, x: 24, bottom: 40 });
  expect(PAGE_GAP).toBe(24);
  expect(KPI_ROW_H).toBe(178);
  expect(OWNERSHIP_BODY_H).toBe(330);
  expect(TEAM_ROW_H).toBe(50);
  expect(ALERTS_STRIP_H).toBe(72);
  expect(ALERTS_CARD_H).toBe(776);
  expect(ALERT_ROW_H).toBe(56);
  expect(ALERT_PAGE_SIZE).toBe(10);
  expect(RAIL_W).toBe(260);
  expect(TREND_PLOT_H).toBe(220);
  expect(SPARK_H).toBe(24);
  expect(DRAWER_W).toBe(460);
  expect(DRAWER_MAX_W).toBe('92vw');
  expect(COVERAGE_LINE_MIN_H).toBe(22);
  expect(SELECT_W).toEqual({ codebase: 220, team: 170, severity: 140, baseline: 118, date: 128 });
});

it('derives the list area from the row height and page size (56px x 10 = 560px)', () => {
  expect(ALERT_LIST_H).toBe(560);
  expect(ALERT_LIST_H).toBe(ALERT_ROW_H * ALERT_PAGE_SIZE);
});

// Revert: put the sticky bar back to its old parts (6px padding top and bottom, 36 + 46) or change any one of them without the others.
it('the sticky bar is the top padding, the tabs row, the clear space under the tab rule and the filters row; the filters row is a caption over a select, the space to the lower rule and that rule', () => {
  expect(FILTER_CONTROLS_H).toBe(FILTER_CAPTION_H + FILTER_CAPTION_GAP + FILTER_SELECT_H);
  expect(FILTER_ROW_H).toBe(FILTER_CONTROLS_H + FILTER_PAD_BOTTOM + FILTER_RULE_H);
  expect(FILTER_BAR_H).toBe(BAR_PAD_TOP + BAR_ROW_H + BAR_ROW_GAP + FILTER_ROW_H);
  // The mockup's sticky bar: 32px selects under 11px captions 5px above them, 14px from the selects to the lower rule, 14px under the tab rule.
  expect([FILTER_SELECT_H, FILTER_CAPTION_GAP, FILTER_PAD_BOTTOM, BAR_ROW_GAP, BAR_PAD_TOP]).toEqual([32, 5, 14, 14, 12]);
  expect(FILTER_BAR_H).toBe(127);
});

it('the filter row (four selects, the date slot, the Reset slot at its right end and the gaps) fits one line at a 1024px viewport minus page padding and a 15px scrollbar', () => {
  const sum = SELECT_W.codebase + SELECT_W.team + SELECT_W.severity + SELECT_W.baseline + SELECT_W.date + RESET_SLOT_W + 5 * FILTER_ROW_GAP;
  expect(FILTER_ROW_W).toBe(sum);
  expect(FILTER_ROW_W).toBe(932);   // 220 + 170 + 140 + 118 + 128 + 116 and five 8px gaps; vuln-filter-bar.test.tsx checks it against the rendered row
  expect(FILTER_ROW_W).toBeLessThanOrEqual(1024 - 2 * PAGE_PAD.x - 15);
});

// Revert: change a slot width, or the divider's padding, without redoing the measurement the constants' comment records (the widest ONE-digit text, +2px).
it('the coverage line\'s slots are one-digit-safe widths (measured +2px), not two-digit ones, and the divider pad is the mockup\'s 14px', () => {
  expect([COVERAGE_BADGE_SLOT_W, COVERAGE_EXCLUDED_SLOT_W, COVERAGE_TAGGING_SLOT_W]).toEqual([150, 126, 95]);
  expect(COVERAGE_RULE_PAD).toBe(14);
});

// Revert: grow a figure row or a reserved line without shrinking another: the "since" tile (label + 3 rows + 3 reserved lines) then overflows its 142px.
it('the KPI tiles use the mockup\'s padding, and the "since" tile\'s parts fit the room the row leaves; the SLA rows keep a ~33px pitch', () => {
  expect([KPI_PAD_Y, KPI_PAD_X]).toEqual([18, 20]);
  const inner = KPI_ROW_H - 2 * KPI_PAD_Y;
  const LABEL_LINE_H = 16;   // text-xs
  expect(inner).toBe(142);
  expect(LABEL_LINE_H + 3 * KPI_SINCE_ROW_H + 3 * KPI_NOTE_H).toBeLessThanOrEqual(inner);
  expect(KPI_SLA_ROW_H).toBe(33);
});

it('the trend card\'s Range select is fixed, and its legend columns are the mockup\'s 170px (5 columns at 1024px keep 13 entries on the 3 reserved lines)', () => {
  expect(TREND_RANGE_W).toBe(128);
  expect(TREND_LEGEND_MIN_W).toBe(170);
  // The card's content at 1024px: 1024 - 2 x 24 (page padding) - 15 (scrollbar) - 2 x 16 (card padding) = 929; 5 columns and 4 gaps of 16px.
  const content = 1024 - 2 * PAGE_PAD.x - 15 - 2 * 16;
  expect(Math.floor((content + 16) / (TREND_LEGEND_MIN_W + 16))).toBeGreaterThanOrEqual(5);
  expect(Math.ceil(13 / 5)).toBe(3);
});

it('layers stack as the spec requires: pinned table rows < sticky bar < drawer', () => {
  expect(Z.pinnedRows).toBeLessThan(Z.stickyBar);
  expect(Z.stickyBar).toBeLessThan(Z.drawer);
});

it('typography classes carry the spec sizes, weights, tracking and radii', () => {
  expect(TYPE.title).toBe('text-2xl font-bold');                       // 24px, 700
  expect(TYPE.kpiValue).toContain('text-[22px]');
  expect(TYPE.kpiValue).toContain('font-bold');                        // 22px, 700
  expect(TYPE.sectionLabel).toBe('text-xs font-semibold uppercase tracking-[0.08em]');   // 12px, 600, 0.08em
  expect(TYPE.tableHeader).toBe('text-[11px] font-semibold uppercase tracking-[0.06em]'); // 11px, 600, 0.06em
  expect(TYPE.body).toBe('text-sm');                                   // 14px
  expect(TYPE.secondary).toBe('text-xs');                              // 12px
  expect(TYPE.card).toBe('rounded-xl');                                // 12px
  expect(TYPE.control).toBe('rounded-md');                             // 6px
  expect(TYPE.badge).toBe('rounded');                                  // 4px
  expect(TYPE.link.split(' ')).toContain('underline');                 // the non-colour cue for a link
  expect(TYPE.link.split(' ')).toContain('text-accent-light');
});
