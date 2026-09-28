'use client';
import { useRef } from 'react';
import useSWR from 'swr';
import { useUrlState } from '@/lib/url-state';
import { useAuth } from '../auth-context';
import ReportsTab from './reports-tab';
import VulnerabilitySyncsTab from './vulnerability-syncs-tab';

const TABS = ['reports', 'syncs'] as const;

// Minimal shape: only the one field this component reads (GLOOK-43 Wave B / B2). `/api/llm-config`
// returns much more than this; widening it here would just invite drift from the real response.
interface LlmConfig { vulnerabilities?: { enabled?: boolean } }

export default function ReportsTabs() {
  const { canAct } = useAuth();
  const { data: config } = useSWR<LlmConfig>('/api/llm-config');
  const [tab, setTab] = useUrlState<(typeof TABS)[number]>({ key: 'tab', type: 'enum', values: TABS, default: 'reports', history: 'replace' });
  // Ids seen running this page session. Owned here (not by either tab) so retention survives a tab
  // switch — the inactive tab unmounts while the other is shown.
  const observedReports = useRef<Set<string>>(new Set());
  const observedSyncs = useRef<Set<number>>(new Set());
  // Ids whose finish side effect (list mutate + global SWR cache bust) has already run. Also owned
  // here, for the same reason: ReportsTab unmounts when the syncs tab is shown, so a per-card ref
  // inside it would reset and re-fire the bust every time the reports tab remounts.
  const finishedFired = useRef<Set<string>>(new Set());

  const reportsTab = <ReportsTab canAct={canAct} observedRunning={observedReports.current} finishedFired={finishedFired.current} />;

  if (!config?.vulnerabilities?.enabled) return reportsTab;

  const cls = (on: boolean) => `pb-2 text-sm font-medium ${on ? 'text-white border-b-2 border-accent -mb-px' : 'text-gray-500 hover:text-gray-300'}`;
  return (
    <>
      <div className="flex gap-6 border-b border-gray-800 mb-4">
        <button className={cls(tab === 'reports')} onClick={() => setTab('reports')}>Reports</button>
        <button className={cls(tab === 'syncs')} onClick={() => setTab('syncs')}>Vulnerability syncs</button>
      </div>
      {tab === 'syncs' ? <VulnerabilitySyncsTab canAct={canAct} observedRunning={observedSyncs.current} /> : reportsTab}
    </>
  );
}
