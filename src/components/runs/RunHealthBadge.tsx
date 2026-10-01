import type { RunHealth } from '@/lib/runs/health';

const TONE: Record<RunHealth['tone'], string> = {
  info:  'bg-sky-500/15 text-sky-300 border-sky-500/30',
  warn:  'bg-amber-500/15 text-amber-300 border-amber-500/30',
  error: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export default function RunHealthBadge({ health }: { health: RunHealth | null }) {
  if (!health) return null;
  return (
    <span title={health.title} className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-semibold ${TONE[health.tone]}`}>
      {health.label}
    </span>
  );
}
