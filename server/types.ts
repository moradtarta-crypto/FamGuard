export type MemberRole = 'parent' | 'child' | 'guardian';

export type MemberStatus = 'safe' | 'needs_attention' | 'unknown';

export interface Member {
  id: string;
  name: string;
  role: MemberRole;
  status: MemberStatus;
  lastCheckIn: string | null;
  createdAt: string;
}

export type AlertType = 'sos' | 'geofence' | 'missed_checkin' | 'low_battery';

export type AlertStatus = 'open' | 'acknowledged';

export interface Alert {
  id: string;
  memberId: string;
  type: AlertType;
  message: string;
  status: AlertStatus;
  createdAt: string;
  acknowledgedAt: string | null;
}

export interface Database {
  members: Member[];
  alerts: Alert[];
}

export interface Overview {
  totalMembers: number;
  safeMembers: number;
  needsAttention: number;
  unknownMembers: number;
  openAlerts: number;
  lastUpdated: string | null;
}

export const MEMBER_ROLES: readonly MemberRole[] = ['parent', 'child', 'guardian'];

export const ALERT_TYPES: readonly AlertType[] = ['sos', 'geofence', 'missed_checkin', 'low_battery'];

export const MEMBER_STATUSES: readonly MemberStatus[] = ['safe', 'needs_attention', 'unknown'];
