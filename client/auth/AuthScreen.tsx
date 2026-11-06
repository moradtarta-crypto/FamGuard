import { useState } from 'react';
import { useAuth } from './AuthProvider';

type Mode = 'sign-in' | 'sign-up';

export function AuthScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setInfo(null);
  };

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === 'sign-in') {
        const message = await signIn(email, password);
        if (message) setError(message);
      } else {
        const result = await signUp({ email, password, fullName });
        if (result.error) setError(result.error);
        if (result.info) setInfo(result.info);
        if (!result.error) setPassword('');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            FG
          </span>
          <div>
            <h1>FamGuard</h1>
            <p className="brand-sub">Family safety and protection</p>
          </div>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sign-in'}
            className={mode === 'sign-in' ? 'auth-tab is-active' : 'auth-tab'}
            onClick={() => switchMode('sign-in')}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'sign-up'}
            className={mode === 'sign-up' ? 'auth-tab is-active' : 'auth-tab'}
            onClick={() => switchMode('sign-up')}
          >
            Create account
          </button>
        </div>

        {error ? (
          <div className="banner banner-error" role="alert">
            {error}
          </div>
        ) : null}
        {info ? (
          <div className="banner banner-info" role="status">
            {info}
          </div>
        ) : null}

        <form className="auth-form" onSubmit={onSubmit} noValidate={false}>
          {mode === 'sign-up' ? (
            <label className="field">
              <span>Full name</span>
              <input
                type="text"
                autoComplete="name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                maxLength={80}
                required
              />
            </label>
          ) : null}

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
              required
            />
          </label>

          <button type="submit" className="primary auth-submit" disabled={pending}>
            {pending ? 'Working…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="muted auth-note">
          {mode === 'sign-in'
            ? 'Sign in with the email and password for your FamGuard account.'
            : 'Your role (parent or child) comes from your family membership in FamGuard.'}
        </p>
      </div>
    </div>
  );
}
