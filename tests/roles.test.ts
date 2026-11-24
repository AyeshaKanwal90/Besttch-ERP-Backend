import request from "supertest";

jest.mock("../src/config/prisma", () => {
  const prisma: Record<string, any> = {
    role: { findUnique: jest.fn(), findMany: jest.fn() },
    permission: { createMany: jest.fn(), findMany: jest.fn() },
    rolePermission: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));
  return { prisma };
});

import { prisma } from "../src/config/prisma";
import { createApp } from "../src/app";
import { PERMISSION_NAMES } from "../src/constants/permissions";
import { makeAuthCookie, useValidSessions, FAKE_ADMIN, FAKE_STAFF, FAKE_SUPER_ADMIN } from "./helpers/authToken";
import { useDefaultPermissions } from "./helpers/permissions";

const app = createApp();

const db = prisma as unknown as Record<string, Record<string, jest.Mock>>;

const ROLES_BY_ID: Record<number, { id: number; name: string; displayName: string }> = {
  1: { id: 1, name: "super_admin", displayName: "Super Admin" },
  2: { id: 2, name: "admin", displayName: "Admin" },
  3: { id: 3, name: "staff", displayName: "Staff" },
};

beforeEach(() => {
  for (const model of [db.role, db.permission, db.rolePermission]) {
    Object.values(model).forEach((fn) => fn.mockReset());
  }
  useDefaultPermissions(db.rolePermission.findMany);
  useValidSessions(db.user.findUnique);
  db.role.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) => ROLES_BY_ID[where.id] ?? null);
  db.permission.findMany.mockImplementation(async ({ where }: { where: { name: { in: string[] } } }) =>
    where.name.in.map((name, i) => ({ id: i + 1, name }))
  );
});

const asSuperAdmin = makeAuthCookie(FAKE_SUPER_ADMIN);

describe("GET /api/roles/:id/permissions", () => {
  it.each([
    ["admin", FAKE_ADMIN],
    ["staff", FAKE_STAFF],
  ])("is refused for %s", async (_label, user) => {
    const res = await request(app).get("/api/roles/3/permissions").set("Cookie", makeAuthCookie(user));

    expect(res.status).toBe(403);
  });

  it("returns the role's permissions and the catalogue", async () => {
    const res = await request(app).get("/api/roles/3/permissions").set("Cookie", asSuperAdmin);

    expect(res.status).toBe(200);
    expect(res.body.data.role.name).toBe("staff");
    expect(res.body.data.permissions).toContain("items.view");
    expect(res.body.data.permissions).not.toContain("products.create");
    expect(res.body.data.available).toHaveLength(PERMISSION_NAMES.length);
    expect(res.body.data.available.find((p: { name: string }) => p.name === "roles.manage").superAdminOnly).toBe(true);
  });

  it("returns 404 for an unknown role", async () => {
    const res = await request(app).get("/api/roles/99/permissions").set("Cookie", asSuperAdmin);

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/roles/:id/permissions", () => {
  it("is refused for admins", async () => {
    const res = await request(app)
      .put("/api/roles/3/permissions")
      .set("Cookie", makeAuthCookie(FAKE_ADMIN))
      .send({ permissions: ["products.view"] });

    expect(res.status).toBe(403);
    expect(db.rolePermission.deleteMany).not.toHaveBeenCalled();
  });

  it("replaces a role's permissions and takes effect immediately", async () => {
    // Warm the cache with staff's default permissions.
    // Passing the permission check caches staff's defaults. The handler
    // itself fails (product model isn't mocked here), which is fine.
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const warm = await request(app).get("/api/products/barcode/x").set("Cookie", makeAuthCookie(FAKE_STAFF));
    expect(warm.status).not.toBe(403);

    // What the database holds once the write below commits.
    db.rolePermission.findMany.mockResolvedValue([
      { permission: { name: "dashboard.view" } },
      { permission: { name: "items.view" } },
    ]);

    const res = await request(app)
      .put("/api/roles/3/permissions")
      .set("Cookie", asSuperAdmin)
      .send({ permissions: ["dashboard.view", "items.view", "items.view"] });

    expect(res.status).toBe(200);
    expect(db.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 3 } });
    expect(db.rolePermission.createMany).toHaveBeenCalledWith({
      data: [
        { roleId: 3, permissionId: 1 },
        { roleId: 3, permissionId: 2 },
      ],
    });

    expect(res.body.data.permissions).toEqual(["dashboard.view", "items.view"]);

    // The cached default set (which had products.view) must be gone.
    const after = await request(app).get("/api/products").set("Cookie", makeAuthCookie(FAKE_STAFF));
    expect(after.status).toBe(403);
  });

  it("rejects unknown permission names", async () => {
    const res = await request(app)
      .put("/api/roles/3/permissions")
      .set("Cookie", asSuperAdmin)
      .send({ permissions: ["products.view", "time_travel"] });

    expect(res.status).toBe(422);
    expect(res.body.errors.permissions[0]).toMatch(/time_travel/);
  });

  it("rejects a body without a permissions list", async () => {
    const res = await request(app).put("/api/roles/3/permissions").set("Cookie", asSuperAdmin).send({});

    expect(res.status).toBe(422);
  });

  it("won't reduce the Super Admin role", async () => {
    const res = await request(app)
      .put("/api/roles/1/permissions")
      .set("Cookie", asSuperAdmin)
      .send({ permissions: PERMISSION_NAMES.filter((name) => name !== "users.delete") });

    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/cannot be reduced/);
    expect(db.rolePermission.deleteMany).not.toHaveBeenCalled();
  });

  it("accepts the full list for Super Admin", async () => {
    const res = await request(app)
      .put("/api/roles/1/permissions")
      .set("Cookie", asSuperAdmin)
      .send({ permissions: PERMISSION_NAMES });

    expect(res.status).toBe(200);
  });

  it("won't give super-admin-only permissions to another role", async () => {
    const res = await request(app)
      .put("/api/roles/2/permissions")
      .set("Cookie", asSuperAdmin)
      .send({ permissions: ["users.view", "users.delete_permanent"] });

    expect(res.status).toBe(422);
    expect(res.body.errors.permissions[0]).toMatch(/users\.delete_permanent/);
  });

  it("returns 404 for an unknown role", async () => {
    const res = await request(app)
      .put("/api/roles/99/permissions")
      .set("Cookie", asSuperAdmin)
      .send({ permissions: [] });

    expect(res.status).toBe(404);
  });
});
