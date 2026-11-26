import { Request, Response } from "express";

import { asyncHandler } from "../utils/asyncHandler";
import { idParam } from "../utils/params";
import { paginated, success } from "../utils/apiResponse";

import {
  createProductSchema,
  listProductsQuerySchema,
  updateProductSchema,
} from "../validators/products.validator";

import { parseOrThrow } from "../validators/validate";
import * as productsService from "../services/products.service";
import { hasPermission } from "../services/permissions.service";
import { ApiError } from "../utils/ApiError";

// Reorder thresholds are managed separately from other product fields
// (low_stock.manage in the permissions matrix).
async function assertCanSetReorderLevel(req: Request, reorderLevel: number | undefined) {
  if (reorderLevel === undefined) return;
  if (!req.user || !(await hasPermission(req.user.roleName, "low_stock.manage"))) {
    throw ApiError.forbidden("You do not have permission to change reorder levels");
  }
}

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = parseOrThrow(listProductsQuerySchema, req.query);

  const { products, meta } = await productsService.listProducts({
    search: query.search,
    categoryId: query.categoryId,
    lowStock: query.lowStock,
    page: query.page,
    perPage: query.per_page,
  });

  paginated(res, products, meta);
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.getProductById(idParam(req));

  success(res, product);
});

export const getByBarcode = asyncHandler(
  async (req: Request, res: Response) => {
    const product = await productsService.getProductByBarcode(
      req.params.barcode
    );

    success(res, product);
  }
);

export const getBySku = asyncHandler(async (req: Request, res: Response) => {
  const product = await productsService.getProductBySku(req.params.sku);

  success(res, product);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const input = parseOrThrow(createProductSchema, req.body);
  await assertCanSetReorderLevel(req, input.reorderLevel);

  const product = await productsService.createProduct(input);

  success(res, product, "Product created successfully", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const input = parseOrThrow(updateProductSchema, req.body);
  await assertCanSetReorderLevel(req, input.reorderLevel);

  const product = await productsService.updateProduct(
    idParam(req),
    input
  );

  success(res, product, "Product updated successfully");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await productsService.deleteProduct(idParam(req));

  res.status(204).send();
});
