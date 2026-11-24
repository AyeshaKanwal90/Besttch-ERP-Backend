export const ROLES = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  STAFF: "staff",
  CLIENT: "client",
} as const;

// Route access is permission-based; see constants/permissions.ts for
// what each role can do by default.
