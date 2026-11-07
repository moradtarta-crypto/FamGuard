import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useAuth } from '../auth/AuthProvider';
import { Banner, DataRow, EmptyState, Note, Pill, SectionCard, SkeletonRows } from '../components/ui';
import { useResource } from '../hooks/useResource';
import type { AccountContext } from '../lib/account';
import {
  createFamilyInvite,
  loadFamily,
  loadFamilyMembers,
  loadInvites,
  loadSubscription,
  saveProfile,
} from '../lib/data';
import { formatDateTime, formatRelative, initials } from '../lib/format';
import { isAccountRole, isSubscriptionStatus } from '../lib/schema';
import { roleLabel } from '../lib/roles';

function refreshedLabel(updatedAt: number | null): string {
  if (!updatedAt) return 'not refreshed yet';
  return `updated ${formatRelative(new Date(updatedAt).toISOString())}`;
}

export function FamilySummary({ client, familyId }: { client: SupabaseClient; familyId: string }) {
  const family = useResource(`family:${familyId}`, () => loadFamily(client, familyId), 60000);

  return (
    <SectionCard title="Family" aside="families">
      {family.error ? (
        <Banner tone="error" title="Family could not be loaded">
          {family.error}
        </Banner>
      ) : null}
      {family.loading && !family.data ? <SkeletonRows count={3} /> : null}
      {!family.loading && !family.error && !family.data ? (
        <EmptyState title="Family not found">
          Your membership points at a family row that is not visible to you.
        </EmptyState>
      ) : null}
      {family.data ? (
        <>
          <DataRow label="Name" value={family.data.name} />
          <DataRow label="Family id" value={<code>{family.data.id}</code>} />
          <DataRow label="Created" value={formatDateTime(family.data.created_at)} />
        </>
      ) : null}
    </SectionCard>
  );
}

export function ProfilePanel({ account }: { account: AccountContext }) {
  const { client, retryAccount } = useAuth();
  const [name, setName] = useState(account.profile?.display_name ?? account.displayName);
  const [language, setLanguage] = useState(account.profile?.preferred_language ?? 'en');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!client) return;

    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Enter a display name with at least 2 characters.');
      return;
    }

    setPending(true);
    setError(null);
    setSaved(null);
    try {
      await saveProfile(client, account.userId, trimmed, language.trim() || 'en');
      setSaved('Profile saved to your own profiles row.');
      retryAccount();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your profile.');
    } finally {
      setPending(false);
    }
  };

  return (
    <SectionCard title="Your profile" aside="profiles">
      <form className="form" onSubmit={onSubmit}>
        <label className="field">
          <span>Display name</span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            required
          />
        </label>

        <label className="field">
          <span>Preferred language</span>
          <input
            type="text"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            maxLength={16}
            placeholder="en"
          />
        </label>

        {error ? <Banner tone="error">{error}</Banner> : null}
        {saved ? <Banner tone="success">{saved}</Banner> : null}

        <div className="form-actions">
          <button type="submit" className="primary" disabled={pending}>
            {pending ? 'Saving…' : 'Save profile'}
          </button>
          {!account.profile ? (
            <span className="muted small">No profiles row exists for you yet.</span>
          ) : null}
        </div>
      </form>

      <Note>
        Your database has no trigger that creates a profiles row, so this form writes only your own
        row when you submit it. If your policies do not allow the write, the exact refusal is shown
        above — FamGuard never changes policies to make it pass.
      </Note>
    </SectionCard>
  );
}

export function MembersPanel({
  client,
  familyId,
  account,
}: {
  client: SupabaseClient;
  familyId: string;
  account: AccountContext;
}) {
  const members = useResource(
    `members:${familyId}`,
    () => loadFamilyMembers(client, familyId),
    30000,
  );

  const count = members.data?.members.length ?? 0;

  return (
    <SectionCard
      title="Members"
      aside={`family_members · ${count} member${count === 1 ? '' : 's'}`}
      actions={
        <button type="button" className="ghost" onClick={members.refresh}>
          Refresh
        </button>
      }
    >
      {members.error ? (
        <Banner tone="error" title="Member list unavailable">
          {members.error}
        </Banner>
      ) : null}

      {members.data?.profileWarning ? (
        <Banner tone="warn" title="Some names are hidden">
          {members.data.profileWarning}
        </Banner>
      ) : null}

      {members.loading && !members.data ? <SkeletonRows count={3} /> : null}

      {members.data && members.data.members.length === 0 ? (
        <EmptyState title="No members yet">
          Invite a family member from the Invites card. Membership rows appear here once an invite
          is accepted.
        </EmptyState>
      ) : null}

      {members.data && members.data.members.length > 0 ? (
        <ul className="member-list">
          {members.data.members.map(({ member, profile }) => {
            const role = isAccountRole(member.role) ? member.role : null;
            const isYou = member.user_id === account.userId;
            const label =
              profile?.display_name?.trim() ||
              (isYou ? account.displayName : `Member ${member.user_id.slice(0, 8)}`);

            return (
              <li className="member" key={`${member.family_id}:${member.user_id}`}>
                <span className="avatar" aria-hidden="true">
                  {initials(label)}
                </span>
                <div className="member-body">
                  <div className="member-name">
                    {label}
                    {isYou ? <span className="muted small"> (you)</span> : null}
                  </div>
                  <div className="muted small">Joined {formatRelative(member.linked_at)}</div>
                </div>
                <Pill tone={role === 'parent' ? 'info' : 'neutral'}>{roleLabel(role)}</Pill>
              </li>
            );
          })}
        </ul>
      ) : null}

      {members.data ? (
        <Note>
          {refreshedLabel(members.updatedAt)} · Supabase Realtime is not enabled for this project, so
          this list polls every 30 seconds instead of subscribing.
        </Note>
      ) : null}
    </SectionCard>
  );
}

export function InvitesPanel({ client, familyId }: { client: SupabaseClient; familyId: string }) {
  const invites = useResource(`invites:${familyId}`, () => loadInvites(client, familyId), 30000);
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const onCreate = async () => {
    setPending(true);
    setError(null);
    setCopied(false);
    try {
      const created = await createFamilyInvite(client, familyId);
      setToken(created);
      invites.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create an invite.');
    } finally {
      setPending(false);
    }
  };

  const onCopy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <SectionCard
      title="Invites"
      aside="family_invites · create_family_invite RPC"
      actions={
        <button type="button" className="primary" onClick={onCreate} disabled={pending}>
          {pending ? 'Creating…' : 'Create invite'}
        </button>
      }
    >
      {error ? (
        <Banner tone="error" title="Invite could not be created">
          {error}
        </Banner>
      ) : null}

      {token ? (
        <Banner tone="success" title="Invite token created — copy it now">
          <p className="token">{token}</p>
          <p className="small">
            Only a hash of this token is stored in <code>family_invites</code>, so it cannot be shown
            again. Send it to the person you want to add; they paste it under “Join a family”.
          </p>
          <button type="button" className="secondary" onClick={onCopy}>
            {copied ? 'Copied' : 'Copy token'}
          </button>
        </Banner>
      ) : null}

      {invites.error ? (
        <Banner tone="error" title="Invite list unavailable">
          {invites.error}
        </Banner>
      ) : null}

      {invites.loading && !invites.data ? <SkeletonRows count={2} /> : null}

      {invites.data && invites.data.length === 0 ? (
        <EmptyState title="No invites yet">Create one to add a family member.</EmptyState>
      ) : null}

      {invites.data && invites.data.length > 0 ? (
        <ul className="plain-list">
          {invites.data.map((invite) => {
            const consumed = invite.consumed_at !== null || invite.consumed_by !== null;
            return (
              <li key={invite.id}>
                <div>
                  <span className="mono small">{invite.id.slice(0, 8)}</span>
                  <div className="muted small">Created {formatDateTime(invite.created_at)}</div>
                </div>
                <Pill tone={consumed ? 'neutral' : 'warn'}>
                  {consumed ? 'Used' : `Expires ${formatDateTime(invite.expires_at)}`}
                </Pill>
              </li>
            );
          })}
        </ul>
      ) : null}

      <Note>
        Tokens are created by the existing SECURITY DEFINER RPC. FamGuard never stores the plain
        token and never queries <code>token_hash</code>.
      </Note>
    </SectionCard>
  );
}

export function SubscriptionPanel({
  client,
  familyId,
}: {
  client: SupabaseClient;
  familyId: string;
}) {
  const subscription = useResource(
    `subscription:${familyId}`,
    () => loadSubscription(client, familyId),
    0,
  );

  return (
    <SectionCard title="Subscription" aside="subscriptions (read only)">
      {subscription.error ? (
        <Banner tone="error" title="Subscription unavailable">
          {subscription.error}
        </Banner>
      ) : null}
      {subscription.loading && !subscription.data ? <SkeletonRows count={2} /> : null}
      {!subscription.loading && !subscription.error && !subscription.data ? (
        <EmptyState title="No subscription row">
          Nothing is stored for this family. Billing is not implemented in FamGuard, and this screen
          never creates or changes a subscription row.
        </EmptyState>
      ) : null}
      {subscription.data ? (
        <>
          <DataRow
            label="Status"
            value={
              <Pill
                tone={
                  isSubscriptionStatus(subscription.data.status) &&
                  subscription.data.status === 'active'
                    ? 'success'
                    : 'neutral'
                }
              >
                {subscription.data.status}
              </Pill>
            }
          />
          <DataRow label="Plan" value={subscription.data.plan_code ?? '—'} />
          <DataRow label="Starts" value={formatDateTime(subscription.data.starts_at)} />
          <DataRow label="Ends" value={formatDateTime(subscription.data.ends_at)} />
          <DataRow label="Verified" value={formatDateTime(subscription.data.verified_at)} />
        </>
      ) : null}
    </SectionCard>
  );
}

const CAPABILITIES: Array<{ label: string; state: string; tone: 'success' | 'warn' | 'neutral' }> = [
  { label: 'Email/password sign-in', state: 'Working', tone: 'success' },
  { label: 'Family creation and invites', state: 'Calls your existing RPCs', tone: 'success' },
  { label: 'Family chat (text)', state: 'Working, polling refresh', tone: 'success' },
  { label: 'SOS alerts', state: 'Stored, polling refresh', tone: 'success' },
  { label: 'Location sharing', state: 'Browser geolocation, polling', tone: 'success' },
  { label: 'Live realtime updates', state: 'Not enabled in your project', tone: 'warn' },
  { label: 'Push or email alerts', state: 'No notification service configured', tone: 'warn' },
  { label: 'Image and voice messages', state: 'No storage bucket verified', tone: 'neutral' },
  { label: 'Zone entry/exit alerts', state: 'Not evaluated by the database', tone: 'warn' },
  { label: 'Payments and billing', state: 'Read-only subscription display', tone: 'neutral' },
];

export function CapabilitiesPanel() {
  return (
    <SectionCard title="What this build can and cannot do" aside="honest capability status">
      <ul className="plain-list">
        {CAPABILITIES.map((item) => (
          <li key={item.label}>
            <span>{item.label}</span>
            <Pill tone={item.tone}>{item.state}</Pill>
          </li>
        ))}
      </ul>
      <Note>
        Nothing above is simulated: where the backend support is missing, the feature is reported as
        unavailable instead of showing placeholder data.
      </Note>
    </SectionCard>
  );
}
