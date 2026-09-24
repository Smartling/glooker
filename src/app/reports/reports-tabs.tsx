'use client';
import useSWR from 'swr';
import { useUrlState } from '@/lib/url-state';
import { useAuth } from '../auth-context';
import VulnerabilitySyncsTab from './vulnerability-syncs-tab';

const TABS = ['reports', 'syncs'] as const;

// Minimal shape: only the one field this component reads (GLOOK-43 Wave B / B2). `/api/llm-config`
// returns much more than this; widening it here would just invite drift from the real response.
interface LlmConfig { vulnerabilities?: { enabled?: boolean } }

export default function ReportsTabs({ reports }: { reports: React.ReactNode }) {
  const { canAct } = useAuth();
  const { data: config } = useSWR<LlmConfig>('/api/llm-config');
  const [tab, setTab] = useUrlState<(typeof TABS)[number]>({ key: 'tab', type: 'enum', values: TABS, default: 'reports', history: 'replace' });
  if (!config?.vulnerabilities?.enabled) return <>{reports}</>;
  const cls = (on: boolean) => `pb-2 text-sm font-medium ${on ? 'text-white border-b-2 border-indigo-500 -mb-px' : 'text-gray-500 hover:text-gray-300'}`;
  return (
    <>
      <div className="flex gap-6 border-b border-gray-800 mb-4">
        <button className={cls(tab === 'reports')} onClick={() => setTab('reports')}>Reports</button>
        <button className={cls(tab === 'syncs')} onClick={() => setTab('syncs')}>Vulnerability syncs</button>
      </div>
      {tab === 'syncs' ? <VulnerabilitySyncsTab canAct={canAct} /> : reports}
    </>
  );
}
