'use client';
import { useState, type ReactNode } from 'react';
import type { RunStatus } from '@/lib/runs/status';
import { formatRunTime, formatDuration } from '@/lib/runs/format';
import RunStatusChip from './RunStatusChip';

export interface RunProgressView {
  step: string;
  counter?: string | null;
  pct: number;
  running: boolean;
  tone: 'normal' | 'failed' | 'stopped';
  error?: string | null;
  logs: string[];
}

/** One colouring rule for report and sync logs. */
export function logLineClass(line: string): string {
  if (line.includes('ERROR') || line.includes('FATAL') || line.includes('failed')) return 'text-red-400';
  if (line.includes('SKIP')) return 'text-yellow-500';
  if (line.includes('LLM [')) return 'text-accent-light';
  if (line.includes('DEV ')) return 'text-green-400';
  return 'text-gray-600';
}

const BAR: Record<RunProgressView['tone'], string> = { normal: 'bg-accent', failed: 'bg-red-500', stopped: 'bg-orange-500' };

function Progress({ p }: { p: RunProgressView }) {
  const [showLogs, setShowLogs] = useState(true);
  return (
    <div className="border-t border-gray-800 px-4 pb-3 pt-3">
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-gray-400">{p.step}</span>
        {p.counter && <span className="text-gray-600">{p.counter}</span>}
      </div>
      <div className="h-1.5 bg-chart-track rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${BAR[p.tone]}`}
          style={{ width: `${Math.max(p.pct, p.running ? 2 : 0)}%` }} />
      </div>
      {p.error && <p className="text-xs text-red-400 mt-1.5">{p.error}</p>}
      {p.logs.length > 0 && (
        <div className="mt-3">
          <button onClick={(e) => { e.stopPropagation(); setShowLogs(!showLogs); }}
            className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-gray-400 uppercase tracking-wider font-semibold">
            <svg className={`w-3 h-3 transition-transform ${showLogs ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            Logs ({p.logs.length})
          </button>
          {showLogs && (
            <div className="max-h-48 overflow-y-auto mt-1.5 p-2 bg-gray-950 rounded-lg font-mono text-[11px] leading-relaxed">
              {p.logs.map((line, i) => <div key={i} className={logLineClass(line)}>{line}</div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface RunCardProps {
  status: RunStatus;
  label: string;
  subject: ReactNode;
  trigger?: string | null;
  startedAt: string | Date;
  finishedAt?: string | Date | null;
  health?: ReactNode;
  actions?: ReactNode;
  progress?: RunProgressView | null;
  expandable: boolean;
  expanded: boolean;
  onToggle: () => void;
  children?: ReactNode;
}

export default function RunCard(p: RunCardProps) {
  return (
    <div className={`group bg-gray-900 border rounded-xl transition-colors ${p.expanded ? 'border-gray-700' : 'border-gray-800 hover:border-gray-700'}`}>
      <div className={`flex items-center justify-between p-4 ${p.expandable ? 'cursor-pointer' : ''}`}
        onClick={() => (p.expandable ? p.onToggle() : undefined)}>
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          {p.expandable && (
            <svg className={`w-3.5 h-3.5 text-gray-600 transition-transform ${p.expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
          <RunStatusChip status={p.status} label={p.label} />
          <span className="font-medium text-white">{p.subject}</span>
          {p.trigger && <span className="text-sm text-gray-400">{p.trigger}</span>}
          <span className="text-xs text-gray-500">{formatDuration(p.startedAt, p.finishedAt ?? null)}</span>
          {p.health}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">{formatRunTime(p.startedAt)}</span>
          {p.actions && (
            <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}>
              {p.actions}
            </div>
          )}
        </div>
      </div>
      {p.progress && <Progress p={p.progress} />}
      {p.expanded && p.children && <div className="border-t border-gray-800 px-4 pb-4 pt-3">{p.children}</div>}
    </div>
  );
}
