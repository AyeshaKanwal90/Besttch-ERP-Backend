import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import { AuthUser } from "../types/express";
import { PermissionName } from "../constants/permissions";
import { hasPermission } from "../services/permissions.service";

/**
 * Verifies the session cookie, then checks the account in the database:
 * the session is rejected if the user was deleted or deactivated, or if
 * their token version was bumped (password reset/change, deactivation,
 * deletion) after this token was issued. The role is read from the
 * database too, so role changes apply on the next request.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[env.cookieName];

  if (!token) {
    next(ApiError.unauthorized("You must be logged in to access this resource"));
    return;
  }

  let payload: AuthUser;
  try {
    payload = jwt.verify(token, env.jwtSecret) as AuthUser;
  } catch {
    next(ApiError.unauthorized("Invalid or expired session"));
    return;
  }

  prisma.user
    .findUnique({
      where: { id: payload.id },
      select: {
        id: true,
        email: true,
        status: true,
        deletedAt: true,
        tokenVersion: true,
        role: { select: { id: true, name: true } },
      },
    })
    .then((user) => {
      if (
        !user ||
        user.deletedAt ||
        user.status !== "active" ||
        user.tokenVersion !== payload.tokenVersion
      ) {
        next(ApiError.unauthorized("Your session has ended. Please log in again."));
        return;
      }

      req.user = {
        id: user.id,
        email: user.email,
        roleId: user.role.id,
        roleName: user.role.name,
        tokenVersion: user.tokenVersion,
      };
      next();
    })
    .catch(next);
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw ApiError.unauthorized();
    }

    if (!allowedRoles.includes(req.user.roleName)) {
      throw ApiError.forbidden("You do not have permission to perform this action");
    }

    next();
  };
}

/**
 * Allows the request only if the user's role has every listed permission.
 * Must run after requireAuth.
 */
export function requirePermission(...required: PermissionName[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }

    hasPermission(req.user.roleName, ...required)
      .then((allowed) => {
        next(allowed ? undefined : ApiError.forbidden("You do not have permission to perform this action"));
      })
      .catch(next);
  };
}
