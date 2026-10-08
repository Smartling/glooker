// src/app/vulnerabilities/vulnerabilities-content.tsx
'use client';
import { useLayoutEffect, useRef } from 'react';
import Link from 'next/link';
import { addDays } from '@/lib/vulnerabilities/time';
import { panelError } from './format';
import { localToday } from './labels';
import { keepTopDelta, scopeOpenCount, useAlertList, useSecurityUrl } from './security-state';
import { useSecurityData } from './use-security-data';
import SecurityHeader, { ConfigErrorBanner } from './security-header';
import FilterBar from './filter-bar';
import CoverageDrawer, { useCoverageDrawer } from './coverage-drawer';
import KpiTiles from './kpi-tiles';
import OwnershipCard from './ownership-card';
import TrendCard from './trend-card';
import AlertsStrip from './alerts-strip';
import RepoRail from './repo-rail';
import AlertList from './alert-list';
import type { SecurityViewProps } from './view-props';
import { ALERTS_CARD_H, PAGE_GAP, PAGE_MAX_W, PAGE_PAD, RAIL_W, TYPE } from './dimensions';

// Longhands, not the `padding` shorthand: each side is then an inspectable inline style.
const PAGE_PADDING = {
  paddingTop: PAGE_PAD.top, paddingRight: PAGE_PAD.x, paddingBottom: PAGE_PAD.bottom, paddingLeft: PAGE_PAD.x,
} as const;

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto" style={{ maxWidth: PAGE_MAX_W, ...PAGE_PADDING }}>{children}</div>;
}

/**
 * The thin composer: URL state, data and the drawer's open state live in hooks; each region of the
 * page is its own module. Only the page chrome, the view switch and the full-page states are here.
 */
export default function VulnerabilitiesContent() {
  const url = useSecurityUrl();
  const alertList = useAlertList({ codebase: url.codebase, team: url.team, repo: url.repo, severity: url.severity });
  const data = useSecurityData(url, alertList.list);
  const drawer = useCoverageDrawer();
  const barRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevView = useRef(url.view);

  // Switching view: if the user has scrolled past the top of the content, scroll up just enough
  // that it starts right under the sticky bar. Never scrolls down. Keyed on `view` and skipped on
  // first mount, so Back and Forward are covered as well.
  useLayoutEffect(() => {
    if (prevView.current === url.view) return;
    prevView.current = url.view;
    const bar = barRef.current;
    const panel = panelRef.current;
    if (!bar || !panel) return;
    const delta = keepTopDelta(panel.getBoundingClientRect().top, bar.getBoundingClientRect().bottom);
    if (delta !== 0) window.scrollBy(0, delta);
  }, [url.view]);

  const { summary } = data;

  // For any summary error other than an unknown team the page fails visibly with one error line,
  // whether or not `summary` still holds data: keepPreviousData would otherwise keep rendering the
  // previous key's figures under the new label. The filters live in the URL, so a reload recovers.
  if (summary.error) {
    const info = (summary.error as { info?: { error?: string; known_teams?: string[] } } | null)?.info;
    if (info?.known_teams) {
      return (
        <Shell>
          <h1 className="text-lg font-semibold text-white">Security</h1>
          <p className="text-sm text-red-400 mt-2">{info.error}</p>
          <p className="text-xs text-gray-500 mt-1">Known teams: {info.known_teams.join(', ')}</p>
          {url.team && (
            <button className={`text-xs ${TYPE.link} mt-3 inline-block`} onClick={() => url.setTeam(null)}>
              Clear team filter
            </button>
          )}
        </Shell>
      );
    }
    return <Shell><div className="text-red-400 text-sm">{panelError(summary.error, 'summary')}</div></Shell>;
  }
  if (summary.unavailable) {
    const u = summary.unavailable;
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-white">Security</h1>
        <p className="text-sm text-gray-400 mt-2">{u.reason}</p>
        <div className="mt-2"><ConfigErrorBanner errors={u.configErrors} /></div>
        {u.sync?.lastStatus === 'failed' && <p className="text-sm text-red-400 mt-1">The last sync failed: {u.sync.issues?.[0]?.message}</p>}
        <Link href="/reports?tab=syncs" className={`text-xs ${TYPE.link} mt-3 inline-block`}>Sync history →</Link>
      </Shell>
    );
  }
  const s = summary.data;
  if (!s) return <Shell><div className="text-gray-500 text-sm">Loading…</div></Shell>;

  const viewProps: SecurityViewProps = {
    summary: s,
    data,
    url,
    list: { ...alertList, list: data.effectiveList },
    openDrawer: drawer.openDrawer,
  };
  // With a repository selected, the previous scope's rows (stale) do not contain it: they would count 0 for it. No number until the new rows arrive.
  const alertsCount = data.repos.data && !(data.effectiveRepo !== null && data.repos.stale)
    ? scopeOpenCount(data.repos.data.rows, url.severity, data.effectiveRepo)
    : null;
  const baselinePrefill = s.delta[url.kSev].baseline?.takenOn ?? addDays(localToday(), -7);

  return (
    <div data-testid="security-page" className="mx-auto flex flex-col" style={{ maxWidth: PAGE_MAX_W, ...PAGE_PADDING, gap: PAGE_GAP }}>
      <SecurityHeader
        summary={s}
        repos={data.metaRepos}
        coverage={data.coverage}
        codebase={url.codebase}
        summaryStale={summary.stale}
        openDrawer={drawer.openDrawer}
      />
      <FilterBar
        barRef={barRef}
        url={url}
        teams={s.knownTeams ?? []}
        codebaseCounts={s.codebaseCounts}
        alertsCount={alertsCount}
        baselinePrefill={baselinePrefill}
      />
      <div
        ref={panelRef}
        id="security-view-panel"
        role="tabpanel"
        aria-labelledby={`security-tab-${url.view}`}
        className="flex flex-col"
        style={{ gap: PAGE_GAP }}
      >
        {url.view === 'overview' ? (
          <>
            <KpiTiles {...viewProps} />
            <OwnershipCard {...viewProps} />
            <TrendCard {...viewProps} />
          </>
        ) : (
          <>
            <AlertsStrip {...viewProps} />
            <div
              data-testid="alerts-card"
              className="bg-gray-900 rounded-xl overflow-hidden grid"
              style={{ height: ALERTS_CARD_H, gridTemplateColumns: `${RAIL_W}px minmax(0, 1fr)` }}
            >
              <RepoRail {...viewProps} />
              <AlertList {...viewProps} />
            </div>
          </>
        )}
      </div>
      <CoverageDrawer open={drawer.open} onClose={drawer.closeDrawer} opener={drawer.opener} coverage={data.coverage} summary={s} />
    </div>
  );
}
