'use client';
import type { TeamProject } from '@/lib/team-pulse/types';

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

export default function ProjectsCard({
  projects,
  loading,
  title = 'Top Projects',
  subtitle,
  emptyMessage = 'No active projects in this window.',
  developerHref,
}: ProjectsCardProps) {
  if (loading) {
    return (
      <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🏗️</span>
          <span className="text-xs font-bold tracking-widest uppercase text-white/40">{title}</span>
        </div>
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Analyzing projects…
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏗️</span>
          <span className="text-xs font-bold tracking-widest uppercase text-white/40">
            {title}{subtitle ? ` · ${subtitle}` : ''}
          </span>
        </div>
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyMessage}</p>
      ) : (
        <div className="space-y-3">
          {projects.map((p, i) => {
            const ago = timeAgo((p as TeamProject).last_activity);
            return (
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
                    {ago && <span className="text-gray-600">· {ago}</span>}
                  </div>
                </div>
                <p className="text-xs text-gray-500 pl-6 mb-1.5">{p.summary}</p>
                <div className="flex gap-1 pl-6 flex-wrap">
                  {p.developers.map(d =>
                    developerHref ? (
                      <a
                        key={d}
                        href={developerHref(d)}
                        className="text-[10px] px-1.5 py-0.5 rounded hover:opacity-80 transition-opacity"
                        style={{ color: 'var(--accent-dark)', backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
                      >@{d}</a>
                    ) : (
                      <span
                        key={d}
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ color: 'var(--accent-dark)', backgroundColor: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}
                      >@{d}</span>
                    ),
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
