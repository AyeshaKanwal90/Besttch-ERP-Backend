import bcrypt from "bcryptjs";
import request from "supertest";

jest.mock("../src/config/prisma", () => {
  const prisma: Record<string, any> = {
    user: { findFirst: jest.fn(), update: jest.fn() },
    passwordResetToken: { findUnique: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
  };
  // Supports both the array form and the interactive (callback) form.
  prisma.$transaction = jest.fn((arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[])
  );
  return { prisma };
});

jest.mock("../src/services/mail.service", () => ({ sendMail: jest.fn() }));

import { prisma } from "../src/config/prisma";
import { createApp } from "../src/app";
import { sendMail } from "../src/services/mail.service";
import { hashResetToken, RESET_TOKEN_TTL_MS } from "../src/services/passwordReset.service";
import { resetRateLimits } from "../src/middleware/rateLimit";

const app = createApp();
const db = prisma as unknown as Record<string, Record<string, jest.Mock>>;
const mail = sendMail as jest.Mock;

const GENERIC = "If an account exists for that email, a password reset link has been sent.";
const ACTIVE_USER = { id: 5, name: "Diego Fernandez", email: "diego@besttech.com", status: "active" };

beforeEach(async () => {
  for (const model of [db.user, db.passwordResetToken]) {
    Object.values(model).forEach((fn) => fn.mockReset());
  }
  mail.mockReset();
  mail.mockResolvedValue(undefined);
  db.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
  db.passwordResetToken.create.mockResolvedValue({});
  await resetRateLimits();
});

describe("POST /api/auth/forgot-password", () => {
  it("creates a hashed one-hour token and emails the link", async () => {
    db.user.findFirst.mockResolvedValue(ACTIVE_USER);
    const before = Date.now();

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "Diego@BestTech.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC);
    expect(db.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "diego@besttech.com", deletedAt: null } })
    );

    // Older links are invalidated first.
    expect(db.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 5, usedAt: null },
      data: { usedAt: expect.any(Date) },
    });

    const stored = db.passwordResetToken.create.mock.calls[0][0].data;
    expect(stored.userId).toBe(5);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    const ttl = stored.expiresAt.getTime() - before;
    expect(ttl).toBeGreaterThanOrEqual(RESET_TOKEN_TTL_MS - 1000);
    expect(ttl).toBeLessThanOrEqual(RESET_TOKEN_TTL_MS + 1000);

    // The emailed token is the one whose hash was stored, never the hash itself.
    const email = mail.mock.calls[0][0];
    expect(email.to).toBe("diego@besttech.com");
    const token = decodeURIComponent(email.text.match(/reset-password\?token=([^\s]+)/)[1]);
    expect(hashResetToken(token)).toBe(stored.tokenHash);
    expect(email.text).not.toContain(stored.tokenHash);
    expect(email.text).toContain("http://localhost:5173/reset-password?token=");
  });

  it("answers the same way for an unknown email and sends nothing", async () => {
    db.user.findFirst.mockResolvedValue(null);

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@besttech.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(GENERIC);
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mail).not.toHaveBeenCalled();
  });

  it("does nothing for an inactive account", async () => {
    db.user.findFirst.mockResolvedValue({ ...ACTIVE_USER, status: "inactive" });

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "diego@besttech.com" });

    expect(res.status).toBe(200);
    expect(db.passwordResetToken.create).not.toHaveBeenCalled();
    expect(mail).not.toHaveBeenCalled();
  });

  it("still answers 200 if the email fails to send", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    db.user.findFirst.mockResolvedValue(ACTIVE_USER);
    mail.mockRejectedValue(new Error("smtp down"));

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "diego@besttech.com" });

    expect(res.status).toBe(200);
  });

  it("rejects an invalid email address", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "not-an-email" });

    expect(res.status).toBe(422);
  });

  it("is rate limited", async () => {
    db.user.findFirst.mockResolvedValue(null);

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(app).post("/api/auth/forgot-password").send({ email: "x@besttech.com" });
      statuses.push(res.status);
    }

    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});

describe("POST /api/auth/reset-password", () => {
  const TOKEN = "a-valid-looking-token";

  function storedToken(overrides: Record<string, unknown> = {}) {
    return {
      id: 11,
      userId: 5,
      tokenHash: hashResetToken(TOKEN),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      usedAt: null,
      user: { id: 5, status: "active", deletedAt: null },
      ...overrides,
    };
  }

  it("sets the new password and uses up the token", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(storedToken());
    db.user.update.mockResolvedValue({});

    const res = await request(app).post("/api/auth/reset-password").send({ token: TOKEN, password: "NewPassword1" });

    expect(res.status).toBe(200);
    expect(db.passwordResetToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: hashResetToken(TOKEN) } })
    );
    expect(db.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { id: 11, usedAt: null },
      data: { usedAt: expect.any(Date) },
    });

    const { where, data } = db.user.update.mock.calls[0][0];
    expect(where).toEqual({ id: 5 });
    expect(await bcrypt.compare("NewPassword1", data.password)).toBe(true);
    // Every existing session for the account is ended.
    expect(data.tokenVersion).toEqual({ increment: 1 });
  });

  it.each([
    ["unknown", null],
    ["expired", storedToken({ expiresAt: new Date(Date.now() - 1000) })],
    ["already used", storedToken({ usedAt: new Date() })],
    ["for an inactive user", storedToken({ user: { id: 5, status: "inactive", deletedAt: null } })],
    ["for an archived user", storedToken({ user: { id: 5, status: "active", deletedAt: new Date() } })],
  ])("refuses a token that is %s", async (_label, record) => {
    db.passwordResetToken.findUnique.mockResolvedValue(record);

    const res = await request(app).post("/api/auth/reset-password").send({ token: TOKEN, password: "NewPassword1" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid or has expired/);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("lets only one of two simultaneous requests use a token", async () => {
    db.passwordResetToken.findUnique.mockResolvedValue(storedToken());
    db.passwordResetToken.updateMany.mockResolvedValue({ count: 0 }); // the other request claimed it

    const res = await request(app).post("/api/auth/reset-password").send({ token: TOKEN, password: "NewPassword1" });

    expect(res.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it("requires a password of at least 8 characters", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: TOKEN, password: "short" });

    expect(res.status).toBe(422);
    expect(res.body.errors.password).toBeDefined();
    expect(db.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });
});
