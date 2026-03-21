export interface ThemeColors {
  id: string;
  name: string;
  // CSS hex values for custom properties
  accent: string;        // main accent (buttons, active states)
  accentLight: string;   // lighter (links, text)
  accentLighter: string; // lightest (hover text)
  accentDark: string;    // darker variant
  accentDarker: string;  // darkest (borders)
  accentBg: string;      // very faint background tint (chips, badges)
  bodyBg: string;        // body background
}

export const THEMES: ThemeColors[] = [
  {
    id: 'amber-glow', name: 'Amber Glow',
    accent: '#D97706', accentLight: '#F59E0B', accentLighter: '#FBBF24',
    accentDark: '#B45309', accentDarker: '#92400E', accentBg: '#78350F',
    bodyBg: '#0F0F0F',
  },
  {
    id: 'electric-violet', name: 'Electric Violet',
    accent: '#7C3AED', accentLight: '#8B5CF6', accentLighter: '#A78BFA',
    accentDark: '#6D28D9', accentDarker: '#5B21B6', accentBg: '#4C1D95',
    bodyBg: '#09090B',
  },
  {
    id: 'coral-spark', name: 'Coral Spark',
    accent: '#E11D48', accentLight: '#F43F5E', accentLighter: '#FB7185',
    accentDark: '#BE123C', accentDarker: '#9F1239', accentBg: '#881337',
    bodyBg: '#0A0A0A',
  },
  {
    id: 'soft-lavender', name: 'Soft Lavender',
    accent: '#6366F1', accentLight: '#818CF8', accentLighter: '#A5B4FC',
    accentDark: '#4F46E5', accentDarker: '#4338CA', accentBg: '#3730A3',
    bodyBg: '#0C0A14',
  },
  {
    id: 'midnight-teal', name: 'Midnight Teal',
    accent: '#0D9488', accentLight: '#14B8A6', accentLighter: '#2DD4BF',
    accentDark: '#0F766E', accentDarker: '#115E59', accentBg: '#134E4A',
    bodyBg: '#0A0A0A',
  },
  {
    id: 'classic-blue', name: 'Classic Blue',
    accent: '#2563EB', accentLight: '#3B82F6', accentLighter: '#60A5FA',
    accentDark: '#1D4ED8', accentDarker: '#1E40AF', accentBg: '#1E3A5F',
    bodyBg: '#030712',
  },
];

export function getTheme(id: string): ThemeColors {
  return THEMES.find(t => t.id === id) || THEMES[0];
}

export function getSavedThemeId(): string {
  if (typeof window === 'undefined') return 'amber-glow';
  return localStorage.getItem('glooker-theme') || 'amber-glow';
}

export function saveThemeId(id: string): void {
  localStorage.setItem('glooker-theme', id);
}

export function applyTheme(theme: ThemeColors): void {
  const root = document.documentElement;
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-light', theme.accentLight);
  root.style.setProperty('--accent-lighter', theme.accentLighter);
  root.style.setProperty('--accent-dark', theme.accentDark);
  root.style.setProperty('--accent-darker', theme.accentDarker);
  root.style.setProperty('--accent-bg', theme.accentBg);
  root.style.setProperty('--body-bg', theme.bodyBg);
  document.body.style.backgroundColor = theme.bodyBg;
}
