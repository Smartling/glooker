'use client';

import { useState, type CSSProperties } from 'react';
import type { useRouter } from 'next/navigation';
import type { RunMetadata } from '@/lib/report-runner/types';

export interface Developer {
  github_login: string; github_name: string; avatar_url: string;
  total_prs: number; total_commits: number; lines_added: number; lines_removed: number;
  avg_complexity: number; impact_score: number; pr_percentage: number; ai_percentage: number;
  type_breakdown: Record<string, number>; active_repos: string[];
  total_jira_issues?: number;
  cc_total_cost?: number;
  cc_requests?: number;
}

export interface ReportMeta {
  id: string; org: string; period_days: number; status: string;
  created_at: string; completed_at: string | null;
  cc_period_start?: string | null;
  cc_period_end?: string | null;
  run_metadata?: RunMetadata | null;
}

export interface SpendWindow {
  periodStart: string;
  periodEnd: string;
  firstCoveredDate: string | null;
  perDev: Record<string, { commits: number; prs: number; lines_added: number; lines_removed: number }>;
}

// ============================================================================
// Spend Tab
// ============================================================================

function formatDollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

// Positions a hover tooltip along a horizontal bar given the hovered segment's
// center as a % of the bar's width. Centering (translateX(-50%)) works for
// interior segments, but would push the tooltip off-page for segments near
// either edge, so those anchor flush to the wrapper's edge instead.
function mixTooltipStyle(centerPct: number): CSSProperties {
  if (centerPct <= 12) return { left: 0 };
  if (centerPct >= 88) return { right: 0 };
  return { left: `${centerPct}%`, transform: 'translateX(-50%)' };
}

function computeSpendMetrics(devs: Developer[]) {
  // Absent cost (stripped for this viewer) and $0 cost both fail `> 0`, so the
  // leaderboard filter already excludes hidden developers — metrics are computed
  // only over developers whose spend this viewer can actually see.
  const withSpend = devs
    .filter(d => Number(d.cc_total_cost ?? 0) > 0)
    .sort((a, b) => Number(b.cc_total_cost ?? 0) - Number(a.cc_total_cost ?? 0));

  const total = withSpend.reduce((s, d) => s + Number(d.cc_total_cost ?? 0), 0);
  const avg = withSpend.length > 0 ? total / withSpend.length : 0;
  const sorted = withSpend.map(d => Number(d.cc_total_cost ?? 0)).sort((a, b) => a - b);
  const median = sorted.length > 0
    ? sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)]
    : 0;

  const top20Count = Math.max(1, Math.ceil(withSpend.length * 0.2));
  const top20Spend = withSpend.slice(0, top20Count).reduce((s, d) => s + Number(d.cc_total_cost ?? 0), 0);
  const top20Pct = total > 0 ? Math.round((top20Spend / total) * 100) : 0;

  const cpiValues = withSpend
    .filter(d => Number(d.impact_score) > 0)
    .map(d => Number(d.cc_total_cost ?? 0) / Number(d.impact_score));
  const medianCPI = cpiValues.length > 0
    ? [...cpiValues].sort((a, b) => a - b)[Math.floor(cpiValues.length / 2)]
    : 0;

  return { withSpend, total, avg, median, top20Count, top20Spend, top20Pct, medianCPI };
}

export interface ModelUsageRow { github_login: string; model: string; cost?: number; requests?: number }
export interface ModelMixRow {
  model: string; cost: number; requests: number; devs: number; pct: number; costPerRequest: number;
}

/**
 * Aggregate per-(login, model) rows into an org/team model mix.
 *
 * Scope coherence: only rows whose `cost` survived per-login stripping are
 * counted. The route keeps a row's `model` while deleting `cost`/`requests` for
 * developers the viewer may not see, so counting every row would mix scopes —
 * org-wide model names and developer counts beside team-only cost.
 */
export function computeModelMix(rows: ModelUsageRow[]): { rows: ModelMixRow[]; total: number } {
  const visible = rows.filter(r => r.cost != null);

  const byModel = new Map<string, { cost: number; requests: number; devs: Set<string> }>();
  for (const r of visible) {
    const entry = byModel.get(r.model) ?? { cost: 0, requests: 0, devs: new Set<string>() };
    entry.cost += Number(r.cost) || 0;
    entry.requests += Number(r.requests) || 0;
    entry.devs.add(r.github_login);
    byModel.set(r.model, entry);
  }

  const total = [...byModel.values()].reduce((s, e) => s + e.cost, 0);
  const out: ModelMixRow[] = [...byModel.entries()]
    .map(([model, e]) => ({
      model,
      cost: e.cost,
      requests: e.requests,
      devs: e.devs.size,
      pct: total > 0 ? (e.cost / total) * 100 : 0,
      costPerRequest: e.requests > 0 ? e.cost / e.requests : 0,
    }))
    .sort((a, b) => b.cost - a.cost || a.model.localeCompare(b.model));

  return { rows: out, total };
}

function formatDateRange(startIso: string, endIso: string): { label: string; days: number } {
  const s = new Date(startIso + 'T00:00:00');
  const e = new Date(endIso + 'T00:00:00');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = sameYear && s.getMonth() === e.getMonth();
  const left = s.toLocaleDateString('en-US', opts);
  const right = e.toLocaleDateString('en-US', { ...opts, ...(sameYear ? {} : { year: 'numeric' }) });
  const days = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
  return { label: sameMonth ? `${left} – ${e.getDate()}, ${e.getFullYear()}` : `${left} – ${right}${sameYear ? `, ${e.getFullYear()}` : ''}`, days };
}

export function SpendTab({ developers, reportId, router, report, spendWindow, modelUsage, skillsUsage }: {
  developers: Developer[];
  reportId: string;
  router: ReturnType<typeof useRouter>;
  report: ReportMeta | null;
  spendWindow: SpendWindow | null;
  modelUsage: ModelUsageRow[];
  skillsUsage: Array<{ github_login: string; product: string; skills_used: number; skills_distinct: number }>;
}) {
  const [showCount, setShowCount] = useState<10 | 20 | 'all'>(10);
  const [modelMixTooltip, setModelMixTooltip] = useState<{ label: string; cost: number; pct: number; left: number } | null>(null);

  const { withSpend, total, avg, median, top20Count, top20Spend, top20Pct, medianCPI } = computeSpendMetrics(developers);
  const bottom80Pct = 100 - top20Pct;
  const fullCostVisibility = developers.length > 0 && developers.every(d => d.cc_total_cost != null);
  const partialScopeNote = 'Cost shown for developers on your team(s) only — org-wide totals require admin access.';
  // Under partial visibility, org-scoped aggregates would silently describe only
  // the viewer's own team. Relabel the summable ones and suppress the
  // concentration stats (a Pareto over a permission-filtered subset is meaningless).
  const spendLabel = fullCostVisibility ? 'Total Org Spend' : 'Visible Spend';

  const { rows: modelMix, total: modelTotal } = computeModelMix(modelUsage);
  const modelMixLabel = fullCostVisibility ? 'Model Mix' : "Your teams' model mix";
  const skillsInvocations = skillsUsage.reduce((s, r) => s + r.skills_used, 0);
  const skillsDevs = new Set(skillsUsage.map(r => r.github_login)).size;
  const skillsByProduct = [...skillsUsage.reduce((m, r) => m.set(r.product, (m.get(r.product) ?? 0) + r.skills_used), new Map<string, number>())]
    .map(([product, used]) => `${product} ${used}`)
    .join(', ');
  const SHARE_COLORS = ['bg-accent', 'bg-accent-light', 'bg-accent-dark', 'bg-gray-600', 'bg-gray-700'];
  // The bar shows only the top models by cost, following the Pareto pattern —
  // the remainder collapses into a single neutral "Other" segment so the bar
  // stays readable when a report carries many distinct models (real reports
  // see ~9). The table below is unaffected and keeps every model individually.
  const MODEL_BAR_TOP_N = 5;
  const topModelMix = modelMix.slice(0, MODEL_BAR_TOP_N);
  const otherModelMix = modelMix.slice(MODEL_BAR_TOP_N);
  const otherModelCost = otherModelMix.reduce((s, m) => s + m.cost, 0);
  const otherModelPct = modelTotal > 0 ? (otherModelCost / modelTotal) * 100 : 0;
  const OTHER_MODEL_COLOR = 'bg-gray-500';
  let modelMixCumulative = 0;

  const isOutlier = (d: Developer) => {
    const cost = Number(d.cc_total_cost ?? 0);
    const impact = Number(d.impact_score) || 0;
    return cost > 0 && impact > 0 && medianCPI > 0 && (cost / impact) > 2 * medianCPI;
  };

  const displayCount = showCount === 'all' ? withSpend.length : showCount;
  const visibleDevs = withSpend.slice(0, displayCount);
  const hiddenDevs = withSpend.slice(displayCount);
  const hiddenTotal = hiddenDevs.reduce((s, d) => s + Number(d.cc_total_cost ?? 0), 0);

  let cumulative = 0;

  const maxImpact = Math.max(...withSpend.map(d => Number(d.impact_score) || 0), 1);
  const maxCost = Math.max(...withSpend.map(d => Number(d.cc_total_cost ?? 0)), 1);
  const impactSorted = withSpend.map(d => Number(d.impact_score) || 0).sort((a, b) => a - b);
  const medianImpact = impactSorted.length > 0
    ? impactSorted.length % 2 === 0
      ? (impactSorted[impactSorted.length / 2 - 1] + impactSorted[impactSorted.length / 2]) / 2
      : impactSorted[Math.floor(impactSorted.length / 2)]
    : 0;
  const medianCost = median;

  // Window header / coverage
  const windowInfo = spendWindow ? formatDateRange(spendWindow.periodStart, spendWindow.periodEnd) : null;
  const reportPeriodDays = report?.period_days ?? 0;
  const windowDiffers = !!(windowInfo && reportPeriodDays && windowInfo.days !== reportPeriodDays);
  const partialCoverage = !!(spendWindow && spendWindow.firstCoveredDate && spendWindow.firstCoveredDate > spendWindow.periodStart);
  const partialDays = partialCoverage && spendWindow && windowInfo
    ? Math.max(0, Math.round((new Date(spendWindow.periodEnd).getTime() - new Date(spendWindow.firstCoveredDate!).getTime()) / 86400000) + 1)
    : 0;

  return (
    <div className="space-y-6">
      {/* Window header */}
      {windowInfo && (
        <div className="bg-gray-900 rounded-xl p-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] text-gray-600 uppercase tracking-wider">Spend Period</p>
            <p className="text-base font-bold text-white mt-0.5">{windowInfo.label} <span className="text-gray-500 font-normal">· {windowInfo.days} days</span></p>
          </div>
          <div className="flex flex-col items-end gap-1 text-[11px] text-right">
            {windowDiffers && (
              <span className="text-amber-400">
                Report window is {reportPeriodDays} days — comparisons below use the spend window ({windowInfo.days} days).
              </span>
            )}
            {partialCoverage && spendWindow?.firstCoveredDate && (
              <span className="text-amber-400">
                Partial coverage: commit data available from {spendWindow.firstCoveredDate} ({partialDays} of {windowInfo.days} days).
              </span>
            )}
            {!fullCostVisibility && (
              <span className="text-amber-400">{partialScopeNote}</span>
            )}
          </div>
        </div>
      )}
      {!windowInfo && !fullCostVisibility && (
        <p className="text-[11px] text-amber-400">{partialScopeNote}</p>
      )}

      {/* Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-900 rounded-xl p-4 flex flex-col">
          <p className="text-xs text-gray-500 uppercase tracking-wider">{spendLabel}</p>
          <p className="text-lg font-bold text-green-400 mt-1">{formatDollars(total)}</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 flex flex-col">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Avg / Developer</p>
          <p className="text-lg font-bold text-green-400 mt-1">{formatDollars(avg)}</p>
        </div>
        <div className="bg-gray-900 rounded-xl p-4 flex flex-col">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Median</p>
          <p className="text-lg font-bold text-green-400 mt-1">{formatDollars(median)}</p>
        </div>
        {fullCostVisibility && (
          <div className="bg-gray-900 rounded-xl p-4 flex flex-col">
            <p className="text-xs text-gray-500 uppercase tracking-wider">Top 20% Share</p>
            <p className="text-lg font-bold text-amber-400 mt-1">{top20Pct}%</p>
          </div>
        )}
      </div>

      {/* Pareto Concentration Bar — org-wide concentration has no valid reading
          over a permission-filtered subset, so it's shown only under full visibility. */}
      {fullCostVisibility && (
      <div className="bg-gray-900 rounded-xl p-5">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Spend Concentration</p>
        <div className="h-6 bg-gray-800 rounded-full overflow-hidden flex">
          <div className="h-full bg-amber-500 flex items-center justify-center text-xs font-bold text-gray-900 transition-all" style={{ width: `${top20Pct}%` }}>
            {top20Pct > 8 && `Top 20% — ${top20Pct}%`}
          </div>
          <div className="h-full bg-gray-600 flex items-center justify-center text-xs font-medium text-gray-300 transition-all" style={{ width: `${bottom80Pct}%` }}>
            {bottom80Pct > 15 && `Bottom 80% — ${bottom80Pct}%`}
          </div>
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <span>{top20Count} developer{top20Count !== 1 ? 's' : ''} ({formatDollars(top20Spend)})</span>
          <span>{withSpend.length - top20Count} developer{withSpend.length - top20Count !== 1 ? 's' : ''} ({formatDollars(total - top20Spend)})</span>
        </div>
      </div>
      )}

      {/* Model Mix — composition of visible spend by model. Unlike the Pareto
          concentration stat above, a composition share stays meaningful on a
          permission-filtered subset, so the % and bar are kept under partial
          visibility and the label carries the scope instead. */}
      {modelMix.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">{modelMixLabel}</p>
          </div>

          <div className="relative mb-4">
            <div className="h-6 bg-gray-800 rounded-full overflow-hidden flex">
              {topModelMix.map((m, i) => {
                const center = modelMixCumulative + m.pct / 2;
                modelMixCumulative += m.pct;
                return (
                  <div key={m.model}
                    className={`h-full flex items-center justify-center text-xs font-bold text-gray-900 cursor-default ${SHARE_COLORS[i]}`}
                    style={{ width: `${m.pct}%` }}
                    onMouseEnter={() => setModelMixTooltip({ label: m.model, cost: m.cost, pct: m.pct, left: center })}
                    onMouseLeave={() => setModelMixTooltip(null)}>
                    {m.pct > 12 && `${Math.round(m.pct)}%`}
                  </div>
                );
              })}
              {otherModelMix.length > 0 && (
                <div
                  className={`h-full flex items-center justify-center text-xs font-bold text-gray-900 cursor-default ${OTHER_MODEL_COLOR}`}
                  style={{ width: `${otherModelPct}%` }}
                  onMouseEnter={() => setModelMixTooltip({
                    label: 'Other (remaining models)',
                    cost: otherModelCost,
                    pct: otherModelPct,
                    left: modelMixCumulative + otherModelPct / 2,
                  })}
                  onMouseLeave={() => setModelMixTooltip(null)}>
                  {otherModelPct > 12 && `Other — ${Math.round(otherModelPct)}%`}
                </div>
              )}
            </div>
            {modelMixTooltip && (
              <div
                className="absolute z-10 bottom-full mb-2 bg-gray-800 border border-gray-700 rounded px-2 py-1 whitespace-nowrap text-xs pointer-events-none"
                style={mixTooltipStyle(modelMixTooltip.left)}
              >
                <span className="text-white font-medium">{modelMixTooltip.label}</span>
                <span className="text-gray-400 ml-2">{formatDollars(modelMixTooltip.cost)}</span>
                <span className="text-gray-500 ml-1">· {Math.round(modelMixTooltip.pct)}%</span>
              </div>
            )}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="px-4 py-3">Model</th>
                <th className="px-4 py-3 text-right">Spend</th>
                <th className="px-4 py-3 text-right">%</th>
                <th className="px-4 py-3 text-right">Requests</th>
                <th className="px-4 py-3 text-right">$/Request</th>
                <th className="px-4 py-3 text-right">Devs</th>
              </tr>
            </thead>
            <tbody>
              {modelMix.map(m => (
                <tr key={m.model} className="border-b border-gray-800/50">
                  <td className="px-4 py-3 text-gray-300">{m.model}</td>
                  <td className="px-4 py-3 text-right text-green-400 font-mono">{formatDollars(m.cost)}</td>
                  <td className="px-4 py-3 text-right text-gray-400 tabular-nums">{Math.round(m.pct)}%</td>
                  <td className="px-4 py-3 text-right text-gray-400 tabular-nums">{m.requests.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right text-gray-400 font-mono">${(m.costPerRequest / 100).toFixed(3)}</td>
                  <td className="px-4 py-3 text-right text-gray-400 tabular-nums">{m.devs}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {skillsUsage.length > 0 && (
            <p className="text-xs text-gray-500 mt-4">
              Skills: {skillsInvocations} invocations by {skillsDevs} developer{skillsDevs === 1 ? '' : 's'}
              {skillsByProduct ? ` (${skillsByProduct})` : ''}
            </p>
          )}
        </div>
      )}

      {/* Top Spenders Table */}
      <div className="bg-gray-900 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold">
            Top Spenders ({withSpend.length})
          </p>
          <div className="flex gap-1">
            {([10, 20, 'all'] as const).map(n => (
              <button
                key={String(n)}
                onClick={() => setShowCount(n)}
                className={`px-2.5 py-1 text-xs rounded ${showCount === n ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {n === 'all' ? 'All' : `Top ${n}`}
              </button>
            ))}
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-4 py-3 w-8">#</th>
              <th className="px-4 py-3">Developer</th>
              <th className="px-4 py-3 text-right">Spend</th>
              <th className="px-4 py-3 text-right">% of Total</th>
              <th className="px-4 py-3 text-right">Cumulative %</th>
              <th className="px-4 py-3 text-right">Requests</th>
              <th className="px-4 py-3 text-right">$/Request</th>
              {spendWindow && <th className="px-4 py-3 text-right" title="Commits by this developer within the spend window (deduped across all reports for this org)">Commits (window)</th>}
              {spendWindow && <th className="px-4 py-3 text-right" title="Distinct PRs authored in the spend window">PRs (window)</th>}
              {spendWindow && <th className="px-4 py-3 text-right" title="Total spend divided by commits in the spend window">$/Commit</th>}
              <th className="px-4 py-3 text-right">Impact</th>
            </tr>
          </thead>
          <tbody>
            {visibleDevs.map((dev, i) => {
              const cost = Number(dev.cc_total_cost ?? 0);
              const pctOfTotal = total > 0 ? (cost / total) * 100 : 0;
              cumulative += pctOfTotal;
              const requests = Number(dev.cc_requests ?? 0);
              const perRequest = requests > 0 ? cost / requests : 0;
              const impact = Number(dev.impact_score) || 0;
              const outlier = isOutlier(dev);
              const win = spendWindow?.perDev[dev.github_login];
              const winCommits = win?.commits ?? 0;
              const winPrs = win?.prs ?? 0;
              const perCommit = winCommits > 0 ? cost / winCommits : 0;

              return (
                <tr
                  key={dev.github_login}
                  className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors cursor-pointer"
                  onClick={() => router.push(`/report/${reportId}/dev/${dev.github_login}`)}
                >
                  <td className="px-4 py-3 text-gray-600 text-xs">{i + 1}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {dev.avatar_url && <img src={dev.avatar_url} alt="" className="w-6 h-6 rounded-full shrink-0" />}
                      <span className="text-white font-medium truncate">@{dev.github_login}</span>
                      {outlier && (
                        <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-red-500/20 text-red-400 rounded">
                          high $/impact
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-green-400">{formatDollars(cost)}</td>
                  <td className="px-4 py-3 text-right text-gray-300">{pctOfTotal.toFixed(1)}%</td>
                  <td className="px-4 py-3 text-right text-gray-300">{cumulative.toFixed(1)}%</td>
                  <td className="px-4 py-3 text-right text-gray-300">{requests > 0 ? requests.toLocaleString() : <span className="text-gray-600">&mdash;</span>}</td>
                  <td className="px-4 py-3 text-right font-mono text-gray-300">{requests > 0 ? formatDollars(perRequest) : <span className="text-gray-600">&mdash;</span>}</td>
                  {spendWindow && (
                    <td className="px-4 py-3 text-right text-gray-300">{winCommits > 0 ? winCommits.toLocaleString() : <span className="text-gray-600">&mdash;</span>}</td>
                  )}
                  {spendWindow && (
                    <td className="px-4 py-3 text-right text-gray-300">{winPrs > 0 ? winPrs : <span className="text-gray-600">&mdash;</span>}</td>
                  )}
                  {spendWindow && (
                    <td className="px-4 py-3 text-right font-mono text-gray-300">{winCommits > 0 ? formatDollars(perCommit) : <span className="text-gray-600">&mdash;</span>}</td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold text-white ${impact >= 7 ? 'bg-accent-light' : impact >= 4 ? 'bg-accent-dark' : 'bg-gray-700'}`}>
                      {impact.toFixed(1)}
                    </span>
                  </td>
                </tr>
              );
            })}
            {hiddenDevs.length > 0 && (
              <tr className="border-b border-gray-800/50 bg-gray-800/20">
                <td colSpan={spendWindow ? 11 : 8} className="px-4 py-3 text-center text-xs text-gray-500">
                  +{hiddenDevs.length} more developer{hiddenDevs.length !== 1 ? 's' : ''} ({formatDollars(hiddenTotal)})
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Spend vs Impact Scatter Plot */}
      <div className="bg-gray-900 rounded-xl p-5">
        <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-4">Spend vs Impact</p>
        <div className="relative w-full" style={{ height: 320 }}>
          <div className="absolute top-2 left-4 text-[10px] text-gray-600">High Spend / Low Impact</div>
          <div className="absolute top-2 right-4 text-[10px] text-gray-600">High Spend / High Impact</div>
          <div className="absolute bottom-8 left-4 text-[10px] text-gray-600">Low Spend / Low Impact</div>
          <div className="absolute bottom-8 right-4 text-[10px] text-gray-600">Low Spend / High Impact</div>

          <div className="absolute bg-gray-700" style={{ left: `${(medianImpact / maxImpact) * 100}%`, top: 0, width: 1, height: '100%', opacity: 0.4 }} />
          <div className="absolute bg-gray-700" style={{ top: `${100 - (medianCost / maxCost) * 100}%`, left: 0, width: '100%', height: 1, opacity: 0.4 }} />

          {withSpend.map(dev => {
            const cost = Number(dev.cc_total_cost ?? 0);
            const impact = Number(dev.impact_score) || 0;
            const x = (impact / maxImpact) * 92 + 4;
            const y = 100 - ((cost / maxCost) * 88 + 6);
            const outlier = isOutlier(dev);
            return (
              <div
                key={dev.github_login}
                className="absolute group cursor-pointer"
                style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
                onClick={() => router.push(`/report/${reportId}/dev/${dev.github_login}`)}
              >
                <div className={`w-3 h-3 rounded-full ${outlier ? 'bg-red-400' : 'bg-blue-400'} opacity-80 hover:opacity-100 transition-opacity`} />
                <div className="hidden group-hover:block absolute z-10 bottom-5 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 rounded px-2 py-1 whitespace-nowrap text-xs">
                  <span className="text-white font-medium">@{dev.github_login}</span>
                  <span className="text-gray-400 ml-2">{formatDollars(cost)}</span>
                  <span className="text-gray-500 ml-1">/ {impact.toFixed(1)} impact</span>
                </div>
              </div>
            );
          })}

          <div className="absolute bottom-0 left-0 right-0 text-center text-[10px] text-gray-500">Impact Score &rarr;</div>
          <div className="absolute top-0 left-0 bottom-0 flex items-center">
            <span className="text-[10px] text-gray-500 -rotate-90 whitespace-nowrap">Spend &rarr;</span>
          </div>
        </div>
      </div>
    </div>
  );
}
