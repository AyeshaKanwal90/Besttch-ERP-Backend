import { DEFAULT_ROLE_PERMISSIONS } from "../../src/constants/permissions";
import { clearPermissionCache } from "../../src/services/permissions.service";

/**
 * Makes a mocked prisma.rolePermission.findMany answer with the default
 * role mapping, so route tests exercise the real requirePermission
 * middleware against the permissions the seed would create.
 */
export function useDefaultPermissions(findMany: jest.Mock) {
  clearPermissionCache();
  findMany.mockImplementation(async (args: { where: { role: { name: string } } }) =>
    (DEFAULT_ROLE_PERMISSIONS[args.where.role.name] ?? []).map((name) => ({ permission: { name } }))
  );
}
