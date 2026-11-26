import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { paginated, success } from "../utils/apiResponse";
import { idParam } from "../utils/params";
import { ApiError } from "../utils/ApiError";
import { parseOrThrow } from "../validators/validate";
import {
  createAdjustmentSchema,
  listAdjustmentsQuerySchema,
  rejectAdjustmentSchema,
} from "../validators/stockAdjustments.validator";
import { hasPermission } from "../services/permissions.service";
import * as adjustmentsService from "../services/stockAdjustments.service";

async function viewer(req: Request) {
  if (!req.user) throw ApiError.unauthorized();
  return { id: req.user.id, canSeeAll: await hasPermission(req.user.roleName, "stock_adjustments.approve") };
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { per_page, ...query } = parseOrThrow(listAdjustmentsQuerySchema, req.query);
  const { adjustments, meta } = await adjustmentsService.listAdjustments({
    ...query,
    perPage: per_page,
    viewer: await viewer(req),
  });
  paginated(res, adjustments, meta);
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  success(res, await adjustmentsService.getAdjustment(idParam(req), await viewer(req)));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const input = parseOrThrow(createAdjustmentSchema, req.body);
  const { id, canSeeAll } = await viewer(req);
  const adjustment = await adjustmentsService.createAdjustment(input, { id, canApprove: canSeeAll });
  success(
    res,
    adjustment,
    adjustment.status === "approved" ? "Adjustment applied" : "Adjustment submitted for approval",
    201
  );
});

export const approve = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  success(res, await adjustmentsService.approveAdjustment(idParam(req), req.user.id), "Adjustment approved and applied");
});

export const reject = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const { reason } = parseOrThrow(rejectAdjustmentSchema, req.body);
  success(res, await adjustmentsService.rejectAdjustment(idParam(req), req.user.id, reason), "Adjustment rejected");
});
