// src/app/vulnerabilities/security-header.tsx
'use client';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import DataFreshness from '@/components/runs/DataFreshness';
import { CODEBASE_LABELS } from '@/lib/vulnerabilities/codebase-labels';
import type { CodebaseGroup } from '@/lib/vulnerabilities/types';
import { unmeasuredBadgeText } from './labels';
import type { SummaryData, ReposData, CoverageData } from './api-types';
import type { Slot } from './use-security-data';
import type { OpenDrawer } from './coverage-drawer';
import { COVERAGE_LINE_MIN_H, TYPE } from './dimensions';

/** "Backend · 11 production repositories · 4 owning teams". The scope value is data
 * (`summary.scope.value`), never a literal. Without counts it is still a full line. */
export function securityMeta(i: { codebase: CodebaseGroup; scopeValue: string; repoCount: number | null; teamCount: number | null }): string {
  const head = `${CODEBASE_LABELS[i.codebase]} · `;
  if (i.repoCount === null || i.teamCount === null) return `${head}${i.scopeValue} repositories`;
  const repos = `${i.repoCount.toLocaleString('en-US')} ${i.scopeValue} ${i.repoCount === 1 ? 'repository' : 'repositories'}`;
  const teams = `${i.teamCount.toLocaleString('en-US')} owning ${i.teamCount === 1 ? 'team' : 'teams'}`;
  return `${head}${repos} · ${teams}`;
}

export function staleHours(lastSuccessfulAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - Date.parse(lastSuccessfulAt)) / 3_600_000));
}

/**
 * The one place that renders the `configErrors` channel every prepare()-based response carries
 * (carried over unchanged from the old page). A `source: 'sync'` entry names when it will clear
 * itself, since the next successful sync overwrites it; a `source: 'startup'` entry clears only on
 * the next restart with the variable fixed.
 */
export function ConfigErrorBanner({ errors }: { errors?: Array<{ source: string; variable: string; rule: string; at?: string }> }) {
  if (!errors || errors.length === 0) return null;
  return (
    <div className="text-xs text-red-400 border border-red-900 rounded p-2 space-y-0.5">
      {errors.map((e, i) => (
        <div key={i}>{e.rule}{e.source === 'sync' ? ` — clears after the next successful sync (as of ${e.at})` : ''}</div>
      ))}
    </div>
  );
}

/** Slot widths, in px, sized for counts of up to two digits in the page's font. The unmeasured badge's
 * slot is always rendered, and the two counts sit in slots too, so the items after each keep their place
 * when a filter change moves a count between zero and non-zero or between one digit and two. */
export const COVERAGE_BADGE_SLOT_W = 168;
export const COVERAGE_EXCLUDED_SLOT_W = 160;
export const COVERAGE_TAGGING_SLOT_W = 120;

/** "COVERAGE", the unmeasured badge, "· N excluded by policy · N need tagging", and the drawer link. The minimum
 * height keeps the line from shrinking when the badge disappears, and the badge's slot keeps its width. */
export function CoverageLine({ coverage, openDrawer }: { coverage: Slot<CoverageData>; openDrawer: OpenDrawer }) {
  const c = coverage.data;
  const unmeasured = c?.unmeasured.length ?? 0;
  // The counts on screen are the previous scope's while the new ones load: dim them, as the tables dim their rows.
  const dim = coverage.stale ? { opacity: 0.6 } : undefined;
  return (
    <div
      data-testid="coverage-line"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400"
      style={{ minHeight: COVERAGE_LINE_MIN_H }}
    >
      <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-500">Coverage</span>
      <span
        data-testid="coverage-badge-slot"
        className="inline-flex shrink-0"
        style={{ minWidth: COVERAGE_BADGE_SLOT_W, visibility: unmeasured > 0 ? 'visible' : 'hidden', ...dim }}
      >
        {unmeasured > 0 && (
          <button
            type="button"
            onClick={e => openDrawer(e.currentTarget)}
            className={`inline-flex items-center gap-1 border border-warn-line bg-warn-bg text-warn px-1.5 py-0.5 font-semibold ${TYPE.badge}`}
          >
            {unmeasuredBadgeText(unmeasured)}
          </button>
        )}
      </span>
      {c && (
        <>
          <span data-testid="coverage-excluded" className="shrink-0" style={{ minWidth: COVERAGE_EXCLUDED_SLOT_W, ...dim }}>· {c.excludedByPolicy.length} excluded by policy</span>
          <span data-testid="coverage-tagging" className="shrink-0" style={{ minWidth: COVERAGE_TAGGING_SLOT_W, ...dim }}>· {c.needsTagging.length} need tagging</span>
        </>
      )}
      {coverage.errorText && <span className="text-red-400">{coverage.errorText}</span>}
      <button type="button" onClick={e => openDrawer(e.currentTarget)} className={TYPE.link}>
        Coverage &amp; policy →
      </button>
    </div>
  );
}

export interface SecurityHeaderProps {
  summary: SummaryData;
  /** `data.metaRepos`: the codebase's repository rows with no owning team applied, so the meta line describes the codebase. */
  repos: Slot<ReposData>;
  coverage: Slot<CoverageData>;
  codebase: CodebaseGroup;
  /** The summary is showing the previous key's data while the new one loads. */
  summaryStale: boolean;
  openDrawer: OpenDrawer;
  /** Injected for tests; defaults to the current time. */
  now?: Date;
}

export default function SecurityHeader({ summary, repos, coverage, codebase, summaryStale, openDrawer, now }: SecurityHeaderProps) {
  // The counts and the codebase label come from the same response. While the rows are the previous
  // codebase's (keepPreviousData, `stale`) they are not counted under the new codebase's name: the line
  // falls back to the count-less form until the new rows arrive.
  const reposData = repos.stale ? undefined : repos.data;
  const rows = reposData?.rows;
  const meta = securityMeta({
    codebase: reposData?.appliedFilters.codebase ?? codebase,
    scopeValue: summary.scope.value,
    repoCount: rows ? rows.length : null,
    teamCount: rows ? new Set(rows.map(r => r.team)).size : null,
  });
  const sync = summary.sync;
  const failed = sync.lastStatus === 'failed';
  const showStale = sync.stale && !!sync.lastSuccessfulAt;

  return (
    // PageHeader's root carries mb-6; the page container already spaces its children, so zero it here.
    <div data-testid="security-header" className="[&>div]:mb-0">
      <PageHeader
        title={`Security · ${summary.org}`}
        meta={meta}
        freshness={(
          <DataFreshness
            label="last successful sync"
            at={sync.lastSuccessfulAt}
            stale={sync.stale}
            // Label only: the failed banner is page-local (below), full width, not squeezed into this row.
            latestFailed={false}
            failedText=""
          />
        )}
        badges={summaryStale ? <span className="text-[11px] text-accent-light">Updating…</span> : undefined}
        actions={<Link href="/reports?tab=syncs" className="text-xs text-accent-light hover:text-accent-lighter">Sync history →</Link>}
      >
        <div className="flex flex-col gap-2">
          {showStale && (
            <div>
              <span data-testid="stale-tag" className={`inline-block border border-warn-line bg-warn-bg text-warn px-1.5 py-0.5 text-xs font-semibold ${TYPE.badge}`}>
                {`▲ STALE · ${staleHours(sync.lastSuccessfulAt as string, now ?? new Date())}H`}
              </span>
            </div>
          )}
          {failed && (
            <div role="alert" className="flex items-start gap-2 text-xs text-red-400 border border-red-900 rounded-md p-2">
              <span aria-hidden="true" className="shrink-0 w-4 h-4 rounded-full border border-red-400 flex items-center justify-center text-[10px] leading-none font-bold">!</span>
              <span>The latest sync failed; showing data from the last good sync. {sync.issues?.[0]?.message}</span>
            </div>
          )}
          <ConfigErrorBanner errors={summary.configErrors} />
          <CoverageLine coverage={coverage} openDrawer={openDrawer} />
        </div>
      </PageHeader>
    </div>
  );
}
