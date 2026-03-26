'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface AuthUser {
  email: string;
  githubLogin: string | null;
  name: string | null;
  avatarUrl: string | null;
  team: { name: string; color: string } | null;
}

interface AuthContextType {
  enabled: boolean;
  user: AuthUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  enabled: false,
  user: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthContextType>({
    enabled: false,
    user: null,
    loading: true,
  });

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        setState({
          enabled: data.enabled ?? false,
          user: data.user ?? null,
          loading: false,
        });
      })
      .catch(() => {
        setState({ enabled: false, user: null, loading: false });
      });
  }, []);

  return (
    <AuthContext.Provider value={state}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
