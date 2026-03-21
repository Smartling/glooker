'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { getTheme, getSavedThemeId, saveThemeId, applyTheme, type ThemeColors } from './themes';

interface ThemeContextType {
  theme: ThemeColors;
  setThemeId: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: getTheme('amber-glow'),
  setThemeId: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeColors>(getTheme('amber-glow'));

  useEffect(() => {
    const t = getTheme(getSavedThemeId());
    setTheme(t);
    applyTheme(t);
  }, []);

  function setThemeId(id: string) {
    const t = getTheme(id);
    setTheme(t);
    saveThemeId(id);
    applyTheme(t);
  }

  return (
    <ThemeContext.Provider value={{ theme, setThemeId }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
