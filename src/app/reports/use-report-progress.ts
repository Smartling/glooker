'use client';
import { useRef } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/app/vulnerabilities/format';

export interface ReportProgress {
  status:              string;
  step:                string;
  totalRepos:          number;
  processedRepos:      number;
  totalDevelopers:     number;
  completedDevelopers: number;
  error?:              string;
  logs?:               string[];
}

/**
 * One report card's live progress, mirroring `useSyncProgress` in vulnerability-syncs-tab.tsx:
 * a per-card SWR hook polling at 1.5s while the last response is running/pending, stopped
 * otherwise. `onFinish` fires exactly once, the first time the status leaves running/pending.
 */
export function useReportProgress(id: string, enabled: boolean, onFinish: () => void) {
  const firedOnce = useRef(false);
  return useSWR<ReportProgress>(
    enabled ? `/api/report/${id}/progress` : null,
    fetcher,
    {
      dedupingInterval: 1000,
      onErrorRetry: (_err, _key, _config, revalidate, opts) => { setTimeout(() => revalidate(opts), 1500); },
      refreshInterval: (latest?: ReportProgress) =>
        (!latest || latest.status === 'running' || latest.status === 'pending') ? 1500 : 0,
      onSuccess: (data) => {
        // Re-arm on a running/pending fetch (e.g. after Resume revalidates this key) so a later
        // finish fires `onFinish` again instead of staying silenced by an earlier run's guard.
        if (data.status === 'running' || data.status === 'pending') {
          firedOnce.current = false;
          return;
        }
        if (!firedOnce.current) {
          firedOnce.current = true;
          onFinish();
        }
      },
    },
  );
}
