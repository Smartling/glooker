import { STATUS_STYLE, type RunStatus } from '@/lib/runs/status';

export default function RunStatusChip({ status, label }: { status: RunStatus; label: string }) {
  const s = STATUS_STYLE[status];
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${s.text} ${s.bg}`}>{label}</span>;
}
