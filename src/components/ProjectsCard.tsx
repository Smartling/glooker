'use client';
import { useState, useMemo } from 'react';
import type { TeamProject } from '@/lib/team-pulse/types';

// Segment colors used in both the legend swatches and the bar segments.
const SEGMENT_COLORS = {
  prs:     '#06B6D4',
  jiras:   '#A855F7',
  commits: 'rgba(255,255,255,0.10)',
} as const;

export interface JiraDetail {
  key: string;
  summary: string | null;
  type: string | null;
  assignee: string | null;
  linked_commits?: number;
  linked_prs?: number;
}

export interface ProjectGroup {
  name: string;
  jira_details: JiraDetail[];
}

export interface PrDetail {
  pr: number;
  repo: string;
  login: string;
  msg: string;
  commits: number;
  added: number;
  removed: number;
}

export interface CommitDetail {
  sha: string;
  repo: string;
  msg: string;
  pr: number | null;
  login: string;
  added: number;
  removed: number;
}

/** Older shape used by the home-page LLM project insights — superset of TeamProject.
 *  Allows the same component to serve both surfaces without a refactor of the home payload. */
export interface ProjectsCardItem {
  name: string;
  summary: string;
  developers: string[];
  jira_count: number;
  estimated_commits: number;
  estimated_prs: number;
  last_activity?: string;     // optional: only the team variant sets this
  jira_details?: JiraDetail[];
  groups?: ProjectGroup[];
  prs?: PrDetail[];
  commits?: CommitDetail[];
}

export interface ProjectsCardProps {
  projects: ProjectsCardItem[] | TeamProject[];
  loading?: boolean;
  title?: string;                        // default: "Top Projects"
  subtitle?: string;                     // default: empty
  emptyMessage?: string;                 // default: "No active projects in this window."
  /** Optional: link template for developer chips. Receives login, returns href.
   *  If omitted, chips are not links. */
  developerHref?: (login: string) => string;
  /** When provided, an "Other (not in top N)" row is appended showing the
   *  activity not captured by the project clusters. Shown as a peer row with
   *  the same bar format so users can compare scale directly. */
  actualTotals?: { commits: number; prs: number; jiras: number };
  /** Server-computed unattributed counts (Jiras and PRs not in any top project).
   *  When present, used directly for the "Other" row instead of deriving from actualTotals. */
  otherTotals?: { jiras: number; prs: number };
  /** Collapsible mode (GLOOK-11): header becomes a toggle button styled to
   *  match <TeamPulseCard>, body hidden when collapsed. Controlled — parent
   *  owns `expanded` state via `onExpandedChange`. */
  collapsible?: boolean;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
}

function timeAgo(iso?: string): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1mo ago' : `${months}mo ago`;
}

function ProjectsBody({
  projects,
  loading,
  emptyMessage,
  developerHref,
  variant,
  actualTotals,
  otherTotals,
}: {
  projects: ProjectsCardItem[] | TeamProject[];
  loading?: boolean;
  emptyMessage: string;
  developerHref?: (login: string) => string;
  variant: 'standalone' | 'collapsible';
  actualTotals?: { commits: number; prs: number; jiras: number };
  otherTotals?: { jiras: number; prs: number };
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'jiras' | 'prs' | 'commits'>('jiras');

  // All hooks must be declared before any early returns (Rules of Hooks).
  // Sort by meaningful output (PRs + Jiras). Commits excluded from sort key
  // because they are squashed into PRs — including them would inflate rank for
  // commit-heavy, low-PR projects. Commits are still shown in the bar for context.
  const sorted = useMemo(
    () => [...projects].sort((a, b) => (b.estimated_prs + b.jira_count) - (a.estimated_prs + a.jira_count)),
    [projects],
  );

  // "Other" row: activity not attributed to any named project cluster.
  // Only shown when actualTotals is provided (home page passes org totals from devStats).
  const other = useMemo(() => {
    // Use server-computed otherTotals when available (more accurate than client subtraction)
    if (otherTotals) {
      return (otherTotals.jiras + otherTotals.prs) > 0
        ? { commits: 0, prs: otherTotals.prs, jiras: otherTotals.jiras }
        : null;
    }
    if (!actualTotals) return null;
    const sumCommits = sorted.reduce((s, p) => s + p.estimated_commits, 0);
    const sumPrs     = sorted.reduce((s, p) => s + p.estimated_prs,     0);
    const sumJiras   = sorted.reduce((s, p) => s + p.jira_count,         0);
    const o = {
      commits: Math.max(0, actualTotals.commits - sumCommits),
      prs:     Math.max(0, actualTotals.prs     - sumPrs),
      jiras:   Math.max(0, actualTotals.jiras   - sumJiras),
    };
    return (o.commits + o.prs + o.jiras) > 0 ? o : null;
  }, [sorted, actualTotals, otherTotals]);

  // Bar width = total volume (PRs + Jiras + Commits) / max across all projects.
  // Commits are intentionally included here even though they are excluded from the
  // sort key — the bar shows the full activity footprint of each project (sort rank
  // reflects quality output, bar width reflects overall size).
  // If "Other" is present, include it in maxVolume so bars are comparable.
  const maxVolume = useMemo(() => {
    const projectMax = sorted.reduce((max, p) => Math.max(max, p.estimated_prs + p.jira_count + p.estimated_commits), 1);
    const otherTotal = other ? other.commits + other.prs + other.jiras : 0;
    return Math.max(projectMax, otherTotal, 1);
  }, [sorted, other]);

  // Hide Jira legend entry when Jira is disabled (all counts are 0).
  const hasJira = useMemo(() => sorted.some(p => p.jira_count > 0) || (other?.jiras ?? 0) > 0, [sorted, other]);

  // Early returns after all hooks (Rules of Hooks: hooks must not be conditional).
  if (loading) {
    return (
      <div className={`flex items-center gap-2 text-gray-500 text-sm ${variant === 'collapsible' ? 'py-6 justify-center' : 'mt-3'}`}>
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Analyzing projects…
      </div>
    );
  }
  if (projects.length === 0) {
    return <p className={`text-sm text-gray-500 ${variant === 'collapsible' ? 'py-4' : 'mt-2'}`}>{emptyMessage}</p>;
  }

  return (
    <div className={`space-y-3 ${variant === 'collapsible' ? 'mt-3' : 'mt-4'}`}>
      {/* Legend */}
      <div className="flex gap-3 text-[10px] text-gray-600 pl-6">
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block w-2 h-2 rounded-[2px]" style={{ background: SEGMENT_COLORS.prs }} />PRs
        </span>
        {hasJira && (
          <span className="flex items-center gap-1">
            <span aria-hidden="true" className="inline-block w-2 h-2 rounded-[2px]" style={{ background: SEGMENT_COLORS.jiras }} />Jiras
          </span>
        )}
        <span className="flex items-center gap-1">
          <span aria-hidden="true" className="inline-block w-2 h-2 rounded-[2px]" style={{ background: 'rgba(255,255,255,0.18)' }} />Commits
        </span>
      </div>

      {sorted.map((rawP, i) => {
        const p = rawP as ProjectsCardItem;
        const ago = timeAgo((rawP as TeamProject).last_activity);
        const totalVol = p.estimated_prs + p.jira_count + p.estimated_commits;
        const barPct = (totalVol / maxVolume) * 100;
        const isExpanded = expandedIdx === i;
        const hasDetail = !!(p.jira_details?.length || p.prs?.length || p.commits?.length);
        return (
          <div key={`${p.name}-${i}`}>
            {/* Project row */}
            <div
              className={`bg-white/[0.02] rounded-lg p-3 ${isExpanded ? 'rounded-b-none' : ''} ${hasDetail ? 'cursor-pointer hover:bg-white/[0.035] transition-colors' : ''}`}
              onClick={() => {
                if (!hasDetail) return;
                if (isExpanded) { setExpandedIdx(null); } else {
                  setExpandedIdx(i);
                  // Default to first non-empty tab so users don't land on a blank panel
                  const firstTab = (p as ProjectsCardItem).jira_details?.length ? 'jiras'
                    : (p as ProjectsCardItem).prs?.length ? 'prs'
                    : 'commits';
                  setActiveTab(firstTab);
                }
              }}
            >
              <div className="flex items-start justify-between gap-3 mb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-gray-600 w-4 shrink-0 text-right">{i + 1}</span>
                  <span className="text-sm font-semibold text-white">{p.name}</span>
                  {hasDetail && (
                    <span className="text-gray-700 text-[10px] ml-1" style={{ display: 'inline-block', transition: 'transform 0.15s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>▶</span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0 text-[11px] text-gray-500">
                  <span>{p.jira_count} jiras</span>
                  <span>~{p.estimated_commits} commits</span>
                  <span>~{p.estimated_prs} PRs</span>
                  {ago && <span className="text-gray-600">· {ago}</span>}
                </div>
              </div>

              {totalVol > 0 && (
                <div className="pl-6 mb-1.5">
                  <div
                    className="h-[5px] rounded-sm overflow-hidden"
                    style={{ background: 'rgba(255,255,255,0.05)' }}
                    role="img"
                    aria-label={`Volume: ${p.estimated_prs} PRs, ${p.jira_count} Jiras, ${p.estimated_commits} commits`}
                  >
                    <div className="h-full flex" style={{ width: `${barPct}%` }}>
                      <div style={{ flex: p.estimated_prs, background: SEGMENT_COLORS.prs }} />
                      <div style={{ flex: p.jira_count, background: SEGMENT_COLORS.jiras }} />
                      <div style={{ flex: p.estimated_commits, background: SEGMENT_COLORS.commits }} />
                    </div>
                  </div>
                </div>
              )}

              <p className="text-xs text-gray-500 pl-6 mb-1.5">{p.summary}</p>
              <div className="flex gap-1 pl-6 flex-wrap">
                {p.developers.map(d =>
                  developerHref ? (
                    <a key={d} href={developerHref(d)} className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity" style={{ color: 'var(--accent-dark)', backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>@{d}</a>
                  ) : (
                    <span key={d} className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--accent-dark)', backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>@{d}</span>
                  ),
                )}
              </div>
            </div>

            {/* Inline expand panel */}
            {isExpanded && hasDetail && (
              <div className="bg-white/[0.015] rounded-b-lg border-t border-white/[0.04] px-4 pb-4 pt-3 mb-0">
                {/* Tabs */}
                <div className="flex gap-0 mb-3 border-b border-white/[0.07]">
                  {(['jiras', 'prs', 'commits'] as const).map(tab => {
                    const count = tab === 'jiras' ? (p.jira_details?.length ?? 0) : tab === 'prs' ? (p.prs?.length ?? 0) : (p.commits?.length ?? 0);
                    if (count === 0) return null;
                    return (
                      <button
                        key={tab}
                        onClick={e => { e.stopPropagation(); setActiveTab(tab); }}
                        className={`text-[10px] px-3 pb-2 pt-1 border-b-2 -mb-px transition-colors capitalize ${activeTab === tab ? 'text-white border-accent' : 'text-gray-500 border-transparent hover:text-gray-300'}`}
                      >
                        {tab === 'jiras' ? 'Jiras' : tab === 'prs' ? 'PRs' : 'Commits'} ({count})
                      </button>
                    );
                  })}
                </div>

                {/* Jiras tab — grouped by epic */}
                {activeTab === 'jiras' && (
                  <div className="space-y-3">
                    {(p.groups?.length ? p.groups : [{ name: '', jira_details: p.jira_details ?? [] }]).map((g: ProjectGroup, gi: number) => (
                      <div key={gi}>
                        {g.name && <p className="text-[9px] font-bold uppercase tracking-wider text-gray-600 mb-1.5">{g.name}</p>}
                        <div>
                          {g.jira_details.slice(0, 8).map((j: JiraDetail) => (
                            <div key={j.key} className="flex items-center gap-2 py-1.5 border-b border-white/[0.03] last:border-0">
                              <span className="font-mono text-accent text-[9.5px] w-20 shrink-0">{j.key}</span>
                              <span className="text-gray-400 text-[10.5px] flex-1 truncate">{j.summary}</span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {j.assignee && <span className="text-[9px] text-gray-600">@{j.assignee.slice(0, 10)}</span>}
                                {(j.linked_commits ?? 0) > 0 && (
                                  <span className="text-[9px] font-mono bg-cyan-500/10 text-cyan-400 rounded px-1.5 py-0.5">
                                    {j.linked_commits}c{(j.linked_prs ?? 0) > 0 ? ` ${j.linked_prs}pr` : ''}
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                          {g.jira_details.length > 8 && <p className="text-[9px] text-gray-700 pt-1 pl-1">+ {g.jira_details.length - 8} more</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* PRs tab */}
                {activeTab === 'prs' && (
                  <div>
                    {(p.prs ?? []).slice(0, 12).map((pr: PrDetail) => (
                      <div key={pr.pr} className="flex items-center gap-2 py-1.5 border-b border-white/[0.03] last:border-0">
                        <span className="font-mono text-cyan-400 text-[9.5px] w-10 shrink-0">#{pr.pr}</span>
                        <span className="text-gray-400 text-[10.5px] flex-1 truncate">{pr.msg}</span>
                        <div className="flex items-center gap-1.5 shrink-0 text-[9px]">
                          <span className="text-gray-600">{pr.repo.split('/').pop()?.slice(0, 14)}</span>
                          <span className="text-gray-600">{pr.commits}c</span>
                          <span className="text-green-500/80">+{pr.added}</span>
                          <span className="text-red-500/80">-{pr.removed}</span>
                        </div>
                      </div>
                    ))}
                    {(p.prs ?? []).length > 12 && <p className="text-[9px] text-gray-700 pt-1">+ {(p.prs ?? []).length - 12} more PRs</p>}
                  </div>
                )}

                {/* Commits tab */}
                {activeTab === 'commits' && (
                  <div>
                    {(p.commits ?? []).slice(0, 12).map((c: CommitDetail) => (
                      <div key={c.sha} className="flex items-center gap-2 py-1.5 border-b border-white/[0.03] last:border-0">
                        <span className="font-mono text-cyan-400 text-[9.5px] w-12 shrink-0">{c.sha}</span>
                        {c.pr && <span className="text-cyan-400/60 text-[9px] shrink-0">#{c.pr}</span>}
                        <span className="text-gray-400 text-[10.5px] flex-1 truncate">{c.msg}</span>
                        <div className="flex items-center gap-1.5 shrink-0 text-[9px]">
                          <span className="text-gray-600">{c.repo.split('/').pop()?.slice(0, 14)}</span>
                          <span className="text-green-500/80">+{c.added}</span>
                          <span className="text-red-500/80">-{c.removed}</span>
                        </div>
                      </div>
                    ))}
                    {(p.commits ?? []).length > 12 && <p className="text-[9px] text-gray-700 pt-1">+ {(p.commits ?? []).length - 12} more commits</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* "Other" row — same visual style as a project, italic label, no summary/devs */}
      {other && (() => {
        const otherTotal = other.commits + other.prs + other.jiras;
        const otherBarPct = (otherTotal / maxVolume) * 100;
        return (
          <div
            className="rounded-lg p-3"
            style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-gray-700 w-4 shrink-0 text-right">~</span>
                <span className="text-sm text-gray-500 italic">Other (not in top {sorted.length})</span>
              </div>
              <div className="flex items-center gap-3 shrink-0 text-[11px] text-gray-600">
                <span>~{other.jiras} jiras</span>
                <span>~{other.commits} commits</span>
                <span>~{other.prs} PRs</span>
              </div>
            </div>
            {otherTotal > 0 && (
              <div className="pl-6 mb-1.5">
                <div
                  className="h-[5px] rounded-sm overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.05)' }}
                  role="img"
                  aria-label={`Other: ${other.prs} PRs, ${other.jiras} Jiras, ${other.commits} commits not attributed to a named project`}
                >
                  <div className="h-full flex" style={{ width: `${otherBarPct}%` }}>
                    <div style={{ flex: other.prs,     background: SEGMENT_COLORS.prs }} />
                    <div style={{ flex: other.jiras,   background: SEGMENT_COLORS.jiras }} />
                    <div style={{ flex: other.commits, background: SEGMENT_COLORS.commits }} />
                  </div>
                </div>
              </div>
            )}
            <div className="text-[10px] text-gray-700 pl-6">Approximate remainder — actual totals minus LLM cluster estimates</div>
          </div>
        );
      })()}
    </div>
  );
}

export default function ProjectsCard({
  projects,
  loading,
  title = 'Top Projects',
  subtitle,
  emptyMessage = 'No active projects in this window.',
  developerHref,
  actualTotals,
  otherTotals,
  collapsible = false,
  expanded = true,
  onExpandedChange,
}: ProjectsCardProps) {
  // Collapsible mode — styled to match <TeamPulseCard>: chevron on the left,
  // compact header height, gray-900 fill, body separated by a top border.
  if (collapsible) {
    return (
      <div className="bg-gray-900 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => onExpandedChange?.(!expanded)}
          className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-800/30 transition-colors"
        >
          <div className="flex items-center gap-3">
            <svg
              className={`w-3.5 h-3.5 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="text-sm font-semibold text-white">
              {title}{subtitle ? `: ${subtitle}` : ''}
            </span>
            {expanded && loading && <span className="text-xs text-gray-500 animate-pulse">Generating…</span>}
          </div>
          {expanded && !loading && projects.length > 0 && (
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span>{projects.length} project{projects.length === 1 ? '' : 's'}</span>
            </div>
          )}
        </button>
        {expanded && (
          <div className="px-5 pb-4 border-t border-gray-800">
            <ProjectsBody
              projects={projects}
              loading={loading}
              emptyMessage={emptyMessage}
              developerHref={developerHref}
              variant="collapsible"
              actualTotals={actualTotals}
              otherTotals={otherTotals}
            />
          </div>
        )}
      </div>
    );
  }

  // Standalone mode (home page) — unchanged styling
  return (
    <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏗️</span>
          <span className="text-xs font-bold tracking-widest uppercase text-white/40">
            {title}{subtitle ? ` · ${subtitle}` : ''}
          </span>
        </div>
      </div>
      <ProjectsBody
        projects={projects}
        loading={loading}
        emptyMessage={emptyMessage}
        developerHref={developerHref}
        variant="standalone"
        actualTotals={actualTotals}
        otherTotals={otherTotals}
      />
    </div>
  );
}
