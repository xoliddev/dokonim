/** Roles & permissions (§16.3). Checked by command handlers in services, never only by routes. */
import { DomainError } from './errors';

export const ROLES = ['owner', 'admin', 'manager', 'catalog_editor', 'order_operator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'store.settings',
  'theme.edit',
  'payments.configure',
  'staff.manage',
  'catalog.write',
  'inventory.adjust',
  'orders.read',
  'orders.manage',
  'orders.refund',
  'customers.read',
  'discounts.manage',
  'analytics.read',
  'audit.read',
  'reviews.moderate',
  'dashboard.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = new Set<Permission>(PERMISSIONS);

const MATRIX: Record<Role, Set<Permission>> = {
  owner: ALL,
  admin: new Set(PERMISSIONS.filter((p) => p !== 'payments.configure')),
  manager: new Set<Permission>([
    'catalog.write', 'inventory.adjust', 'orders.read', 'orders.manage', 'orders.refund', 'customers.read',
    'discounts.manage', 'analytics.read', 'reviews.moderate', 'dashboard.read',
  ]),
  catalog_editor: new Set<Permission>(['catalog.write', 'inventory.adjust', 'reviews.moderate', 'dashboard.read']),
  order_operator: new Set<Permission>(['inventory.adjust', 'orders.read', 'orders.manage', 'customers.read', 'dashboard.read']),
  viewer: new Set<Permission>(['analytics.read', 'orders.read', 'dashboard.read']),
};

export function permissionsOf(role: Role): Permission[] {
  return [...MATRIX[role]];
}

export function can(role: Role | null | undefined, p: Permission): boolean {
  return !!role && MATRIX[role].has(p);
}

export function requirePermission(role: Role | null | undefined, p: Permission): void {
  if (!can(role, p)) throw new DomainError('FORBIDDEN', `Missing permission ${p}`, { permission: p, role: role ?? null });
}

/** Who may assign which role: nobody can grant above themselves; only the owner can create admins. */
export function canAssignRole(actor: Role, target: Role): boolean {
  if (target === 'owner') return false;
  if (actor === 'owner') return true;
  if (actor === 'admin') return target !== 'admin';
  return false;
}
