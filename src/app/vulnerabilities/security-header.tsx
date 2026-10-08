// src/app/vulnerabilities/security-header.tsx
'use client';
import Link from 'next/link';
import PageHeader from '@/components/PageHeader';
import DataFreshness from '@/components/runs/DataFreshness';
import { CODEBASE_LABELS } from '@/lib/vulnerabilities/codebase-labels';
import type { CodebaseGroup } from '@/lib/vulnerabilities/types';
import { displayDate, unmeasuredBadgeText } from './labels';
import type { SummaryData, ReposData, CoverageData } from './api-types';
import type { Slot } from './use-security-data';
import type { OpenDrawer } from './coverage-drawer';
import { COVERAGE_BADGE_SLOT_W, COVERAGE_EXCLUDED_SLOT_W, COVERAGE_LINE_MIN_H, COVERAGE_RULE_PAD, COVERAGE_TAGGING_SLOT_W, TYPE } from './dimensions';

const SYNCED_DAILY = ' · synced daily';

/** "Backend · 11 production repositories · 4 owning teams · synced daily". The scope value is data
 * (`summary.scope.value`), never a literal. Without counts it is still a full line. The closing "synced daily" is the design's
 * wording; it is a literal, so it is only true while the sync schedule is daily (Settings, Schedules). */
export function securityMeta(i: { codebase: CodebaseGroup; scopeValue: string; repoCount: number | null; teamCount: number | null }): string {
  const head = `${CODEBASE_LABELS[i.codebase]} · `;
  if (i.repoCount === null || i.teamCount === null) return `${head}${i.scopeValue} repositories${SYNCED_DAILY}`;
  const repos = `${i.repoCount.toLocaleString('en-US')} ${i.scopeValue} ${i.repoCount === 1 ? 'repository' : 'repositories'}`;
  const teams = `${i.teamCount.toLocaleString('en-US')} owning ${i.teamCount === 1 ? 'team' : 'teams'}`;
  return `${head}${repos} · ${teams}${SYNCED_DAILY}`;
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
        <div key={i}>
          {e.rule}
          {e.source === 'sync' && (
            <>
              {' — clears after the next successful sync'}
              {e.at && <> (as of <span title={e.at}>{displayDate(e.at)}</span>)</>}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** "COVERAGE", the unmeasured badge, "· N excluded by policy · N need tagging", and the drawer link. The minimum
 * height keeps the line from shrinking when the badge disappears, and every slot keeps its width: sized for a one-digit count, with a longer
 * one cut by "…" (its full text in a `title`). */
export function CoverageLine({ coverage, openDrawer }: { coverage: Slot<CoverageData>; openDrawer: OpenDrawer }) {
  const c = coverage.data;
  const unmeasured = c?.unmeasured.length ?? 0;
  // The counts on screen are the previous scope's while the new ones load: dim them, as the tables dim their rows.
  const dim = coverage.stale ? { opacity: 0.6 } : undefined;
  const excludedText = c ? `· ${c.excludedByPolicy.length} excluded by policy` : '';
  const taggingText = c ? `· ${c.needsTagging.length} need tagging` : '';
  return (
    <div
      data-testid="coverage-line"
      className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400"
      style={{ minHeight: COVERAGE_LINE_MIN_H }}
    >
      <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-500">Coverage</span>
      <span
        data-testid="coverage-badge-slot"
        className="inline-flex shrink-0"
        style={{ width: COVERAGE_BADGE_SLOT_W, visibility: unmeasured > 0 ? 'visible' : 'hidden', ...dim }}
      >
        {unmeasured > 0 && (
          <button
            type="button"
            title={unmeasuredBadgeText(unmeasured)}
            onClick={e => openDrawer(e.currentTarget)}
            // The hatched wash, as the unmeasured rows in the tables and the rail: the one look for "unmeasured".
            className={`vuln-hatch inline-flex min-w-0 max-w-full items-center gap-1 border border-warn-line text-warn px-1.5 py-0.5 font-semibold ${TYPE.badge}`}
          >
            <span className="truncate">{unmeasuredBadgeText(unmeasured)}</span>
          </button>
        )}
      </span>
      {/* Always rendered, empty until the counts arrive (or after an error): the link after them never jumps. */}
      <span data-testid="coverage-excluded" className="shrink-0 truncate" title={excludedText || undefined} style={{ width: COVERAGE_EXCLUDED_SLOT_W, ...dim }}>
        {excludedText}
      </span>
      <span data-testid="coverage-tagging" className="shrink-0 truncate" title={taggingText || undefined} style={{ width: COVERAGE_TAGGING_SLOT_W, ...dim }}>
        {taggingText}
      </span>
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
  const failedMessage = sync.issues?.[0]?.message;
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
            // The label turns amber, and the "▲ STALE · NH" tag beside it (the `badges` slot, on the same row) names the age.
            stale={showStale}
            // Label only: the failed banner is page-local (below), full width, not squeezed into this row.
            latestFailed={false}
            failedText=""
          />
        )}
        badges={(showStale || summaryStale) ? (
          <>
            {showStale && (
              <span data-testid="stale-tag" className={`inline-block shrink-0 whitespace-nowrap border border-warn-line bg-warn-bg text-warn px-1.5 text-[11px] font-semibold leading-4 ${TYPE.badge}`}>
                {`▲ STALE · ${staleHours(sync.lastSuccessfulAt as string, now ?? new Date())}H`}
              </span>
            )}
            {summaryStale && <span className="text-[11px] text-accent-light">Updating…</span>}
          </>
        ) : undefined}
        actions={(
          <Link
            href="/reports?tab=syncs"
            // The app's secondary button, as "Download PDF" on the org report: a filled gray-800 button, no border, 28px tall.
            className="inline-block shrink-0 rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700"
          >
            Sync history
          </Link>
        )}
      >
        <div className="flex flex-col gap-2">
          {failed && (
            <div role="alert" className="flex items-start gap-2 text-[13px] text-red-400 border border-red-900 rounded-md p-2">
              {/* A filled red disc with the "!", as the mockup's (and the strip's, rail's and list's BangMark): an outline ring read as a different, lighter mark. */}
              <span aria-hidden="true" className="shrink-0 w-4 h-4 rounded-full bg-red-400 flex items-center justify-center text-[11px] leading-none font-bold text-gray-900">!</span>
              <span>The latest sync failed; showing data from the last good sync.{failedMessage ? ` ${failedMessage}` : ''}</span>
            </div>
          )}
          <ConfigErrorBanner errors={summary.configErrors} />
          {/* The divider above the line, COVERAGE_RULE_PAD from it, as the mockup's header card. It is the line's wrapper, so the line keeps its own minimum height. */}
          <div data-testid="coverage-divider" className="border-t border-gray-800" style={{ paddingTop: COVERAGE_RULE_PAD }}>
            <CoverageLine coverage={coverage} openDrawer={openDrawer} />
          </div>
        </div>
      </PageHeader>
    </div>
  );
}
