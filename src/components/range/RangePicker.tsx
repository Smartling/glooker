'use client';

export interface RangePickerProps<T extends string> {
  options: readonly T[];
  labels: Record<T, string>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** Segmented range control shared by the org charts (90d/12m/all) and the Team/Engineer pages (GLOOK-63). */
export default function RangePicker<T extends string>({ options, labels, value, onChange, ariaLabel }: RangePickerProps<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className="inline-flex rounded-md border border-gray-800 p-0.5 no-print">
      {options.map(o => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={`px-2.5 py-1 text-xs rounded transition-colors ${value === o ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}
