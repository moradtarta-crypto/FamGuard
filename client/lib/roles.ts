import type { AccountRole } from './schema';

export const ROLE_LABEL: Record<AccountRole, string> = {
  parent: 'Parent',
  child: 'Child',
};

export function roleLabel(role: AccountRole | null): string {
  return role ? ROLE_LABEL[role] : 'Role not assigned';
}

export const ROLE_SUMMARY: Record<AccountRole, string> = {
  parent: 'Parents manage members, invites, zones and acknowledge SOS alerts.',
  child: 'Children share their location, raise SOS alerts and follow family zones.',
};
