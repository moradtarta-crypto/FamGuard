import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Banner, Note, SectionCard } from '../components/ui';
import type { AccountContext } from '../lib/account';
import { acceptFamilyInvite, createFamily } from '../lib/data';

/**
 * Shown when the signed-in user has no family_members row yet.
 *
 * Nothing here runs automatically: both actions call the existing SECURITY DEFINER
 * RPCs only after the user submits a form.
 */
export function Onboarding({
  client,
  account,
  onChanged,
}: {
  client: SupabaseClient;
  account: AccountContext;
  onChanged: () => void;
}) {
  const [familyName, setFamilyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createInfo, setCreateInfo] = useState<string | null>(null);

  const [token, setToken] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joinInfo, setJoinInfo] = useState<string | null>(null);

  const onCreateFamily = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = familyName.trim();
    if (trimmed.length < 2) {
      setCreateError('Enter a family name with at least 2 characters.');
      return;
    }

    setCreating(true);
    setCreateError(null);
    setCreateInfo(null);
    try {
      const familyId = await createFamily(client, trimmed);
      setFamilyName('');
      setCreateInfo(`Family created (${familyId.slice(0, 8)}…). Loading your membership…`);
      onChanged();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : 'Could not create this family.');
    } finally {
      setCreating(false);
    }
  };

  const onJoin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = token.trim();
    if (!/^[a-f0-9]{64}$/i.test(trimmed)) {
      setJoinError('The invite token must be exactly 64 hexadecimal characters. Ask the parent to copy the full token again.');
      return;
    }

    setJoining(true);
    setJoinError(null);
    setJoinInfo(null);
    try {
      const familyId = await acceptFamilyInvite(client, trimmed);
      setToken('');
      setJoinInfo(`Joined family (${familyId.slice(0, 8)}…). Loading your membership…`);
      onChanged();
    } catch (cause) {
      setJoinError(cause instanceof Error ? cause.message : 'Could not accept this invite.');
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="page">
      <header className="onboarding-head">
        <h1>Welcome, {account.displayName}</h1>
        <p className="muted">
          Your account exists, but it is not part of a family yet. Create a family as a parent, or
          join one with an invite token from a parent.
        </p>
      </header>

      <div className="grid-two">
        <SectionCard title="Create a family" aside="create_family RPC · parent">
          <form className="form" onSubmit={onCreateFamily}>
            <label className="field">
              <span>Family name</span>
              <input
                type="text"
                value={familyName}
                onChange={(event) => setFamilyName(event.target.value)}
                maxLength={80}
                placeholder="The Tarta family"
                required
              />
            </label>

            {createError ? <Banner tone="error">{createError}</Banner> : null}
            {createInfo ? <Banner tone="success">{createInfo}</Banner> : null}

            <div className="form-actions">
              <button type="submit" className="primary" disabled={creating}>
                {creating ? 'Creating…' : 'Create family'}
              </button>
            </div>
          </form>

          <Note>
            This calls your existing <code>create_family(family_name)</code> function, which also
            writes your membership row and assigns your role. FamGuard does not insert those rows
            itself.
          </Note>
        </SectionCard>

        <SectionCard title="Join a family" aside="accept_family_invite RPC · child">
          <form className="form" onSubmit={onJoin}>
            <label className="field">
              <span>Invite token</span>
              <input
                type="text"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Paste the token from your parent"
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                required
              />
            </label>

            {joinError ? <Banner tone="error">{joinError}</Banner> : null}
            {joinInfo ? <Banner tone="success">{joinInfo}</Banner> : null}

            <div className="form-actions">
              <button type="submit" className="primary" disabled={joining}>
                {joining ? 'Joining…' : 'Join family'}
              </button>
            </div>
          </form>

          <Note>
            The token is passed to your existing <code>accept_family_invite(invite_token)</code>{' '}
            function. The role you receive is whatever that function and your policies assign — the
            app cannot choose it.
          </Note>
        </SectionCard>
      </div>

      <SectionCard title="About this account" aside="from your own rows only">
        <div className="data-row">
          <span className="muted small">Email</span>
          <span>{account.email ?? '—'}</span>
        </div>
        <div className="data-row">
          <span className="muted small">User id</span>
          <span className="mono small">{account.userId}</span>
        </div>
        <div className="data-row">
          <span className="muted small">Profile row</span>
          <span>{account.profile ? 'Present' : 'Not created yet'}</span>
        </div>
        <Note>
          A profile row is not created automatically — your database has no trigger for it. You can
          create or update your own row after joining a family.
        </Note>
      </SectionCard>
    </div>
  );
}
