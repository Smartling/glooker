// src/app/vulnerabilities/ownership-card.tsx
'use client';
// GLOOK-64: the Overview's ownership card: an "Owning teams" tab and a "Repositories" tab over one
// 330px body that the tables scroll inside (their header and footer rows stay pinned). The body keeps
// its height in every state (loading, error, empty, populated), so a filter change never resizes the card.
import { useState } from 'react';
import type { SecurityViewProps } from './view-props';
import type { OwnTab } from './security-state';
import { OWNERSHIP_BODY_H, TYPE } from './dimensions';
import TeamTable from './team-table';
import RepoTable from './repo-table';
import { teamRowsOverflow } from './ownership-model';

/** Every tab's count sits in a slot at least this wide, so a count going from one digit to two (a
 * filter changes the number of owning teams) does not move the tab after it. */
export const OWN_TAB_COUNT_MIN_W = '2ch';

const TABS: Array<{ id: OwnTab; label: string }> = [
  { id: 'teams', label: 'Owning teams' },
  { id: 'repos', label: 'Repositories' },
];

export default function OwnershipCard(props: SecurityViewProps) {
  const { url, data, summary } = props;
  const [nameFilter, setNameFilter] = useState('');

  const teamsSrc = data.teamSummary.data ?? summary;
  const teamCount = teamsSrc.pivot.rows.length;
  const carriedTotal = teamsSrc.pivot.total.critical.resolved !== null ? teamsSrc.pivot.total.critical.carriedResolved : 0;
  const teamsScroll = teamRowsOverflow(teamCount, carriedTotal > 0);
  const repoRows = data.repos.data?.rows;
  const unmeasured = repoRows ? repoRows.filter(r => r.unmeasured).length : 0;
  const counts: Record<OwnTab, string | null> = {
    teams: String(teamCount),
    repos: repoRows ? `${repoRows.length - unmeasured}${unmeasured ? ` + ${unmeasured} unmeasured` : ''}` : null,
  };

  return (
    <section aria-label="Ownership" data-testid="ownership-card" className="flex flex-col gap-3">
      <h2 className={`${TYPE.sectionLabel} text-gray-400`}>Open alerts by owner</h2>
      <div className={`${TYPE.card} bg-gray-900 p-4`}>
        <div className="flex h-9 items-center justify-between gap-3 border-b border-gray-800">
          {/* A pressed-button group, not role="tab": the page's own view tabs are the only tablist, and the
              composer's tabpanel is the only tabpanel. */}
          <div role="group" aria-label="Ownership view" className="flex min-w-0 gap-5">
            {TABS.map(t => {
              const on = url.own === t.id;
              return (
                <button
                  key={t.id} type="button" id={`ownership-tab-${t.id}`} aria-pressed={on} aria-controls="ownership-panel"
                  className={`-mb-px flex min-w-0 items-baseline gap-1.5 border-b-2 pb-2 pt-1 ${TYPE.body} ${on ? 'border-accent font-semibold text-white' : 'border-transparent text-gray-400 hover:text-gray-200'}`}
                  onClick={() => url.setOwn(t.id)}
                >
                  {/* The pressed tab is semibold. The invisible ::after copy of the label is semibold on both tabs, so
                      each tab is as wide as its bold label and switching tabs does not move the other one. */}
                  <span
                    data-testid={`ownership-tab-label-${t.id}`} data-label={t.label}
                    className="truncate after:invisible after:block after:h-0 after:overflow-hidden after:font-semibold after:content-[attr(data-label)]"
                  >{t.label}</span>
                  <span data-testid={`ownership-tab-count-${t.id}`} className="shrink-0 text-xs font-normal text-gray-500" style={{ minWidth: OWN_TAB_COUNT_MIN_W }}>{counts[t.id]}</span>
                </button>
              );
            })}
          </div>
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            <span className="hidden truncate text-xs text-gray-500 md:block">
              {url.own === 'teams'
                ? `Click a team to filter the page to it${teamsScroll ? ' · scroll for more' : ''}`
                : 'Click a repository to open its alerts'}
            </span>
            {url.own === 'repos' && (
              <input
                type="search" aria-label="Filter repositories by name" placeholder="Filter repositories by name" value={nameFilter}
                className={`h-7 w-56 ${TYPE.control} border border-gray-700 bg-gray-800 px-2 text-xs text-gray-200 placeholder:text-gray-500`}
                onChange={e => setNameFilter(e.target.value)}
              />
            )}
          </div>
        </div>
        <div
          id="ownership-panel" role="region" aria-labelledby={`ownership-tab-${url.own}`} data-testid="ownership-card-body"
          className="mt-3 overflow-hidden" style={{ height: OWNERSHIP_BODY_H }}
        >
          {url.own === 'teams' ? <TeamTable {...props} /> : <RepoTable {...props} nameFilter={nameFilter} />}
        </div>
      </div>
    </section>
  );
}
