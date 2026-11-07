import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { ConfigError, createSupabaseClient, fetchSupabaseConfig } from '../lib/supabase';
import { loadAccount, type AccountContext } from '../lib/account';
import { resetSharedCache } from '../lib/resourceCache';

export type AuthPhase = 'loading' | 'config-error' | 'signed-out' | 'signed-in';

export interface SignUpResult {
  error: string | null;
  info: string | null;
}

export interface AuthContextValue {
  phase: AuthPhase;
  client: SupabaseClient | null;
  session: Session | null;
  account: AccountContext | null;
  accountLoading: boolean;
  accountError: string | null;
  configError: string | null;
  configProblems: string[];
  recoveryMode: boolean;
  signIn: (email: string, password: string) => Promise<string | null>;
  resetPassword: (email: string) => Promise<string | null>;
  updatePassword: (password: string) => Promise<string | null>;
  signUp: (input: { email: string; password: string; fullName: string; requestedRole: 'parent' | 'child' }) => Promise<SignUpResult>;
  signOut: () => Promise<string | null>;
  retryConfig: () => void;
  retryAccount: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [booting, setBooting] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configProblems, setConfigProblems] = useState<string[]>([]);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [account, setAccount] = useState<AccountContext | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountAttempt, setAccountAttempt] = useState(0);
  // The account whose rows the shared screen cache currently holds. A change here means the
  // cache must be dropped before anything can be read for the new session.
  const cachedForUser = useRef<string | null>(null);

  // 1. Load the browser-safe Supabase settings, then restore any stored session.
  useEffect(() => {
    let cancelled = false;
    setBooting(true);
    setConfigError(null);
    setConfigProblems([]);

    void (async () => {
      try {
        const config = await fetchSupabaseConfig();
        if (cancelled) return;
        const created = createSupabaseClient(config);
        const { data, error } = await created.auth.getSession();
        if (cancelled) return;
        if (error) {
          setConfigError(`Could not restore your session: ${error.message}`);
          setConfigProblems([]);
          return;
        }
        setSession(data.session);
        cachedForUser.current = data.session?.user?.id ?? null;
        setClient(created);
      } catch (cause) {
        if (cancelled) return;
        if (cause instanceof ConfigError) {
          setConfigError(cause.message);
          setConfigProblems(cause.problems);
        } else {
          setConfigError(cause instanceof Error ? cause.message : 'Could not start FamGuard.');
          setConfigProblems([]);
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [configAttempt]);

  // 2. Keep the session in sync with Supabase auth events (sign in, refresh, sign out).
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      if (event === 'SIGNED_OUT') setRecoveryMode(false);
      // Rows loaded for one account must never be handed to the next one, so the shared
      // screen cache is dropped whenever the authenticated user changes — including a
      // sign-out, where the new id is `null`.
      const nextUserId = nextSession?.user?.id ?? null;
      if (cachedForUser.current !== nextUserId) {
        resetSharedCache();
        cachedForUser.current = nextUserId;
      }
      setSession(nextSession);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, [client]);

  // 3. Resolve profile, family membership and role for the signed-in user.
  useEffect(() => {
    if (!client || !session?.user) {
      setAccount(null);
      setAccountError(null);
      setAccountLoading(false);
      return;
    }

    let cancelled = false;
    const user = session.user;
    setAccountLoading(true);
    setAccountError(null);

    void loadAccount(client, user)
      .then((next) => {
        if (!cancelled) setAccount(next);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setAccount(null);
        setAccountError(cause instanceof Error ? cause.message : 'Could not load your account.');
      })
      .finally(() => {
        if (!cancelled) setAccountLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, session?.user, accountAttempt]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      if (!client) return 'FamGuard is still starting up. Please try again in a moment.';
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      return error ? error.message : null;
    },
    [client],
  );

  const resetPassword = useCallback(async (email: string): Promise<string | null> => {
    if (!client) return 'FamGuard is still starting up. Please try again in a moment.';
    const redirectTo = new URL(window.location.pathname, window.location.origin).toString();
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    return error ? error.message : null;
  }, [client]);

  const updatePassword = useCallback(async (password: string): Promise<string | null> => {
    if (!client) return 'FamGuard is still starting up. Please try again in a moment.';
    const { error } = await client.auth.updateUser({ password });
    if (!error) setRecoveryMode(false);
    return error ? error.message : null;
  }, [client]);

  const signUp = useCallback(
    async (input: { email: string; password: string; fullName: string; requestedRole: 'parent' | 'child' }): Promise<SignUpResult> => {
      if (!client) {
        return { error: 'FamGuard is still starting up. Please try again in a moment.', info: null };
      }
      const { data, error } = await client.auth.signUp({
        email: input.email.trim(),
        password: input.password,
        options: { data: { full_name: input.fullName.trim(), requested_role: input.requestedRole } },
      });
      if (error) return { error: error.message, info: null };
      if (!data.session) {
        return {
          error: null,
          info: 'Account created. Check your email to confirm it, then sign in.',
        };
      }
      return { error: null, info: null };
    },
    [client],
  );

  const signOut = useCallback(async (): Promise<string | null> => {
    if (!client) return null;
    // Drop shared screen data before the session ends, so nothing loaded for this account
    // can be shown to whoever signs in next — even if the sign-out request itself fails.
    resetSharedCache();
    cachedForUser.current = null;
    const { error } = await client.auth.signOut();
    return error ? error.message : null;
  }, [client]);

  const retryConfig = useCallback(() => setConfigAttempt((attempt) => attempt + 1), []);
  const retryAccount = useCallback(() => setAccountAttempt((attempt) => attempt + 1), []);

  const phase: AuthPhase = booting
    ? 'loading'
    : configError
      ? 'config-error'
      : session
        ? 'signed-in'
        : 'signed-out';

  const value = useMemo<AuthContextValue>(
    () => ({
      phase,
      client,
      session,
      account,
      accountLoading,
      accountError,
      configError,
      configProblems,
      recoveryMode,
      signIn,
      resetPassword,
      updatePassword,
      signUp,
      signOut,
      retryConfig,
      retryAccount,
    }),
    [
      phase,
      client,
      session,
      account,
      accountLoading,
      accountError,
      configError,
      configProblems,
      recoveryMode,
      signIn,
      resetPassword,
      updatePassword,
      signUp,
      signOut,
      retryConfig,
      retryAccount,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
