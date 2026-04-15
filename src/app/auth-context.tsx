'use client';

import { createContext, useContext, type ReactNode } from 'react';
import useSWR from 'swr';

interface AuthUser {
  email: string;
  githubLogin: string | null;
  name: string | null;
  avatarUrl: string | null;
  team: { name: string; color: string } | null;
  role: 'admin' | 'viewer';
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
  const { data, isLoading } = useSWR('/api/auth/me', { revalidateIfStale: false });

  const state: AuthContextType = {
    enabled: data?.enabled ?? false,
    user: data?.user ?? null,
    loading: isLoading,
  };

  return (
    <AuthContext.Provider value={state}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  const canAct = !ctx.enabled || ctx.user?.role === 'admin';
  return { ...ctx, canAct };
}
