import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Banner, DataRow, EmptyState, Note, Pill, SectionCard, SkeletonRows } from '../components/ui';
import { useResource } from '../hooks/useResource';
import type { AccountContext } from '../lib/account';
import {
  acknowledgeSos,
  createZone,
  loadFamilyMembers,
  loadLatestLocations,
  loadSosEvents,
  loadZones,
  setZoneEnabled,
  shareLocation,
} from '../lib/data';
import { batteryPercent, currentPosition } from '../lib/geolocation';
import {
  distanceMeters,
  formatBattery,
  formatCoordinates,
  formatDistance,
  formatRelative,
  initials,
} from '../lib/format';
import { isZoneKind } from '../lib/schema';
import type { AccountRole, ZoneKind } from '../lib/schema';
import { sendSosAlert } from '../lib/sos';

function refreshedLabel(updatedAt: number | null): string {
  if (!updatedAt) return 'not refreshed yet';
  return `updated ${formatRelative(new Date(updatedAt).toISOString())}`;
}

/**
 * Shown when `family_members` returns no rows for a family this account belongs to. That
 * result is ambiguous — the family may be empty, or the rows may not be visible to this
 * account — so the screen must not present it as "nobody is sharing".
 */
const MEMBERSHIP_UNVERIFIED_NOTE =
  'Could not verify the family member list, so location sharing cannot be confirmed.';

/**
 * The safety cards below all need the same latest-location rows. A short sharing window
 * keeps them on one request per refresh instead of three, while staying far below the
 * polling interval so a shared row is never presented as fresher than it is.
 */
const LOCATION_CACHE_MS = 5000;

function MembershipUnverified() {
  return (
    <Banner tone="warn" title="Member list could not be verified">
      {MEMBERSHIP_UNVERIFIED_NOTE} An empty member list is not a confirmed “no updates yet”.
    </Banner>
  );
}

/* --------------------------------------------------------------- location */

export function ShareLocationCard({
  client,
  familyId,
  account,
}: {
  client: SupabaseClient;
  familyId: string;
  account: AccountContext;
}) {
  const viewerRole = account.memberships.find((membership) => membership.family_id === familyId)?.role ?? null;
  const latest = useResource(
    `locations:${familyId}`,
    () => loadLatestLocations(client, familyId, viewerRole),
    20000,
    LOCATION_CACHE_MS,
  );
  const rows = latest.data?.rows ?? [];
  const membershipUnverified = latest.data?.membership === 'unverified';
  const locationHistoryRestricted = latest.data?.membership === 'restricted';
  const mine = rows.find((row) => row.child_user_id === account.userId) ?? null;

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const onShare = async () => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const position = await currentPosition();
      const battery = await batteryPercent();
      await shareLocation(client, {
        familyId,
        childUserId: account.userId,
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyM: position.accuracy,
        batteryPercent: battery,
      });
      setMessage('Location shared with your family.');
      latest.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not share your location.');
    } finally {
      setPending(false);
    }
  };

  return (
    <SectionCard
      title="Share my location"
      aside="location_updates"
      actions={
        <button type="button" className="primary" onClick={onShare} disabled={pending}>
          {pending ? 'Sharing…' : 'Share now'}
        </button>
      }
    >
      {error ? <Banner tone="error" title="Location not shared">{error}</Banner> : null}
      {message ? <Banner tone="success">{message}</Banner> : null}
      {latest.error ? (
        <Banner tone="error" title="Location history unavailable">
          {latest.error}
        </Banner>
      ) : null}

      {mine ? (
        <>
          <DataRow label="Last shared" value={formatRelative(mine.recorded_at)} />
          <DataRow
            label="Coordinates"
            value={formatCoordinates(mine.latitude, mine.longitude)}
          />
          <DataRow label="Accuracy" value={formatDistance(mine.accuracy_m)} />
          <DataRow label="Battery" value={formatBattery(mine.battery_percent)} />
        </>
      ) : membershipUnverified ? (
        <MembershipUnverified />
      ) : locationHistoryRestricted ? (
        <Note>Your account can share its location, but only a parent can view location history. Ask a parent to confirm that your update arrived.</Note>
      ) : (
        <EmptyState title="You have not shared a location yet">
          Sharing asks the browser for permission once, then stores a single row in
          <code> location_updates</code>. Nothing is shared automatically.
        </EmptyState>
      )}

      <Note>
        Your browser only reports a position over HTTPS (or on localhost) and after you grant
        permission. Supabase Realtime is not enabled, so this card refreshes every 20 seconds.
      </Note>
    </SectionCard>
  );
}

export function MemberLocationsPanel({
  client,
  familyId,
  account,
}: {
  client: SupabaseClient;
  familyId: string;
  account: AccountContext;
}) {
  const viewerRole = account.memberships.find((membership) => membership.family_id === familyId)?.role ?? null;
  const latest = useResource(
    `locations:${familyId}`,
    () => loadLatestLocations(client, familyId, viewerRole),
    20000,
    LOCATION_CACHE_MS,
  );
  const members = useResource(
    `safety-members:${familyId}`,
    () => loadFamilyMembers(client, familyId),
    60000,
  );

  const names = new Map<string, string>();
  for (const entry of members.data?.members ?? []) {
    names.set(
      entry.member.user_id,
      entry.profile?.display_name?.trim() || `Member ${entry.member.user_id.slice(0, 8)}`,
    );
  }

  const rows = latest.data?.rows ?? [];
  const membershipUnverified = latest.data?.membership === 'unverified';
  const locationHistoryRestricted = latest.data?.membership === 'restricted';

  return (
    <SectionCard
      title="Latest locations"
      aside="one most recent row per member"
      actions={
        <button type="button" className="ghost" onClick={latest.refresh}>
          Refresh
        </button>
      }
    >
      {latest.error ? (
        <Banner tone="error" title="Locations unavailable">
          {latest.error}
        </Banner>
      ) : null}
      {membershipUnverified ? <MembershipUnverified /> : null}
      {locationHistoryRestricted ? <Note>Location history is visible to parents only. Your family’s location updates are not available to this account.</Note> : null}
      {latest.loading && !latest.data ? <SkeletonRows count={2} /> : null}
      {!latest.loading && !latest.error && !membershipUnverified && !locationHistoryRestricted && rows.length === 0 ? (
        <EmptyState title="No location updates yet">
          Location rows appear here after a family member shares their position.
        </EmptyState>
      ) : null}

      {rows.length > 0 ? (
        <ul className="plain-list">
          {rows.map((row) => {
            const name =
              names.get(row.child_user_id) ??
              (row.child_user_id === account.userId
                ? 'You'
                : `Member ${row.child_user_id.slice(0, 8)}`);
            return (
              <li key={row.id}>
                <div>
                  <span className="avatar avatar-sm" aria-hidden="true">
                    {initials(name)}
                  </span>
                  <strong>{name}</strong>
                  <div className="muted small">
                    {formatCoordinates(row.latitude, row.longitude)} · {formatRelative(row.recorded_at)}
                  </div>
                </div>
                <Pill tone="neutral">
                  {formatDistance(row.accuracy_m)} · {formatBattery(row.battery_percent)}
                </Pill>
              </li>
            );
          })}
        </ul>
      ) : null}

      {latest.data ? <Note>{refreshedLabel(latest.updatedAt)} · polls every 20 seconds.</Note> : null}
    </SectionCard>
  );
}

/* -------------------------------------------------------------------- SOS */

export function SosPanel({
  client,
  familyId,
  account,
  role,
}: {
  client: SupabaseClient;
  familyId: string;
  account: AccountContext;
  role: AccountRole | null;
}) {
  const canReadHistory = role === 'parent';
  const events = useResource(
    `sos:${familyId}:${canReadHistory ? 'parent' : 'restricted'}`,
    () => (canReadHistory ? loadSosEvents(client, familyId) : Promise.resolve([])),
    15000,
  );
  const members = useResource(
    `sos-members:${familyId}`,
    () => loadFamilyMembers(client, familyId),
    60000,
  );

  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A stored alert whose position lookup failed is a success with a warning, not an error.
  const [warning, setWarning] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);
  const [ackPending, setAckPending] = useState<string | null>(null);

  const names = new Map<string, string>();
  names.set(account.userId, account.displayName);
  for (const entry of members.data?.members ?? []) {
    names.set(
      entry.member.user_id,
      entry.profile?.display_name?.trim() || `Member ${entry.member.user_id.slice(0, 8)}`,
    );
  }

  const open = (events.data ?? []).filter((event) => event.acknowledged_at === null);

  const onRaise = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setWarning(null);
    try {
      // Bounded to ~3 seconds and never cached. A denied or unavailable sensor only drops
      // the coordinates; the alert itself is still recorded, and that case comes back as a
      // warning rather than a failure.
      const outcome = await sendSosAlert(client, {
        familyId,
        childUserId: account.userId,
        note: note.trim() ? note.trim() : null,
      });

      if (!outcome.ok) {
        setError(outcome.error);
        return;
      }

      setNote('');
      setWarning(outcome.warning);
      events.refresh();
    } finally {
      setPending(false);
    }
  };

  const onAcknowledge = async (sosId: string) => {
    setAckPending(sosId);
    setAckError(null);
    try {
      await acknowledgeSos(client, sosId, account.userId);
      events.refresh();
    } catch (cause) {
      setAckError(cause instanceof Error ? cause.message : 'Could not acknowledge this alert.');
    } finally {
      setAckPending(null);
    }
  };

  return (
    <SectionCard
      title="SOS alerts"
      aside={`sos_events · ${open.length} open`}
      actions={
        <button type="button" className="ghost" onClick={events.refresh}>
          Refresh
        </button>
      }
    >
      {events.error ? (
        <Banner tone="error" title="SOS history unavailable">
          {events.error}
        </Banner>
      ) : null}
      {error ? <Banner tone="error" title="SOS not sent">{error}</Banner> : null}
      {warning ? (
        <Banner tone="warn" title="SOS sent without your location">
          {warning}
        </Banner>
      ) : null}
      {ackError ? <Banner tone="error" title="Acknowledgement failed">{ackError}</Banner> : null}

      {role === 'child' || role === null ? (
        <form className="form" onSubmit={onRaise}>
          <label className="field">
            <span>Note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={200}
              placeholder="What is happening?"
            />
          </label>
          <div className="form-actions">
            <button type="submit" className="danger" disabled={pending}>
              {pending ? 'Sending…' : 'Send SOS alert'}
            </button>
            <span className="muted small">Sent to your family's alert list.</span>
          </div>
        </form>
      ) : null}

      {events.loading && !events.data ? <SkeletonRows count={2} /> : null}
      {!events.loading && !events.error && (events.data ?? []).length === 0 ? (
        role === 'child' ? (
          <EmptyState title="SOS history is not available to this account">
            Your alert is stored for a parent to view in FamGuard. This account cannot read the
            family SOS history under the current access rules.
          </EmptyState>
        ) : (
          <EmptyState title="No SOS alerts">Nothing has been raised in this family.</EmptyState>
        )
      ) : null}

      {(events.data ?? []).length > 0 ? (
        <ul className="plain-list">
          {(events.data ?? []).map((event) => {
            const acknowledged = event.acknowledged_at !== null;
            const who = names.get(event.child_user_id) ?? `Member ${event.child_user_id.slice(0, 8)}`;
            return (
              <li key={event.id}>
                <div>
                  <strong>{who}</strong>
                  <div className="muted small">
                    {formatRelative(event.created_at)}
                    {event.latitude !== null && event.longitude !== null
                      ? ` · ${formatCoordinates(event.latitude, event.longitude)}`
                      : ' · no coordinates'}
                  </div>
                  {event.note ? <div className="small">{event.note}</div> : null}
                </div>
                {acknowledged ? (
                  <Pill tone="success">Acknowledged</Pill>
                ) : role === 'parent' ? (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => onAcknowledge(event.id)}
                    disabled={ackPending === event.id}
                  >
                    {ackPending === event.id ? 'Saving…' : 'Acknowledge'}
                  </button>
                ) : (
                  <Pill tone="error">Open</Pill>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      <Note>
        Alerts are stored rows only. Parents can see them when they open FamGuard; this build sends
        no push, SMS or email notifications. Parent history refreshes every 15 seconds.
      </Note>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------ zones */

export function ZonesPanel({
  client,
  familyId,
  account,
  role,
}: {
  client: SupabaseClient;
  familyId: string;
  account: AccountContext;
  role: AccountRole | null;
}) {
  const zones = useResource(`zones:${familyId}`, () => loadZones(client, familyId), 30000);
  const latest = useResource(
    `locations:${familyId}`,
    () => loadLatestLocations(client, familyId, role),
    30000,
    LOCATION_CACHE_MS,
  );

  const mine = latest.data?.rows.find((row) => row.child_user_id === account.userId) ?? null;
  const membershipUnverified = latest.data?.membership === 'unverified';

  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<ZoneKind>('safe');
  const [radius, setRadius] = useState('300');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [entry, setEntry] = useState(true);
  const [exit, setExit] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [togglePending, setTogglePending] = useState<string | null>(null);

  const useMyPosition = async () => {
    setError(null);
    try {
      const position = await currentPosition();
      setLat(String(position.latitude));
      setLng(String(position.longitude));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read your position.');
    }
  };

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const radiusValue = Number(radius);
    const latValue = Number(lat);
    const lngValue = Number(lng);

    if (!label.trim()) {
      setError('Give the zone a label.');
      return;
    }
    if (!Number.isFinite(radiusValue) || radiusValue <= 0) {
      setError('Radius must be a positive number of metres.');
      return;
    }
    if (!Number.isFinite(latValue) || latValue < -90 || latValue > 90) {
      setError('Latitude must be between -90 and 90.');
      return;
    }
    if (!Number.isFinite(lngValue) || lngValue < -180 || lngValue > 180) {
      setError('Longitude must be between -180 and 180.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      await createZone(client, {
        familyId,
        createdBy: account.userId,
        label: label.trim(),
        kind,
        centerLat: latValue,
        centerLng: lngValue,
        radiusM: radiusValue,
        alertsOnEntry: entry,
        alertsOnExit: exit,
      });
      setLabel('');
      zones.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this zone.');
    } finally {
      setPending(false);
    }
  };

  const onToggle = async (zoneId: string, enabled: boolean) => {
    setTogglePending(zoneId);
    setToggleError(null);
    try {
      await setZoneEnabled(client, zoneId, enabled);
      zones.refresh();
    } catch (cause) {
      setToggleError(cause instanceof Error ? cause.message : 'Could not change this zone.');
    } finally {
      setTogglePending(null);
    }
  };

  return (
    <SectionCard title="Safe and danger zones" aside={`zones · ${zones.data?.length ?? 0} total`}>
      {zones.error ? (
        <Banner tone="error" title="Zones unavailable">
          {zones.error}
        </Banner>
      ) : null}
      {toggleError ? <Banner tone="error">{toggleError}</Banner> : null}

      {membershipUnverified ? (
        <Note>
          Distances are hidden because the family member list could not be verified, so the
          latest location for this account cannot be confirmed.
        </Note>
      ) : null}

      {zones.loading && !zones.data ? <SkeletonRows count={2} /> : null}
      {!zones.loading && !zones.error && (zones.data ?? []).length === 0 ? (
        role === 'parent' ? (
          <EmptyState title="No zones yet">Create a safe or danger zone below.</EmptyState>
        ) : (
          <EmptyState title="No zones visible">
            A parent can create safe and danger zones. None are visible to this account yet.
          </EmptyState>
        )
      ) : null}

      {(zones.data ?? []).length > 0 ? (
        <ul className="plain-list">
          {(zones.data ?? []).map((zone) => {
            const zoneKind: ZoneKind | null = isZoneKind(zone.kind) ? zone.kind : null;
            const distance = mine
              ? distanceMeters(
                  { latitude: mine.latitude, longitude: mine.longitude },
                  { latitude: zone.center_lat, longitude: zone.center_lng },
                )
              : null;
            const inside = distance !== null ? distance <= zone.radius_m : null;

            return (
              <li key={zone.id}>
                <div>
                  <strong>{zone.label}</strong>
                  <div className="muted small">
                    {zoneKind === 'danger' ? 'Danger' : 'Safe'} · radius {formatDistance(zone.radius_m)}
                    {inside !== null && distance !== null
                      ? ` · you are ${formatDistance(distance)} from the centre (${inside ? 'inside' : 'outside'})`
                      : ''}
                  </div>
                  <div className="muted small">
                    Entry alerts {zone.alerts_on_entry ? 'on' : 'off'} · exit alerts{' '}
                    {zone.alerts_on_exit ? 'on' : 'off'}
                  </div>
                </div>
                <div className="row-gap">
                  <Pill tone={zoneKind === 'danger' ? 'error' : 'success'}>
                    {zone.enabled ? 'Enabled' : 'Disabled'}
                  </Pill>
                  {role === 'parent' ? (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => onToggle(zone.id, !zone.enabled)}
                      disabled={togglePending === zone.id}
                    >
                      {togglePending === zone.id ? 'Saving…' : zone.enabled ? 'Disable' : 'Enable'}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {role === 'parent' ? (
        <form className="form" onSubmit={onCreate}>
          <div className="form-row">
            <label className="field grow">
              <span>Label</span>
              <input
                type="text"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={80}
                placeholder="School"
              />
            </label>
            <label className="field">
              <span>Kind</span>
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value === 'danger' ? 'danger' : 'safe')}
              >
                <option value="safe">Safe</option>
                <option value="danger">Danger</option>
              </select>
            </label>
            <label className="field">
              <span>Radius (m)</span>
              <input
                type="number"
                min={1}
                value={radius}
                onChange={(event) => setRadius(event.target.value)}
              />
            </label>
          </div>

          <div className="form-row">
            <label className="field grow">
              <span>Latitude</span>
              <input
                type="number"
                step="any"
                value={lat}
                onChange={(event) => setLat(event.target.value)}
                placeholder="51.5074"
              />
            </label>
            <label className="field grow">
              <span>Longitude</span>
              <input
                type="number"
                step="any"
                value={lng}
                onChange={(event) => setLng(event.target.value)}
                placeholder="-0.1278"
              />
            </label>
            <div className="field">
              <span>&nbsp;</span>
              <button type="button" className="secondary" onClick={useMyPosition}>
                Use my location
              </button>
            </div>
          </div>

          <div className="form-row">
            <label className="check">
              <input type="checkbox" checked={entry} onChange={(event) => setEntry(event.target.checked)} />
              <span>Alert on entry</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={exit} onChange={(event) => setExit(event.target.checked)} />
              <span>Alert on exit</span>
            </label>
          </div>

          {error ? <Banner tone="error">{error}</Banner> : null}

          <div className="form-actions">
            <button type="submit" className="primary" disabled={pending}>
              {pending ? 'Saving…' : 'Create zone'}
            </button>
          </div>
        </form>
      ) : null}

      <Note>
        Zones are stored rows. Your database has no trigger or scheduled function that evaluates
        entry/exit, so no alert is generated automatically — the distance shown here is computed in
        the browser for display only.
      </Note>
    </SectionCard>
  );
}
