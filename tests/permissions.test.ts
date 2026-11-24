import express from "express";
import request from "supertest";

jest.mock("../src/config/prisma", () => ({
  prisma: { rolePermission: { findMany: jest.fn() } },
}));

import { prisma } from "../src/config/prisma";
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_NAMES,
  SUPER_ADMIN_ONLY_PERMISSIONS,
} from "../src/constants/permissions";
import { requireAuth, requirePermission } from "../src/middleware/auth";
import { errorHandler } from "../src/middleware/errorHandler";
import { clearPermissionCache, getRolePermissions } from "../src/services/permissions.service";
import cookieParser from "cookie-parser";
import { FAKE_ADMIN, FAKE_STAFF, FAKE_SUPER_ADMIN, makeAuthCookie } from "./helpers/authToken";

const findMany = prisma.rolePermission.findMany as jest.Mock;

function rowsFor(names: readonly string[]) {
  return names.map((name) => ({ permission: { name } }));
}

beforeEach(() => {
  findMany.mockReset();
  clearPermissionCache();
});

describe("default role permissions", () => {
  it("only uses permissions that exist in the catalogue", () => {
    for (const names of Object.values(DEFAULT_ROLE_PERMISSIONS)) {
      for (const name of names) expect(PERMISSION_NAMES).toContain(name);
    }
  });

  it("gives super admin everything", () => {
    expect([...DEFAULT_ROLE_PERMISSIONS.super_admin].sort()).toEqual([...PERMISSION_NAMES].sort());
  });

  it("keeps super-admin-only permissions away from every other role", () => {
    for (const role of ["admin", "staff", "client"]) {
      for (const name of SUPER_ADMIN_ONLY_PERMISSIONS) {
        expect(DEFAULT_ROLE_PERMISSIONS[role]).not.toContain(name);
      }
    }
  });

  it("follows the matrix for staff", () => {
    const staff = DEFAULT_ROLE_PERMISSIONS.staff;
    expect(staff).toEqual(expect.arrayContaining(["products.view", "items.update", "items.create"]));
    for (const name of ["products.create", "items.update_price", "users.view", "roles.view", "inventory_reports.view", "erp_reports.view"]) {
      expect(staff).not.toContain(name);
    }
  });

  it("gives clients only their own records", () => {
    for (const name of DEFAULT_ROLE_PERMISSIONS.client) {
      expect(name).toMatch(/\.own$/);
    }
  });
});

describe("getRolePermissions", () => {
  it("returns every permission for super admin without hitting the database", async () => {
    const granted = await getRolePermissions("super_admin");

    expect(granted.size).toBe(PERMISSION_NAMES.length);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("caches per role until cleared", async () => {
    findMany.mockResolvedValue(rowsFor(["products.view"]));

    await getRolePermissions("staff");
    await getRolePermissions("staff");
    expect(findMany).toHaveBeenCalledTimes(1);

    clearPermissionCache("staff");
    await getRolePermissions("staff");
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});

describe("requirePermission", () => {
  const app = express();
  app.use(cookieParser());
  app.get("/guarded", requireAuth, requirePermission("products.create", "products.view"), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);

  it("allows a role holding every listed permission", async () => {
    findMany.mockResolvedValue(rowsFor(["products.create", "products.view"]));

    const res = await request(app).get("/guarded").set("Cookie", makeAuthCookie(FAKE_ADMIN));

    expect(res.status).toBe(200);
  });

  it("rejects a role missing any of them", async () => {
    findMany.mockResolvedValue(rowsFor(["products.view"]));

    const res = await request(app).get("/guarded").set("Cookie", makeAuthCookie(FAKE_STAFF));

    expect(res.status).toBe(403);
  });

  it("always allows super admin", async () => {
    const res = await request(app).get("/guarded").set("Cookie", makeAuthCookie(FAKE_SUPER_ADMIN));

    expect(res.status).toBe(200);
  });

  it("passes database errors to the error handler", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    findMany.mockRejectedValue(new Error("db down"));

    const res = await request(app).get("/guarded").set("Cookie", makeAuthCookie(FAKE_STAFF));

    expect(res.status).toBe(500);
  });
});
