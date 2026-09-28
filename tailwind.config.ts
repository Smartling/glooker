import type { Config } from 'tailwindcss';

// GLOOK-58: chart tokens are CSS variables (globals.css), so the same class resolves to the dark
// value under :root and the light value under [data-theme-mode="light"]. Opacity modifiers
// (e.g. bg-chart-grid/50) do NOT work on these: Tailwind v3 cannot split a var() hex into channels.
const TYPES = ['feature', 'bug', 'refactor', 'infra', 'docs', 'test', 'other', 'in-flight'] as const;

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        chart: {
          grid: 'var(--chart-grid)',
          axis: 'var(--chart-axis)',
          cursor: 'var(--chart-cursor)',
          'tooltip-bg': 'var(--chart-tooltip-bg)',
          'tooltip-border': 'var(--chart-tooltip-border)',
          'tooltip-text': 'var(--chart-tooltip-text)',
          track: 'var(--chart-track)',
          surface: 'var(--chart-surface)',
          type: Object.fromEntries(TYPES.map(t => [t, `var(--chart-type-${t})`])),
          badge: Object.fromEntries(
            TYPES.flatMap(t => [[`${t}-bg`, `var(--chart-badge-${t}-bg)`], [`${t}-text`, `var(--chart-badge-${t}-text)`]]),
          ),
        },
      },
    },
  },
  plugins: [],
};

export default config;
