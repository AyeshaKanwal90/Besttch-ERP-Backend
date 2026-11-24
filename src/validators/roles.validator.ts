import { z } from "zod";

export const setRolePermissionsSchema = z.object({
  permissions: z.array(z.string().trim().min(1), {
    required_error: "permissions is required",
    invalid_type_error: "permissions must be a list of permission names",
  }),
});
