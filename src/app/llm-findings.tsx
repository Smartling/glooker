'use client';

import { useState, useEffect } from 'react';

interface Highlight {
  icon: string;
  text: string;
  sentiment: 'positive' | 'neutral' | 'warning';
}

interface ProjectInsight {
  name: string;
  developers: string[];
  summary: string;
  jira_count: number;
  estimated_commits: number;
  estimated_prs: number;
}

interface UntrackedWork {
  name: string;
  repo: string;
  developers: string[];
  commits: number;
  summary: string;
}

export default function LlmFindings() {
  const [highlights, setHighlights] = useState<Highlight[] | null>(null);
  const [highlightsLoading, setHighlightsLoading] = useState(true);
  const [highlightsMeta, setHighlightsMeta] = useState<{ org: string; periodDays: number; dateA: string; dateB: string } | null>(null);

  // Project insights
  const [projects, setProjects] = useState<ProjectInsight[]>([]);
  const [untrackedWork, setUntrackedWork] = useState<UntrackedWork[]>([]);
  const [projectsMeta, setProjectsMeta] = useState<{ id: string; org: string; periodDays: number; createdAt: string } | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);

  // Release notes
  const [releaseNotes, setReleaseNotes] = useState<string | null>(null);
  const [releaseNotesCount, setReleaseNotesCount] = useState(0);
  const [releaseNotesDismissed, setReleaseNotesDismissed] = useState(false);
  const [releaseNotesSha, setReleaseNotesSha] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/report-highlights')
      .then(async r => {
        const text = await r.text();
        try { return JSON.parse(text); } catch { return { available: false }; }
      })
      .then(data => {
        if (data.available && data.highlights?.length > 0) {
          setHighlights(data.highlights);
          setHighlightsMeta({
            org: data.org,
            periodDays: data.periodDays,
            dateA: data.reportDateA,
            dateB: data.reportDateB,
          });
        }
      })
      .catch(() => {})
      .finally(() => setHighlightsLoading(false));

    // Release notes
    fetch('/api/release-notes')
      .then(async r => { try { return JSON.parse(await r.text()); } catch { return { available: false }; } })
      .then(data => {
        if (data.available && data.latestSha) {
          setReleaseNotes(data.summary);
          setReleaseNotesCount(data.commitCount || 0);
          setReleaseNotesSha(data.latestSha);
          const dismissed = localStorage.getItem('glooker-release-notes-dismissed');
          if (dismissed === data.latestSha) setReleaseNotesDismissed(true);
        }
      })
      .catch(() => {});

    // Project insights
    fetch('/api/project-insights')
      .then(async r => { try { return JSON.parse(await r.text()); } catch { return { available: false }; } })
      .then(data => {
        if (data.available) {
          setProjects(data.projects || []);
          setUntrackedWork(data.untracked_work || []);
          setProjectsMeta({ id: data.report.id, org: data.report.org, periodDays: data.report.periodDays, createdAt: data.report.createdAt });
        }
      })
      .catch(() => {})
      .finally(() => setProjectsLoading(false));
  }, []);

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const sentimentColor = { positive: 'text-green-400', neutral: 'text-gray-400', warning: 'text-amber-400' };
  const sentimentDot = { positive: 'bg-green-400', neutral: 'bg-gray-500', warning: 'bg-amber-400' };

  return (
    <div className="space-y-6">
      {/* Highlights */}
      {highlightsLoading && (
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">📊</span>
            <span className="text-xs font-bold tracking-widest uppercase text-white/40">Highlights</span>
          </div>
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Comparing latest reports...
          </div>
        </div>
      )}
      {!highlightsLoading && highlights && highlightsMeta && (
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">📊</span>
              <span className="text-xs font-bold tracking-widest uppercase text-white/40">
                {highlightsMeta.org} · {highlightsMeta.periodDays}d · {formatDate(highlightsMeta.dateA)} vs {formatDate(highlightsMeta.dateB)}
              </span>
            </div>
          </div>
          <div className="space-y-2.5">
            {highlights.map((h, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${sentimentDot[h.sentiment] || 'bg-gray-500'}`} />
                <span className="text-lg shrink-0">{h.icon}</span>
                <p className={`text-sm leading-relaxed ${sentimentColor[h.sentiment] || 'text-gray-400'}`}>{h.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Project Insights */}
      {projectsLoading && (
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🏗️</span>
            <span className="text-xs font-bold tracking-widest uppercase text-white/40">Top Projects</span>
          </div>
          <div className="flex items-center gap-2 text-gray-500 text-sm">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Analyzing projects...
          </div>
        </div>
      )}
      {!projectsLoading && projects.length > 0 && projectsMeta && (
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-lg p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">🏗️</span>
              <span className="text-xs font-bold tracking-widest uppercase text-white/40">
                Top Projects · {projectsMeta.org} · {projectsMeta.periodDays}d · {formatDate(projectsMeta.createdAt)}
              </span>
            </div>
          </div>

          {/* Project list */}
          <div className="space-y-3 mb-4">
            {projects.map((p, i) => (
              <div key={i} className="bg-white/[0.02] rounded-lg p-3">
                <div className="flex items-start justify-between gap-3 mb-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-gray-600 w-4 shrink-0 text-right">{i + 1}</span>
                    <span className="text-sm font-semibold text-white">{p.name}</span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 text-[11px] text-gray-500">
                    <span>{p.jira_count} jiras</span>
                    <span>~{p.estimated_commits} commits</span>
                    <span>~{p.estimated_prs} PRs</span>
                  </div>
                </div>
                <p className="text-xs text-gray-500 pl-6 mb-1.5">{p.summary}</p>
                <div className="flex gap-1 pl-6 flex-wrap">
                  {p.developers.map(d => (
                    <a key={d} href={`/report/${projectsMeta.id}/dev/${d}`} className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity" style={{ color: 'var(--accent-dark)', backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>@{d}</a>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Work with no Jiras */}
          {untrackedWork.length > 0 && (
            <div className="border-t border-white/[0.06] pt-3 mt-3">
              <p className="text-[10px] text-white/25 uppercase tracking-widest font-bold mb-2">Top {untrackedWork.length} with no Jiras</p>
              <div className="space-y-2">
                {untrackedWork.map((w, i) => (
                  <div key={i} className="flex items-start gap-3 bg-amber-500/5 border border-amber-500/10 rounded-lg p-2.5">
                    <span className="text-xs text-amber-400/80 font-semibold shrink-0">{w.repo}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-400">{w.summary}</p>
                      <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-600">
                        <span>{w.commits} commits</span>
                        <span>·</span>
                        <span>{w.developers.map((d, di) => (<span key={d}>{di > 0 && ', '}<a href={`/report/${projectsMeta!.id}/dev/${d}`} className="hover:opacity-80 transition-opacity" style={{ color: 'var(--accent-dark)' }}>@{d}</a></span>))}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Release Notes */}
      {releaseNotes && !releaseNotesDismissed && (
        <div className="bg-white/[0.03] border border-white/[0.07] rounded-lg p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🚀</span>
            <span className="text-xs font-bold tracking-widest uppercase text-white/40">What&apos;s New in Glooker</span>
            <span className="text-[10px] text-white/20 ml-auto">{releaseNotesCount} commits in the last 14 days</span>
            <button
              onClick={() => {
                setReleaseNotesDismissed(true);
                if (releaseNotesSha) localStorage.setItem('glooker-release-notes-dismissed', releaseNotesSha);
              }}
              className="text-white/20 hover:text-white/50 transition-colors ml-1"
              title="Dismiss"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="text-sm text-white/60 leading-relaxed whitespace-pre-line">
            {releaseNotes}
          </div>
        </div>
      )}

      {/* How Impact Score Works */}
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">📊</span>
          <span className="text-xs font-bold tracking-widest uppercase text-white/40">How Impact Score Works</span>
        </div>
        <p className="text-sm text-white/50 mb-4 leading-relaxed">
          Each developer&apos;s impact score (0–9.6) is a weighted blend of four signals, designed to reward
          complex, high-quality contributions over raw volume alone.
        </p>

        {/* Formula */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 mb-5 font-mono text-sm text-center">
          <span className="text-amber-300 font-bold">Impact</span>
          <span className="text-white/25 mx-2">=</span>
          <span className="text-purple-400">Complexity</span>
          <span className="text-white/25 mx-1">+</span>
          <span className="text-emerald-400">PRs</span>
          <span className="text-white/25 mx-1">+</span>
          <span className="text-blue-400">Volume</span>
          <span className="text-white/25 mx-1">+</span>
          <span className="text-cyan-400">Discipline</span>
        </div>

        {/* Components */}
        <div className="space-y-3">
          <ScoreComponent
            color="purple"
            label="Avg Complexity"
            weight="3.5"
            maxWeight="9.6"
            formula="(avgComplexity / 10) × 3.5"
            description="LLM-assessed complexity (1-10) of each commit. The heaviest weight — rewards tackling harder problems over trivial changes."
          />
          <ScoreComponent
            color="emerald"
            label="PR Volume"
            weight="3.0"
            maxWeight="9.6"
            formula="min(PRs / 10, 1) × 3"
            description="Scales linearly up to 10 merged PRs, then caps. Values shipping complete work units."
          />
          <ScoreComponent
            color="blue"
            label="Commit Volume"
            weight="2.0"
            maxWeight="9.6"
            formula="min(commits / 20, 1) × 2"
            description="Scales linearly up to 20 commits, then caps. Intentionally lower weight — quantity matters less than quality."
          />
          <ScoreComponent
            color="cyan"
            label="PR Discipline"
            weight="1.1"
            maxWeight="9.6"
            formula="(prPercentage / 100) × 1.1"
            description="What percentage of commits went through a PR. Encourages code review culture over direct pushes."
          />
        </div>

        {/* Examples */}
        <div className="mt-5 pt-4 border-t border-white/[0.06]">
          <p className="text-xs font-bold text-white/40 uppercase tracking-wider mb-3">Score Examples</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <ScoreExample
              label="Senior IC"
              score="8.4"
              detail="25 commits, 12 PRs, complexity 6.2, 95% PR rate"
              color="green"
            />
            <ScoreExample
              label="Steady contributor"
              score="5.4"
              detail="10 commits, 5 PRs, complexity 4.0, 80% PR rate"
              color="yellow"
            />
            <ScoreExample
              label="Light period"
              score="2.4"
              detail="3 commits, 1 PR, complexity 3.0, 60% PR rate"
              color="gray"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ScoreComponent({ color, label, weight, maxWeight, formula, description }: {
  color: string; label: string; weight: string; maxWeight: string; formula: string; description: string;
}) {
  const colors: Record<string, { bar: string; text: string; bg: string }> = {
    blue:    { bar: 'bg-blue-500',    text: 'text-blue-400',    bg: 'bg-blue-500/10' },
    emerald: { bar: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    purple:  { bar: 'bg-purple-500',  text: 'text-purple-400',  bg: 'bg-purple-500/10' },
    cyan:    { bar: 'bg-cyan-500',    text: 'text-cyan-400',    bg: 'bg-cyan-500/10' },
  };
  const c = colors[color];
  const pct = (parseFloat(weight) / parseFloat(maxWeight)) * 100;

  return (
    <div className={`${c.bg} rounded-lg p-3`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className={`text-sm font-semibold ${c.text}`}>{label}</span>
        <span className="text-xs text-white/40 font-mono">{weight} / {maxWeight}</span>
      </div>
      <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden mb-2">
        <div className={`h-full ${c.bar} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-white/30 font-mono mb-1">{formula}</p>
      <p className="text-xs text-white/45 leading-relaxed">{description}</p>
    </div>
  );
}

function ScoreExample({ label, score, detail, color }: { label: string; score: string; detail: string; color: string }) {
  const scoreColor = color === 'green' ? 'text-green-400' : color === 'yellow' ? 'text-yellow-400' : 'text-gray-400';
  return (
    <div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-white/70">{label}</span>
        <span className={`text-lg font-bold ${scoreColor}`}>{score}</span>
      </div>
      <p className="text-[11px] text-white/35 leading-relaxed">{detail}</p>
    </div>
  );
}
