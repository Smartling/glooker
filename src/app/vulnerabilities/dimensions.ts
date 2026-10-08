// src/app/vulnerabilities/dimensions.ts
// GLOOK-64: the Security page's fixed sizes, written once from the spec's "Dimensions and
// typography" table. Tests compare rendered inline styles against these names, so a layout number
// changes in exactly one place. Not a page.tsx file, so it may export freely.

// Page container: max width 1280, padding 32 / 24 / 40 (top / sides / bottom), gap 24.
export const PAGE_MAX_W = 1280;
export const PAGE_PAD = { top: 32, x: 24, bottom: 40 } as const;
export const PAGE_GAP = 24;

// Overview.
export const KPI_ROW_H = 178;
export const OWNERSHIP_BODY_H = 330;   // tables scroll inside it; header row and Total row stay pinned
export const TEAM_ROW_H = 50;
// The Owning teams table's pinned header (a band row over a column-header row) and the † footnote under its Total row.
export const TEAM_BAND_H = 24;
export const TEAM_COLHEAD_H = 32;
export const TEAM_HEAD_H = TEAM_BAND_H + TEAM_COLHEAD_H;
export const TEAM_FOOTNOTE_H = 20;
export const TREND_PLOT_H = 220;
export const SPARK_H = 24;

// Alerts.
export const ALERTS_STRIP_H = 72;
export const ALERTS_CARD_H = 776;
export const ALERT_ROW_H = 56;
export const ALERT_PAGE_SIZE = 10;
export const ALERT_LIST_H = ALERT_ROW_H * ALERT_PAGE_SIZE; // 560
/** The pager's "Page X of Y" slot, in px (border-box, padding included): fits "Page 99 of 99" at text-xs with tabular-nums,
 * so Previous and Next keep their place when the page count gains a digit. */
export const PAGER_INDICATOR_W = 112;
export const RAIL_W = 260;

// Drawer and header.
export const DRAWER_W = 460;
export const DRAWER_MAX_W = '92vw';
export const COVERAGE_LINE_MIN_H = 22;
/** The header's coverage line: slot widths in px, sized for counts of up to two digits in the page's font. The
 * unmeasured badge's slot is always rendered, and the two counts sit in slots too, so the items after each keep
 * their place when a filter change moves a count between zero and non-zero or between one digit and two. */
export const COVERAGE_BADGE_SLOT_W = 168;
export const COVERAGE_EXCLUDED_SLOT_W = 160;
export const COVERAGE_TAGGING_SLOT_W = 120;
/** The drawer's Policy list: the label column. */
export const POLICY_LABEL_W = 96;
/** The Alerts tab's "N open" slot: wide enough for "9,999 open", so the tab does not resize when the count arrives. */
export const ALERTS_TAB_COUNT_W = 64;

// Sticky bar. Selects have fixed widths; each is shrink-0 and truncates with a title attribute.
// Two fixed rows: the view tabs, then the filters, each under its own caption.
export const SELECT_W = { codebase: 220, team: 170, severity: 140, baseline: 118, date: 128 } as const;
export const FILTER_ROW_GAP = 8;
export const BAR_ROW_H = 36;                  // the view tabs' row
export const FILTER_CAPTION_H = 14;           // "CODEBASE", "OWNING TEAM", ...: 10.5px uppercase, one line
export const FILTER_CAPTION_GAP = 4;
export const FILTER_SELECT_H = 28;
export const FILTER_ROW_H = FILTER_CAPTION_H + FILTER_CAPTION_GAP + FILTER_SELECT_H; // 46
export const BAR_PAD_Y = 6;
export const FILTER_BAR_H = BAR_ROW_H + FILTER_ROW_H + 2 * BAR_PAD_Y; // 94: tabs row + filters row
export const RESET_SLOT_W = 116;
/** The four selects, the date slot, the "Reset filters" slot at the row's right end, and the 5 gaps between them. */
export const FILTER_ROW_W =
  SELECT_W.codebase + SELECT_W.team + SELECT_W.severity + SELECT_W.baseline + SELECT_W.date + RESET_SLOT_W + 5 * FILTER_ROW_GAP;

/** Layer order: tables' pinned rows < sticky bar < drawer. Apply as inline `zIndex`. */
export const Z = { pinnedRows: 10, stickyBar: 20, drawer: 40 } as const;

/** Typography and radii from the spec, as full class strings (Tailwind scans this file). */
export const TYPE = {
  title: 'text-2xl font-bold',
  kpiValue: 'text-[22px] leading-7 font-bold',
  sectionLabel: 'text-xs font-semibold uppercase tracking-[0.08em]',
  tableHeader: 'text-[11px] font-semibold uppercase tracking-[0.06em]',
  body: 'text-sm',
  secondary: 'text-xs',
  card: 'rounded-xl',
  control: 'rounded-md',
  badge: 'rounded',
  /** Every in-page link: the underline is the non-colour cue (spec, "Colour tokens"). */
  link: 'text-accent-light underline underline-offset-2 hover:text-accent-lighter',
} as const;
