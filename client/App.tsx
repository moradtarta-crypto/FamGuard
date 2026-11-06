import { AuthProvider, useAuth } from './auth/AuthProvider';
import { AuthScreen } from './auth/AuthScreen';
import type { AccountRole } from './lib/roles';

const ROLE_LABEL: Record<AccountRole, string> = {
  parent: 'Parent',
  child: 'Child',
};

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
          service-role key.
        </p>
        <button type="button" className="primary" onClick={retryConfig}>
          Retry
        </button>
      </div>
    </div>
  );
}

function AccountShell() {
  const { session, account, accountLoading, accountError, signOut, retryAccount } = useAuth();

  const onSignOut = () => {
    void signOut();
  };

  const role = account?.role ?? null;

  return (
    <div className="page">
      <header className="topbar">
        <Brand />
        <div className="topbar-meta">
          {role ? (
            <span className={`role-badge role-${role}`}>{ROLE_LABEL[role]}</span>
          ) : (
            <span className="role-badge role-unknown">Role not assigned</span>
          )}
          <span className="muted">{account?.displayName ?? session?.user.email ?? 'Signed in'}</span>
          <button type="button" className="ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {accountError ? (
        <div className="banner banner-error" role="alert">
          <strong>Could not load your account.</strong>
          <p>{accountError}</p>
          <p className="muted">
            FamGuard reads only your own rows, so a database policy may be blocking this query. No
            database change will be made from the app.
          </p>
          <button type="button" className="secondary" onClick={retryAccount}>
            Try again
          </button>
        </div>
      ) : null}

      <main className="layout">
        <section className="card" aria-labelledby="account-heading">
          <div className="card-head">
            <h2 id="account-heading">Your account</h2>
            <span className="muted">Supabase authentication</span>
          </div>
          {accountLoading ? (
            <div className="skeleton" aria-hidden="true" />
          ) : (
            <dl className="detail-list">
              <div>
                <dt>Signed in as</dt>
                <dd>{account?.email ?? session?.user.email ?? '—'}</dd>
              </div>
              <div>
                <dt>Interface</dt>
                <dd>
                  {role === 'parent'
                    ? 'Parent account'
                    : role === 'child'
                      ? 'Child account'
                      : 'Not assigned yet'}
                </dd>
              </div>
              <div>
                <dt>Role source</dt>
                <dd>
                  {account?.roleSource === 'membership'
                    ? 'Family membership'
                    : account?.roleSource === 'profile'
                      ? 'Profile record'
                      : 'No role found'}
                </dd>
              </div>
              <div>
                <dt>Profile record</dt>
                <dd>{account?.profile ? 'Loaded' : 'Not created yet'}</dd>
              </div>
            </dl>
          )}
        </section>

        <section className="card" aria-labelledby="family-heading">
          <div className="card-head">
            <h2 id="family-heading">Family</h2>
            <span className="muted">
              {account ? `${account.memberships.length} membership${account.memberships.length === 1 ? '' : 's'}` : '—'}
            </span>
          </div>

          {accountLoading ? (
            <div className="skeleton" aria-hidden="true" />
          ) : account?.familyId ? (
            <div className="panel-note">
              <p>
                Connected to family <code>{account.familyId}</code>.
              </p>
              <p className="muted">
                Member list, chat, SOS, location and zones are the next implementation stage.
              </p>
            </div>
          ) : (
            <div className="empty">
              <p>You are not part of a family yet.</p>
              <p className="muted">
                Creating a family and joining with an invite are the next implementation stage.
              </p>
            </div>
          )}
        </section>
      </main>

      <footer className="footer">
        <span>FamGuard · live data from your Supabase project, no demo records</span>
      </footer>
    </div>
  );
}

function Screen() {
  const { phase } = useAuth();
  if (phase === 'loading') return <LoadingScreen />;
  if (phase === 'config-error') return <ConfigErrorScreen />;
  if (phase === 'signed-out') return <AuthScreen />;
  return <AccountShell />;
}

export default function App() {
  return (
    <AuthProvider>
      <Screen />
    </AuthProvider>
  );
}
