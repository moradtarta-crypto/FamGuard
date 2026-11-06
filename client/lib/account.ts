import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  MEMBERSHIP_FAMILY_KEYS,
  MEMBERSHIP_ROLE_KEYS,
  MEMBERSHIP_USER_KEYS,
  PROFILE_NAME_KEYS,
  PROFILE_ROLE_KEYS,
  normalizeRole,
  pickIdentifier,
  pickString,
  type AccountRole,
} from './roles';

export interface FamilyMembership {
  id: string | null;
  familyId: string | null;
  role: AccountRole | null;
  rawRole: string | null;
}

export interface AccountContext {
  userId: string;
  email: string | null;
  profile: Record<string, unknown> | null;
  displayName: string;
  role: AccountRole | null;
  roleSource: 'membership' | 'profile' | 'none';
  memberships: FamilyMembership[];
  familyId: string | null;
}

/** PostgREST reports an unknown column as 42703; only that error means "try another key". */
function isMissingColumn(error: { code?: string; message?: string }): boolean {
  if (error.code === '42703') return true;
  const message = (error.message ?? '').toLowerCase();
  return message.includes('does not exist') || message.includes('could not find');
}

function toMembership(row: Record<string, unknown>): FamilyMembership {
  const rawRole = pickString(row, MEMBERSHIP_ROLE_KEYS);
  return {
    id: pickIdentifier(row, ['id']),
    familyId: pickIdentifier(row, MEMBERSHIP_FAMILY_KEYS),
    role: normalizeRole(rawRole),
    rawRole,
  };
}

async function loadMemberships(client: SupabaseClient, userId: string): Promise<FamilyMembership[]> {
  let lastMessage = 'unknown error';
  for (const column of MEMBERSHIP_USER_KEYS) {
    const { data, error } = await client.from('family_members').select('*').eq(column, userId);
    if (!error) {
      const rows = (data ?? []) as Record<string, unknown>[];
      return rows.map(toMembership);
    }
    lastMessage = error.message;
    if (!isMissingColumn(error)) break;
  }
  throw new Error(`Could not read your family membership: ${lastMessage}`);
}

export function resolveRole(
  profile: Record<string, unknown> | null,
  memberships: FamilyMembership[],
): Pick<AccountContext, 'role' | 'roleSource' | 'familyId'> {
  for (const membership of memberships) {
    if (membership.role) {
      return { role: membership.role, roleSource: 'membership', familyId: membership.familyId };
    }
  }
  const profileRole = normalizeRole(pickString(profile, PROFILE_ROLE_KEYS));
  if (profileRole) {
    return { role: profileRole, roleSource: 'profile', familyId: memberships[0]?.familyId ?? null };
  }
  return { role: null, roleSource: 'none', familyId: memberships[0]?.familyId ?? null };
}

export function resolveDisplayName(profile: Record<string, unknown> | null, email: string | null): string {
  const fromProfile = pickString(profile, PROFILE_NAME_KEYS);
  if (fromProfile) return fromProfile;
  if (email && email.includes('@')) {
    const local = email.slice(0, email.indexOf('@'));
    if (local.length > 0) return local;
  }
  return 'FamGuard user';
}

/**
 * Loads the signed-in user's own profile row and family membership rows.
 * Reads only; every query is scoped by the existing row level security policies.
 */
export async function loadAccount(client: SupabaseClient, user: User): Promise<AccountContext> {
  const { data: profileRow, error: profileError } = await client
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Could not read your profile: ${profileError.message}`);
  }

  const profile = (profileRow as Record<string, unknown> | null) ?? null;
  const memberships = await loadMemberships(client, user.id);
  const resolved = resolveRole(profile, memberships);

  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
    displayName: resolveDisplayName(profile, user.email ?? null),
    role: resolved.role,
    roleSource: resolved.roleSource,
    memberships,
    familyId: resolved.familyId,
  };
}
