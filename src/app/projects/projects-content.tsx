'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../auth-context';

interface ProjectEpic {
  key: string;
  summary: string;
  status: string;
  dueDate: string | null;
  assignee: string | null;
  team: { name: string; color: string } | null;
  initiative: { key: string; summary: string } | null;
  goal: { key: string; summary: string } | null;
}

interface WorkGroup {
  name: string;
  summary: string;
  commitCount: number;
  repos: string[];
  linesAdded: number;
  linesRemoved: number;
}

interface UntrackedCommit {
  sha: string;
  repo: string;
  author: string;
  message: string;
  linesAdded: number;
  linesRemoved: number;
}

interface UntrackedTeam {
  name: string;
  color: string;
  groups: WorkGroup[];
  commits: UntrackedCommit[];
  totalCommits: number;
}

export default function ProjectsContent() {
  const { canAct } = useAuth();
  const [epics, setEpics] = useState<ProjectEpic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [org, setOrg] = useState<string | null>(null);
  const [jiraHost, setJiraHost] = useState<string | null>(null);

  // Filters
  const [filterTeam, setFilterTeam] = useState<string>('');
  const [filterGoal, setFilterGoal] = useState<string>('');
  const [filterInitiative, setFilterInitiative] = useState<string>('');

  // Hover state for grouped rows
  const [hoveredGoal, setHoveredGoal] = useState<string | null>(null);
  const [hoveredInit, setHoveredInit] = useState<string | null>(null);

  // Untracked work
  const [untrackedTeams, setUntrackedTeams] = useState<UntrackedTeam[]>([]);
  const [untrackedLoading, setUntrackedLoading] = useState(false);

  // Epic summary expand
  const [expandedEpic, setExpandedEpic] = useState<string | null>(null);
  const [showCommits, setShowCommits] = useState<string | null>(null);
  const [summaryData, setSummaryData] = useState<Record<string, { summary: string; stats: any; commits: any[]; generatedAt: string; cached: boolean } | null>>({});
  const [summaryLoading, setSummaryLoading] = useState<Record<string, boolean>>({});

  const fetchSummary = (epicKey: string, epicSummaryText: string, refresh = false) => {
    if (!org) return;
    setSummaryLoading(prev => ({ ...prev, [epicKey]: true }));
    const params = new URLSearchParams({ org, summary: epicSummaryText });
    if (refresh) params.set('refresh', 'true');
    fetch(`/api/projects/${encodeURIComponent(epicKey)}/summary?${params}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => setSummaryData(prev => ({ ...prev, [epicKey]: data })))
      .catch(() => setSummaryData(prev => ({ ...prev, [epicKey]: null })))
      .finally(() => setSummaryLoading(prev => ({ ...prev, [epicKey]: false })));
  };

  const toggleExpand = (epicKey: string, epicSummaryText: string) => {
    if (expandedEpic === epicKey) {
      setExpandedEpic(null);
    } else {
      setExpandedEpic(epicKey);
      if (!summaryData[epicKey] && !summaryLoading[epicKey]) {
        fetchSummary(epicKey, epicSummaryText);
      }
    }
  };

  useEffect(() => {
    fetch('/api/orgs')
      .then(r => r.json())
      .then(data => {
        if (data.length > 0) setOrg(data[0].login);
        else setError('No GitHub org configured');
      })
      .catch(() => setError('Failed to load org'));
  }, []);

  useEffect(() => {
    if (!org) return;
    setLoading(true);
    fetch(`/api/projects?org=${encodeURIComponent(org)}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => { setEpics(data.epics); setJiraHost(data.jiraHost); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [org]);

  const loadUntracked = () => {
    if (!org || untrackedLoading) return;
    setUntrackedLoading(true);
    fetch(`/api/projects/untracked?org=${encodeURIComponent(org)}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => setUntrackedTeams(data.teams || []))
      .catch(() => setUntrackedTeams([]))
      .finally(() => setUntrackedLoading(false));
  };

  // Derive unique filter options from data
  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const e of epics) if (e.team) set.add(e.team.name);
    return Array.from(set).sort();
  }, [epics]);

  const goals = useMemo(() => {
    const set = new Set<string>();
    for (const e of epics) if (e.goal) set.add(e.goal.summary);
    return Array.from(set).sort();
  }, [epics]);

  const initiatives = useMemo(() => {
    const set = new Set<string>();
    for (const e of epics) if (e.initiative) set.add(e.initiative.summary);
    return Array.from(set).sort();
  }, [epics]);

  // Apply filters
  const filteredEpics = useMemo(() => {
    return epics.filter(e => {
      if (filterTeam === '__none__' && e.team !== null) return false;
      if (filterTeam && filterTeam !== '__none__' && e.team?.name !== filterTeam) return false;
      if (filterGoal && e.goal?.summary !== filterGoal) return false;
      if (filterInitiative && e.initiative?.summary !== filterInitiative) return false;
      return true;
    });
  }, [epics, filterTeam, filterGoal, filterInitiative]);

  const activeFilterCount = [filterTeam, filterGoal, filterInitiative].filter(Boolean).length;

  const isOverdue = (dateStr: string | null) => {
    if (!dateStr) return false;
    return new Date(dateStr) < new Date();
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Precompute rowSpans for merged goal and initiative cells
  const spans = useMemo(() => {
    const result: Array<{ goalSpan: number; initSpan: number; showGoal: boolean; showInit: boolean; goalGroupId: string; initGroupId: string }> = [];
    for (let i = 0; i < filteredEpics.length; i++) {
      const goalKey = filteredEpics[i].goal?.summary || '—';
      const initKey = (filteredEpics[i].goal?.summary || '—') + '|' + (filteredEpics[i].initiative?.summary || '—');

      // Count how many consecutive rows share the same goal
      let goalSpan = 0;
      for (let j = i; j < filteredEpics.length; j++) {
        if ((filteredEpics[j].goal?.summary || '—') === goalKey) goalSpan++;
        else break;
      }

      // Count how many consecutive rows share the same initiative (within same goal)
      let initSpan = 0;
      for (let j = i; j < filteredEpics.length; j++) {
        const jKey = (filteredEpics[j].goal?.summary || '—') + '|' + (filteredEpics[j].initiative?.summary || '—');
        if (jKey === initKey) initSpan++;
        else break;
      }

      // Is this the first row of a goal group?
      const showGoal = i === 0 || (filteredEpics[i - 1].goal?.summary || '—') !== goalKey;
      // Is this the first row of an initiative group?
      const prevInitKey = i > 0 ? (filteredEpics[i - 1].goal?.summary || '—') + '|' + (filteredEpics[i - 1].initiative?.summary || '—') : '';
      const showInit = i === 0 || prevInitKey !== initKey;

      result.push({ goalSpan, initSpan, showGoal, showInit, goalGroupId: `g-${goalKey}`, initGroupId: `i-${initKey}` });
    }
    return result;
  }, [filteredEpics]);

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-gray-400 text-sm mt-1">In-progress epics from Jira</p>
        </div>
        <a
          href="/"
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          &larr; Back to Dashboard
        </a>
      </div>

      {loading && <div className="text-gray-500 py-8">Loading projects from Jira...</div>}
      {error && <div className="text-red-400 py-8">Error: {error}</div>}

      {!loading && !error && epics.length > 0 && (
        <>
          {/* Filters */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <select
              value={filterGoal}
              onChange={e => setFilterGoal(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-400 focus:outline-none focus:border-accent cursor-pointer"
            >
              <option value="">All goals</option>
              {goals.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <select
              value={filterInitiative}
              onChange={e => setFilterInitiative(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-400 focus:outline-none focus:border-accent cursor-pointer"
            >
              <option value="">All initiatives</option>
              {initiatives.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
            <select
              value={filterTeam}
              onChange={e => setFilterTeam(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-400 focus:outline-none focus:border-accent cursor-pointer"
            >
              <option value="">All teams</option>
              <option value="__none__">No team</option>
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            {/* Active filter pills */}
            {filterGoal && (
              <span className="inline-flex items-center gap-1.5 bg-accent/20 text-accent-lighter text-xs font-medium px-2.5 py-1 rounded-lg border border-accent/30">
                {filterGoal}
                <button onClick={() => setFilterGoal('')} className="text-accent-light hover:text-white ml-0.5">&times;</button>
              </span>
            )}
            {filterInitiative && (
              <span className="inline-flex items-center gap-1.5 bg-accent/20 text-accent-lighter text-xs font-medium px-2.5 py-1 rounded-lg border border-accent/30">
                {filterInitiative}
                <button onClick={() => setFilterInitiative('')} className="text-accent-light hover:text-white ml-0.5">&times;</button>
              </span>
            )}
            {filterTeam && (
              <span className="inline-flex items-center gap-1.5 bg-accent/20 text-accent-lighter text-xs font-medium px-2.5 py-1 rounded-lg border border-accent/30">
                {filterTeam === '__none__' ? 'No team' : filterTeam}
                <button onClick={() => setFilterTeam('')} className="text-accent-light hover:text-white ml-0.5">&times;</button>
              </span>
            )}
            {activeFilterCount > 1 && (
              <button onClick={() => { setFilterTeam(''); setFilterGoal(''); setFilterInitiative(''); }} className="text-xs text-gray-600 hover:text-gray-400">Clear all</button>
            )}
          </div>

          {filteredEpics.length === 0 ? (
            <div className="text-gray-500 py-8">No epics match the selected filters.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-800">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '35%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '12%' }} />
                </colgroup>
                <thead>
                  <tr className="bg-gray-900/50 text-gray-400 text-left text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 font-medium">Business Goal</th>
                    <th className="px-4 py-3 font-medium">Initiative</th>
                    <th className="px-4 py-3 font-medium">Epic</th>
                    <th className="px-4 py-3 font-medium">Due</th>
                    <th className="px-4 py-3 font-medium">Lead</th>
                    <th className="px-4 py-3 font-medium">Team</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEpics.map((epic, i) => {
                    const { goalSpan, initSpan, showGoal, showInit, goalGroupId, initGroupId } = spans[i];
                    const isGoalHovered = hoveredGoal === goalGroupId;
                    const isInitHovered = hoveredInit === initGroupId;

                    return (
                      <tr
                        key={epic.key}
                        className={`border-b border-gray-800/50 transition-colors ${isGoalHovered ? 'bg-gray-900/30' : ''}`}
                        onMouseEnter={() => { setHoveredGoal(goalGroupId); setHoveredInit(initGroupId); }}
                        onMouseLeave={() => { setHoveredGoal(null); setHoveredInit(null); }}
                      >
                        {showGoal && (
                          <td
                            className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isGoalHovered ? 'bg-gray-900/30' : ''}`}
                            rowSpan={goalSpan}
                          >
                            {epic.goal ? (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-accent-bg/30 text-accent-lighter">
                                {epic.goal.summary}
                              </span>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                        )}
                        {showInit && (
                          <td
                            className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isGoalHovered ? 'bg-gray-900/30' : ''}`}
                            rowSpan={initSpan}
                          >
                            {epic.initiative ? (
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-300">
                                {epic.initiative.summary}
                              </span>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 text-white font-medium">
                          <div className="flex items-start gap-1.5">
                            <button
                              onClick={() => toggleExpand(epic.key, epic.summary)}
                              className="mt-0.5 text-gray-500 hover:text-gray-300 transition-transform shrink-0"
                              style={{ transform: expandedEpic === epic.key ? 'rotate(90deg)' : 'rotate(0deg)' }}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                            <div className="flex-1 min-w-0">
                              <div>
                                {jiraHost ? (
                                  <a href={`https://${jiraHost}/browse/${epic.key}`} target="_blank" rel="noopener noreferrer" className="text-accent-light hover:text-accent-lighter underline" onClick={e => e.stopPropagation()}>{epic.key}</a>
                                ) : (
                                  <span>{epic.key}</span>
                                )}
                                {' '}{epic.summary}
                              </div>
                              {expandedEpic === epic.key && (
                                <div className="mt-2 pt-2 border-t border-gray-800/50">
                                  {summaryLoading[epic.key] ? (
                                    <div className="text-gray-500 text-xs animate-pulse">Generating summary...</div>
                                  ) : summaryData[epic.key] ? (
                                    <>
                                      <div className="flex items-start gap-2">
                                        <p className="text-gray-400 text-xs leading-relaxed flex-1">{summaryData[epic.key]!.summary}</p>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); fetchSummary(epic.key, epic.summary, true); }}
                                          className="text-gray-600 hover:text-gray-400 shrink-0 mt-0.5"
                                          title="Refresh summary"
                                        >
                                          <svg className={`w-3 h-3 ${summaryLoading[epic.key] ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                          </svg>
                                        </button>
                                      </div>
                                      {summaryData[epic.key]!.commits?.length > 0 && (
                                        <div className="mt-2">
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setShowCommits(showCommits === epic.key ? null : epic.key); }}
                                            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                                          >
                                            {showCommits === epic.key ? 'Hide' : 'Show'} {summaryData[epic.key]!.commits.length} commits
                                          </button>
                                          {showCommits === epic.key && (
                                            <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
                                              {summaryData[epic.key]!.commits.map((c: any) => {
                                                const jiraMatch = c.message.match(/([A-Z]+-\d+)/);
                                                const shortSha = c.sha.slice(0, 7);
                                                return (
                                                  <div key={c.sha} className="flex items-start gap-2 text-xs text-gray-500">
                                                    <a
                                                      href={c.prNumber ? `https://github.com/${org}/${c.repo}/pull/${c.prNumber}` : `https://github.com/${org}/${c.repo}/commit/${c.sha}`}
                                                      target="_blank" rel="noopener noreferrer"
                                                      className="text-accent-light hover:text-accent-lighter shrink-0 font-mono"
                                                      onClick={e => e.stopPropagation()}
                                                    >
                                                      {c.prNumber ? `PR #${c.prNumber}` : shortSha}
                                                    </a>
                                                    <span className="text-gray-600 shrink-0">{c.repo}</span>
                                                    <span className="text-gray-500 truncate flex-1">
                                                      {jiraMatch && jiraHost ? (
                                                        <>
                                                          <a href={`https://${jiraHost}/browse/${jiraMatch[1]}`} target="_blank" rel="noopener noreferrer" className="text-accent-light hover:text-accent-lighter" onClick={e => e.stopPropagation()}>{jiraMatch[1]}</a>
                                                          {' '}{c.message.replace(jiraMatch[1], '').trim()}
                                                        </>
                                                      ) : c.message}
                                                    </span>
                                                    <span className="text-gray-700 shrink-0">+{c.linesAdded}/-{c.linesRemoved}</span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </>
                                  ) : (
                                    <div className="text-gray-600 text-xs">Failed to load summary.</div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className={`px-4 py-3 ${isOverdue(epic.dueDate) ? 'text-red-400' : 'text-gray-400'}`}>
                          {formatDate(epic.dueDate)}
                        </td>
                        <td className="px-4 py-3 text-gray-300">
                          {epic.assignee || '—'}
                        </td>
                        <td className="px-4 py-3">
                          {epic.team ? (
                            <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-accent/20 text-accent-lighter border border-accent/30">
                              {epic.team.name}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {/* Not in Project rows */}
                  {(() => {
                    const filtered = untrackedTeams.filter(t => {
                      if (filterGoal && filterGoal !== 'Not in Project') return false;
                      if (filterTeam && filterTeam !== '__none__' && filterTeam !== t.name) return false;
                      if (filterTeam === '__none__') return false;
                      if (filterInitiative && filterInitiative !== t.name) return false;
                      return true;
                    });
                    const totalRows = filtered.reduce((sum, t) => sum + t.groups.length, 0);
                    if (totalRows === 0) return null;
                    let rowIdx = 0;
                    const untrackedGoalId = 'g-Not in Project';

                    return filtered.map((team, teamIdx) =>
                      team.groups.map((group, groupIdx) => {
                        const isFirstRow = rowIdx === 0;
                        const isFirstGroup = groupIdx === 0;
                        const groupId = `untracked-${team.name}-${group.name}`;
                        const isHovered = hoveredGoal === untrackedGoalId;
                        rowIdx++;

                        return (
                          <tr
                            key={groupId}
                            className={`border-b border-gray-800/50 transition-colors ${isHovered ? 'bg-gray-900/30' : ''}`}
                            onMouseEnter={() => { setHoveredGoal(untrackedGoalId); setHoveredInit(null); }}
                            onMouseLeave={() => { setHoveredGoal(null); setHoveredInit(null); }}
                          >
                            {isFirstRow && (
                              <td
                                className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isHovered ? 'bg-gray-900/30' : ''}`}
                                rowSpan={totalRows}
                              >
                                <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-700/50 text-gray-400">
                                  Not in Project
                                </span>
                              </td>
                            )}
                            {isFirstGroup && (
                              <td
                                className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isHovered ? 'bg-gray-900/30' : ''}`}
                                rowSpan={team.groups.length}
                              >
                                <span className="text-gray-600">—</span>
                              </td>
                            )}
                            <td className="px-4 py-3 text-white font-medium">
                              <div className="flex items-start gap-1.5">
                                <button
                                  onClick={() => setExpandedEpic(expandedEpic === groupId ? null : groupId)}
                                  className="mt-0.5 text-gray-500 hover:text-gray-300 transition-transform shrink-0"
                                  style={{ transform: expandedEpic === groupId ? 'rotate(90deg)' : 'rotate(0deg)' }}
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                  </svg>
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className="text-gray-300">{group.name}</div>
                                  {expandedEpic === groupId && (
                                    <div className="mt-2 pt-2 border-t border-gray-800/50">
                                      <p className="text-gray-400 text-xs leading-relaxed">{group.summary}</p>
                                      {team.commits?.length > 0 && (
                                        <div className="mt-2">
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setShowCommits(showCommits === groupId ? null : groupId); }}
                                            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                                          >
                                            {showCommits === groupId ? 'Hide' : 'Show'} {team.commits.filter((c: any) => group.repos.includes(c.repo)).length || team.commits.length} commits
                                          </button>
                                          {showCommits === groupId && (
                                            <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
                                              {team.commits
                                                .filter((c: any) => group.repos.length === 0 || group.repos.includes(c.repo))
                                                .map((c: any) => {
                                                  const jiraMatch = c.message.match(/([A-Z]+-\d+)/);
                                                  const shortSha = c.sha?.slice(0, 7) || '';
                                                  return (
                                                    <div key={c.sha || c.message} className="flex items-start gap-2 text-xs text-gray-500">
                                                      {shortSha && org ? (
                                                        <a
                                                          href={`https://github.com/${org}/${c.repo}/commit/${c.sha}`}
                                                          target="_blank" rel="noopener noreferrer"
                                                          className="text-accent-light hover:text-accent-lighter shrink-0 font-mono"
                                                          onClick={e => e.stopPropagation()}
                                                        >{shortSha}</a>
                                                      ) : <span className="font-mono shrink-0">•</span>}
                                                      <span className="text-gray-600 shrink-0">{c.repo}</span>
                                                      <span className="text-gray-500 truncate flex-1">
                                                        {jiraMatch && jiraHost ? (
                                                          <>
                                                            <a href={`https://${jiraHost}/browse/${jiraMatch[1]}`} target="_blank" rel="noopener noreferrer" className="text-accent-light hover:text-accent-lighter" onClick={e => e.stopPropagation()}>{jiraMatch[1]}</a>
                                                            {' '}{c.message.replace(jiraMatch[1], '').trim()}
                                                          </>
                                                        ) : c.message}
                                                      </span>
                                                      <span className="text-gray-700 shrink-0">+{c.linesAdded}/-{c.linesRemoved}</span>
                                                    </div>
                                                  );
                                                })}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-600">—</td>
                            <td className="px-4 py-3 text-gray-600">—</td>
                            <td className="px-4 py-3">
                              <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-accent/20 text-accent-lighter border border-accent/30">
                                {team.name}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    );
                  })()}
                </tbody>
              </table>
              <div className="px-4 py-2 text-xs text-gray-500 bg-gray-900/30 border-t border-gray-800 flex items-center justify-between">
                <span>
                  {filteredEpics.length}{filteredEpics.length !== epics.length ? ` of ${epics.length}` : ''} epic{filteredEpics.length !== 1 ? 's' : ''}
                  {untrackedTeams.length > 0 && ` · ${untrackedTeams.length} team${untrackedTeams.length !== 1 ? 's' : ''} with untracked work`}
                </span>
                {untrackedTeams.length === 0 && !untrackedLoading && canAct && (
                  <button
                    onClick={loadUntracked}
                    className="text-xs text-gray-500 hover:text-gray-300 bg-gray-800 hover:bg-gray-700 px-2.5 py-1 rounded border border-gray-700 transition-colors"
                  >
                    Show work outside projects
                  </button>
                )}
                {untrackedLoading && (
                  <span className="text-xs text-gray-500 animate-pulse">Loading untracked work...</span>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {!loading && !error && epics.length === 0 && (
        <div className="text-gray-500 py-8">No epics found matching the configured JQL.</div>
      )}
    </div>
  );
}
