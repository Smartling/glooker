'use client';
import useSWR from 'swr';
import { formatRunTime } from '@/lib/runs/format';

/** GLOOK-59: the vulnerability sync schedule is deployment configuration (VULN_SYNC_CRON / VULN_SYNC_TZ),
 * so Settings shows it read-only next to the editable report schedules. */
export default function VulnScheduleRow() {
  const { data, error } = useSWR<any>('/api/vulnerabilities/syncs?limit=1', { shouldRetryOnError: false });
  if (error || !data || data.available !== true) return null;
  const { cron, tz, next_run } = data.schedule;
  return (
    <div className="bg-gray-900 rounded-xl overflow-hidden mt-4">
      <table className="w-full text-sm">
        <tbody>
          <tr className="text-gray-400">
            <td className="px-4 py-3 text-white font-medium">Dependabot alerts sync</td>
            <td className="px-4 py-3 text-gray-300">{data.org}</td>
            <td className="px-4 py-3 text-gray-400 text-xs font-mono">{cron}</td>
            <td className="px-4 py-3 text-gray-500 text-xs">{tz}</td>
            <td className="px-4 py-3 text-gray-500 text-xs">{formatRunTime(next_run)}</td>
            <td className="px-4 py-3 text-gray-600 text-xs text-right">Configured by deployment</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
