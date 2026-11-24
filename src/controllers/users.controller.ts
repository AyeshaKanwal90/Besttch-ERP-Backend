import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { idParam } from "../utils/params";
import { paginated, success } from "../utils/apiResponse";
import { ApiError } from "../utils/ApiError";
import {
  createUserSchema,
  deleteUserQuerySchema,
  listUsersQuerySchema,
  toggleStatusSchema,
  updateUserSchema,
} from "../validators/users.validator";
import { parseOrThrow } from "../validators/validate";
import * as usersService from "../services/users.service";
import { hasPermission } from "../services/permissions.service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = parseOrThrow(listUsersQuerySchema, req.query);
  const { users, meta } = await usersService.listUsers({
    search: query.search,
    role: query.role,
    status: query.status,
    page: query.page,
    perPage: query.per_page,
    sort: query.sort,
    direction: query.direction,
  });
  paginated(res, users, meta);
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const user = await usersService.getUserById(idParam(req));
  success(res, user);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const input = parseOrThrow(createUserSchema, req.body);
  const user = await usersService.createUser(input, req.user);
  success(res, user, "User created successfully", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const input = parseOrThrow(updateUserSchema, req.body);
  const user = await usersService.updateUser(idParam(req), input, req.user);
  success(res, user, "User updated successfully");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const { permanent } = parseOrThrow(deleteUserQuerySchema, req.query);

  if (permanent && !(await hasPermission(req.user.roleName, "users.delete_permanent"))) {
    throw ApiError.forbidden("Only a Super Admin can permanently delete users");
  }

  await usersService.deleteUser(idParam(req), req.user, { permanent });
  res.status(204).send();
});

export const setStatus = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const { status } = parseOrThrow(toggleStatusSchema, req.body);
  const user = await usersService.setUserStatus(idParam(req), status, req.user);
  success(res, user, "User status updated");
});
