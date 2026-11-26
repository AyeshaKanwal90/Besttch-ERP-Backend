import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  // Generated from the name when omitted.
  slug: z.string().trim().max(120).optional(),
  parentId: z.coerce.number().int().positive().nullable().optional(),
});

export const updateCategorySchema = createCategorySchema.partial();
