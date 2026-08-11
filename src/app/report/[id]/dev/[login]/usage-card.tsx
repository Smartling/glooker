export interface SkillRow { product: string; skills_used: number; skills_distinct: number }
/** cost and requests are optional: the dev route strips both for viewers who
 *  may not see this developer's cost. */
export interface ModelRow { model: string; cost?: number; requests?: number }

/**
 * Exported for tests: mounting the whole page would require mocking useSWR and
 * useParams, which tells us nothing about this card.
 */
export function ClaudeCodeUsageCard({ costCents, requests, skillsUsed, skills, models }: {
  costCents?: number;
  requests?: number;
  skillsUsed?: number;
  skills: SkillRow[];
  models: ModelRow[];
}) {
  const hasSpend = costCents != null && Number(costCents) > 0;
  if (!hasSpend && skills.length === 0 && models.length === 0) return null;

  const maxModelCost = Math.max(...models.map(m => Number(m.cost ?? 0)), 1);

  return (
    <div className="bg-gray-900 rounded-xl p-5 mb-6">
      <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Claude Code Usage</p>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider">Spend</p>
          <p className="text-xl font-bold text-green-400">
            {costCents != null ? `$${(Number(costCents) / 100).toFixed(2)}` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider">Requests</p>
          <p className="text-xl font-bold text-gray-200">{requests != null ? requests : '—'}</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider">Skills Invoked</p>
          <p className="text-xl font-bold text-gray-200">{skillsUsed ?? 0}</p>
        </div>
      </div>

      {skills.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Skills by product</p>
          <div className="space-y-1">
            {skills.map(s => (
              <div key={s.product} className="flex items-center justify-between text-sm py-0.5">
                <span className="text-gray-400">{s.product}</span>
                <span className="text-gray-300 tabular-nums">{s.skills_used} used · {s.skills_distinct} distinct</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {models.length > 0 && (
        <div>
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1.5">Models</p>
          <div className="space-y-1">
            {models.map(m => (
              <div key={m.model} className="flex items-center gap-3 text-sm py-0.5">
                <span className="text-gray-400 truncate min-w-0 flex-1">{m.model}</span>
                {m.cost != null && (
                  <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden shrink-0">
                    <div className="h-full bg-accent-light rounded-full"
                      style={{ width: `${(Number(m.cost) / maxModelCost) * 100}%` }} />
                  </div>
                )}
                <span className="text-gray-300 tabular-nums shrink-0">
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
        </div>
      )}
    </div>
  );
}
