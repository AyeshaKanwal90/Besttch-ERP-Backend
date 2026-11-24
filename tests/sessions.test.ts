import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";

jest.mock("../src/config/prisma", () => ({
  prisma: {
    user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    role: { findUnique: jest.fn() },
    rolePermission: { findMany: jest.fn() },
  },
}));

import { prisma } from "../src/config/prisma";
import { createApp } from "../src/app";
import { env } from "../src/config/env";
import { FAKE_ADMIN, FAKE_STAFF, FAKE_SUPER_ADMIN, makeAuthCookie, useValidSessions } from "./helpers/authToken";
import { useDefaultPermissions } from "./helpers/permissions";

const app = createApp();
const user = prisma.user as unknown as Record<string, jest.Mock>;

function sessionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FAKE_STAFF.id,
    email: FAKE_STAFF.email,
    status: "active",
    deletedAt: null,
    tokenVersion: 0,
    role: { id: 3, name: "staff" },
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(user).forEach((fn) => fn.mockReset());
  useDefaultPermissions(prisma.rolePermission.findMany as jest.Mock);
});

describe("requireAuth checks the account on every request", () => {
  it("accepts a token whose version matches", async () => {
    user.findUnique.mockResolvedValue(sessionRow());
    user.findFirst.mockResolvedValue({ ...sessionRow(), name: "Staff", phone: null, avatarUrl: null, lastLoginAt: null, createdAt: new Date(), role: { id: 3, name: "staff", displayName: "Staff" } });

    const res = await request(app).get("/api/auth/me").set("Cookie", makeAuthCookie(FAKE_STAFF));

    expect(res.status).toBe(200);
  });

  it.each([
    ["the token version was bumped", sessionRow({ tokenVersion: 1 })],
    ["the account was deactivated", sessionRow({ status: "inactive" })],
    ["the account was deleted", sessionRow({ deletedAt: new Date() })],
    ["the account no longer exists", null],
  ])("rejects the session when %s", async (_label, row) => {
    user.findUnique.mockResolvedValue(row);

    const res = await request(app).get("/api/auth/me").set("Cookie", makeAuthCookie(FAKE_STAFF));

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/session has ended/);
  });

  it("rejects a token issued before token versions existed", async () => {
    user.findUnique.mockResolvedValue(sessionRow());
    const { tokenVersion: _ignored, ...legacy } = FAKE_STAFF;
    const token = jwt.sign(legacy, env.jwtSecret, { expiresIn: "1h" });

    const res = await request(app).get("/api/auth/me").set("Cookie", `${env.cookieName}=${token}`);

    expect(res.status).toBe(401);
  });

  it("uses the role from the database, not the one in the token", async () => {
    // Token says staff, but the user has since been moved to client.
    user.findUnique.mockResolvedValue(sessionRow({ role: { id: 4, name: "client" } }));

    const res = await request(app).get("/api/products").set("Cookie", makeAuthCookie(FAKE_STAFF));

    expect(res.status).toBe(403);
  });
});

describe("what bumps the token version", () => {
  const TARGET = { id: 9, email: "t@besttech.com", deletedAt: null, role: { id: 3, name: "staff" } };

  beforeEach(() => {
    useValidSessions(user.findUnique);
    user.findFirst.mockResolvedValue(TARGET);
    user.update.mockResolvedValue({ id: 9 });
    (prisma.role.findUnique as jest.Mock).mockResolvedValue({ id: 3, name: "staff" });
  });

  it("deactivating a user", async () => {
    const res = await request(app)
      .patch("/api/users/9/status")
      .set("Cookie", makeAuthCookie(FAKE_ADMIN))
      .send({ status: "inactive" });

    expect(res.status).toBe(200);
    expect(user.update.mock.calls[0][0].data).toEqual({ status: "inactive", tokenVersion: { increment: 1 } });
  });

  it("but not re-activating one", async () => {
    await request(app).patch("/api/users/9/status").set("Cookie", makeAuthCookie(FAKE_ADMIN)).send({ status: "active" });

    expect(user.update.mock.calls[0][0].data).toEqual({ status: "active" });
  });

  it("archiving a user", async () => {
    const res = await request(app).delete("/api/users/9").set("Cookie", makeAuthCookie(FAKE_SUPER_ADMIN));

    expect(res.status).toBe(204);
    expect(user.update.mock.calls[0][0].data).toEqual({ deletedAt: expect.any(Date), tokenVersion: { increment: 1 } });
  });

  it("an admin setting a new password or deactivating through PUT", async () => {
    await request(app).put("/api/users/9").set("Cookie", makeAuthCookie(FAKE_ADMIN)).send({ password: "NewPassword1" });
    expect(user.update.mock.calls[0][0].data.tokenVersion).toEqual({ increment: 1 });

    await request(app).put("/api/users/9").set("Cookie", makeAuthCookie(FAKE_ADMIN)).send({ status: "inactive" });
    expect(user.update.mock.calls[1][0].data.tokenVersion).toEqual({ increment: 1 });
  });

  it("but not a plain profile edit through PUT", async () => {
    await request(app).put("/api/users/9").set("Cookie", makeAuthCookie(FAKE_ADMIN)).send({ name: "New Name" });

    expect(user.update.mock.calls[0][0].data.tokenVersion).toBeUndefined();
  });
});

describe("changing your own password", () => {
  const PROFILE = {
    id: FAKE_STAFF.id,
    name: "Staff",
    email: FAKE_STAFF.email,
    phone: null,
    avatarUrl: null,
    status: "active",
    lastLoginAt: null,
    createdAt: new Date(),
    roleId: 3,
    role: { id: 3, name: "staff", displayName: "Staff" },
  };

  beforeEach(async () => {
    useValidSessions(user.findUnique);
    user.findFirst.mockResolvedValue({ ...PROFILE, tokenVersion: 0, password: await bcrypt.hash("OldPassword1", 10) });
  });

  it("logs out other sessions but keeps this one", async () => {
    user.update.mockResolvedValue({ ...PROFILE, tokenVersion: 1 });

    const res = await request(app)
      .put("/api/auth/me")
      .set("Cookie", makeAuthCookie(FAKE_STAFF))
      .send({ currentPassword: "OldPassword1", newPassword: "NewPassword1" });

    expect(res.status).toBe(200);
    expect(user.update.mock.calls[0][0].data.tokenVersion).toEqual({ increment: 1 });

    // A fresh cookie carrying the new version is issued to this session.
    const cookie = res.headers["set-cookie"]?.[0] ?? "";
    const token = cookie.split(";")[0].split("=")[1];
    expect((jwt.verify(token, env.jwtSecret) as { tokenVersion: number }).tokenVersion).toBe(1);
  });

  it("doesn't touch sessions for a profile-only change", async () => {
    user.update.mockResolvedValue({ ...PROFILE, tokenVersion: 0 });

    const res = await request(app).put("/api/auth/me").set("Cookie", makeAuthCookie(FAKE_STAFF)).send({ name: "Renamed" });

    expect(res.status).toBe(200);
    expect(user.update.mock.calls[0][0].data.tokenVersion).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
});
