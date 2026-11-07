import type { SupabaseClient, User } from '@supabase/supabase-js';
import { describeDbError } from './errors';
import { COLUMNS, isAccountRole } from './schema';
import type { AccountRole, FamilyMemberRow, ProfileRow } from './schema';

export interface AccountContext {
  userId: string;
  email: string | null;
  /** Null when the signed-in user has no profiles row yet (no trigger creates one). */
  profile: ProfileRow | null;
  displayName: string;
  memberships: FamilyMemberRow[];
  /** User-selected onboarding preference only; family_members remains the authorization source. */
  requestedRole: 'parent' | 'child' | null;
}

export function resolveDisplayName(profile: ProfileRow | null, user: User): string {
  const fromProfile = profile?.display_name?.trim();
  if (fromProfile) return fromProfile;

  const metadataName = user.user_metadata?.full_name;
  if (typeof metadataName === 'string' && metadataName.trim().length > 0) {
    return metadataName.trim();
  }

  const email = user.email ?? '';
  const local = email.includes('@') ? email.slice(0, email.indexOf('@')) : email;
  return local.length > 0 ? local : 'FamGuard user';
}

/** Role is per family: family_members.role is the only source of truth. */
export function roleForFamily(
  memberships: FamilyMemberRow[],
  familyId: string | null,
): AccountRole | null {
  if (!familyId) return null;
  const membership = memberships.find((row) => row.family_id === familyId);
  return membership && isAccountRole(membership.role) ? membership.role : null;
}

export async function loadAccount(client: SupabaseClient, user: User): Promise<AccountContext> {
  const { data: profileRow, error: profileError } = await client
    .from('profiles')
    .select(COLUMNS.profile)
    .eq('user_id', user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(describeDbError(profileError, 'read your profile').message);
  }

  const { data: membershipRows, error: membershipError } = await client
    .from('family_members')
    .select(COLUMNS.familyMember)
    .eq('user_id', user.id);

  if (membershipError) {
    throw new Error(describeDbError(membershipError, 'read your family membership').message);
  }

  const profile = (profileRow as ProfileRow | null) ?? null;
  const memberships = ((membershipRows ?? []) as FamilyMemberRow[]).filter((row) =>
    isAccountRole(row.role),
  );

  return {
    userId: user.id,
    email: user.email ?? null,
    profile,
    displayName: resolveDisplayName(profile, user),
    memberships,
    requestedRole: user.user_metadata?.requested_role === 'child' ? 'child' : user.user_metadata?.requested_role === 'parent' ? 'parent' : null,
  };
}
