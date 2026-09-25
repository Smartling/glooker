'use client';
import type { ResolvedSince } from '@/lib/vulnerabilities/types';
import { resolvedCaption } from './format';

interface Win { id: string; severity: string; days: number; effectiveFrom: string; until: string | null; pending: boolean }

interface Scope { property: string; value: string }

export default function PolicyPanel({ policy, highActive, resolvedSince, scope, policyInvalid }: {
  policy: Win[]; highActive: boolean; resolvedSince: ResolvedSince; scope: Scope; policyInvalid: boolean;
}) {
  return (
    <div className="text-xs text-gray-300 space-y-1">
      {policy.map(p => (
        <div key={p.id}>{p.id} · {p.days} days · {p.effectiveFrom} → {p.until ?? 'open-ended'} {p.pending && <span className="text-amber-400">pending</span>}</div>
      ))}
      {/* GLOOK-43 Wave P: an invalid policy forces the parsed policy to [] (config.ts), which is
          indistinguishable from a genuinely empty one unless this branches first — an invalid
          policy must never read as "no policy configured yet". */}
      {policyInvalid
        ? <div className="text-red-400">SLA policy configuration is invalid — see the error above</div>
        : policy.length === 0 && <div className="text-gray-500">No SLA policy yet</div>}
      {!policyInvalid && !highActive && !policy.some(p => p.severity === 'high') && <div className="text-gray-500">high · SLA not yet active</div>}
      <div className="text-gray-500">Resolved counted {resolvedCaption(resolvedSince)} · scope: {scope.property} = {scope.value}</div>
      <div className="text-gray-500">Archiving a repo drops its open alerts but keeps its resolved ones, which raises % closed.</div>
    </div>
  );
}
