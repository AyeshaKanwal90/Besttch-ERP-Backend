import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { prisma } from "../config/prisma";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";
import { sendMail } from "./mail.service";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

const INVALID_LINK = "This reset link is invalid or has expired. Please request a new one.";

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Starts a password reset. Silently does nothing for unknown, archived or
 * inactive accounts: the endpoint answers the same way either way so it
 * can't be used to find out which emails are registered.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase(), deletedAt: null },
    select: { id: true, name: true, email: true, status: true },
  });

  if (!user || user.status !== "active") {
    return;
  }

  const token = randomBytes(32).toString("base64url");
  const now = new Date();

  await prisma.$transaction([
    // Only the newest link works.
    prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashResetToken(token),
        expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
      },
    }),
  ]);

  const link = `${env.appUrl}/reset-password?token=${encodeURIComponent(token)}`;

  // Not awaited: waiting on SMTP would make responses for real accounts
  // measurably slower than for unknown ones.
  sendMail({
    to: user.email,
    subject: "Reset your BestTech password",
    text: [
      `Hi ${user.name},`,
      "",
      "We received a request to reset your BestTech password. Use the link below to choose a new one:",
      "",
      link,
      "",
      "The link expires in 1 hour and can only be used once.",
      "If you didn't ask for this, you can ignore this email; your password won't change.",
    ].join("\n"),
  }).catch((err) => console.error("Failed to send password reset email:", err));
}

/**
 * Sets a new password using a reset token. The token is claimed with a
 * conditional update so two simultaneous requests can't both use it.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    include: { user: { select: { id: true, status: true, deletedAt: true } } },
  });

  const now = new Date();

  if (
    !record ||
    record.usedAt ||
    record.expiresAt <= now ||
    record.user.deletedAt ||
    record.user.status !== "active"
  ) {
    throw ApiError.badRequest(INVALID_LINK);
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.passwordResetToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: now },
    });

    if (claimed.count !== 1) {
      throw ApiError.badRequest(INVALID_LINK);
    }

    await tx.user.update({
      where: { id: record.userId },
      // Ends every existing session for the account.
      data: { password: passwordHash, tokenVersion: { increment: 1 } },
    });

    // Any other outstanding links for this user stop working too.
    await tx.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null },
      data: { usedAt: now },
    });
  });
}
