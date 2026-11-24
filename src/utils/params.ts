import { Request } from "express";
import { ApiError } from "./ApiError";

/**
 * Reads a numeric route parameter (defaults to `:id`).
 *
 * Anything that isn't a positive integer can't match a row, so it is
 * treated as "not found" rather than being passed to Prisma as NaN,
 * which used to surface as a 500.
 */
export function idParam(req: Request, name = "id"): number {
  const raw = req.params[name];

  if (typeof raw !== "string" || !/^\d+$/.test(raw)) {
    throw ApiError.notFound("Resource not found");
  }

  const id = Number(raw);

  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) {
    throw ApiError.notFound("Resource not found");
  }

  return id;
}
