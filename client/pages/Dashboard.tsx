import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Banner, Note, Pill } from '../components/ui';
import {
  CapabilitiesPanel,
  FamilySummary,
  InvitesPanel,
  MembersPanel,
  ProfilePanel,
  SubscriptionPanel,
} from '../features/family';
import { ChatPanel } from '../features/chat';
import {
  MemberLocationsPanel,
  ShareLocationCard,
  SosPanel,
  ZonesPanel,
} from '../features/safety';
import { useResource } from '../hooks/useResource';
import { roleForFamily, type AccountContext } from '../lib/account';
import { loadFamily } from '../lib/data';
import { roleLabel } from '../lib/roles';

type Tab = 'overview' | 'chat' | 'safety' | 'members' | 'account';

export function Dashboard({
  client,
  account,
  onSignOut,
}: {
  client: SupabaseClient;
  account: AccountContext;
  onSignOut: () => void;
}) {
  const membershipKey = useMemo(
    () =>
      account.memberships
        .map((membership) => membership.family_id)
        .sort()
        .join(','),
    [account.memberships],
  );

  const [selectedFamilyId, setSelectedFamilyId] = useState<string>(
    account.memberships[0]?.family_id ?? '',
  );
  const [tab, setTab] = useState<Tab>('overview');

  // Drop the selection if it is no longer one of our memberships.
  useEffect(() => {
    const ids = account.memberships.map((membership) => membership.family_id);
    if (!ids.includes(selectedFamilyId)) {
      setSelectedFamilyId(ids[0] ?? '');
    }
  }, [account.memberships, selectedFamilyId]);

  const families = useResource<Array<{ id: string; name: string }>>(
    `families:${account.userId}:${membershipKey}`,
    async () => {
      const rows = await Promise.all(
        account.memberships.map((membership) => loadFamily(client, membership.family_id)),
      );
      return rows
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .map((row) => ({ id: row.id, name: row.name }));
    },
    0,
  );

  const role = roleForFamily(account.memberships, selectedFamilyId);
  const familyName =
    families.data?.find((family) => family.id === selectedFamilyId)?.name ?? 'Your family';

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'chat', label: 'Family chat' },
    { id: 'safety', label: 'Safety' },
    { id: 'members', label: role === 'parent' ? 'Members & invites' : 'Members' },
    { id: 'account', label: 'Account' },
  ];

  return (
    <div className="page">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="brand-mark" aria-hidden="true">
            FG
          </span>
          <div>
            <strong className="brand-name">FamGuard</strong>
            <span className="muted small block">{account.email ?? account.displayName}</span>
          </div>
        </div>

        <div className="topbar-meta">
          {account.memberships.length > 1 ? (
            <label className="family-switch">
              <span className="sr-only">Selected family</span>
              <select
                value={selectedFamilyId}
                onChange={(event) => setSelectedFamilyId(event.target.value)}
              >
                {account.memberships.map((membership) => {
                  const match = families.data?.find(
                    (family) => family.id === membership.family_id,
                  );
                  return (
                    <option key={membership.family_id} value={membership.family_id}>
                      {match?.name ?? membership.family_id.slice(0, 8)}
                    </option>
                  );
                })}
              </select>
            </label>
          ) : (
            <span className="family-name">{familyName}</span>
          )}

          <Pill tone={role === 'parent' ? 'info' : role === 'child' ? 'success' : 'warn'}>
            {roleLabel(role)}
          </Pill>

          <button type="button" className="ghost" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      {!selectedFamilyId ? (
        <Banner tone="warn" title="No family selected">
          Your membership rows did not include a family id. Reload the page, or contact a parent to
          confirm your invite was accepted.
        </Banner>
      ) : null}

      <nav className="tabs" aria-label="Sections">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={entry.id === tab ? 'tab tab-active' : 'tab'}
            onClick={() => setTab(entry.id)}
            aria-current={entry.id === tab ? 'page' : undefined}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {selectedFamilyId ? (
        <>
          {tab === 'overview' ? (
            <div className="stack">
              <FamilySummary client={client} familyId={selectedFamilyId} />
              <SosPanel
                client={client}
                familyId={selectedFamilyId}
                account={account}
                role={role}
              />
              <CapabilitiesPanel />
            </div>
          ) : null}

          {tab === 'chat' ? (
            <ChatPanel client={client} familyId={selectedFamilyId} account={account} />
          ) : null}

          {tab === 'safety' ? (
            <div className="stack">
              <ShareLocationCard
                client={client}
                familyId={selectedFamilyId}
                account={account}
              />
              <MemberLocationsPanel
                client={client}
                familyId={selectedFamilyId}
                account={account}
              />
              <ZonesPanel
                client={client}
                familyId={selectedFamilyId}
                account={account}
                role={role}
              />
            </div>
          ) : null}

          {tab === 'members' ? (
            <div className="stack">
              <MembersPanel
                client={client}
                familyId={selectedFamilyId}
                account={account}
              />
              {role === 'parent' ? (
                <InvitesPanel client={client} familyId={selectedFamilyId} />
              ) : (
                <Note>
                  Only parents can create invite tokens. Ask a parent if you need to invite someone.
                </Note>
              )}
            </div>
          ) : null}

          {tab === 'account' ? (
            <div className="stack">
              <ProfilePanel account={account} />
              {role === 'parent' ? (
                <SubscriptionPanel client={client} familyId={selectedFamilyId} />
              ) : null}
              <CapabilitiesPanel />
            </div>
          ) : null}
        </>
      ) : null}

      <footer className="footer">
        <span className="muted small">
          Reading only your own permitted rows. Realtime is not enabled on this project, so screens
          refresh on an interval and on demand.
        </span>
      </footer>
    </div>
  );
}
