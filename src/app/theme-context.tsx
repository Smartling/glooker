'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import {
  getTheme, getSavedThemeId, saveThemeId, applyTheme,
  getSavedChartAccent, saveChartAccent, applyChartAccent,
  type ThemeColors, type ChartAccent,
} from './themes';

interface ThemeContextType {
  theme: ThemeColors;
  setThemeId: (id: string) => void;
  chartAccent: ChartAccent;
  setChartAccent: (a: ChartAccent) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: getTheme('amber-glow'),
  setThemeId: () => {},
  chartAccent: 'vivid',
  setChartAccent: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeColors>(getTheme('amber-glow'));
  const [chartAccent, setChartAccentState] = useState<ChartAccent>('vivid');

  useEffect(() => {
    const t = getTheme(getSavedThemeId());
    setTheme(t);
    applyTheme(t);

    const a = getSavedChartAccent();
    setChartAccentState(a);
    applyChartAccent(a);
  }, []);

  function setThemeId(id: string) {
    const t = getTheme(id);
    setTheme(t);
    saveThemeId(id);
    applyTheme(t);
  }

  function setChartAccent(a: ChartAccent) {
    setChartAccentState(a);
    saveChartAccent(a);
    applyChartAccent(a);
  }

  return (
    <ThemeContext.Provider value={{ theme, setThemeId, chartAccent, setChartAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
