import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { paginated } from "../utils/apiResponse";
import { idParam } from "../utils/params";
import { ApiError } from "../utils/ApiError";
import { prisma } from "../config/prisma";
import { parseOrThrow } from "../validators/validate";
import { listMovementsQuerySchema } from "../validators/stockMovements.validator";
import * as movementsService from "../services/stockMovements.service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const { per_page, ...query } = parseOrThrow(listMovementsQuerySchema, req.query);
  const { movements, meta } = await movementsService.listMovements({ ...query, perPage: per_page });
  paginated(res, movements, meta);
});

/** GET /api/products/:id/movements: the same list, fixed to one product. */
export const listForProduct = asyncHandler(async (req: Request, res: Response) => {
  const productId = idParam(req);
  const exists = await prisma.product.findUnique({ where: { id: productId }, select: { id: true } });
  if (!exists) throw ApiError.notFound("Product not found");

  const { per_page, ...query } = parseOrThrow(listMovementsQuerySchema, req.query);
  const { movements, meta } = await movementsService.listMovements({ ...query, productId, perPage: per_page });
  paginated(res, movements, meta);
});
