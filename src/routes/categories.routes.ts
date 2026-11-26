import { Router } from "express";
import * as categoriesController from "../controllers/categories.controller";
import { requireAuth, requirePermission } from "../middleware/auth";

const router = Router();

/**
 * @openapi
 * /categories:
 *   get:
 *     tags:
 *       - Categories
 *     summary: List product categories
 *     description: >
 *       Flat list ordered by name, each with parentId, productCount and
 *       childCount; build the tree from parentId. Requires `products.view`.
 *     responses:
 *       200:
 *         description: Categories retrieved
 *   post:
 *     tags:
 *       - Categories
 *     summary: Create a category
 *     description: Requires `categories.manage`. The slug is generated from the name when omitted.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: Peripherals }
 *               slug: { type: string, example: peripherals }
 *               parentId: { type: integer, nullable: true }
 *     responses:
 *       201:
 *         description: Category created
 *       422:
 *         description: Validation failed (e.g. duplicate slug, unknown parent)
 */
router.get("/", requireAuth, requirePermission("products.view"), categoriesController.list);
router.post("/", requireAuth, requirePermission("categories.manage"), categoriesController.create);

/**
 * @openapi
 * /categories/{id}:
 *   get:
 *     tags:
 *       - Categories
 *     summary: Get a category
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Category retrieved
 *       404:
 *         description: Category not found
 *   put:
 *     tags:
 *       - Categories
 *     summary: Update a category
 *     description: >
 *       Requires `categories.manage`. A category can't be moved under itself
 *       or one of its own sub-categories.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Category updated
 *       422:
 *         description: Validation failed
 *   delete:
 *     tags:
 *       - Categories
 *     summary: Delete a category
 *     description: >
 *       Requires `categories.manage`. Its products become uncategorised.
 *       Refused while it still has sub-categories.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       204:
 *         description: Category deleted
 *       422:
 *         description: Category still has sub-categories
 */
router.get("/:id", requireAuth, requirePermission("products.view"), categoriesController.getOne);
router.put("/:id", requireAuth, requirePermission("categories.manage"), categoriesController.update);
router.delete("/:id", requireAuth, requirePermission("categories.manage"), categoriesController.remove);

export default router;
