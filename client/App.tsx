import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  acknowledgeAlert,
  checkInMember,
  createAlert,
  createMember,
  fetchDashboard,
  type Alert,
  type AlertType,
  type Member,
  type MemberRole,
  type Overview,
} from './api';

const STATUS_LABEL: Record<Member['status'], string> = {
  safe: 'Safe',
  needs_attention: 'Needs attention',
  unknown: 'Awaiting check-in',
};

const ALERT_LABEL: Record<AlertType, string> = {
  sos: 'SOS',
  geofence: 'Geofence',
  missed_checkin: 'Missed check-in',
  low_battery: 'Low battery',
};

const ROLE_LABEL: Record<MemberRole, string> = {
  parent: 'Parent',
  child: 'Child',
  guardian: 'Guardian',
};

function formatTime(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function App() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<MemberRole>('child');

  const [sosMemberId, setSosMemberId] = useState('');
  const [sosType, setSosType] = useState<AlertType>('sos');
  const [sosMessage, setSosMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await fetchDashboard();
      setOverview(data.overview);
      setMembers(data.members);
      setAlerts(data.alerts);
      setError(null);
      setSosMemberId((current) => current || (data.members[0]?.id ?? ''));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reach the FamGuard API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setBusyId(key);
      setError(null);
      try {
        await action();
        await load();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Action failed.');
      } finally {
        setBusyId(null);
      }
    },
    [load],
  );

  const memberNames = useMemo(
    () => new Map(members.map((member) => [member.id, member.name])),
    [members],
  );

  const openAlerts = alerts.filter((alert) => alert.status === 'open');
  const resolvedAlerts = alerts.filter((alert) => alert.status === 'acknowledged');

  const onCheckIn = (member: Member) => runAction(member.id, () => checkInMember(member.id));

  const onAcknowledge = (alert: Alert) =>
    runAction(alert.id, () => acknowledgeAlert(alert.id));

  const onSubmitSos = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sosMemberId) return;
    void runAction('sos', async () => {
      await createAlert({ memberId: sosMemberId, type: sosType, message: sosMessage });
      setSosMessage('');
    });
  };

  const onSubmitMember = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runAction('member', async () => {
      await createMember({ name: newMemberName, role: newMemberRole });
      setNewMemberName('');
    });
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            FG
          </span>
          <div>
            <h1>FamGuard</h1>
            <p className="brand-sub">Family safety and protection</p>
          </div>
        </div>
        <div className="topbar-meta">
          <span className="live-dot" aria-hidden="true" />
          <span>{overview ? `Updated ${formatTime(overview.lastUpdated)}` : 'Connecting…'}</span>
          <button type="button" className="ghost" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
        </div>
      </header>

      {error ? (
        <div className="banner banner-error" role="alert">
          {error}
        </div>
      ) : null}

      <section className="stats" aria-label="Family status overview">
        <article className="stat">
          <span className="stat-label">Family members</span>
          <strong data-testid="stat-members">{overview?.totalMembers ?? '—'}</strong>
        </article>
        <article className="stat stat-safe">
          <span className="stat-label">Safe</span>
          <strong data-testid="stat-safe">{overview?.safeMembers ?? '—'}</strong>
        </article>
        <article className="stat stat-warn">
          <span className="stat-label">Needs attention</span>
          <strong data-testid="stat-attention">{overview?.needsAttention ?? '—'}</strong>
        </article>
        <article className="stat stat-alert">
          <span className="stat-label">Open alerts</span>
          <strong data-testid="stat-open-alerts">{overview?.openAlerts ?? '—'}</strong>
        </article>
      </section>

      <main className="layout">
        <section className="card" aria-labelledby="members-heading">
          <div className="card-head">
            <h2 id="members-heading">Family members</h2>
            <span className="muted">{members.length} tracked</span>
          </div>
          {loading ? <p className="muted">Loading members…</p> : null}
          <ul className="member-list">
            {members.map((member) => (
              <li key={member.id} className="member">
                <div className="member-main">
                  <div className="avatar" aria-hidden="true">
                    {member.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="member-name">{member.name}</p>
                    <p className="muted">
                      {ROLE_LABEL[member.role]} · Last check-in {formatTime(member.lastCheckIn)}
                    </p>
                  </div>
                </div>
                <div className="member-actions">
                  <span className={`pill pill-${member.status}`}>{STATUS_LABEL[member.status]}</span>
                  {member.openAlerts > 0 ? (
                    <span className="pill pill-count">{member.openAlerts} open</span>
                  ) : null}
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onCheckIn(member)}
                    disabled={busyId === member.id}
                  >
                    {busyId === member.id ? 'Saving…' : 'Check in'}
                  </button>
                </div>
              </li>
            ))}
            {!loading && members.length === 0 ? (
              <li className="muted">No family members yet — add the first one below.</li>
            ) : null}
          </ul>

          <form className="inline-form" onSubmit={onSubmitMember}>
            <h3>Add a family member</h3>
            <div className="inline-fields">
              <input
                type="text"
                placeholder="Full name"
                value={newMemberName}
                onChange={(event) => setNewMemberName(event.target.value)}
                maxLength={80}
                required
                aria-label="Full name"
              />
              <select
                value={newMemberRole}
                onChange={(event) => setNewMemberRole(event.target.value as MemberRole)}
                aria-label="Role"
              >
                <option value="parent">Parent</option>
                <option value="child">Child</option>
                <option value="guardian">Guardian</option>
              </select>
              <button type="submit" className="secondary" disabled={busyId === 'member'}>
                Add member
              </button>
            </div>
          </form>
        </section>

        <section className="card" aria-labelledby="alerts-heading">
          <div className="card-head">
            <h2 id="alerts-heading">Safety alerts</h2>
            <span className="muted">{openAlerts.length} open</span>
          </div>

          <ul className="alert-list">
            {openAlerts.map((alert) => (
              <li key={alert.id} className="alert alert-open">
                <div className="alert-top">
                  <span className="pill pill-open">{ALERT_LABEL[alert.type]}</span>
                  <span className="muted">{formatTime(alert.createdAt)}</span>
                </div>
                <p className="alert-name">{memberNames.get(alert.memberId) ?? 'Unknown member'}</p>
                <p className="alert-message">{alert.message}</p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => onAcknowledge(alert)}
                  disabled={busyId === alert.id}
                >
                  {busyId === alert.id ? 'Resolving…' : 'Acknowledge'}
                </button>
              </li>
            ))}
            {!loading && openAlerts.length === 0 ? (
              <li className="empty">Everyone is accounted for. No open alerts.</li>
            ) : null}
          </ul>

          {resolvedAlerts.length > 0 ? (
            <div className="resolved">
              <h3>Recently resolved</h3>
              <ul className="alert-list">
                {resolvedAlerts.slice(0, 5).map((alert) => (
                  <li key={alert.id} className="alert alert-done">
                    <div className="alert-top">
                      <span className="pill pill-acknowledged">{ALERT_LABEL[alert.type]}</span>
                      <span className="muted">{formatTime(alert.acknowledgedAt)}</span>
                    </div>
                    <p className="alert-name">{memberNames.get(alert.memberId) ?? 'Unknown member'}</p>
                    <p className="alert-message">{alert.message}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <form className="inline-form" onSubmit={onSubmitSos}>
            <h3>Raise an alert</h3>
            <div className="inline-fields">
              <select
                value={sosMemberId}
                onChange={(event) => setSosMemberId(event.target.value)}
                aria-label="Member"
                required
              >
                <option value="">Select member</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
              <select
                value={sosType}
                onChange={(event) => setSosType(event.target.value as AlertType)}
                aria-label="Alert type"
              >
                <option value="sos">SOS</option>
                <option value="geofence">Geofence</option>
                <option value="missed_checkin">Missed check-in</option>
                <option value="low_battery">Low battery</option>
              </select>
              <input
                type="text"
                placeholder="What happened?"
                value={sosMessage}
                onChange={(event) => setSosMessage(event.target.value)}
                maxLength={280}
                required
                aria-label="Alert message"
              />
              <button type="submit" className="danger" disabled={busyId === 'sos'}>
                Send alert
              </button>
            </div>
          </form>
        </section>
      </main>

      <footer className="footer">
        <span>FamGuard · check-ins and safety alerts for your household</span>
      </footer>
    </div>
  );
}
