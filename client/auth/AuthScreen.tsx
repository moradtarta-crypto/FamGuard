import { useState } from 'react';
import { useAuth } from './AuthProvider';

type Mode = 'sign-in' | 'sign-up' | 'reset' | 'update';

export function AuthScreen({ recoveryMode = false }: { recoveryMode?: boolean }) {
  const { signIn, signUp, resetPassword, updatePassword } = useAuth();
  const [mode, setMode] = useState<Mode>(recoveryMode ? 'update' : 'sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [requestedRole, setRequestedRole] = useState<'parent' | 'child'>('parent');
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
      } else if (mode === 'sign-up') {
        const result = await signUp({ email, password, fullName, requestedRole });
        if (result.error) setError(result.error);
        if (result.info) setInfo(result.info);
        if (!result.error) setPassword('');
      } else if (mode === 'reset') {
        const message = await resetPassword(email);
        if (message) setError(message);
        else setInfo('If an account exists for this email, a password reset link has been sent. Check your inbox and spam folder.');
      } else {
        if (password.length < 6) {
          setError('Your new password must contain at least 6 characters.');
        } else {
          const message = await updatePassword(password);
          if (message) setError(message);
          else {
            setPassword('');
            setInfo('Your password has been updated. You can now sign in with your new password.');
            setMode('sign-in');
          }
        }
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

        {mode !== 'reset' && mode !== 'update' ? <div className="auth-tabs" role="tablist" aria-label="Account access">
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
        </div> : null}

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
            <>
            <fieldset className="role-choice">
              <legend>Who will use this account?</legend>
              <label>
                <input type="radio" name="requestedRole" value="parent" checked={requestedRole === 'parent'} onChange={() => setRequestedRole('parent')} />
                <span><strong>Parent</strong><small>Create and manage a family</small></span>
              </label>
              <label>
                <input type="radio" name="requestedRole" value="child" checked={requestedRole === 'child'} onChange={() => setRequestedRole('child')} />
                <span><strong>Child</strong><small>Join a family using an invite code</small></span>
              </label>
            </fieldset>
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
            </>
          ) : null}

          {mode !== 'update' ? <label className="field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label> : null}

          {mode !== 'reset' ? <label className="field">
            <span>{mode === 'update' ? 'New password' : 'Password'}</span>
            <input
              type="password"
              autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={6}
              required
            />
          </label> : null}

          <button type="submit" className="primary auth-submit" disabled={pending}>
            {pending ? 'Working…' : mode === 'sign-in' ? 'Sign in' : mode === 'sign-up' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Update password'}
          </button>
        </form>

        {mode === 'sign-in' ? <button type="button" className="ghost" onClick={() => switchMode('reset')}>Forgot password?</button> : null}
        {mode === 'reset' || mode === 'update' ? (
          <button type="button" className="ghost" onClick={() => switchMode('sign-in')}>Back to sign in</button>
        ) : null}
        <p className="muted auth-note">
          {mode === 'sign-in'
            ? 'Sign in with the email and password for your FamGuard account.'
            : mode === 'sign-up'
              ? 'This is a preference only. Your actual parent or child role and permissions are assigned by the family membership workflow.'
              : mode === 'reset'
                ? 'Enter your account email. If it is registered, Supabase will send a secure reset link.'
                : 'Choose a new password for your FamGuard account.'}
        </p>
      </div>
    </div>
  );
}
