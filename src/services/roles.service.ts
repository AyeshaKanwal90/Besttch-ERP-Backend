import { prisma } from "../config/prisma";
import {
  PERMISSIONS,
  PERMISSION_NAMES,
  PermissionName,
  SUPER_ADMIN_ONLY_PERMISSIONS,
} from "../constants/permissions";
import { ROLES } from "../constants/roles";
import { ApiError } from "../utils/ApiError";
import { clearPermissionCache, getRolePermissions } from "./permissions.service";

const roleSelect = { id: true, name: true, displayName: true } as const;

async function findRoleOrThrow(id: number) {
  const role = await prisma.role.findUnique({ where: { id }, select: roleSelect });

  if (!role) {
    throw ApiError.notFound("Role not found");
  }

  return role;
}

export async function getRolePermissionDetails(id: number) {
  const role = await findRoleOrThrow(id);
  const granted = await getRolePermissions(role.name);

  return {
    role,
    permissions: PERMISSION_NAMES.filter((name) => granted.has(name)),
    // Full catalogue so a settings screen can render every checkbox.
    available: PERMISSIONS.map((p) => ({
      ...p,
      superAdminOnly: SUPER_ADMIN_ONLY_PERMISSIONS.includes(p.name),
    })),
  };
}

export async function setRolePermissions(id: number, requested: string[]) {
  const role = await findRoleOrThrow(id);
  const wanted = [...new Set(requested)];

  const unknown = wanted.filter((name) => !PERMISSION_NAMES.includes(name as PermissionName));
  if (unknown.length) {
    throw ApiError.unprocessable("Validation failed", {
      permissions: [`Unknown permission(s): ${unknown.join(", ")}`],
    });
  }

  if (role.name === ROLES.SUPER_ADMIN) {
    const missing = PERMISSION_NAMES.filter((name) => !wanted.includes(name));
    if (missing.length) {
      throw ApiError.unprocessable("Super Admin permissions cannot be reduced", {
        permissions: [`Missing: ${missing.join(", ")}`],
      });
    }
  } else {
    const restricted = wanted.filter((name) => SUPER_ADMIN_ONLY_PERMISSIONS.includes(name as PermissionName));
    if (restricted.length) {
      throw ApiError.unprocessable("Validation failed", {
        permissions: [`Only Super Admin can hold: ${restricted.join(", ")}`],
      });
    }
  }

  await prisma.$transaction(async (tx) => {
    // Make sure every catalogue entry has a row, in case the seed hasn't
    // been run since a permission was added.
    await tx.permission.createMany({
      data: PERMISSIONS.map(({ name, description }) => ({ name, description })),
      skipDuplicates: true,
    });

    const rows = await tx.permission.findMany({
      where: { name: { in: wanted } },
      select: { id: true },
    });

    await tx.rolePermission.deleteMany({ where: { roleId: role.id } });

    if (rows.length) {
      await tx.rolePermission.createMany({
        data: rows.map((row) => ({ roleId: role.id, permissionId: row.id })),
      });
    }
  });

  clearPermissionCache(role.name);

  return getRolePermissionDetails(id);
}
