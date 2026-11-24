import request from "supertest";
import { Prisma } from "@prisma/client";

jest.mock("../src/config/prisma", () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    role: {
      findUnique: jest.fn(),
    },
    rolePermission: {
      findMany: jest.fn(),
    },
  },
}));

import { prisma } from "../src/config/prisma";
import { createApp } from "../src/app";
import { makeAuthCookie, FAKE_ADMIN, FAKE_STAFF, FAKE_SUPER_ADMIN } from "./helpers/authToken";
import { useDefaultPermissions } from "./helpers/permissions";

const app = createApp();

const mocks = {
  findFirst: prisma.user.findFirst as jest.Mock,
  findMany: prisma.user.findMany as jest.Mock,
  count: prisma.user.count as jest.Mock,
  create: prisma.user.create as jest.Mock,
  update: prisma.user.update as jest.Mock,
  delete: prisma.user.delete as jest.Mock,
  roleFindUnique: prisma.role.findUnique as jest.Mock,
};

const VALID_USER = {
  firstName: "New",
  lastName: "User",
  email: "new@besttech.com",
  phoneNumber: "+1-555-0100",
  password: "Password@123",
  roleId: 3,
};

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  useDefaultPermissions(prisma.rolePermission.findMany as jest.Mock);
});

describe("POST /api/users", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).post("/api/users").send({ name: "New User" });
    expect(res.status).toBe(401);
  });

  it("rejects staff users with 403 (not a user manager role)", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Cookie", makeAuthCookie(FAKE_STAFF))
      .send(VALID_USER);

    expect(res.status).toBe(403);
  });

  it("returns 422 with field errors when required fields are missing", async () => {
    const res = await request(app)
      .post("/api/users")
      .set("Cookie", makeAuthCookie(FAKE_ADMIN))
      .send({ email: "not-an-email" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.errors).toBeDefined();
    expect(res.body.errors.firstName).toBeDefined();
    expect(res.body.errors.lastName).toBeDefined();
    expect(res.body.errors.phoneNumber).toBeDefined();
    expect(res.body.errors.password).toBeDefined();
  });

  it("creates a user when payload is valid and role manages users", async () => {
    mocks.roleFindUnique.mockResolvedValue({ id: 3, name: "staff" });
    mocks.findFirst.mockResolvedValue(null); // email available
    mocks.create.mockResolvedValue({
      id: 10,
      name: "New User",
      email: "new@besttech.com",
      phone: null,
      avatarUrl: null,
      status: "active",
      lastLoginAt: null,
      createdAt: new Date(),
      role: { id: 3, name: "staff", displayName: "Staff" },
    });

    const res = await request(app)
      .post("/api/users")
      .set("Cookie", makeAuthCookie(FAKE_ADMIN))
      .send(VALID_USER);

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe("new@besttech.com");
  });
});

describe("DELETE /api/users/:id", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).delete("/api/users/5");
    expect(res.status).toBe(401);
  });

  it("soft-deletes a user as super admin", async () => {
    mocks.findFirst.mockResolvedValue({
      id: 5,
      email: "someone@besttech.com",
      role: { id: 3, name: "staff" },
    });
    mocks.update.mockResolvedValue({});

    const res = await request(app).delete("/api/users/5").set("Cookie", makeAuthCookie(FAKE_SUPER_ADMIN));

    expect(res.status).toBe(204);
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { deletedAt: expect.any(Date) },
    });
  });

  it("blocks an admin from deleting a super admin account", async () => {
    mocks.findFirst.mockResolvedValue({
      id: 1,
      email: "root@besttech.com",
      role: { id: 1, name: "super_admin" },
    });

    const res = await request(app).delete("/api/users/1").set("Cookie", makeAuthCookie(FAKE_ADMIN));

    expect(res.status).toBe(403);
  });
});

const ROLE_ROWS: Record<number, { id: number; name: string }> = {
  1: { id: 1, name: "super_admin" },
  2: { id: 2, name: "admin" },
  3: { id: 3, name: "staff" },
  4: { id: 4, name: "client" },
};

function existingUser(id: number, roleId: number) {
  return { id, email: `user${id}@besttech.com`, deletedAt: null, role: ROLE_ROWS[roleId] };
}

describe("admins manage only staff and client users", () => {
  beforeEach(() => {
    mocks.roleFindUnique.mockImplementation(async ({ where }: { where: { id: number } }) => ROLE_ROWS[where.id] ?? null);
    mocks.create.mockResolvedValue({ id: 20, email: "new@besttech.com" });
    mocks.update.mockResolvedValue({ id: 5 });
  });

  it("refuses an admin creating another admin", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/users")
      .set("Cookie", makeAuthCookie(FAKE_ADMIN))
      .send({ ...VALID_USER, roleId: 2 });

    expect(res.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("lets a super admin create an admin", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/users")
      .set("Cookie", makeAuthCookie(FAKE_SUPER_ADMIN))
      .send({ ...VALID_USER, roleId: 2 });

    expect(res.status).toBe(201);
  });

  it("lets an admin create a client", async () => {
    mocks.findFirst.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/users")
      .set("Cookie", makeAuthCookie(FAKE_ADMIN))
      .send({ ...VALID_USER, roleId: 4 });

    expect(res.status).toBe(201);
  });

  it("refuses an admin editing another admin", async () => {
    mocks.findFirst.mockResolvedValue(existingUser(7, 2));

    const res = await request(app).put("/api/users/7").set("Cookie", makeAuthCookie(FAKE_ADMIN)).send({ name: "Renamed" });

    expect(res.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("refuses an admin promoting staff to admin", async () => {
    mocks.findFirst.mockResolvedValue(existingUser(5, 3));

    const res = await request(app).put("/api/users/5").set("Cookie", makeAuthCookie(FAKE_ADMIN)).send({ roleId: 2 });

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/staff or client/);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("lets an admin edit a staff user and move them to client", async () => {
    mocks.findFirst.mockResolvedValue(existingUser(5, 3));

    const res = await request(app).put("/api/users/5").set("Cookie", makeAuthCookie(FAKE_ADMIN)).send({ roleId: 4 });

    expect(res.status).toBe(200);
  });

  it("refuses an admin deactivating another admin", async () => {
    mocks.findFirst.mockResolvedValue(existingUser(7, 2));

    const res = await request(app)
      .patch("/api/users/7/status")
      .set("Cookie", makeAuthCookie(FAKE_ADMIN))
      .send({ status: "inactive" });

    expect(res.status).toBe(403);
  });

  it("refuses an admin deleting another admin", async () => {
    mocks.findFirst.mockResolvedValue(existingUser(7, 2));

    const res = await request(app).delete("/api/users/7").set("Cookie", makeAuthCookie(FAKE_ADMIN));

    expect(res.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("deleting users", () => {
  it("refuses deleting your own account", async () => {
    const res = await request(app).delete(`/api/users/${FAKE_SUPER_ADMIN.id}`).set("Cookie", makeAuthCookie(FAKE_SUPER_ADMIN));

    expect(res.status).toBe(403);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("refuses deactivating your own account", async () => {
    const res = await request(app)
      .patch(`/api/users/${FAKE_SUPER_ADMIN.id}/status`)
      .set("Cookie", makeAuthCookie(FAKE_SUPER_ADMIN))
      .send({ status: "inactive" });

    expect(res.status).toBe(403);
  });

  it("refuses a permanent delete by an admin", async () => {
    mocks.findFirst.mockResolvedValue(existingUser(5, 3));

    const res = await request(app).delete("/api/users/5?permanent=true").set("Cookie", makeAuthCookie(FAKE_ADMIN));

    expect(res.status).toBe(403);
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("lets a super admin permanently delete, including archived users", async () => {
    mocks.findFirst.mockResolvedValue({ ...existingUser(5, 3), deletedAt: new Date() });
    mocks.delete.mockResolvedValue({});

    const res = await request(app).delete("/api/users/5?permanent=true").set("Cookie", makeAuthCookie(FAKE_SUPER_ADMIN));

    expect(res.status).toBe(204);
    expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5 } }));
    expect(mocks.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("returns 409 when related records block a permanent delete", async () => {
    mocks.findFirst.mockResolvedValue(existingUser(5, 3));
    mocks.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "5.22.0" })
    );

    const res = await request(app).delete("/api/users/5?permanent=true").set("Cookie", makeAuthCookie(FAKE_SUPER_ADMIN));

    expect(res.status).toBe(409);
  });

  it("rejects a malformed permanent flag", async () => {
    const res = await request(app).delete("/api/users/5?permanent=yes").set("Cookie", makeAuthCookie(FAKE_SUPER_ADMIN));

    expect(res.status).toBe(422);
  });
});
