import { Request, Response } from "express";
import { env } from "../config/env";
import { asyncHandler } from "../utils/asyncHandler";
import { success } from "../utils/apiResponse";
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from "../validators/auth.validator";
import * as passwordResetService from "../services/passwordReset.service";
import { parseOrThrow } from "../validators/validate";
import * as authService from "../services/auth.service";
import { ApiError } from "../utils/ApiError";

const baseCookieOptions = {
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: env.cookieSameSite,
  path: "/",
};

const cookieOptions = {
  ...baseCookieOptions,
  maxAge: 24 * 60 * 60 * 1000,
};

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = parseOrThrow(loginSchema, req.body);
  const { token, user } = await authService.login(email, password);

  res.cookie(env.cookieName, token, cookieOptions);
  success(res, user, "Logged in successfully");
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  // Must match the attributes the cookie was set with or browsers keep it.
  res.clearCookie(env.cookieName, baseCookieOptions);
  success(res, null, "Logged out successfully");
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw ApiError.unauthorized();
  }

  const user = await authService.getCurrentUser(req.user.id);
  success(res, user);
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const { email } = parseOrThrow(forgotPasswordSchema, req.body);
  await passwordResetService.requestPasswordReset(email);

  // Same answer whether or not the account exists.
  success(res, null, "If an account exists for that email, a password reset link has been sent.");
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const { token, password } = parseOrThrow(resetPasswordSchema, req.body);
  await passwordResetService.resetPassword(token, password);

  success(res, null, "Your password has been reset. You can now log in.");
});

export const updateProfile = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw ApiError.unauthorized();
  }

  const input = parseOrThrow(updateProfileSchema, req.body);
  const user = await authService.updateOwnProfile(req.user.id, input);
  success(res, user, "Profile updated successfully");
});
