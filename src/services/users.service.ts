import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import { ROLES } from "../constants/roles";
import { AuthUser } from "../types/express";

interface ListUsersParams {
  search?: string;
  role?: string;
  status?: "active" | "inactive";
  page: number;
  perPage: number;
  sort: "name" | "email" | "createdAt" | "lastLoginAt";
  direction: "asc" | "desc";
}

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  avatarUrl: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  role: {
    select: {
      id: true,
      name: true,
      displayName: true,
    },
  },
} satisfies Prisma.UserSelect;

export async function listUsers(params: ListUsersParams) {
  const where: Prisma.UserWhereInput = {
    deletedAt: null,

    ...(params.status
      ? {
          status: params.status,
        }
      : {}),

    ...(params.role
      ? {
          role: {
            name: params.role,
          },
        }
      : {}),

    ...(params.search
      ? {
          OR: [
            {
              name: {
                contains: params.search,
                mode: "insensitive",
              },
            },
            {
              email: {
                contains: params.search,
                mode: "insensitive",
              },
            },
          ],
        }
      : {}),
  };

  const [total, users] = await Promise.all([
    prisma.user.count({
      where,
    }),

    prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: {
        [params.sort]: params.direction,
      },
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
    }),
  ]);

  return {
    users,
    meta: {
      currentPage: params.page,
      perPage: params.perPage,
      total,
      lastPage: Math.max(1, Math.ceil(total / params.perPage)),
    },
  };
}

export async function getUserById(id: number) {
  const user = await prisma.user.findFirst({
    where: {
      id,
      deletedAt: null,
    },
    select: userSelect,
  });

  if (!user) {
    throw ApiError.notFound("User not found");
  }

  return user;
}

export async function createUser(input: {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  roleId: number;
  password: string;
  status?: "active" | "inactive";
}, actingUser: AuthUser) {
  const role = await assertRoleExists(input.roleId);
  assertCanManageRole(actingUser, role.name, "create");
  await assertEmailAvailable(input.email);

  const hashedPassword = await bcrypt.hash(input.password, 10);

  const fullName = `${input.firstName.trim()} ${input.lastName.trim()}`;

  return prisma.user.create({
    data: {
      name: fullName,
      email: input.email.toLowerCase(),
      password: hashedPassword,
      roleId: input.roleId,
      phone: input.phoneNumber,
      status: input.status ?? "active",
    },

    select: userSelect,
  });
}

export async function updateUser(
  id: number,
  input: {
    name?: string;
    email?: string;
    password?: string;
    roleId?: number;
    phone?: string | null;
    status?: "active" | "inactive";
  },
  actingUser: AuthUser
) {
  const target = await findEditableTargetOrThrow(id, actingUser);

  if (input.roleId) {
    const role = await assertRoleExists(input.roleId);
    assertCanManageRole(actingUser, role.name, "assign");
  }

  if (input.email && input.email.toLowerCase() !== target.email.toLowerCase()) {
    await assertEmailAvailable(input.email);
  }

  return prisma.user.update({
    where: {
      id,
    },

    data: {
      ...(input.name
        ? {
            name: input.name,
          }
        : {}),

      ...(input.email
        ? {
            email: input.email.toLowerCase(),
          }
        : {}),

      ...(input.password
        ? {
            password: await bcrypt.hash(input.password, 10),
          }
        : {}),

      ...(input.roleId
        ? {
            roleId: input.roleId,
          }
        : {}),

      ...(input.phone !== undefined
        ? {
            phone: input.phone,
          }
        : {}),

      ...(input.status
        ? {
            status: input.status,
          }
        : {}),

      // A new password or deactivation ends the user's sessions.
      ...(input.password || input.status === "inactive"
        ? {
            tokenVersion: { increment: 1 },
          }
        : {}),
    },

    select: userSelect,
  });
}

/**
 * Archives a user (soft delete) by default. With `permanent` the row is
 * removed; the route only allows that for users.delete_permanent, which
 * is super-admin only. Archived users can also be removed permanently.
 */
export async function deleteUser(
  id: number,
  actingUser: AuthUser,
  options: { permanent: boolean } = { permanent: false }
) {
  if (id === actingUser.id) {
    throw ApiError.forbidden("You cannot delete your own account");
  }

  await findEditableTargetOrThrow(id, actingUser, { includeArchived: options.permanent });

  if (options.permanent) {
    await prisma.user.delete({ where: { id } });
    return;
  }

  await prisma.user.update({
    where: {
      id,
    },
    data: {
      deletedAt: new Date(),
      tokenVersion: { increment: 1 },
    },
  });
}

export async function setUserStatus(
  id: number,
  status: "active" | "inactive",
  actingUser: AuthUser
) {
  if (id === actingUser.id && status === "inactive") {
    throw ApiError.forbidden("You cannot deactivate your own account");
  }

  await findEditableTargetOrThrow(id, actingUser);

  return prisma.user.update({
    where: {
      id,
    },

    data: {
      status,
      ...(status === "inactive" ? { tokenVersion: { increment: 1 } } : {}),
    },

    select: userSelect,
  });
}

async function assertRoleExists(roleId: number) {
  const role = await prisma.role.findUnique({
    where: {
      id: roleId,
    },
  });

  if (!role) {
    throw ApiError.unprocessable("Validation failed", {
      roleId: ["Selected role does not exist"],
    });
  }

  return role;
}

// Roles a non-super-admin user manager may create, edit or assign.
// From the requirements doc: admins manage staff and client users only.
const ROLES_MANAGEABLE_BY_ADMINS: readonly string[] = [ROLES.STAFF, ROLES.CLIENT];

function assertCanManageRole(actingUser: AuthUser, roleName: string, action: "create" | "assign" | "manage") {
  if (actingUser.roleName === ROLES.SUPER_ADMIN || ROLES_MANAGEABLE_BY_ADMINS.includes(roleName)) {
    return;
  }

  const messages = {
    create: "You can only create staff and client users",
    assign: "You can only assign the staff or client role",
    manage: "You can only manage staff and client users",
  };

  throw ApiError.forbidden(messages[action]);
}

async function assertEmailAvailable(email: string) {
  const existing = await prisma.user.findFirst({
    where: {
      email: email.toLowerCase(),
      deletedAt: null,
    },
  });

  if (existing) {
    throw ApiError.unprocessable("Validation failed", {
      email: ["Email is already in use"],
    });
  }
}

// Super admins can manage anyone; everyone else only staff and clients.
async function findEditableTargetOrThrow(
  id: number,
  actingUser: AuthUser,
  options: { includeArchived?: boolean } = {}
) {
  const target = await prisma.user.findFirst({
    where: {
      id,
      ...(options.includeArchived ? {} : { deletedAt: null }),
    },

    include: {
      role: true,
    },
  });

  if (!target) {
    throw ApiError.notFound("User not found");
  }

  assertCanManageRole(actingUser, target.role.name, "manage");

  return target;
}
