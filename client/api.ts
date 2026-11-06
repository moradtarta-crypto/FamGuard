export type MemberRole = 'parent' | 'child' | 'guardian';
export type MemberStatus = 'safe' | 'needs_attention' | 'unknown';
export type AlertType = 'sos' | 'geofence' | 'missed_checkin' | 'low_battery';
export type AlertStatus = 'open' | 'acknowledged';

export interface Member {
  id: string;
  name: string;
  role: MemberRole;
  status: MemberStatus;
  lastCheckIn: string | null;
  createdAt: string;
  openAlerts: number;
}

export interface Alert {
  id: string;
  memberId: string;
  type: AlertType;
  message: string;
  status: AlertStatus;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface Overview {
  totalMembers: number;
  safeMembers: number;
  needsAttention: number;
  unknownMembers: number;
  openAlerts: number;
  lastUpdated: string | null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const payload: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return payload as T;
}

export async function fetchDashboard(): Promise<{
  overview: Overview;
  members: Member[];
  alerts: Alert[];
}> {
  const [overview, membersResponse, alertsResponse] = await Promise.all([
    request<Overview>('/api/overview'),
    request<{ members: Member[] }>('/api/members'),
    request<{ alerts: Alert[] }>('/api/alerts'),
  ]);
  return { overview, members: membersResponse.members, alerts: alertsResponse.alerts };
}

export async function checkInMember(id: string): Promise<Member> {
  const { member } = await request<{ member: Member }>(`/api/members/${id}/checkin`, { method: 'PATCH' });
  return member;
}

export async function acknowledgeAlert(id: string): Promise<Alert> {
  const { alert } = await request<{ alert: Alert }>(`/api/alerts/${id}/acknowledge`, { method: 'PATCH' });
  return alert;
}

export async function createAlert(input: {
  memberId: string;
  type: AlertType;
  message: string;
}): Promise<Alert> {
  const { alert } = await request<{ alert: Alert }>('/api/alerts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return alert;
}

export async function createMember(input: { name: string; role: MemberRole }): Promise<Member> {
  const { member } = await request<{ member: Member }>('/api/members', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return member;
}
