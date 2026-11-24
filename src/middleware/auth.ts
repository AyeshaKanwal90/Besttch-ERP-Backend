import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { ApiError } from "../utils/ApiError";
import { AuthUser } from "../types/express";
import { PermissionName } from "../constants/permissions";
import { hasPermission } from "../services/permissions.service";

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[env.cookieName];

  if (!token) {
    throw ApiError.unauthorized("You must be logged in to access this resource");
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthUser;
    req.user = payload;
    next();
  } catch {
    throw ApiError.unauthorized("Invalid or expired session");
  }
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
