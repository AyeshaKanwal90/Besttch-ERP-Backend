import { Request, Response } from "express";

import { asyncHandler } from "../utils/asyncHandler";
import { idParam } from "../utils/params";

import { paginated, success } from "../utils/apiResponse";

import {
  createItemSchema,
  listItemsQuerySchema,
  updateItemSchema,
} from "../validators/items.validator";

import { parseOrThrow } from "../validators/validate";
import * as itemsService from "../services/items.service";

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = parseOrThrow(listItemsQuerySchema, req.query);

  const { items, meta } = await itemsService.listItems({
    search: query.search,
    status: query.status,
    productId: query.productId,
    warehouseId: query.warehouseId,
    page: query.page,
    perPage: query.per_page,
  });

  paginated(res, items, meta);
});

export const create = asyncHandler(async (req: Request, res: Response) => {
  const input = parseOrThrow(createItemSchema, req.body);

  const item = await itemsService.createItem(input);

  success(res, item, "Item added successfully", 201);
});

export const getOne = asyncHandler(async (req: Request, res: Response) => {
  const item = await itemsService.getItemById(idParam(req));

  success(res, item);
});

export const getBySerial = asyncHandler(async (req: Request, res: Response) => {
  const item = await itemsService.getItemBySerial(req.params.serialNumber);

  success(res, item);
});

export const getByCode = asyncHandler(async (req: Request, res: Response) => {
  const item = await itemsService.getItemByCode(req.params.itemCode);

  success(res, item);
});

export const update = asyncHandler(async (req: Request, res: Response) => {
  const input = parseOrThrow(updateItemSchema, req.body);

  const item = await itemsService.updateItem(idParam(req), input);

  success(res, item, "Item updated successfully");
});

export const sell = asyncHandler(async (req: Request, res: Response) => {
  const item = await itemsService.sellItem(idParam(req));

  success(res, item, "Item sold successfully");
});

export const remove = asyncHandler(async (req: Request, res: Response) => {
  const item = await itemsService.removeItem(idParam(req));

  success(res, item, "Item removed from inventory");
});

export const returnItem = asyncHandler(async (req: Request, res: Response) => {
  const item = await itemsService.returnItem(idParam(req));

  success(res, item, "Item returned to inventory");
});
