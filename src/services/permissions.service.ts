import { prisma } from "../config/prisma";
import { PERMISSION_NAMES } from "../constants/permissions";
import { ROLES } from "../constants/roles";

/**
 * Role -> permission lookups happen on nearly every request, so they are
 * cached per role. Changes made through the role-permissions endpoint
 * clear the cache immediately; the TTL only matters when the database is
 * edited some other way (seed, another server instance).
 */
const CACHE_TTL_MS = 60 * 1000;

const cache = new Map<string, { permissions: Set<string>; expiresAt: number }>();

export async function getRolePermissions(roleName: string): Promise<Set<string>> {
  // Super admin always has everything, including permissions added in code
  // that haven't been seeded yet. This also makes lock-out impossible.
  if (roleName === ROLES.SUPER_ADMIN) {
    return new Set(PERMISSION_NAMES);
  }

  const cached = cache.get(roleName);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.permissions;
  }

  const rows = await prisma.rolePermission.findMany({
    where: { role: { name: roleName } },
    select: { permission: { select: { name: true } } },
  });

  const permissions = new Set(rows.map((row) => row.permission.name));
  cache.set(roleName, { permissions, expiresAt: Date.now() + CACHE_TTL_MS });

  return permissions;
}

export async function hasPermission(roleName: string, ...required: string[]): Promise<boolean> {
  const granted = await getRolePermissions(roleName);
  return required.every((permission) => granted.has(permission));
}

export function clearPermissionCache(roleName?: string) {
  if (roleName) cache.delete(roleName);
  else cache.clear();
}
