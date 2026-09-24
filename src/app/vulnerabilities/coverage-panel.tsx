'use client';
import { useState } from 'react';
import type { Coverage, CoverageRow } from '@/lib/vulnerabilities/aggregate';

function List({ title, rows, note }: { title: string; rows: CoverageRow[]; note?: (r: CoverageRow) => string | null }) {
  const [open, setOpen] = useState(false);
  const crit = rows.reduce((n, r) => n + r.openCritical, 0);
  return (
    <div className="mb-2">
      <button onClick={() => setOpen(!open)} className="text-xs text-gray-200"><b>{title}</b>: {rows.length} repos · {crit} open critical {open ? '▾' : '▸'}</button>
      {open && (
        <table className="w-full text-[11px] text-gray-400 mt-1"><tbody>
          {rows.map(r => (
            <tr key={r.repoId} className="border-b border-gray-800/40">
              <td className="py-1"><a className="text-indigo-400" href={`https://github.com/${r.fullName}`} target="_blank" rel="noreferrer">{r.fullName}</a></td>
              <td>{r.serviceTier ?? '—'} / {r.codebaseType ?? '—'}</td><td>{r.team ?? 'Unassigned'}</td>
              <td className="text-right">{r.openCritical} crit · {r.openHigh} high</td>
              {note && <td className="pl-2 text-amber-400">{note(r)}</td>}
            </tr>
          ))}
        </tbody></table>
      )}
    </div>
  );
}

export default function CoveragePanel({ coverage }: { coverage: Coverage }) {
  return (
    <div>
      <List title="Needs tagging" rows={coverage.needsTagging} />
      <List title="Excluded by policy" rows={coverage.excludedByPolicy} />
      <List
        title="Unmeasured (Dependabot status error or off)"
        rows={coverage.unmeasured}
        note={r => (r.dependabotStatus === 'dependabot-off' ? 'Dependabot off' : r.detail ?? null)}
      />
    </div>
  );
}
