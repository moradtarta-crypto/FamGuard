import type { SupabaseClient } from '@supabase/supabase-js';
import { describeDbError } from './errors';
import { COLUMNS, isAccountRole } from './schema';
import type {
  ConversationRow,
  FamilyInviteRow,
  FamilyMemberRow,
  FamilyRow,
  LocationRow,
  MessageRow,
  ProfileRow,
  SosEventRow,
  SubscriptionRow,
  ZoneKind,
  ZoneRow,
} from './schema';

type DbError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
} | null;

export class DataError extends Error {
  readonly code: string | null;
  readonly blockedByPolicy: boolean;

  constructor(message: string, code: string | null, blockedByPolicy: boolean) {
    super(message);
    this.name = 'DataError';
    this.code = code;
    this.blockedByPolicy = blockedByPolicy;
  }
}

function fail(error: DbError, action: string): never {
  const described = describeDbError(error, action);
  throw new DataError(described.message, described.code, described.blockedByPolicy);
}

/* ------------------------------------------------------------------ profile */

export async function saveProfile(
  client: SupabaseClient,
  userId: string,
  displayName: string,
  preferredLanguage: string,
): Promise<ProfileRow> {
  const { data, error } = await client
    .from('profiles')
    .upsert(
      {
        user_id: userId,
        display_name: displayName,
        preferred_language: preferredLanguage,
      },
      { onConflict: 'user_id' },
    )
    .select(COLUMNS.profile)
    .single();

  if (error) fail(error, 'save your profile');
  return data as ProfileRow;
}

/* ------------------------------------------------------------- memberships */

export async function loadMemberships(
  client: SupabaseClient,
  userId: string,
): Promise<FamilyMemberRow[]> {
  const { data, error } = await client
    .from('family_members')
    .select(COLUMNS.familyMember)
    .eq('user_id', userId);

  if (error) fail(error, 'read your family membership');
  return ((data ?? []) as FamilyMemberRow[]).filter((row) => isAccountRole(row.role));
}

export async function loadFamily(
  client: SupabaseClient,
  familyId: string,
): Promise<FamilyRow | null> {
  const { data, error } = await client
    .from('families')
    .select(COLUMNS.family)
    .eq('id', familyId)
    .maybeSingle();

  if (error) fail(error, 'read this family');
  return (data as FamilyRow | null) ?? null;
}

export interface FamilyMemberView {
  member: FamilyMemberRow;
  profile: ProfileRow | null;
}

export interface FamilyMemberList {
  members: FamilyMemberView[];
  /** Set when member rows loaded but profiles were refused — names then fall back to ids. */
  profileWarning: string | null;
}

export async function loadFamilyMembers(
  client: SupabaseClient,
  familyId: string,
): Promise<FamilyMemberList> {
  const { data, error } = await client
    .from('family_members')
    .select(COLUMNS.familyMember)
    .eq('family_id', familyId)
    .order('linked_at', { ascending: true });

  if (error) fail(error, 'read the family member list');

  const members = (data ?? []) as FamilyMemberRow[];
  if (members.length === 0) return { members: [], profileWarning: null };

  const userIds = Array.from(new Set(members.map((row) => row.user_id)));
  const { data: profileRows, error: profileError } = await client
    .from('profiles')
    .select(COLUMNS.profile)
    .in('user_id', userIds);

  const profiles = new Map<string, ProfileRow>();
  let profileWarning: string | null = null;

  if (profileError) {
    profileWarning = describeDbError(profileError, 'read member profiles').message;
  } else {
    for (const row of (profileRows ?? []) as ProfileRow[]) profiles.set(row.user_id, row);
  }

  return {
    members: members.map((member) => ({
      member,
      profile: profiles.get(member.user_id) ?? null,
    })),
    profileWarning,
  };
}

/* ------------------------------------------------------------------ invites */

export async function loadInvites(
  client: SupabaseClient,
  familyId: string,
): Promise<FamilyInviteRow[]> {
  const { data, error } = await client
    .from('family_invites')
    .select(COLUMNS.familyInvite)
    .eq('family_id', familyId)
    .order('created_at', { ascending: false })
    .limit(25);

  if (error) fail(error, 'read family invites');
  return (data ?? []) as FamilyInviteRow[];
}

/* -------------------------------------------------------------------- zones */

export async function loadZones(client: SupabaseClient, familyId: string): Promise<ZoneRow[]> {
  const { data, error } = await client
    .from('zones')
    .select(COLUMNS.zone)
    .eq('family_id', familyId)
    .order('created_at', { ascending: false });

  if (error) fail(error, 'read safe and danger zones');
  return (data ?? []) as ZoneRow[];
}

export interface NewZoneInput {
  familyId: string;
  createdBy: string;
  label: string;
  kind: ZoneKind;
  centerLat: number;
  centerLng: number;
  radiusM: number;
  alertsOnEntry: boolean;
  alertsOnExit: boolean;
}

export async function createZone(
  client: SupabaseClient,
  input: NewZoneInput,
): Promise<ZoneRow> {
  const { data, error } = await client
    .from('zones')
    .insert({
      family_id: input.familyId,
      created_by: input.createdBy,
      label: input.label,
      kind: input.kind,
      center_lat: input.centerLat,
      center_lng: input.centerLng,
      radius_m: input.radiusM,
      alerts_on_entry: input.alertsOnEntry,
      alerts_on_exit: input.alertsOnExit,
      enabled: true,
    })
    .select(COLUMNS.zone)
    .single();

  if (error) fail(error, 'save this zone');
  return data as ZoneRow;
}

export async function setZoneEnabled(
  client: SupabaseClient,
  zoneId: string,
  enabled: boolean,
): Promise<ZoneRow> {
  const { data, error } = await client
    .from('zones')
    .update({ enabled })
    .eq('id', zoneId)
    .select(COLUMNS.zone)
    .single();

  if (error) fail(error, 'change this zone');
  return data as ZoneRow;
}

/* -------------------------------------------------------- location updates */

/** Whether the member list behind a location result could be read completely. */
export type MembershipVerification = 'verified' | 'unverified';

export interface LatestLocations {
  rows: LocationRow[];
  /**
   * `unverified` means `family_members` returned no rows for this family. That result is
   * ambiguous — the family may have no members yet, or the rows may simply not be visible
   * to this account — so callers must not present it as "nobody is sharing".
   */
  membership: MembershipVerification;
}

export async function loadLatestLocations(
  client: SupabaseClient,
  familyId: string,
): Promise<LatestLocations> {
  // Query the latest row per member instead of a family-wide window. A shared window
  // lets one frequently-updating member fill it, which used to hide a quieter member
  // entirely rather than showing them as stale.
  const { data: memberRows, error: memberError } = await client
    .from('family_members')
    .select('user_id')
    .eq('family_id', familyId);

  // A refused or failed member read must surface as an error. Degrading to "no
  // locations" would report a permission problem as "nobody is sharing".
  if (memberError) fail(memberError, 'read the family members for locations');

  const userIds = Array.from(
    new Set(((memberRows ?? []) as { user_id: string }[]).map((row) => row.user_id)),
  );
  // No rows here is not proof that the family is empty: row-level policies filter rather
  // than raise. Report the result as unverified instead of claiming nobody shares.
  if (userIds.length === 0) return { rows: [], membership: 'unverified' };

  const rows = await Promise.all(
    userIds.map(async (userId) => {
      const { data, error } = await client
        .from('location_updates')
        .select(COLUMNS.location)
        .eq('family_id', familyId)
        .eq('child_user_id', userId)
        .order('recorded_at', { ascending: false })
        // A tie on recorded_at must still select one stable row, otherwise the same query
        // can report a different update between polls.
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) fail(error, 'read location updates');
      return (data as LocationRow | null) ?? null;
    }),
  );

  return {
    rows: rows
      .filter((row): row is LocationRow => row !== null)
      .sort((a, b) => {
        if (a.recorded_at !== b.recorded_at) return a.recorded_at < b.recorded_at ? 1 : -1;
        return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
      }),
    membership: 'verified',
  };
}

export interface NewLocationInput {
  familyId: string;
  childUserId: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  batteryPercent: number | null;
}

export async function shareLocation(
  client: SupabaseClient,
  input: NewLocationInput,
): Promise<LocationRow> {
  const { data, error } = await client
    .from('location_updates')
    .insert({
      family_id: input.familyId,
      child_user_id: input.childUserId,
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy_m: input.accuracyM,
      battery_percent: input.batteryPercent,
      recorded_at: new Date().toISOString(),
    })
    .select(COLUMNS.location)
    .single();

  if (error) fail(error, 'share your location');
  return data as LocationRow;
}

/* --------------------------------------------------------------------- chat */

export async function loadConversation(
  client: SupabaseClient,
  familyId: string,
): Promise<ConversationRow | null> {
  const { data, error } = await client
    .from('conversations')
    .select(COLUMNS.conversation)
    .eq('family_id', familyId)
    .order('created_at', { ascending: true })
    // Every caller must resolve to the same row, so a tie on created_at is broken by id
    // instead of being left to the database's discretion.
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) fail(error, 'read the family conversation');
  return (data as ConversationRow | null) ?? null;
}

export async function createConversation(
  client: SupabaseClient,
  familyId: string,
): Promise<ConversationRow> {
  // Two members can create a conversation in the same round-trip. Making the insert
  // unique would need a schema change, so converge instead: read back the canonical
  // (oldest) conversation and return that. Both callers then target a single row, and
  // any duplicate row stays inert because nothing ever resolves to it.
  const { error } = await client.from('conversations').insert({ family_id: familyId });

  if (error) fail(error, 'create the family conversation');

  const canonical = await loadConversation(client, familyId);
  if (!canonical) {
    throw new DataError(
      'Could not start the family chat: the conversation could not be read back after it was created.',
      null,
      false,
    );
  }
  return canonical;
}

export async function loadMessages(
  client: SupabaseClient,
  conversationId: string,
  limit = 200,
): Promise<MessageRow[]> {
  // Ask for the newest window, never the oldest: an ascending LIMIT silently freezes
  // the chat once a conversation grows past `limit` rows, with no visible error.
  const { data, error } = await client
    .from('messages')
    .select(COLUMNS.message)
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    // Ties on created_at need a total order, otherwise both the window boundary and the
    // rendered order can change between polls.
    .order('id', { ascending: false })
    .limit(limit);

  if (error) fail(error, 'read messages');

  // Callers render oldest-first, so restore chronological order inside the window.
  return ((data ?? []) as MessageRow[]).slice().reverse();
}

export interface NewMessageInput {
  conversationId: string;
  senderUserId: string;
  body: string;
}

export async function sendMessage(
  client: SupabaseClient,
  input: NewMessageInput,
): Promise<MessageRow> {
  const { data, error } = await client
    .from('messages')
    .insert({
      conversation_id: input.conversationId,
      sender_user_id: input.senderUserId,
      kind: 'text',
      body: input.body,
    })
    .select(COLUMNS.message)
    .single();

  if (error) fail(error, 'send this message');
  return data as MessageRow;
}

export async function markConversationRead(
  client: SupabaseClient,
  conversationId: string,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .is('read_at', null)
    .neq('sender_user_id', userId);

  if (error) fail(error, 'mark messages as read');
}

/* ---------------------------------------------------------------------- SOS */

export async function loadSosEvents(
  client: SupabaseClient,
  familyId: string,
  limit = 30,
): Promise<SosEventRow[]> {
  const { data, error } = await client
    .from('sos_events')
    .select(COLUMNS.sosEvent)
    .eq('family_id', familyId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) fail(error, 'read SOS alerts');
  return (data ?? []) as SosEventRow[];
}

export interface NewSosInput {
  familyId: string;
  childUserId: string;
  latitude: number | null;
  longitude: number | null;
  note: string | null;
}

export async function raiseSos(client: SupabaseClient, input: NewSosInput): Promise<SosEventRow> {
  const { data, error } = await client
    .from('sos_events')
    .insert({
      family_id: input.familyId,
      child_user_id: input.childUserId,
      latitude: input.latitude,
      longitude: input.longitude,
      note: input.note,
    })
    .select(COLUMNS.sosEvent)
    .single();

  if (error) fail(error, 'send this SOS alert');
  return data as SosEventRow;
}

export async function acknowledgeSos(
  client: SupabaseClient,
  sosId: string,
  parentUserId: string,
): Promise<SosEventRow> {
  const { data, error } = await client
    .from('sos_events')
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: parentUserId })
    .eq('id', sosId)
    .select(COLUMNS.sosEvent)
    .single();

  if (error) fail(error, 'acknowledge this SOS alert');
  return data as SosEventRow;
}

/* ------------------------------------------------------------ subscriptions */

export async function loadSubscription(
  client: SupabaseClient,
  familyId: string,
): Promise<SubscriptionRow | null> {
  const { data, error } = await client
    .from('subscriptions')
    .select(COLUMNS.subscription)
    .eq('family_id', familyId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) fail(error, 'read the family subscription');
  return (data as SubscriptionRow | null) ?? null;
}

/* ---------------------------------------------------------------------- RPCs */

/**
 * SECURITY DEFINER RPCs owned by the existing database. The app only calls them
 * from an explicit user action — never on page load, never for verification.
 */
export async function createFamily(client: SupabaseClient, familyName: string): Promise<string> {
  const { data, error } = await client.rpc('create_family', { family_name: familyName });
  if (error) fail(error, 'create this family');
  if (typeof data !== 'string' || data.length === 0) {
    throw new DataError('Could not create this family: the RPC returned no family id.', null, false);
  }
  return data;
}

export async function createFamilyInvite(
  client: SupabaseClient,
  familyId: string,
): Promise<string> {
  const { data, error } = await client.rpc('create_family_invite', { target_family: familyId });
  if (error) fail(error, 'create this invite');
  if (typeof data !== 'string' || data.length === 0) {
    throw new DataError('Could not create this invite: the RPC returned no token.', null, false);
  }
  return data;
}

export async function acceptFamilyInvite(
  client: SupabaseClient,
  token: string,
): Promise<string> {
  const { data, error } = await client.rpc('accept_family_invite', { invite_token: token });
  if (error) fail(error, 'accept this invite');
  if (typeof data !== 'string' || data.length === 0) {
    throw new DataError('Could not join this family: the RPC returned no family id.', null, false);
  }
  return data;
}
