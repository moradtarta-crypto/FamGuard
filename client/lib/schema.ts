/**
 * Row shapes and enum values for the user's EXISTING FamGuard Supabase schema.
 *
 * Only verified columns are declared here. Nothing in this file creates, alters or
 * describes anything the database does not already have.
 */

export type AccountRole = 'parent' | 'child';
export type ZoneKind = 'safe' | 'danger';
export type MessageKind = 'text' | 'image' | 'voice' | 'system';
export type SubscriptionStatus = 'inactive' | 'pending' | 'active' | 'expired' | 'cancelled';

export const ACCOUNT_ROLES: readonly AccountRole[] = ['parent', 'child'];
export const ZONE_KINDS: readonly ZoneKind[] = ['safe', 'danger'];
export const MESSAGE_KINDS: readonly MessageKind[] = ['text', 'image', 'voice', 'system'];
export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  'inactive',
  'pending',
  'active',
  'expired',
  'cancelled',
];

export function isAccountRole(value: unknown): value is AccountRole {
  return typeof value === 'string' && (ACCOUNT_ROLES as readonly string[]).includes(value);
}

export function isZoneKind(value: unknown): value is ZoneKind {
  return typeof value === 'string' && (ZONE_KINDS as readonly string[]).includes(value);
}

export function isMessageKind(value: unknown): value is MessageKind {
  return typeof value === 'string' && (MESSAGE_KINDS as readonly string[]).includes(value);
}

export function isSubscriptionStatus(value: unknown): value is SubscriptionStatus {
  return typeof value === 'string' && (SUBSCRIPTION_STATUSES as readonly string[]).includes(value);
}

export interface ProfileRow {
  user_id: string;
  display_name: string | null;
  preferred_language: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface FamilyRow {
  id: string;
  name: string;
  created_by: string | null;
  created_at: string | null;
}

export interface FamilyMemberRow {
  family_id: string;
  user_id: string;
  role: AccountRole | string;
  linked_at: string | null;
}

/**
 * `token_hash` is intentionally never selected: the app only ever holds the plain
 * invite token returned once by create_family_invite, never the stored hash.
 */
export interface FamilyInviteRow {
  id: string;
  family_id: string;
  created_by: string | null;
  expires_at: string | null;
  consumed_by: string | null;
  consumed_at: string | null;
  created_at: string | null;
}

export interface ZoneRow {
  id: string;
  family_id: string;
  created_by: string | null;
  label: string;
  kind: ZoneKind | string;
  center_lat: number;
  center_lng: number;
  radius_m: number;
  alerts_on_entry: boolean;
  alerts_on_exit: boolean;
  enabled: boolean;
  created_at: string | null;
}

export interface LocationRow {
  id: string;
  family_id: string;
  child_user_id: string;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  battery_percent: number | null;
  recorded_at: string;
  received_at: string | null;
}

export interface ConversationRow {
  id: string;
  family_id: string;
  created_at: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  kind: MessageKind | string;
  body: string | null;
  media_object_path: string | null;
  created_at: string | null;
  read_at: string | null;
}

export interface SosEventRow {
  id: string;
  family_id: string;
  child_user_id: string;
  latitude: number | null;
  longitude: number | null;
  note: string | null;
  created_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
}

export interface SubscriptionRow {
  id: string;
  parent_user_id: string;
  family_id: string;
  status: SubscriptionStatus | string;
  plan_code: string | null;
  starts_at: string | null;
  ends_at: string | null;
  payment_network: string | null;
  transaction_id: string | null;
  verified_at: string | null;
  created_at: string | null;
}

/** Column lists used by every select, so screens never request unverified columns. */
export const COLUMNS = {
  profile: 'user_id, display_name, preferred_language, created_at, updated_at',
  family: 'id, name, created_by, created_at',
  familyMember: 'family_id, user_id, role, linked_at',
  familyInvite: 'id, family_id, created_by, expires_at, consumed_by, consumed_at, created_at',
  zone:
    'id, family_id, created_by, label, kind, center_lat, center_lng, radius_m, alerts_on_entry, alerts_on_exit, enabled, created_at',
  location:
    'id, family_id, child_user_id, latitude, longitude, accuracy_m, battery_percent, recorded_at, received_at',
  conversation: 'id, family_id, created_at',
  message: 'id, conversation_id, sender_user_id, kind, body, media_object_path, created_at, read_at',
  sosEvent: 'id, family_id, child_user_id, latitude, longitude, note, created_at, acknowledged_at, acknowledged_by',
  subscription:
    'id, parent_user_id, family_id, status, plan_code, starts_at, ends_at, payment_network, transaction_id, verified_at, created_at',
} as const;
