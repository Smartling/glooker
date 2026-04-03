'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
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

interface UntrackedCommit {
  sha: string;
  repo: string;
  author: string;
  message: string;
  linesAdded: number;
  linesRemoved: number;
}

interface WorkGroup {
  name: string;
  summary: string;
  commits: UntrackedCommit[];
}

interface EpicRingStats {
  epicKey: string;
  totalJiras: number;
  resolvedJiras: number;
  remainingJiras: number;
  commitCount: number;
  devCount: number;
  linesAdded: number;
  linesRemoved: number;
  repos: string[];
  cached: boolean;
}

interface UntrackedTeam {
  name: string;
  color: string;
  groups: WorkGroup[];
  totalCommits: number;
}

type StatusTab = 'In Progress' | 'Rollout' | 'Done';

export default function ProjectsContent() {
  const { canAct } = useAuth();
  const [activeTab, setActiveTab] = useState<StatusTab>('In Progress');
  const [tabCache, setTabCache] = useState<Partial<Record<StatusTab, { epics: ProjectEpic[]; jiraHost: string | null }>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [org, setOrg] = useState<string | null>(null);
  const [jiraHost, setJiraHost] = useState<string | null>(null);

  // Filters
  const [filterTeam, setFilterTeam] = useState<string>('');
  const [filterGoal, setFilterGoal] = useState<string>('');
  const [filterInitiative, setFilterInitiative] = useState<string>('');

  // Hover state for row highlight
  const [hoveredEpic, setHoveredEpic] = useState<string | null>(null);

  // Untracked work
  const [untrackedTeams, setUntrackedTeams] = useState<UntrackedTeam[]>([]);
  const [untrackedLoading, setUntrackedLoading] = useState(false);

  const [ringStats, setRingStats] = useState<Record<string, EpicRingStats>>({});

  // Due date editing
  const [editingDue, setEditingDue] = useState<string | null>(null);
  const [savingDue, setSavingDue] = useState<string | null>(null);
  const [calMonth, setCalMonth] = useState<Date>(new Date());

  // Status editing
  const [editingStatus, setEditingStatus] = useState<string | null>(null);
  const [transitionsCache, setTransitionsCache] = useState<Record<string, Array<{ id: string; name: string; to: { name: string } }>>>({});
  const [transitionsLoading, setTransitionsLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState<string | null>(null);

  const fetchingTransitions = useRef(new Set<string>());
  const openStatusEditor = async (epicKey: string) => {
    if (editingStatus === epicKey) { setEditingStatus(null); return; }
    setEditingStatus(epicKey);
    if (transitionsCache[epicKey] || fetchingTransitions.current.has(epicKey)) return;
    fetchingTransitions.current.add(epicKey);
    setTransitionsLoading(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(epicKey)}/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTransitionsCache(prev => ({ ...prev, [epicKey]: data.transitions || [] }));
    } catch { setTransitionsCache(prev => ({ ...prev, [epicKey]: [] })); }
    finally { fetchingTransitions.current.delete(epicKey); setTransitionsLoading(false); }
  };

  const executeTransition = async (epicKey: string, transitionId: string, toStatus: string) => {
    setSavingStatus(epicKey);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(epicKey)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transitionId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Remove from current tab cache, invalidate target tab
      setTabCache(prev => {
        const updated = { ...prev };
        for (const tab of Object.keys(updated) as StatusTab[]) {
          const entry = updated[tab];
          if (entry) {
            updated[tab] = { ...entry, epics: entry.epics.filter(e => e.key !== epicKey) };
          }
        }
        // Invalidate the target tab so it re-fetches
        const targetTab = (['In Progress', 'Rollout', 'Done'] as StatusTab[]).find(t => t === toStatus);
        if (targetTab && updated[targetTab]) {
          delete updated[targetTab];
        }
        return updated;
      });
    } catch (err) {
      console.error('Failed to transition:', err);
    } finally {
      setSavingStatus(null);
      setEditingStatus(null);
      // Invalidate transitions cache for this epic (status changed, transitions differ)
      setTransitionsCache(prev => { const n = { ...prev }; delete n[epicKey]; return n; });
    }
  };

  useEffect(() => {
    if (!editingStatus) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditingStatus(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingStatus]);

  useEffect(() => {
    if (!editingDue) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditingDue(null); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editingDue]);

  const saveDueDate = async (epicKey: string, newDate: string | null) => {
    setSavingDue(epicKey);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(epicKey)}/due`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dueDate: newDate }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Optimistic update in tab cache
      setTabCache(prev => {
        const updated = { ...prev };
        for (const tab of Object.keys(updated) as StatusTab[]) {
          const entry = updated[tab];
          if (entry) {
            updated[tab] = {
              ...entry,
              epics: entry.epics.map(e => e.key === epicKey ? { ...e, dueDate: newDate } : e),
            };
          }
        }
        return updated;
      });
    } catch (err) {
      console.error('Failed to update due date:', err);
    } finally {
      setSavingDue(null);
      setEditingDue(null);
    }
  };

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

  // Fetch epics for a tab, with client-side caching
  const fetchTab = useCallback((tab: StatusTab, background = false) => {
    if (!org) return;
    const params = new URLSearchParams({ org });
    if (tab !== 'In Progress') params.set('status', tab);
    if (!background) setLoading(true);
    fetch(`/api/projects?${params}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        setTabCache(prev => ({ ...prev, [tab]: { epics: data.epics, jiraHost: data.jiraHost } }));
        if (tab === activeTab || !background) {
          setJiraHost(data.jiraHost);
        }
      })
      .catch(e => { if (!background) setError(e.message); })
      .finally(() => { if (!background) setLoading(false); });
  }, [org, activeTab]);

  // On tab switch: use cache if available, otherwise fetch
  useEffect(() => {
    if (!org) return;
    const cached = tabCache[activeTab];
    if (cached) {
      setJiraHost(cached.jiraHost);
      setLoading(false);
    } else {
      fetchTab(activeTab);
    }
  }, [org, activeTab]);

  // Prefetch other tabs in background after default tab loads
  useEffect(() => {
    if (!org || loading) return;
    const otherTabs: StatusTab[] = (['In Progress', 'Rollout', 'Done'] as StatusTab[]).filter(t => t !== activeTab && !tabCache[t]);
    for (const tab of otherTabs) {
      fetchTab(tab, true);
    }
  }, [org, loading]);

  // Derive epics from tab cache
  const epics = useMemo(() => tabCache[activeTab]?.epics || [], [tabCache, activeTab]);

  useEffect(() => {
    if (!org || epics.length === 0) return;
    for (const epic of epics) {
      fetch(`/api/projects/${encodeURIComponent(epic.key)}/stats?org=${encodeURIComponent(org)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) setRingStats(prev => ({ ...prev, [epic.key]: data }));
        })
        .catch(() => {});
    }
  }, [org, epics]);

  const loadUntracked = (refresh = false) => {
    if (!org || untrackedLoading) return;
    setUntrackedLoading(true);
    const params = new URLSearchParams({ org });
    if (refresh) params.set('refresh', 'true');
    fetch(`/api/projects/untracked?${params}`)
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

  const avgCommitsPerJira = useMemo(() => {
    const stats = Object.values(ringStats);
    const totalJiras = stats.reduce((s, r) => s + r.totalJiras, 0);
    const totalCommits = stats.reduce((s, r) => s + r.commitCount, 0);
    return totalJiras > 0 ? totalCommits / totalJiras : 1;
  }, [ringStats]);

  const maxVolume = useMemo(() => {
    return Math.max(1, ...Object.values(ringStats).map(r => Math.log(r.commitCount + 1)));
  }, [ringStats]);

  const isOverdue = (dateStr: string | null) => {
    if (!dateStr) return false;
    return new Date(dateStr + 'T00:00:00') < new Date();
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
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

  // Map epic key → group IDs so merged cells can highlight when any sibling row is hovered
  const epicGroupMap = useMemo(() => {
    const map = new Map<string, { goalGroupId: string; initGroupId: string }>();
    for (let i = 0; i < filteredEpics.length; i++) {
      map.set(filteredEpics[i].key, { goalGroupId: spans[i].goalGroupId, initGroupId: spans[i].initGroupId });
    }
    return map;
  }, [filteredEpics, spans]);

  const getNextMonday = () => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
    d.setDate(d.getDate() + diff);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const CalendarPopover = ({ epicKey, currentDate, onSelect, onClose }: {
    epicKey: string; currentDate: string | null;
    onSelect: (date: string | null) => void; onClose: () => void;
  }) => {
    const today = new Date().toISOString().split('T')[0];
    const selected = currentDate || '';

    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const prevMonthDays = new Date(year, month, 0).getDate();

    const days: Array<{ day: number; current: boolean; dateStr: string }> = [];
    for (let i = firstDay - 1; i >= 0; i--) {
      const d = prevMonthDays - i;
      const m = month === 0 ? 12 : month;
      const y = month === 0 ? year - 1 : year;
      days.push({ day: d, current: false, dateStr: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      days.push({ day: d, current: true, dateStr: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }
    const remaining = 42 - days.length;
    for (let d = 1; d <= remaining; d++) {
      const m = month + 2 > 12 ? 1 : month + 2;
      const y = month + 2 > 12 ? year + 1 : year;
      days.push({ day: d, current: false, dateStr: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` });
    }

    const monthLabel = new Date(year, month).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    return (
      <div className="absolute top-full left-0 mt-1.5 z-30 bg-gray-800 border border-gray-700 rounded-xl p-3 shadow-2xl w-56" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-2">
          <button onClick={() => setCalMonth(new Date(year, month - 1))} className="text-gray-500 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-700 text-sm">&larr;</button>
          <span className="text-xs font-semibold text-gray-200">{monthLabel}</span>
          <button onClick={() => setCalMonth(new Date(year, month + 1))} className="text-gray-500 hover:text-white px-1.5 py-0.5 rounded hover:bg-gray-700 text-sm">&rarr;</button>
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
            <span key={d} className="text-center text-[9px] text-gray-600 py-1">{d}</span>
          ))}
          {days.map((d, i) => (
            <button
              key={i}
              onClick={() => { onSelect(d.dateStr); onClose(); }}
              className={`text-center text-[11px] py-1.5 rounded-md transition-colors ${
                d.dateStr === selected ? 'bg-accent text-white font-semibold' :
                d.dateStr === today ? 'border border-accent/50 text-gray-300' :
                d.current ? 'text-gray-300 hover:bg-gray-700' :
                'text-gray-600 hover:bg-gray-700/50'
              }`}
            >{d.day}</button>
          ))}
        </div>
        <div className="flex gap-2 mt-2.5 pt-2 border-t border-gray-700">
          {currentDate && (
            <button onClick={() => { onSelect(null); onClose(); }} className="text-[11px] px-2.5 py-1 rounded-md bg-red-500/10 text-red-400 hover:bg-red-500/20">Clear</button>
          )}
          <button onClick={() => { onSelect(getNextMonday()); onClose(); }} className="text-[11px] px-2.5 py-1 rounded-md bg-accent/10 text-accent-lighter hover:bg-accent/20">Next Monday</button>
        </div>
      </div>
    );
  };

  const ProgressRing = ({ stats }: { stats: EpicRingStats }) => {
    const volume = Math.log(stats.commitCount + 1);
    const sizePct = maxVolume > 0 ? volume / maxVolume : 0;
    const px = Math.max(16, Math.round(sizePct * 48));

    const jiraPct = stats.totalJiras > 0 ? stats.resolvedJiras / stats.totalJiras : 0;
    const expectedCommits = stats.totalJiras * avgCommitsPerJira;
    const commitPct = expectedCommits > 0 ? Math.min(1, stats.commitCount / expectedCommits) : 0;

    // SVG ring math
    const outerR = 20;
    const innerR = 13;
    const outerCirc = 2 * Math.PI * outerR;
    const innerCirc = 2 * Math.PI * innerR;
    const outerOffset = outerCirc * (1 - jiraPct);
    const innerOffset = innerCirc * (1 - commitPct);

    // Stroke width scales inversely with size for readability
    const outerStroke = Math.max(3, 8 - sizePct * 5);
    const innerStroke = Math.max(3, 8 - sizePct * 5);

    const jiraPctDisplay = Math.round(jiraPct * 100);
    const commitPctDisplay = Math.round(commitPct * 100);

    return (
      <div className="relative group" style={{ width: px, height: px }}>
        <svg width={px} height={px} viewBox="0 0 48 48" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="24" cy="24" r={outerR} fill="none" stroke="#1f2937" strokeWidth={outerStroke} />
          <circle cx="24" cy="24" r={outerR} fill="none" stroke="#D97706" strokeWidth={outerStroke}
            strokeDasharray={outerCirc} strokeDashoffset={outerOffset} strokeLinecap="round" />
          <circle cx="24" cy="24" r={innerR} fill="none" stroke="#1f2937" strokeWidth={innerStroke} />
          <circle cx="24" cy="24" r={innerR} fill="none" stroke="#10B981" strokeWidth={innerStroke}
            strokeDasharray={innerCirc} strokeDashoffset={innerOffset} strokeLinecap="round" />
        </svg>
        <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-bold text-gray-200"
          style={{ fontSize: Math.max(7, Math.round(px * 0.28)) }}>
          {stats.devCount}
        </span>
        {/* Tooltip */}
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20
          bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-xs text-gray-300 whitespace-nowrap shadow-lg">
          Jira: <span className="text-amber-400 font-semibold">{stats.resolvedJiras}/{stats.totalJiras}</span> closed ({jiraPctDisplay}%)
          {' · '}Commits: <span className="text-emerald-400 font-semibold">{stats.commitCount}</span> ({commitPctDisplay}% of expected)
          {' · '}<span className="text-gray-200 font-semibold">{stats.devCount}</span> dev{stats.devCount !== 1 ? 's' : ''}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-700" />
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-gray-400 text-sm mt-1">Epics from Jira</p>
        </div>
        <a
          href="/"
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          &larr; Back to Dashboard
        </a>
      </div>

      {error && <div className="text-red-400 py-8">Error: {error}</div>}

      {loading && <div className="text-gray-500 py-8">Loading projects from Jira...</div>}

      {!loading && !error && org && (
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

          {/* Status tabs — below filters */}
          <div className="flex border-b border-gray-800 mb-4">
            {(['In Progress', 'Rollout', 'Done'] as StatusTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-xs font-medium transition-colors relative ${
                  activeTab === tab
                    ? 'text-accent-lighter'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tab}{tab === 'Done' ? ' (30d)' : ''}
                {activeTab === tab && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-light rounded-t" />
                )}
              </button>
            ))}
          </div>

          {epics.length === 0 ? (
            <div className="text-gray-500 py-8">No epics with status &ldquo;{activeTab}&rdquo;{activeTab === 'Done' ? ' in the last 30 days' : ''}.</div>
          ) : filteredEpics.length === 0 ? (
            <div className="text-gray-500 py-8">No epics match the selected filters.</div>
          ) : (
            <div className="rounded-lg border border-gray-800">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '4%' }} />
                  <col style={{ width: '34%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '11%' }} />
                </colgroup>
                <thead>
                  <tr className="bg-gray-900/50 text-gray-400 text-left text-xs uppercase tracking-wider">
                    <th className="px-4 py-3 font-medium">Business Goal</th>
                    <th className="px-4 py-3 font-medium">Initiative</th>
                    <th className="px-2 py-3 font-medium"></th>
                    <th className="px-4 py-3 font-medium">Epic</th>
                    <th className="px-4 py-3 font-medium">Due</th>
                    <th className="px-4 py-3 font-medium">Lead</th>
                    <th className="px-4 py-3 font-medium">Team</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEpics.map((epic, i) => {
                    const { goalSpan, initSpan, showGoal, showInit, goalGroupId, initGroupId } = spans[i];
                    const hoveredGroups = hoveredEpic ? epicGroupMap.get(hoveredEpic) : null;
                    const isGoalHovered = hoveredGroups?.goalGroupId === goalGroupId;
                    const isInitHovered = hoveredGroups?.initGroupId === initGroupId;

                    return (
                      <tr
                        key={epic.key}
                        className={`border-b border-gray-800/50 transition-colors ${hoveredEpic === epic.key ? 'bg-gray-800/30' : ''}`}
                        onMouseEnter={() => setHoveredEpic(epic.key)}
                        onMouseLeave={() => setHoveredEpic(null)}
                      >
                        {showGoal && (
                          <td
                            className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isGoalHovered && hoveredEpic !== epic.key ? 'bg-gray-800/30' : ''}`}
                            rowSpan={goalSpan}
                          >
                            {epic.goal ? (
                              <a href={jiraHost ? `https://${jiraHost}/browse/${epic.goal.key}` : '#'} target="_blank" rel="noopener noreferrer" className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-accent-bg/30 text-accent-lighter hover:text-white transition-colors">
                                {epic.goal.summary}
                              </a>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                        )}
                        {showInit && (
                          <td
                            className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isInitHovered && hoveredEpic !== epic.key ? 'bg-gray-800/30' : ''}`}
                            rowSpan={initSpan}
                          >
                            {epic.initiative ? (
                              <a href={jiraHost ? `https://${jiraHost}/browse/${epic.initiative.key}` : '#'} target="_blank" rel="noopener noreferrer" className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-300 hover:text-white transition-colors">
                                {epic.initiative.summary}
                              </a>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>
                        )}
                        <td className="px-2 py-3 text-center">
                          {ringStats[epic.key] ? (
                            <ProgressRing stats={ringStats[epic.key]} />
                          ) : (
                            <div className="w-4 h-4 rounded-full bg-gray-800 animate-pulse mx-auto" />
                          )}
                        </td>
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
                                {canAct && (
                                  <span className="relative inline-block ml-1.5 align-middle">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openStatusEditor(epic.key); }}
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                        editingStatus === epic.key
                                          ? 'bg-accent/15 text-accent-lighter border border-accent/30'
                                          : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
                                      }`}
                                    >
                                      {savingStatus === epic.key ? 'Saving...' : epic.status}
                                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </button>
                                    {editingStatus === epic.key && (
                                      <>
                                        <div className="fixed inset-0 z-20" onClick={() => setEditingStatus(null)} />
                                        <div className="absolute top-full left-0 mt-1 z-30 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden min-w-[160px]">
                                          {transitionsLoading && !transitionsCache[epic.key] ? (
                                            <div className="px-3 py-2 text-xs text-gray-500 animate-pulse">Loading...</div>
                                          ) : (transitionsCache[epic.key] || []).length === 0 ? (
                                            <div className="px-3 py-2 text-xs text-gray-600">No transitions available</div>
                                          ) : (
                                            (transitionsCache[epic.key] || []).map(t => (
                                              <button
                                                key={t.id}
                                                onClick={(e) => { e.stopPropagation(); if (t.to.name === epic.status) { setEditingStatus(null); } else { executeTransition(epic.key, t.id, t.to.name); } }}
                                                className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-gray-700 transition-colors flex items-center gap-2"
                                              >
                                                <span className="text-gray-500">&rarr;</span> {t.to.name}
                                              </button>
                                            ))
                                          )}
                                        </div>
                                      </>
                                    )}
                                  </span>
                                )}
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
                        <td className={`px-4 py-3 relative ${activeTab === 'In Progress' && isOverdue(epic.dueDate) ? 'text-red-400' : 'text-gray-400'}`}>
                          <div
                            className={`group/due inline-flex items-center gap-1.5 cursor-pointer px-1.5 py-0.5 rounded-md transition-colors ${
                              editingDue === epic.key ? 'bg-accent/10 border border-accent/30' : 'hover:bg-white/5'
                            } ${canAct ? '' : 'cursor-default'}`}
                            onClick={() => {
                              if (!canAct) return;
                              if (editingDue === epic.key) {
                                setEditingDue(null);
                              } else {
                                const d = epic.dueDate ? new Date(epic.dueDate + 'T00:00:00') : new Date();
                                setCalMonth(new Date(d.getFullYear(), d.getMonth()));
                                setEditingDue(epic.key);
                              }
                            }}
                          >
                            <span className={editingDue === epic.key ? 'text-accent-lighter' : ''}>
                              {savingDue === epic.key ? 'Saving...' : formatDate(epic.dueDate)}
                            </span>
                            {canAct && (
                              <svg className={`w-3 h-3 opacity-0 group-hover/due:opacity-100 transition-opacity ${editingDue === epic.key ? 'opacity-100 text-accent' : 'text-gray-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            )}
                          </div>
                          {editingDue === epic.key && (
                            <>
                              <div className="fixed inset-0 z-20" onClick={() => setEditingDue(null)} />
                              <CalendarPopover
                                epicKey={epic.key}
                                currentDate={epic.dueDate}
                                onSelect={(date) => saveDueDate(epic.key, date)}
                                onClose={() => setEditingDue(null)}
                              />
                            </>
                          )}
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
                  {/* Not in Project rows — only on In Progress tab */}
                  {activeTab === 'In Progress' && (() => {
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

                    return filtered.map((team, teamIdx) =>
                      team.groups.map((group, groupIdx) => {
                        const isFirstRow = rowIdx === 0;
                        const isFirstGroup = groupIdx === 0;
                        const groupId = `untracked-${team.name}-${group.name}`;
                        const isUntrackedHovered = hoveredEpic?.startsWith('untracked-') ?? false;
                        const isTeamHovered = hoveredEpic?.startsWith(`untracked-${team.name}-`) ?? false;
                        rowIdx++;

                        return (
                          <tr
                            key={groupId}
                            className={`border-b border-gray-800/50 transition-colors ${hoveredEpic === groupId ? 'bg-gray-800/30' : ''}`}
                            onMouseEnter={() => setHoveredEpic(groupId)}
                            onMouseLeave={() => setHoveredEpic(null)}
                          >
                            {isFirstRow && (
                              <td
                                className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isUntrackedHovered && hoveredEpic !== groupId ? 'bg-gray-800/30' : ''}`}
                                rowSpan={totalRows}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-700/50 text-gray-400">
                                    Not in Project
                                  </span>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); loadUntracked(true); }}
                                    className="text-gray-600 hover:text-gray-400 shrink-0"
                                    title="Refresh untracked work"
                                  >
                                    <svg className={`w-3 h-3 ${untrackedLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                  </button>
                                </div>
                              </td>
                            )}
                            {isFirstGroup && (
                              <td
                                className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isTeamHovered && hoveredEpic !== groupId ? 'bg-gray-800/30' : ''}`}
                                rowSpan={team.groups.length}
                              >
                                <span className="text-gray-600">—</span>
                              </td>
                            )}
                            <td className="px-2 py-3" />
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
                                      <div className="flex items-start gap-2">
                                        <p className="text-gray-400 text-xs leading-relaxed flex-1">{group.summary}</p>
                                        <button
                                          onClick={(e) => { e.stopPropagation(); loadUntracked(true); }}
                                          className="text-gray-600 hover:text-gray-400 shrink-0 mt-0.5"
                                          title="Refresh untracked work"
                                        >
                                          <svg className={`w-3 h-3 ${untrackedLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                          </svg>
                                        </button>
                                      </div>
                                      {group.commits?.length > 0 && (
                                        <div className="mt-2">
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setShowCommits(showCommits === groupId ? null : groupId); }}
                                            className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                                          >
                                            {showCommits === groupId ? 'Hide' : 'Show'} {group.commits.length} commits
                                          </button>
                                          {showCommits === groupId && (
                                            <div className="mt-2 space-y-1.5 max-h-64 overflow-y-auto">
                                              {group.commits.map((c: any) => {
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
                {activeTab === 'In Progress' && untrackedTeams.length === 0 && !untrackedLoading && (
                  <button
                    onClick={() => loadUntracked()}
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

    </div>
  );
}
