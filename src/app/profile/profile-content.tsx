'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../auth-context';

interface SelfUsage {
  cc_total_cost?: number;
  cc_requests?: number;
  cc_skills_used?: number;
  skills: Array<{ product: string; skills_used: number; skills_distinct: number }>;
  models: Array<{ model: string; cost?: number; requests?: number }>;
}

export default function ProfileContent() {
  const auth = useAuth();

  const [usage, setUsage] = useState<SelfUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(true);

  const login = auth.user?.githubLogin ?? null;
  useEffect(() => {
    // Auth identity is still resolving — `login` is necessarily null here even for a
    // developer who turns out to be mapped. Don't touch usage state yet: doing so would
    // leave a stale "not loading" flag around for the render where `auth.loading` and
    // `login` both flip to their resolved values in the same update, flashing the
    // empty state before the real fetch has even started.
    if (auth.loading) return;
    if (!login) { setUsageLoading(false); return; }
    setUsageLoading(true);
    let cancelled = false;
    (async () => {
      try {
        const reports = await (await fetch('/api/report')).json();
        const latest = (Array.isArray(reports) ? reports : []).find((r: any) => r.status === 'completed');
        if (!latest) return;
        // Own login only — never a value from the URL or another developer.
        const res = await fetch(`/api/report/${latest.id}/dev/${encodeURIComponent(login)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setUsage({
          cc_total_cost: data.developer?.cc_total_cost,
          cc_requests: data.developer?.cc_requests,
          cc_skills_used: data.developer?.cc_skills_used,
          skills: data.skills ?? [],
          models: data.models ?? [],
        });
      } catch { /* leave usage null — rendered as "no usage" below */ }
      finally { if (!cancelled) setUsageLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [login, auth.loading]);

  if (auth.loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="animate-pulse bg-gray-900 rounded-xl p-8 h-48" />
      </div>
    );
  }

  if (!auth.user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center text-gray-500">
        No user identity found.
      </div>
    );
  }

  const user = auth.user;

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <div className="bg-gray-900 rounded-xl p-8 border border-gray-800">
        <div className="flex items-center gap-5 mb-6">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-20 h-20 rounded-full border-2 border-gray-700" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center text-2xl text-gray-400">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
          )}
          <div>
            {user.name && <h1 className="text-xl font-bold text-white">{user.name}</h1>}
            <p className="text-gray-400">{user.email}</p>
          </div>
        </div>

        <div className="space-y-4 border-t border-gray-800 pt-6">
          {user.githubLogin && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">GitHub</span>
              <span className="text-sm text-gray-300">{user.githubLogin}</span>
            </div>
          )}
          {user.team && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Team</span>
              <span className="text-sm text-gray-300 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: user.team.color }} />
                {user.team.name}
              </span>
            </div>
          )}
          {auth.user.role && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Role</span>
              <span className="text-sm text-gray-300 capitalize">{auth.user.role}</span>
            </div>
          )}
        </div>

        <div className="border-t border-gray-800 pt-6 mt-6">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-4">Your Claude Code usage</p>

          {usageLoading && <div className="animate-pulse bg-gray-800 rounded h-16" />}

          {!usageLoading && !usage && (
            <p className="text-sm text-gray-500">
              No Claude Code usage found for your account in the latest report.
            </p>
          )}

          {!usageLoading && usage && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider">Spend</p>
                  <p className="text-lg font-bold text-green-400">
                    {usage.cc_total_cost != null ? `$${(Number(usage.cc_total_cost) / 100).toFixed(2)}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider">Requests</p>
                  <p className="text-lg font-bold text-gray-200">{usage.cc_requests ?? '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider">Skills invoked</p>
                  <p className="text-lg font-bold text-gray-200">{usage.cc_skills_used ?? 0}</p>
                </div>
              </div>

              {usage.skills.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Skills by product</p>
                  {usage.skills.map(s => (
                    <div key={s.product} className="flex items-center justify-between text-sm py-0.5">
                      <span className="text-gray-400">{s.product}</span>
                      <span className="text-gray-300 tabular-nums">
                        {s.skills_used} used · {s.skills_distinct} distinct
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {usage.models.length > 0 && (
                <div>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Models</p>
                  {usage.models.map(m => (
                    <div key={m.model} className="flex items-center justify-between text-sm py-0.5">
                      <span className="text-gray-400">{m.model}</span>
                      <span className="text-gray-300 tabular-nums">
                        {m.cost != null && m.requests != null
                          ? `$${(Number(m.cost) / 100).toFixed(2)} · ${m.requests} req`
                          : m.cost != null
                            ? `$${(Number(m.cost) / 100).toFixed(2)}`
                            : m.requests != null
                              ? `${m.requests} req`
                              : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-600 mt-8">
          Identity provided by your organization&apos;s identity provider
        </p>
      </div>
    </div>
  );
}
