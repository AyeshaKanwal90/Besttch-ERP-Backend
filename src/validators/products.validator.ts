import { z } from "zod";

export const createProductSchema = z.object({
  sku: z.string().trim().min(1, "SKU is required").max(50),

  barcode: z.string().trim().min(1, "Barcode is required").max(50),

  name: z.string().trim().min(2, "Product name is required").max(200),

  description: z.string().trim().optional().nullable(),

  unit: z.string().trim().max(20).default("piece"),

  isActive: z.boolean().optional().default(true),

  categoryId: z.coerce.number().int().positive().nullable().optional(),

  // Default price for new items of this product.
  unitPrice: z.coerce.number().finite().min(0, "Price cannot be negative").optional(),

  // Low-stock threshold; 0 turns the alert off.
  reorderLevel: z.coerce.number().int().min(0, "Reorder level cannot be negative").max(1_000_000).optional(),
});

export const updateProductSchema = z.object({
  sku: z.string().trim().min(1).max(50).optional(),

  barcode: z.string().trim().min(1).max(50).optional(),

  name: z.string().trim().min(2).max(200).optional(),

  description: z.string().trim().optional().nullable(),

  unit: z.string().trim().max(20).optional(),

  isActive: z.boolean().optional(),

  categoryId: z.coerce.number().int().positive().nullable().optional(),

  unitPrice: z.coerce.number().finite().min(0, "Price cannot be negative").optional(),

  reorderLevel: z.coerce.number().int().min(0, "Reorder level cannot be negative").max(1_000_000).optional(),
});

export const listProductsQuerySchema = z.object({
  search: z.string().trim().optional(),

  categoryId: z.coerce.number().int().positive().optional(),

  lowStock: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),

  page: z.coerce.number().int().min(1).default(1),

  per_page: z.coerce.number().int().min(1).max(100).default(20),
});
