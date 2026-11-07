import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AuthScreen } from './auth/AuthScreen';
import { Dashboard } from './pages/Dashboard';
import { Onboarding } from './pages/Onboarding';

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true">
        FG
      </span>
      <div>
        <h1>FamGuard</h1>
        <p className="brand-sub">Family safety and protection</p>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <Brand />
        <p className="muted" role="status">
          Connecting to FamGuard…
        </p>
        <div className="skeleton" aria-hidden="true" />
        <div className="skeleton skeleton-short" aria-hidden="true" />
      </div>
    </div>
  );
}

function ConfigErrorScreen() {
  const { configError, configProblems, retryConfig } = useAuth();
  return (
    <div className="auth-page">
      <div className="auth-card">
        <Brand />
        <div className="banner banner-error" role="alert">
          <strong>Supabase is not configured.</strong>
          <p>{configError}</p>
          {configProblems.length > 0 ? (
            <ul className="problem-list">
              {configProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <p className="muted">
          Set the server environment variables and retry. Only the publishable key is used — never a
          service-role or secret key.
        </p>
        <button type="button" className="primary" onClick={retryConfig}>
          Retry
        </button>
      </div>
    </div>
  );
}

function AccountErrorScreen() {
  const { accountError, retryAccount, signOut } = useAuth();
  return (
    <div className="auth-page">
      <div className="auth-card">
        <Brand />
        <div className="banner banner-error" role="alert">
          <strong>Could not load your account.</strong>
          <p>{accountError}</p>
          <p className="muted">
            FamGuard reads only your own rows, so a database policy may be blocking this query. The
            app will not attempt to change any database policy.
          </p>
        </div>
        <div className="form-actions">
          <button type="button" className="primary" onClick={retryAccount}>
            Try again
          </button>
          <button type="button" className="ghost" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function SignedIn() {
  const { client, account, accountLoading, accountError, signOut, retryAccount } = useAuth();

  if (accountError && !account) {
    return <AccountErrorScreen />;
  }

  if (accountLoading && !account) {
    return <LoadingScreen />;
  }

  if (!client || !account) {
    return <LoadingScreen />;
  }

  if (account.memberships.length === 0) {
    return <Onboarding client={client} account={account} onChanged={retryAccount} />;
  }

  return (
    <Dashboard client={client} account={account} onSignOut={() => void signOut()} />
  );
}

function Screen() {
  const { phase } = useAuth();
  if (phase === 'loading') return <LoadingScreen />;
  if (phase === 'config-error') return <ConfigErrorScreen />;
  if (phase === 'signed-out') return <AuthScreen />;
  return <SignedIn />;
}

export default function App() {
  return (
    <AuthProvider>
      <Screen />
    </AuthProvider>
  );
}
