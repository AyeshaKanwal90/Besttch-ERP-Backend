import { Router } from "express";
import * as rolesController from "../controllers/roles.controller";
import { requireAuth, requirePermission } from "../middleware/auth";

const router = Router();

/**
 * @openapi
 * /roles:
 *   get:
 *     tags:
 *       - Roles
 *     summary: Get all roles
 *     description: Returns the list of available roles.
 *     responses:
 *       200:
 *         description: Roles retrieved successfully
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Permission denied
 *       500:
 *         description: Internal server error
 */
router.get(
  "/",
  requireAuth,
  requirePermission("roles.view"),
  rolesController.list
);

/**
 * @openapi
 * /roles/{id}/permissions:
 *   get:
 *     tags:
 *       - Roles
 *     summary: Get a role's permissions
 *     description: >
 *       Super admin only (requires `roles.manage`, which no other role
 *       can hold). Returns the role, the permissions it currently has,
 *       and the full permission catalogue with groups and descriptions.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Role permissions retrieved
 *       403:
 *         description: Not a super admin
 *       404:
 *         description: Role not found
 *   put:
 *     tags:
 *       - Roles
 *     summary: Replace a role's permissions
 *     description: >
 *       Super admin only. Replaces the role's permission set with the
 *       list given. The Super Admin role can't lose any permission, and
 *       super-admin-only permissions (dashboard.system,
 *       users.delete_permanent, roles.manage, settings.system) can't be
 *       given to other roles. Takes effect immediately.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - permissions
 *             properties:
 *               permissions:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["dashboard.view", "products.view", "items.view"]
 *     responses:
 *       200:
 *         description: Role permissions updated
 *       403:
 *         description: Not a super admin
 *       404:
 *         description: Role not found
 *       422:
 *         description: Unknown permission, super admin reduced, or a super-admin-only permission given to another role
 */
router.get("/:id/permissions", requireAuth, requirePermission("roles.manage"), rolesController.getPermissions);
router.put("/:id/permissions", requireAuth, requirePermission("roles.manage"), rolesController.setPermissions);

export default router;
