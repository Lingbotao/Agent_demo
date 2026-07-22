import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export type UserRole = 'admin' | 'agent' | 'visitor';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  logout: () => void;
  /** 注入到 fetch / EventSource 的 Authorization 头 */
  authHeader: () => Record<string, string>;
}

const AuthContext = createContext<AuthState | null>(null);

const TOKEN_KEY = 'auth_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  /** 用本地 token 询问后端当前用户 */
  const fetchMe = useCallback(async (token: string) => {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('token invalid');
      const data = await res.json();
      setUser(data.user as AuthUser);
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) {
      fetchMe(token).finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [fetchMe]);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data?.error || '登录失败');
    }
    localStorage.setItem(TOKEN_KEY, data.token);
    const u = data.user as AuthUser;
    setUser(u);
    return u;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  const authHeader = useCallback((): Record<string, string> => {
    const token = localStorage.getItem(TOKEN_KEY);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, authHeader }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}