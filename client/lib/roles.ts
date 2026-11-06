export type AccountRole = 'parent' | 'child';

const PARENT_TOKENS = ['parent', 'guardian', 'owner', 'admin', 'caregiver'];
const CHILD_TOKENS = ['child', 'kid', 'teen', 'dependent'];

/** Maps an unknown database value onto the two FamGuard interfaces. */
export function normalizeRole(value: unknown): AccountRole | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return null;
  if (PARENT_TOKENS.some((token) => normalized.includes(token))) return 'parent';
  if (CHILD_TOKENS.some((token) => normalized.includes(token))) return 'child';
  return null;
}

export function pickString(row: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Identifiers can come back as uuid strings or as numbers depending on the schema. */
export function pickIdentifier(row: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!row) return null;
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

export const PROFILE_NAME_KEYS = ['full_name', 'name', 'display_name', 'first_name'] as const;
export const PROFILE_ROLE_KEYS = [
  'role',
  'account_type',
  'account_role',
  'member_role',
  'user_type',
] as const;

export const MEMBERSHIP_USER_KEYS = ['user_id', 'profile_id', 'member_id', 'account_id'] as const;
export const MEMBERSHIP_FAMILY_KEYS = ['family_id', 'family', 'families_id', 'family_uuid'] as const;
export const MEMBERSHIP_ROLE_KEYS = ['role', 'member_role', 'relationship', 'type'] as const;
