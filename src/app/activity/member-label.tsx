import type { CalendarRow } from '@/lib/activity-calendar/metrics';

/** Avatar, display name and yearly total for one calendar row. */
export default function MemberLabel({ row, totalLabel }: { row: CalendarRow; totalLabel: string }) {
  return (
    <>
      {row.avatarUrl ? (
        <img src={row.avatarUrl} alt="" className="w-6 h-6 rounded-full border border-gray-700 shrink-0" />
      ) : (
        <div data-testid="avatar-fallback" className="w-6 h-6 rounded-full bg-gray-700 shrink-0 flex items-center justify-center text-[10px] text-gray-400">
          {(row.name || row.login)[0].toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <span className="block text-sm text-gray-200 truncate" title={row.login}>{row.name || row.login}</span>
        <span className="block text-[11px] text-gray-500 tabular-nums">{totalLabel}</span>
      </div>
    </>
  );
}
