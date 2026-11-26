import { z } from "zod";

const date = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(Date.parse(value)), `${label} must be a date (YYYY-MM-DD or ISO 8601)`)
    .optional();

export const listMovementsQuerySchema = z
  .object({
    productId: z.coerce.number().int().positive().optional(),
    warehouseId: z.coerce.number().int().positive().optional(),
    itemId: z.coerce.number().int().positive().optional(),
    userId: z.coerce.number().int().positive().optional(),
    type: z.enum(["in", "out", "adjustment", "transfer"]).optional(),
    reason: z.enum(["receive", "sale", "removal", "damage", "return", "transfer", "correction"]).optional(),
    from: date("from"),
    // A bare date for `to` includes that whole day.
    to: date("to"),
    page: z.coerce.number().int().min(1).default(1),
    per_page: z.coerce.number().int().min(1).max(100).default(25),
  })
  .transform((q) => ({
    ...q,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? endOfDayIfDateOnly(q.to) : undefined,
  }));

function endOfDayIfDateOnly(value: string): Date {
  const parsed = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) parsed.setUTCHours(23, 59, 59, 999);
  return parsed;
}
