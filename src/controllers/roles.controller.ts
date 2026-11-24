import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { success } from "../utils/apiResponse";
import { idParam } from "../utils/params";
import { prisma } from "../config/prisma";
import { parseOrThrow } from "../validators/validate";
import { setRolePermissionsSchema } from "../validators/roles.validator";
import * as rolesService from "../services/roles.service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  const roles = await prisma.role.findMany({
    select: { id: true, name: true, displayName: true },
    orderBy: { id: "asc" },
  });
  success(res, roles);
});

export const getPermissions = asyncHandler(async (req: Request, res: Response) => {
  const data = await rolesService.getRolePermissionDetails(idParam(req));
  success(res, data);
});

export const setPermissions = asyncHandler(async (req: Request, res: Response) => {
  const { permissions } = parseOrThrow(setRolePermissionsSchema, req.body);
  const data = await rolesService.setRolePermissions(idParam(req), permissions);
  success(res, data, "Role permissions updated");
});
