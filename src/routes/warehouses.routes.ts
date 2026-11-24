import { Router } from "express";

import * as warehousesController from "../controllers/warehouses.controller";

import { requireAuth, requireRole } from "../middleware/auth";
import { INTERNAL_ROLES, INVENTORY_MANAGER_ROLES } from "../constants/roles";

const router = Router();

/**
 * @openapi
 * /warehouses:
 *   get:
 *     tags:
 *       - Warehouses
 *     summary: Get all warehouses
 *     description: Search warehouses by name, code, address or warehouse ID. Available to super admin, admin and staff.
 *
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         example: Main
 *
 *       - in: query
 *         name: isActive
 *         schema:
 *           type: boolean
 *
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *
 *       - in: query
 *         name: per_page
 *         schema:
 *           type: integer
 *           default: 20
 *
 *     responses:
 *       200:
 *         description: Warehouses retrieved successfully
 */
router.get("/", requireAuth, requireRole(...INTERNAL_ROLES), warehousesController.list);

/**
 * @openapi
 * /warehouses:
 *   post:
 *     tags:
 *       - Warehouses
 *     summary: Create a warehouse
 *     description: Super admin and admin only.
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *
 *             required:
 *               - name
 *               - code
 *
 *             properties:
 *               name:
 *                 type: string
 *                 example: Main Warehouse
 *
 *               code:
 *                 type: string
 *                 example: MAIN
 *
 *               address:
 *                 type: string
 *                 nullable: true
 *                 example: 10 Industrial Road, Birmingham
 *
 *               isActive:
 *                 type: boolean
 *                 example: true
 *
 *     responses:
 *       201:
 *         description: Warehouse created successfully
 *
 *       403:
 *         description: Only super admin or admin can create warehouses
 *
 *       422:
 *         description: Validation failed
 */
router.post("/", requireAuth, requireRole(...INVENTORY_MANAGER_ROLES), warehousesController.create);

/**
 * @openapi
 * /warehouses/code/{code}:
 *   get:
 *     tags:
 *       - Warehouses
 *     summary: Find warehouse by code
 *
 *     parameters:
 *       - in: path
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         example: MAIN
 *
 *     responses:
 *       200:
 *         description: Warehouse found
 *
 *       404:
 *         description: Warehouse not found
 */
router.get("/code/:code", requireAuth, requireRole(...INTERNAL_ROLES), warehousesController.getByCode);

/**
 * @openapi
 * /warehouses/{id}:
 *   get:
 *     tags:
 *       - Warehouses
 *     summary: Get warehouse by ID
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 1
 *
 *     responses:
 *       200:
 *         description: Warehouse retrieved successfully
 *
 *       404:
 *         description: Warehouse not found
 */
router.get("/:id", requireAuth, requireRole(...INTERNAL_ROLES), warehousesController.getOne);

/**
 * @openapi
 * /warehouses/{id}:
 *   put:
 *     tags:
 *       - Warehouses
 *     summary: Update a warehouse
 *     description: Super admin and admin only.
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *
 *             properties:
 *               name:
 *                 type: string
 *                 example: Birmingham Main Warehouse
 *
 *               code:
 *                 type: string
 *                 example: BHM-MAIN
 *
 *               address:
 *                 type: string
 *                 nullable: true
 *                 example: Birmingham, UK
 *
 *               isActive:
 *                 type: boolean
 *                 example: true
 *
 *     responses:
 *       200:
 *         description: Warehouse updated successfully
 *
 *       403:
 *         description: Only super admin or admin can update warehouses
 *
 *       404:
 *         description: Warehouse not found
 *
 *       422:
 *         description: Validation failed
 */
router.put("/:id", requireAuth, requireRole(...INVENTORY_MANAGER_ROLES), warehousesController.update);

/**
 * @openapi
 * /warehouses/{id}:
 *   delete:
 *     tags:
 *       - Warehouses
 *     summary: Delete a warehouse
 *     description: >
 *       Deactivates the warehouse instead of physically deleting it.
 *       Super admin and admin only.
 *       A warehouse cannot be deactivated while it contains in-stock items.
 *
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *
 *     responses:
 *       200:
 *         description: Warehouse deactivated successfully
 *
 *       403:
 *         description: Only super admin or admin can delete warehouses
 *
 *       404:
 *         description: Warehouse not found
 *
 *       422:
 *         description: Warehouse still contains stock
 */
router.delete("/:id", requireAuth, requireRole(...INVENTORY_MANAGER_ROLES), warehousesController.remove);

export default router;
