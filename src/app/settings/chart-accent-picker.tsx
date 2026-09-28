'use client';

// GLOOK-58 Decision 16: Settings -> Appearance control for the chart-color preference. Lives in
// its own module (not settings/page.tsx) because a Next.js page.tsx may export only `default`.
import { useTheme } from '@/app/theme-context';
import type { ChartAccent } from '@/app/themes';

const OPTIONS: { value: ChartAccent; label: string; colorVar: string }[] = [
  { value: 'vivid', label: 'Vivid', colorVar: 'var(--accent)' },
  { value: 'soft', label: 'Soft', colorVar: 'var(--chart-accent-soft)' },
  { value: 'deep', label: 'Deep', colorVar: 'var(--chart-accent-deep)' },
];

export function ChartAccentPicker() {
  const { theme, chartAccent, setChartAccent } = useTheme();
  const isLight = theme.mode === 'light';

  return (
    <div className="mt-8">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Chart colors</h3>
      <p className="text-sm text-gray-400 mb-4">
        Calmer options for the weekly activity charts. Soft and Deep can be harder to read on some
        themes. Deep changes dark themes only.
      </p>
      <fieldset className="grid grid-cols-3 gap-4">
        <legend className="sr-only">Chart colors</legend>
        {OPTIONS.map(opt => {
          const isActive = chartAccent === opt.value;
          return (
            <label key={opt.value} className="block cursor-pointer">
              <input
                type="radio"
                name="chart-accent"
                value={opt.value}
                checked={isActive}
                onChange={() => setChartAccent(opt.value)}
                className="sr-only peer"
                aria-label={opt.label}
              />
              <div
                className={`rounded-xl p-4 border-2 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-gray-400 ${
                  isLight ? 'bg-white' : 'bg-gray-900'
                } ${
                  isActive
                    ? isLight ? 'border-gray-400 ring-1 ring-gray-300' : 'border-white/30 ring-1 ring-white/10'
                    : isLight ? 'border-gray-200 hover:border-gray-300' : 'border-transparent hover:border-gray-800'
                }`}
              >
                <p className={`text-sm font-bold mb-2 ${isLight ? 'text-gray-900' : 'text-white'}`}>{opt.label}</p>
                {isActive && (
                  <p aria-hidden="true" className={`text-[10px] ${isLight ? 'text-gray-400' : 'text-gray-500'}`}>
                    Active
                  </p>
                )}
                <div className="flex items-end gap-1 h-8 rounded p-1.5" style={{ background: 'var(--chart-surface)' }}>
                  {[0.5, 0.8, 0.4, 1, 0.65].map((h, i) => (
                    <div key={i} className="flex-1 rounded-sm" style={{ height: `${h * 100}%`, background: opt.colorVar }} />
                  ))}
                </div>
                {opt.value === 'deep' && isLight && (
                  <p aria-hidden="true" className="text-[10px] text-gray-400 mt-2">
                    Same as Vivid on light themes
                  </p>
                )}
              </div>
            </label>
          );
        })}
      </fieldset>
    </div>
  );
}
