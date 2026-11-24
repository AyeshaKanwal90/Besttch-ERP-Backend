import jwt from "jsonwebtoken";
import { env } from "../../src/config/env";
import { AuthUser } from "../../src/types/express";

export function makeAuthCookie(user: AuthUser): string {
  const token = jwt.sign(user, env.jwtSecret, { expiresIn: "1h" });
  return `${env.cookieName}=${token}`;
}

export const FAKE_SUPER_ADMIN: AuthUser = { id: 1, email: "admin@besttech.com", roleId: 1, roleName: "super_admin", tokenVersion: 0 };
export const FAKE_ADMIN: AuthUser = { id: 2, email: "manager@besttech.com", roleId: 2, roleName: "admin", tokenVersion: 0 };
export const FAKE_STAFF: AuthUser = { id: 3, email: "staff@besttech.com", roleId: 3, roleName: "staff", tokenVersion: 0 };
export const FAKE_CLIENT: AuthUser = { id: 4, email: "client@clientmail.com", roleId: 4, roleName: "client", tokenVersion: 0 };

const FAKE_USERS = [FAKE_SUPER_ADMIN, FAKE_ADMIN, FAKE_STAFF, FAKE_CLIENT];

/**
 * requireAuth looks the session user up with prisma.user.findUnique.
 * Point a mocked findUnique at the fake users above (active, token
 * version 0) so their cookies are accepted.
 */
export function useValidSessions(findUnique: jest.Mock) {
  findUnique.mockImplementation(async ({ where }: { where: { id: number } }) => {
    const user = FAKE_USERS.find((u) => u.id === where.id);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      status: "active",
      deletedAt: null,
      tokenVersion: 0,
      role: { id: user.roleId, name: user.roleName },
    };
  });
}
