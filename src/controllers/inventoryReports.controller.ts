import { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler";
import { success } from "../utils/apiResponse";
import { parseOrThrow } from "../validators/validate";
import * as reports from "../services/inventoryReports.service";

const valuationQuerySchema = z.object({
  warehouseId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
});

export const lowStock = asyncHandler(async (_req: Request, res: Response) => {
  success(res, await reports.getLowStock());
});

export const stockValuation = asyncHandler(async (req: Request, res: Response) => {
  const filters = parseOrThrow(valuationQuerySchema, req.query);
  success(res, await reports.getStockValuation(filters));
});
