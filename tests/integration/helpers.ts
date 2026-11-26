import bcrypt from "bcryptjs";
import request from "supertest";
import { prisma } from "../../src/config/prisma";
import { createApp } from "../../src/app";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS } from "../../src/constants/permissions";
import { clearPermissionCache } from "../../src/services/permissions.service";
import { resetRateLimits } from "../../src/middleware/rateLimit";
import { makeAuthCookie } from "../helpers/authToken";

export const app = createApp();

export interface TestUsers {
  superAdmin: string;
  admin: string;
  staff: string;
  client: string;
  ids: Record<"superAdmin" | "admin" | "staff" | "client", number>;
}

/**
 * Empties every table, then seeds the roles with their default
 * permissions and one user per role. Returns auth cookies for each.
 */
export async function resetDatabase(): Promise<TestUsers> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const list = tables.map((t) => `"${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);

  await prisma.permission.createMany({ data: PERMISSIONS.map(({ name, description }) => ({ name, description })) });
  const permissions = await prisma.permission.findMany();
  const permissionId = new Map(permissions.map((p) => [p.name, p.id]));

  const password = await bcrypt.hash("Password@123", 4);
  const users = {} as TestUsers["ids"];
  const roleKeys = [
    ["super_admin", "superAdmin"],
    ["admin", "admin"],
    ["staff", "staff"],
    ["client", "client"],
  ] as const;

  for (const [roleName, key] of roleKeys) {
    const role = await prisma.role.create({ data: { name: roleName, displayName: roleName } });
    await prisma.rolePermission.createMany({
      data: DEFAULT_ROLE_PERMISSIONS[roleName].map((name) => ({ roleId: role.id, permissionId: permissionId.get(name)! })),
    });
    const user = await prisma.user.create({
      data: { name: `Test ${key}`, email: `${key.toLowerCase()}@test.local`, password, roleId: role.id },
    });
    users[key] = user.id;
  }

  clearPermissionCache();
  await resetRateLimits();

  const cookie = (key: keyof TestUsers["ids"], roleName: string) =>
    makeAuthCookie({ id: users[key], email: `${key.toLowerCase()}@test.local`, roleId: 0, roleName, tokenVersion: 0 });

  return {
    superAdmin: cookie("superAdmin", "super_admin"),
    admin: cookie("admin", "admin"),
    staff: cookie("staff", "staff"),
    client: cookie("client", "client"),
    ids: users,
  };
}

/** Small helpers for building fixtures through the API. */
export function api(cookie: string) {
  return {
    get: (path: string) => request(app).get(`/api${path}`).set("Cookie", cookie),
    post: (path: string, body?: object) => request(app).post(`/api${path}`).set("Cookie", cookie).send(body ?? {}),
    put: (path: string, body?: object) => request(app).put(`/api${path}`).set("Cookie", cookie).send(body ?? {}),
    patch: (path: string, body?: object) => request(app).patch(`/api${path}`).set("Cookie", cookie).send(body ?? {}),
    delete: (path: string) => request(app).delete(`/api${path}`).set("Cookie", cookie),
  };
}

export async function createWarehouse(cookie: string, code: string) {
  const res = await api(cookie).post("/warehouses", { name: `Warehouse ${code}`, code });
  if (res.status !== 201) throw new Error(`createWarehouse failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: number; code: string };
}

export async function createProduct(cookie: string, overrides: Record<string, unknown> = {}) {
  const sku = (overrides.sku as string) ?? `SKU-${Math.random().toString(36).slice(2, 8)}`;
  const res = await api(cookie).post("/products", {
    sku,
    barcode: `BC-${sku}`,
    name: `Product ${sku}`,
    unitPrice: 10,
    ...overrides,
  });
  if (res.status !== 201) throw new Error(`createProduct failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body.data as { id: number; sku: string; barcode: string };
}

export { prisma };
