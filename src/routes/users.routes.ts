import { Router } from "express";

import * as usersController from "../controllers/users.controller";
import { requireAuth, requirePermission } from "../middleware/auth";


const router = Router();

/**
 * @openapi
 * /users:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get all users
 *     description: >
 *       Returns all non-deleted users.
 *       Supports search, role filtering, status filtering,
 *       pagination and sorting.
 *
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search users by name or email
 *         example: John
 *
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *         description: Filter users by role
 *         example: admin
 *
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum:
 *             - active
 *             - inactive
 *         description: Filter users by status
 *
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *
 *       - in: query
 *         name: per_page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 15
 *         description: Number of users per page
 *
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum:
 *             - name
 *             - email
 *             - createdAt
 *             - lastLoginAt
 *           default: createdAt
 *         description: Field used to sort users
 *
 *       - in: query
 *         name: direction
 *         schema:
 *           type: string
 *           enum:
 *             - asc
 *             - desc
 *           default: desc
 *         description: Sort direction
 *
 *     responses:
 *       200:
 *         description: Users retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         example: 1
 *
 *                       name:
 *                         type: string
 *                         example: John Doe
 *
 *                       email:
 *                         type: string
 *                         format: email
 *                         example: john.doe@besttch.com
 *
 *                       phone:
 *                         type: string
 *                         nullable: true
 *                         example: "+447123456789"
 *
 *                       status:
 *                         type: string
 *                         enum:
 *                           - active
 *                           - inactive
 *                         example: active
 *
 *                       lastLoginAt:
 *                         type: string
 *                         format: date-time
 *                         nullable: true
 *
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *
 *                       updatedAt:
 *                         type: string
 *                         format: date-time
 *
 *                       role:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: integer
 *                             example: 2
 *
 *                           name:
 *                             type: string
 *                             example: admin
 *
 *                           displayName:
 *                             type: string
 *                             example: Admin
 *
 *       401:
 *         description: Authentication required
 *
 *       403:
 *         description: Permission denied
 *
 *
 *   post:
 *     tags:
 *       - Users
 *     summary: Create a new user
 *     description: Creates a new ERP user. Admins can only create staff and client users; super admins can create any role.
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *
 *             required:
 *               - firstName
 *               - lastName
 *               - email
 *               - phoneNumber
 *               - roleId
 *               - password
 *
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: John
 *
 *               lastName:
 *                 type: string
 *                 example: Doe
 *
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john.doe@besttch.com
 *
 *               phoneNumber:
 *                 type: string
 *                 example: "+447123456789"
 *
 *               roleId:
 *                 type: integer
 *                 example: 2
 *
 *               password:
 *                 type: string
 *                 format: password
 *                 example: Password123!
 *
 *               status:
 *                 type: string
 *                 enum:
 *                   - active
 *                   - inactive
 *                 example: active
 *
 *     responses:
 *       201:
 *         description: User created successfully
 *
 *       400:
 *         description: Invalid request
 *
 *       401:
 *         description: Authentication required
 *
 *       403:
 *         description: Permission denied
 *
 *       422:
 *         description: Validation failed
 */
router.get(
  "/",
  requireAuth,
  requirePermission("users.view"),
  usersController.list
);

router.post(
  "/",
  requireAuth,
  requirePermission("users.create"),
  usersController.create
);

/**
 * @openapi
 * /users/{id}/status:
 *   patch:
 *     tags:
 *       - Users
 *     summary: Change user status
 *     description: >
 *       Admins can only change staff and client users. Nobody can deactivate their own account.
 *       Activates or deactivates an existing user.
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: User ID
 *         schema:
 *           type: integer
 *         example: 5
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *
 *             required:
 *               - status
 *
 *             properties:
 *               status:
 *                 type: string
 *                 enum:
 *                   - active
 *                   - inactive
 *                 example: inactive
 *
 *     responses:
 *       200:
 *         description: User status updated successfully
 *
 *       400:
 *         description: Invalid request
 *
 *       401:
 *         description: Authentication required
 *
 *       403:
 *         description: Permission denied
 *
 *       404:
 *         description: User not found
 *
 *       422:
 *         description: Validation failed
 */
router.patch(
  "/:id/status",
  requireAuth,
  requirePermission("users.manage_status"),
  usersController.setStatus
);

/**
 * @openapi
 * /users/{id}:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get user by ID
 *     description: Returns a single non-deleted user.
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: User ID
 *         schema:
 *           type: integer
 *         example: 5
 *
 *     responses:
 *       200:
 *         description: User retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                       example: 5
 *
 *                     name:
 *                       type: string
 *                       example: John Doe
 *
 *                     email:
 *                       type: string
 *                       format: email
 *                       example: john.doe@besttch.com
 *
 *                     phone:
 *                       type: string
 *                       nullable: true
 *                       example: "+447123456789"
 *
 *                     status:
 *                       type: string
 *                       enum:
 *                         - active
 *                         - inactive
 *
 *                     role:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: integer
 *
 *                         name:
 *                           type: string
 *
 *                         displayName:
 *                           type: string
 *
 *       401:
 *         description: Authentication required
 *
 *       403:
 *         description: Permission denied
 *
 *       404:
 *         description: User not found
 *
 *
 *   put:
 *     tags:
 *       - Users
 *     summary: Update user
 *     description: >
 *       Admins can only edit staff and client users, and can only assign the staff or client role.
 *       Updates an existing ERP user.
 *       Only fields supplied in the request are changed.
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: User ID
 *         schema:
 *           type: integer
 *         example: 5
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: John
 *
 *               lastName:
 *                 type: string
 *                 example: Smith
 *
 *               email:
 *                 type: string
 *                 format: email
 *                 example: john.smith@besttch.com
 *
 *               phoneNumber:
 *                 type: string
 *                 nullable: true
 *                 example: "+447123456789"
 *
 *               roleId:
 *                 type: integer
 *                 example: 2
 *
 *               password:
 *                 type: string
 *                 format: password
 *                 example: NewPassword123!
 *
 *               status:
 *                 type: string
 *                 enum:
 *                   - active
 *                   - inactive
 *                 example: active
 *
 *     responses:
 *       200:
 *         description: User updated successfully
 *
 *       400:
 *         description: Invalid request
 *
 *       401:
 *         description: Authentication required
 *
 *       403:
 *         description: Permission denied
 *
 *       404:
 *         description: User not found
 *
 *       422:
 *         description: Validation failed
 *
 *
 *   delete:
 *     tags:
 *       - Users
 *     summary: Delete user
 *     description: >
 *       Archives (soft deletes) an ERP user by default: the record is
 *       kept but deletedAt is set so the user no longer appears in
 *       normal queries. With `?permanent=true` the record is removed;
 *       that needs `users.delete_permanent` (super admin only) and also
 *       works on already-archived users. Admins can only delete staff
 *       and client users. Nobody can delete their own account.
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: User ID
 *         schema:
 *           type: integer
 *         example: 5
 *       - in: query
 *         name: permanent
 *         schema:
 *           type: string
 *           enum: ["true", "false"]
 *         description: Permanently delete instead of archiving
 *
 *     responses:
 *       204:
 *         description: User deleted successfully
 *
 *       401:
 *         description: Authentication required
 *
 *       403:
 *         description: Missing permission, target outside the caller's scope, or deleting yourself
 *
 *       404:
 *         description: User not found
 *
 *       409:
 *         description: User still has related records (permanent delete only)
 */
router.get(
  "/:id",
  requireAuth,
  requirePermission("users.view"),
  usersController.getOne
);

router.put(
  "/:id",
  requireAuth,
  requirePermission("users.update"),
  usersController.update
);

router.delete(
  "/:id",
  requireAuth,
  requirePermission("users.delete"),
  usersController.remove
);

export default router;
