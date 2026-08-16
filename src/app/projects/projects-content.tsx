'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import useSWR, { preload } from 'swr';
import { useAuth } from '../auth-context';
import { findFirstJiraKey } from '@/lib/jira-key-utils';
import { useUrlState, useUrlBatch } from '@/lib/url-state';
// Type-only import keeps the server module out of the client bundle while
// letting the client fail fast if the shared response shape changes.
import type { EpicSummaryResult } from '@/lib/projects/epic-summary';
import { applyPendingTransitions, type PendingTransition } from '@/lib/projects/transition-state';
import { ProgressRing, type EpicRingStats } from './progress-ring';
import { ALL_TABS, visibleTabs, tabLabel, columnLayout, computeSpans } from './board-layout';
import type { JiraProject, BoardTabKind } from '@/lib/jira-projects/types';

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

interface UntrackedTeam {
  name: string;
  color: string;
  groups: WorkGroup[];
  totalCommits: number;
}

type StatusTab = BoardTabKind;

export default function ProjectsContent() {
  const { canAct } = useAuth();
  // Validated against every legally addressable tab, not just the ones this
  // board shows — `?status=middle` must survive the first render, before the
  // project has arrived and told us whether it declares a middle status.
  const [activeTab, setActiveTab] = useUrlState<StatusTab>({
    key: 'status',
    type: 'enum',
    values: ALL_TABS,
    default: 'active',
    history: 'push',
  });
  // `tabCache` stays as useState — it's a memoization cache, not URL state.
  // Keyed by `${tab}|${project}`: the same tab holds different epics per
  // project, because the project selection is applied server-side by the
  // board's own JQL.
  const [tabCache, setTabCache] = useState<Record<string, { epics: ProjectEpic[]; jiraHost: string | null }>>({});
  const [org, setOrg] = useUrlState<string>({
    key: 'org',
    type: 'string',
    default: '',
    history: 'replace',
  });
  // Empty means "whatever the server picks", which is the first configured
  // project. The selector writes a key here once the user chooses.
  const [selectedProject, setSelectedProject] = useUrlState<string>({
    key: 'project',
    type: 'string',
    default: '',
    history: 'replace',
  });
  // `jiraHost` stays as useState — comes from the API, not user input.
  const [jiraHost, setJiraHost] = useState<string | null>(null);
  // The project row the board is currently showing. Drives the tab set, the
  // tab labels and the column layout.
  const [project, setProject] = useState<JiraProject | null>(null);
  // The configured list, for the selector.
  const [projectList, setProjectList] = useState<JiraProject[]>([]);

  // Filters
  const [filterTeam, setFilterTeam] = useUrlState<string>({
    key: 'team',
    type: 'string',
    default: '',
    history: 'replace',
  });
  const [filterGoal, setFilterGoal] = useUrlState<string>({
    key: 'goal',
    type: 'string',
    default: '',
    history: 'replace',
  });
  const [filterInitiative, setFilterInitiative] = useUrlState<string>({
    key: 'initiative',
    type: 'string',
    default: '',
    history: 'replace',
  });
  const [searchQuery, setSearchQuery] = useUrlState<string>({
    key: 'q',
    type: 'string',
    default: '',
    history: 'replace',
  });
  const urlBatch = useUrlBatch();

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
  const [statusDropdownPos, setStatusDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const statusTriggerRef = useRef<HTMLElement | null>(null);
  const [transitionsCache, setTransitionsCache] = useState<Record<string, Array<{ id: string; name: string; to: { name: string } }>>>({});
  const [transitionsLoading, setTransitionsLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  // Pending transitions registry: every fetch response (useSWR, preload, etc.)
  // is patched through this map before populating `tabCache`, so optimistic
  // moves stay applied regardless of Jira's JQL index lag. Cleared only on
  // page reload — by then Jira's state will have reconciled.
  const pendingTransitionsRef = useRef<Map<string, PendingTransition<ProjectEpic>>>(new Map());

  const openStatusEditor = async (epicKey: string, triggerEl?: HTMLElement) => {
    if (editingStatus === epicKey) { setEditingStatus(null); setStatusDropdownPos(null); statusTriggerRef.current = null; setTransitionError(null); return; }
    if (triggerEl) {
      statusTriggerRef.current = triggerEl;
      const rect = triggerEl.getBoundingClientRect();
      setStatusDropdownPos({ top: rect.bottom + 2, left: rect.left });
    }
    setEditingStatus(epicKey);
    if (transitionsCache[epicKey]) return; // already cached
    setTransitionsLoading(true);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(epicKey)}/status`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTransitionsCache(prev => ({ ...prev, [epicKey]: data.transitions || [] }));
    } catch { setTransitionsCache(prev => ({ ...prev, [epicKey]: [] })); }
    finally { setTransitionsLoading(false); }
  };

  const executeTransition = async (epicKey: string, transitionId: string, toStatus: string) => {
    setSavingStatus(epicKey);
    setTransitionError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(epicKey)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transitionId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Pure optimistic move. The PATCH succeeded, so Jira has accepted the
      // transition — only its JQL search index lags. We record the move in
      // `pendingTransitionsRef` and update tabCache directly. Any future
      // tabData (from useSWR / preload / refetch) is patched through the
      // registry in the populate-tabCache useEffect, so the move sticks
      // regardless of Jira's index lag.
      // Tabs are no longer named after Jira statuses (GLOOK-38), so the
      // destination has to be resolved against this project's own status
      // vocabulary. Anything that is neither the active nor the middle status
      // is a Done-category status — the only other kind of transition the
      // board offers — and lands on the Done tab.
      const targetTab: StatusTab =
        toStatus === project?.activeStatus ? 'active'
          : toStatus === project?.middleStatus ? 'middle'
            : 'done';
      // tabCache is keyed by `${tab}|${project}`, so the destination entry is
      // the target tab under the project currently in view.
      const targetCacheKey = `${targetTab}|${selectedProject}`;
      let movedEpic: ProjectEpic | null = null;
      for (const key of Object.keys(tabCache)) {
        const entry = tabCache[key];
        if (!entry) continue;
        const found = entry.epics.find(e => e.key === epicKey);
        if (found && !movedEpic) movedEpic = { ...found, status: toStatus };
      }

      if (movedEpic) {
        pendingTransitionsRef.current.set(epicKey, { targetTab, movedEpic });

        // Optimistic tabCache update for the tabs we already have data for.
        // Tabs we have NOT cached yet stay unset; when the user navigates to
        // one, the tabData useEffect applies pendingTransitions to whatever
        // Jira returns and seeds tabCache with the patched full list.
        setTabCache(prev => {
          const updated: typeof prev = { ...prev };
          for (const key of Object.keys(updated)) {
            const entry = updated[key];
            if (entry) {
              updated[key] = { ...entry, epics: entry.epics.filter(e => e.key !== epicKey) };
            }
          }
          const targetEntry = updated[targetCacheKey];
          if (targetEntry) {
            updated[targetCacheKey] = { ...targetEntry, epics: [movedEpic!, ...targetEntry.epics] };
          }
          return updated;
        });
      }

      // Close the dropdown now that the move is in place.
      setEditingStatus(null);
      setStatusDropdownPos(null);
      statusTriggerRef.current = null;
    } catch (err) {
      // Surface the error to the user instead of silently swallowing it.
      // Keep the dropdown open so they can retry with the same trigger.
      console.error('Failed to transition:', err);
      setTransitionError(err instanceof Error ? err.message : 'Failed to change status');
    } finally {
      setSavingStatus(null);
      // Invalidate transitions cache for this epic (status changed, transitions differ)
      setTransitionsCache(prev => { const n = { ...prev }; delete n[epicKey]; return n; });
    }
  };

  useEffect(() => {
    if (!editingStatus) return;
    const close = () => { setEditingStatus(null); setStatusDropdownPos(null); statusTriggerRef.current = null; setTransitionError(null); };
    const reposition = () => {
      if (!statusTriggerRef.current) return;
      const rect = statusTriggerRef.current.getBoundingClientRect();
      setStatusDropdownPos({ top: rect.bottom + 2, left: rect.left });
    };
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', keyHandler);
    window.addEventListener('scroll', reposition, { capture: true, passive: true });
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('keydown', keyHandler);
      window.removeEventListener('scroll', reposition, { capture: true });
      window.removeEventListener('resize', reposition);
    };
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
        for (const key of Object.keys(updated)) {
          const entry = updated[key];
          if (entry) {
            updated[key] = {
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
  const [summaryData, setSummaryData] = useState<Record<string, EpicSummaryResult | null>>({});
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

  // SWR: fetch orgs list
  const { data: orgsData, error: orgsError } = useSWR('/api/orgs');
  // Fallback: if orgs fails, try getting org from latest report
  const { data: reportsData } = useSWR(orgsError ? '/api/report' : null);

  // Auto-select the first org when none is set in the URL.
  //
  // Defensive: read window.location.search live (not the closure `org` derived
  // from useSearchParams) so we don't fire setOrg if the user has already typed
  // any URL-owned filter — a setOrg call's closure could otherwise be from an
  // earlier render and clobber a concurrent ?q=… or ?team=… write.
  //
  // setOrg is deliberately omitted from the deps: the useUrlState setter's
  // identity rotates on every searchParams change, which would re-fire this
  // effect on every URL update unnecessarily.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const live = new URLSearchParams(window.location.search);
      // If any URL-owned key is already present, the user is already engaging.
      // Don't auto-set the org — they'll see the empty default and can pick.
      if (live.has('org') || live.has('team') || live.has('goal') ||
          live.has('initiative') || live.has('q') || live.has('status')) {
        return;
      }
    }
    if (orgsData?.length > 0 && !org) {
      setOrg(orgsData[0].login);
    } else if (orgsError && reportsData?.length > 0 && !org) {
      setOrg(reportsData[0].org);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setOrg identity churns on URL change; safely omitted
  }, [orgsData, orgsError, reportsData, org]);

  // The configured projects, for the selector. Independent of the epic fetch:
  // the list is small, changes rarely and must be present before the first
  // board response so the dropdown never renders empty.
  useEffect(() => {
    if (!org) return;
    fetch(`/api/jira-projects?org=${encodeURIComponent(org)}`)
      .then(r => r.json())
      .then((list: JiraProject[]) => setProjectList(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [org]);

  // SWR: fetch epics for the active tab. The selected project goes to the
  // server so that project's own JQL drives the response.
  const cacheKey = `${activeTab}|${selectedProject}`;
  const tabUrl = org
    ? `/api/projects?org=${encodeURIComponent(org)}&status=${encodeURIComponent(activeTab)}`
      + (selectedProject ? `&project=${encodeURIComponent(selectedProject)}` : '')
    : null;
  // `revalidateIfStale: false` is essential here. With the default (true), a
  // background revalidation fires every time `useSWR` rebinds (e.g. on tab
  // switch). That revalidation can race optimistic transitions: the response
  // arrives during Jira's index-propagation window and overwrites the cache
  // entry we just mutated. We trust our optimistic state until a page reload
  // or an explicit `mutate(url)` call invalidates it.
  const { data: tabData, isLoading: tabLoading, error: tabError } = useSWR(tabUrl, { revalidateIfStale: false });

  // When tabData arrives, populate the tabCache after applying any pending
  // transitions. This is the single point where Jira's view (possibly with
  // a lagging search index) is reconciled with the user's optimistic moves.
  useEffect(() => {
    if (tabData?.epics) {
      const epics = applyPendingTransitions(tabData.epics, activeTab, pendingTransitionsRef.current);
      setTabCache(prev => ({ ...prev, [cacheKey]: { epics, jiraHost: tabData.jiraHost } }));
      setJiraHost(tabData.jiraHost);
      setProject(tabData.project ?? null);
    }
  }, [tabData, activeTab, cacheKey]);

  // Prefetch the board's other tabs in background after the active tab loads.
  // We only preload once per org+project because preload's fetch responses
  // would otherwise race optimistic transitions: a re-fire after a `mutate`
  // returns Jira's still-lagging list and overwrites the optimistic state.
  const fetcher = (url: string) => fetch(url).then(r => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
  const preloadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!org || !tabData) return;
    const key = `${org}|${selectedProject}`;
    if (preloadedKeyRef.current === key) return;
    preloadedKeyRef.current = key;
    const projectParam = selectedProject ? `&project=${encodeURIComponent(selectedProject)}` : '';
    for (const tab of visibleTabs(tabData.project ?? null).filter(t => t !== activeTab)) {
      preload(`/api/projects?org=${encodeURIComponent(org)}&status=${encodeURIComponent(tab)}${projectParam}`, fetcher);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot per org+project; re-running would race optimistic mutations
  }, [org, selectedProject, tabData]);

  // Derive epics from tab cache
  const epics = useMemo(() => tabCache[cacheKey]?.epics || [], [tabCache, cacheKey]);

  const tabs = useMemo(() => visibleTabs(project), [project]);

  // Guard against sitting on a tab the newly-selected board does not offer —
  // e.g. switching from a three-tab project to a two-tab one while on the
  // middle tab would otherwise leave no tab active and an empty table.
  //
  // Judged against the *response's* project, not the `project` state, and only
  // once a response exists. Before then `project` is either null (cold load) or
  // the previously selected one, and `setProject` lands one render after
  // `tabData` — resetting on either would bounce a `?status=middle&project=…`
  // deep link straight back to the active tab, which is the very thing
  // ALL_TABS exists to allow.
  useEffect(() => {
    // A failed fetch renders an error banner *instead of* the tab bar, so the
    // user has nothing to click their way out with. `?status=middle` is a
    // legal URL now, and the route 404s on an unknown `?project=` — e.g. a
    // bookmarked `?project=RND&status=middle` after RND is removed in
    // Settings. Recover to the default tab set: with no response we have no
    // project to trust.
    if (tabError) {
      if (!visibleTabs(null).includes(activeTab)) setActiveTab('active');
      return;
    }
    if (!tabData) return;
    if (!visibleTabs(tabData.project ?? null).includes(activeTab)) setActiveTab('active');
  }, [tabData, tabError, activeTab, setActiveTab]);

  useEffect(() => {
    if (!org || epics.length === 0) return;
    // Skip epics we've already fetched stats for. Without this, optimistic
    // tabCache updates (which change the `epics` array reference) refire
    // this effect and re-fetch stats for every epic on the page.
    for (const epic of epics) {
      if (ringStats[epic.key]) continue;
      fetch(`/api/projects/${encodeURIComponent(epic.key)}/stats?org=${encodeURIComponent(org)}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) setRingStats(prev => ({ ...prev, [epic.key]: data }));
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ringStats is a read-only guard; including it would refire the effect each fetch
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
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const fields = [
          e.key, e.summary, e.assignee,
          e.goal?.key, e.goal?.summary,
          e.initiative?.key, e.initiative?.summary,
          e.team?.name, e.dueDate, e.status,
        ];
        if (!fields.some(f => f && f.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [epics, filterTeam, filterGoal, filterInitiative, searchQuery]);

  const activeFilterCount = [filterTeam, filterGoal, filterInitiative, searchQuery].filter(Boolean).length;

  const avgCommitsPerJira = useMemo(() => {
    const stats = Object.values(ringStats);
    const totalJiras = stats.reduce((s, r) => s + r.totalJiras, 0);
    const totalCommits = stats.reduce((s, r) => s + r.commitCount, 0);
    return totalJiras > 0 ? totalCommits / totalJiras : 1;
  }, [ringStats]);

  // Sizing weight = commits + jiras. Counting commits alone hides epics that
  // ship resolved jiras but have no commit attribution (docs, non-code work,
  // commits the message-key heuristic missed) — they collapsed to the 16px
  // minimum and looked like the ring was missing.
  const maxVolume = useMemo(() => {
    return Math.max(1, ...Object.values(ringStats).map(r => Math.log(r.commitCount + r.totalJiras + 1)));
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

  const layout = useMemo(() => columnLayout(project), [project]);

  // In owner mode the merged column is the assignee, so rows must be ordered by
  // assignee for run-length merging to produce one block per person. The service
  // sorts by goal → initiative → summary, which is meaningless for a flat project.
  const orderedEpics = useMemo(() => {
    if (project?.hierarchy !== 'owner') return filteredEpics;
    return [...filteredEpics].sort((a, b) => {
      const an = a.assignee || '￿';
      const bn = b.assignee || '￿';
      if (an !== bn) return an.localeCompare(bn);
      return a.summary.localeCompare(b.summary);
    });
  }, [filteredEpics, project]);

  // Precompute rowSpans for the merged leading cells
  const spans = useMemo(
    () => computeSpans(orderedEpics, project?.hierarchy ?? 'goal-initiative'),
    [orderedEpics, project],
  );

  // Untracked work is computed against JIRA_PROJECTS_JQL, so it is only
  // meaningful on the project that variable names. Everywhere else it would be
  // showing one project's leftovers on another project's board.
  //
  // The hierarchy clause is a cell-count guard, not a provenance one: the
  // untracked rows below hard-code the seven-column goal/initiative shape, so
  // a first-position project configured with the six-column owner layout could
  // not host them without breaking the table.
  const isLegacyProject = useMemo(
    () => !!project && projectList.length > 0
      && project.projectKey === projectList[0].projectKey
      && project.hierarchy === 'goal-initiative',
    [project, projectList],
  );

  // Map epic key → group IDs so merged cells can highlight when any sibling row is hovered
  const epicGroupMap = useMemo(() => {
    const map = new Map<string, { primaryGroupId: string; secondaryGroupId: string }>();
    for (let i = 0; i < orderedEpics.length; i++) {
      map.set(orderedEpics[i].key, {
        primaryGroupId: spans[i].primaryGroupId,
        secondaryGroupId: spans[i].secondaryGroupId,
      });
    }
    return map;
  }, [orderedEpics, spans]);

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

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Projects</h1>
          <p className="text-gray-400 text-sm mt-1">Epics from Jira</p>
        </div>
      </div>

      {orgsError && !reportsData && !org && <div className="text-red-400 py-8">Error: No org found &mdash; run a report or check GitHub token</div>}
      {tabError && <div className="text-red-400 py-8">Error: {tabError.message}</div>}

      {tabLoading && <div className="text-gray-500 py-8">Loading projects from Jira...</div>}

      {!tabLoading && !tabError && org && (
        <>
          {/* Filters */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="bg-gray-800 border border-gray-700 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-accent w-48"
            />
            <select
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-accent cursor-pointer"
            >
              {projectList.map(p => (
                <option key={p.projectKey} value={p.projectKey}>{p.displayName}</option>
              ))}
            </select>
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
            {searchQuery && (
              <span className="inline-flex items-center gap-1.5 bg-accent/20 text-accent-lighter text-xs font-medium px-2.5 py-1 rounded-lg border border-accent/30">
                &ldquo;{searchQuery}&rdquo;
                <button onClick={() => setSearchQuery('')} className="text-accent-light hover:text-white ml-0.5">&times;</button>
              </span>
            )}
            {activeFilterCount > 1 && (
              <button onClick={() => urlBatch(() => { setFilterTeam(''); setFilterGoal(''); setFilterInitiative(''); setSearchQuery(''); })} className="text-xs text-gray-600 hover:text-gray-400">Clear all</button>
            )}
          </div>

          {/* Status tabs — below filters */}
          <div className="flex border-b border-gray-800 mb-4">
            {tabs.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-xs font-medium transition-colors relative ${
                  activeTab === tab ? 'text-accent-lighter' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {tabLabel(project, tab)}
                {activeTab === tab && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-light rounded-t" />
                )}
              </button>
            ))}
          </div>

          {epics.length === 0 ? (
            <div className="text-gray-500 py-8">No epics on the {tabLabel(project, activeTab)} tab.</div>
          ) : orderedEpics.length === 0 ? (
            <div className="text-gray-500 py-8">No epics match the selected filters.</div>
          ) : (
            <div className="rounded-lg border border-gray-800">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  {layout.widths.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
                </colgroup>
                <thead>
                  <tr className="bg-gray-900/50 text-gray-400 text-left text-xs uppercase tracking-wider">
                    {layout.headers.map((h, i) => (
                      <th key={i} className={h === '' ? 'px-2 py-3 font-medium' : 'px-4 py-3 font-medium'}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orderedEpics.map((epic, i) => {
                    const { primarySpan, secondarySpan, showPrimary, showSecondary, primaryGroupId, secondaryGroupId } = spans[i];
                    const hoveredGroups = hoveredEpic ? epicGroupMap.get(hoveredEpic) : null;
                    const isPrimaryHovered = hoveredGroups?.primaryGroupId === primaryGroupId;
                    const isSecondaryHovered = hoveredGroups?.secondaryGroupId === secondaryGroupId;

                    return (
                      <tr
                        key={epic.key}
                        className={`border-b border-gray-800/50 transition-colors ${hoveredEpic === epic.key ? 'bg-gray-800/30' : ''}`}
                        onMouseEnter={() => setHoveredEpic(epic.key)}
                        onMouseLeave={() => setHoveredEpic(null)}
                      >
                        {layout.showOwnerColumn && showPrimary && (
                          <td
                            className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isPrimaryHovered && hoveredEpic !== epic.key ? 'bg-gray-800/30' : ''}`}
                            rowSpan={primarySpan}
                          >
                            {epic.assignee
                              ? <span className="text-gray-300 text-[13px]">{epic.assignee}</span>
                              : <span className="text-gray-600">Unassigned</span>}
                          </td>
                        )}
                        {layout.showHierarchy && showPrimary && (
                          <td
                            className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isPrimaryHovered && hoveredEpic !== epic.key ? 'bg-gray-800/30' : ''}`}
                            rowSpan={primarySpan}
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
                        {layout.showHierarchy && showSecondary && (
                          <td
                            className={`px-4 py-3 align-top border-r border-gray-800/30 transition-colors ${isSecondaryHovered && hoveredEpic !== epic.key ? 'bg-gray-800/30' : ''}`}
                            rowSpan={secondarySpan}
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
                            <ProgressRing
                              stats={ringStats[epic.key]}
                              maxVolume={maxVolume}
                              avgCommitsPerJira={avgCommitsPerJira}
                            />
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
                                      {summaryData[epic.key]!.remaining.length > 0 && (
                                        <div className="mt-2">
                                          <div className="text-[10px] uppercase tracking-wider font-semibold text-gray-500 mb-1">Open Jiras</div>
                                          <ul className="text-[11px] text-gray-500 leading-relaxed space-y-0.5">
                                            {summaryData[epic.key]!.remaining.map(t => (
                                              <li key={t.key}>
                                                {jiraHost ? (
                                                  <a
                                                    href={`https://${jiraHost}/browse/${t.key}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    onClick={e => e.stopPropagation()}
                                                    className="text-amber-400 hover:text-amber-300 hover:underline transition-colors"
                                                  >
                                                    <span className="font-mono">{t.key}</span> {t.summary}
                                                  </a>
                                                ) : (
                                                  <span className="text-amber-400">
                                                    <span className="font-mono">{t.key}</span> {t.summary}
                                                  </span>
                                                )}
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      )}
                                      {summaryData[epic.key]!.commits.length > 0 && (
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
                                                const jiraMatch = findFirstJiraKey(c.message);
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
                                                          <a href={`https://${jiraHost}/browse/${jiraMatch.key}`} target="_blank" rel="noopener noreferrer" className="text-accent-light hover:text-accent-lighter" onClick={e => e.stopPropagation()}>{jiraMatch.key}</a>
                                                          {' '}{(c.message.slice(0, jiraMatch.start) + c.message.slice(jiraMatch.end)).trim()}
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
                        <td className={`px-4 py-3 relative ${activeTab === 'active' && isOverdue(epic.dueDate) ? 'text-red-400' : 'text-gray-400'}`}>
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
                          {!layout.showOwnerColumn && <div>{epic.assignee || '—'}</div>}
                          <div className={layout.showOwnerColumn ? '' : 'mt-0.5'}>
                            {canAct ? (
                              <div
                                onClick={(e) => { e.stopPropagation(); openStatusEditor(epic.key, e.currentTarget as HTMLElement); }}
                                className={`flex items-center gap-1 cursor-pointer text-[10px] transition-colors ${
                                  editingStatus === epic.key ? 'text-accent-lighter' : 'text-gray-500 hover:text-gray-300'
                                }`}
                              >
                                <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{
                                  background: savingStatus === epic.key ? '#6B7280' :
                                    epic.status === 'Done' ? '#10B981' : epic.status === 'Rollout' ? '#3B82F6' :
                                    epic.status === 'In Progress' ? '#D97706' : '#6B7280'
                                }} />
                                {savingStatus === epic.key ? 'Saving...' : epic.status}
                                <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" /></svg>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 text-[10px] text-gray-600">
                                <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{
                                  background: epic.status === 'Done' ? '#10B981' : epic.status === 'Rollout' ? '#3B82F6' :
                                    epic.status === 'In Progress' ? '#D97706' : '#6B7280'
                                }} />
                                {epic.status}
                              </div>
                            )}
                            {editingStatus === epic.key && statusDropdownPos && (
                              <>
                                <div className="fixed inset-0 z-20" onClick={() => { setEditingStatus(null); setStatusDropdownPos(null); statusTriggerRef.current = null; setTransitionError(null); }} />
                                <div
                                  className="fixed z-30 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden min-w-[140px]"
                                  style={{ top: statusDropdownPos.top, left: statusDropdownPos.left }}
                                >
                                  {transitionError && (
                                    <div className="px-3 py-2 text-xs text-red-400 border-b border-gray-700 bg-red-950/30">
                                      {transitionError}
                                    </div>
                                  )}
                                  {transitionsLoading && !transitionsCache[epic.key] ? (
                                    <div className="px-3 py-2 text-xs text-gray-500 animate-pulse">Loading...</div>
                                  ) : (transitionsCache[epic.key] || []).length === 0 ? (
                                    <div className="px-3 py-2 text-xs text-gray-600">No transitions</div>
                                  ) : (
                                    (transitionsCache[epic.key] || []).map(t => (
                                      <button
                                        key={t.id}
                                        onClick={(e) => { e.stopPropagation(); if (t.to.name === epic.status) { setEditingStatus(null); setStatusDropdownPos(null); statusTriggerRef.current = null; setTransitionError(null); } else { executeTransition(epic.key, t.id, t.to.name); } }}
                                        className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2 ${
                                          t.to.name === epic.status ? 'text-accent-lighter font-medium' : 'text-gray-300 hover:bg-gray-700'
                                        }`}
                                      >
                                        <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{
                                          background: t.to.name === 'Done' ? '#10B981' : t.to.name === 'Rollout' ? '#3B82F6' : t.to.name === 'In Progress' ? '#D97706' : '#6B7280'
                                        }} />
                                        {t.to.name}
                                      </button>
                                    ))
                                  )}
                                </div>
                              </>
                            )}
                          </div>
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
                  {/* Not in Project rows — only on the active tab, and only on the
                      project untracked work is actually computed against: these rows
                      hard-code the seven-column layout, and untracked work is
                      commit-derived, which is exactly what a research board should
                      not be judged on. */}
                  {isLegacyProject && activeTab === 'active' && (() => {
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
                                                  const jiraMatch = findFirstJiraKey(c.message);
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
                                                            <a href={`https://${jiraHost}/browse/${jiraMatch.key}`} target="_blank" rel="noopener noreferrer" className="text-accent-light hover:text-accent-lighter" onClick={e => e.stopPropagation()}>{jiraMatch.key}</a>
                                                            {' '}{(c.message.slice(0, jiraMatch.start) + c.message.slice(jiraMatch.end)).trim()}
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
                  {/* Gated like the rows and the trigger button: `untrackedTeams`
                      persists across project switches, so an ungated count advertises
                      untracked work that another project's board never renders. */}
                  {isLegacyProject && untrackedTeams.length > 0 && ` · ${untrackedTeams.length} team${untrackedTeams.length !== 1 ? 's' : ''} with untracked work`}
                </span>
                {isLegacyProject && activeTab === 'active' && untrackedTeams.length === 0 && !untrackedLoading && (
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
