// src/app/vulnerabilities/view-props.ts
import type { SummaryData } from './api-types';
import type { SecurityData } from './use-security-data';
import type { AlertListController, SecurityUrl } from './security-state';
import type { OpenDrawer } from './coverage-drawer';

/** What the composer hands to every view slot. A slot reads what it needs and ignores the rest. */
export interface SecurityViewProps {
  /** The scoped summary (codebase, team, baseline); always available:true here. */
  summary: SummaryData;
  /** Every data slot: summary, teamSummary, coverage, repos, metaRepos, trend, sparkline, alerts, repoStatus. */
  data: SecurityData;
  /** URL values and the handlers that write them. */
  url: SecurityUrl;
  /** The alert-list state; `list.list` is the EFFECTIVE (sanitised) state that was sent. */
  list: AlertListController;
  openDrawer: OpenDrawer;
}
