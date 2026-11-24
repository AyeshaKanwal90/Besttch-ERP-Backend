import { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ApiError } from "../utils/ApiError";
import { failure } from "../utils/apiResponse";

export function notFoundHandler(req: Request, res: Response) {
  failure(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);
}

function uniqueFields(err: Prisma.PrismaClientKnownRequestError): string[] {
  const target = err.meta?.target;

  if (Array.isArray(target)) {
    return target.map(String);
  }

  if (typeof target === "string") {
    return [target];
  }

  return [];
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    failure(res, err.status, err.message, err.errors);
    return;
  }

  // express.json() rejects a body that isn't valid JSON. That's a client
  // mistake, not a server fault.
  if (typeof err === "object" && err !== null && (err as { type?: string }).type === "entity.parse.failed") {
    failure(res, 400, "Request body is not valid JSON");
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Unique constraint hit, usually two requests racing past the
    // "is this value free?" check in a service.
    if (err.code === "P2002") {
      const fields = uniqueFields(err);
      const errors: Record<string, string[]> = {};

      for (const field of fields.length ? fields : ["_"]) {
        errors[field] = ["This value is already in use"];
      }

      failure(res, 422, "Validation failed", errors);
      return;
    }

    // Record to update/delete does not exist.
    if (err.code === "P2025") {
      failure(res, 404, "Resource not found");
      return;
    }
  }

  console.error(err);
  failure(res, 500, "Internal server error");
}
