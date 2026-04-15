'use client';

import useSWR from 'swr';
import Link from 'next/link';
import LlmFindings from './llm-findings';
import ChatPanel from './chat-panel';

export default function Home() {
  const { data: config, isLoading: loading } = useSWR('/api/llm-config', { revalidateIfStale: false });
  const org = config?.latestReport?.org ?? null;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {loading && (
        <div className="flex items-center justify-center py-16">
          <div className="flex items-center gap-3 text-gray-500">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading...
          </div>
        </div>
      )}

      {!loading && !org && (
        <div className="text-center text-gray-500 py-16">
          <p className="mb-2">No completed reports yet</p>
          <p className="text-xs text-gray-600">
            Go to{' '}
            <Link href="/reports" className="text-indigo-400 hover:text-indigo-300 transition-colors">
              Report History
            </Link>
            {' '}to generate your first report.
          </p>
        </div>
      )}

      <LlmFindings />

      {org && <ChatPanel org={org} />}
    </div>
  );
}
