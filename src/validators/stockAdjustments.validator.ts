import { z } from "zod";

const MAX_UNITS_PER_LINE = 1000;

const lineSchema = z.object({
  productId: z.coerce.number().int().positive("Product is required"),
  warehouseId: z.coerce.number().int().positive("Warehouse is required"),
  // Negative only for corrections (removes stock); checked per type in the service.
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number")
    .min(-MAX_UNITS_PER_LINE, `At most ${MAX_UNITS_PER_LINE} units per line`)
    .max(MAX_UNITS_PER_LINE, `At most ${MAX_UNITS_PER_LINE} units per line`),
  serials: z
    .array(z.string().trim().min(1, "Serial numbers can't be blank").max(100))
    .max(MAX_UNITS_PER_LINE)
    .optional()
    .refine((list) => !list || new Set(list).size === list.length, "Serial numbers must be unique"),
  unitPrice: z.coerce.number().finite().min(0, "Price cannot be negative").nullable().optional(),
});

export const createAdjustmentSchema = z.object({
  type: z.enum(["receive", "damage", "return", "correction"]),
  reason: z.string().trim().min(2, "Give a reason").max(200),
  note: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(lineSchema).min(1, "Add at least one line").max(100, "At most 100 lines per adjustment"),
});

export const rejectAdjustmentSchema = z.object({
  reason: z.string().trim().min(2, "Say why the adjustment is rejected").max(1000),
});

export const listAdjustmentsQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  type: z.enum(["receive", "damage", "return", "correction"]).optional(),
  requestedById: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(20),
});
