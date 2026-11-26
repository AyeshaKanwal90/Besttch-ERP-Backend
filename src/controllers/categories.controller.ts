import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { success } from "../utils/apiResponse";
import { idParam } from "../utils/params";
import { parseOrThrow } from "../validators/validate";
import { createCategorySchema, updateCategorySchema } from "../validators/categories.validator";
import * as categoriesService from "../services/categories.service";

export const list = asyncHandler(async (_req: Request, res: Response) => {
  success(res, await categoriesService.listCategories());
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  success(res, await categoriesService.getCategoryById(idParam(req)));
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const input = parseOrThrow(createCategorySchema, req.body);
  success(res, await categoriesService.createCategory(input), "Category created", 201);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const input = parseOrThrow(updateCategorySchema, req.body);
  success(res, await categoriesService.updateCategory(idParam(req), input), "Category updated");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  await categoriesService.deleteCategory(idParam(req));
  res.status(204).send();
});
