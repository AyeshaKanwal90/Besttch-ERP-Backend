import { Router } from "express";

import * as productsController from "../controllers/products.controller";
import * as movementsController from "../controllers/stockMovements.controller";
import { requireAuth, requirePermission } from "../middleware/auth";
import { singleImageUpload } from "../middleware/upload";

const router = Router();

/**
 * @openapi
 * /products:
 *   get:
 *     tags:
 *       - Products
 *     summary: Get all products
 *     description: Returns all products with quantity calculated from in-stock items. Supports search by product name, SKU, barcode or product ID. Requires `products.view`.
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by name, SKU, barcode or ID
 *         example: Logitech
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: per_page
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Products retrieved successfully
 */
router.get("/", requireAuth, requirePermission("products.view"), productsController.list);

/**
 * @openapi
 * /products:
 *   post:
 *     tags:
 *       - Products
 *     summary: Create a product
 *     description: Requires `products.create` (super admin and admin by default).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - sku
 *               - barcode
 *               - name
 *             properties:
 *               sku:
 *                 type: string
 *                 example: MOUSE-M185
 *               barcode:
 *                 type: string
 *                 example: "5099206027275"
 *               name:
 *                 type: string
 *                 example: Logitech M185 Wireless Mouse
 *               description:
 *                 type: string
 *                 nullable: true
 *                 example: Wireless optical mouse
 *               unit:
 *                 type: string
 *                 example: piece
 *               isActive:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       201:
 *         description: Product created successfully
 *       403:
 *         description: Missing the products.create permission
 *       422:
 *         description: Validation failed
 */
router.post("/", requireAuth, requirePermission("products.create"), productsController.create);

/**
 * @openapi
 * /products/barcode/{barcode}:
 *   get:
 *     tags:
 *       - Products
 *     summary: Find product by barcode
 *     parameters:
 *       - in: path
 *         name: barcode
 *         required: true
 *         schema:
 *           type: string
 *         example: "5099206027275"
 *     responses:
 *       200:
 *         description: Product found
 *       404:
 *         description: Product not found
 */
router.get("/barcode/:barcode", requireAuth, requirePermission("products.view"), productsController.getByBarcode);

/**
 * @openapi
 * /products/sku/{sku}:
 *   get:
 *     tags:
 *       - Products
 *     summary: Find product by SKU
 *     parameters:
 *       - in: path
 *         name: sku
 *         required: true
 *         schema:
 *           type: string
 *         example: MOUSE-M185
 *     responses:
 *       200:
 *         description: Product found
 *       404:
 *         description: Product not found
 */
router.get("/sku/:sku", requireAuth, requirePermission("products.view"), productsController.getBySku);

/**
 * @openapi
 * /products/{id}:
 *   get:
 *     tags:
 *       - Products
 *     summary: Get product by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 12
 *     responses:
 *       200:
 *         description: Product retrieved successfully
 *       404:
 *         description: Product not found
 */
router.get("/:id", requireAuth, requirePermission("products.view"), productsController.getOne);

/**
 * @openapi
 * /products/{id}:
 *   put:
 *     tags:
 *       - Products
 *     summary: Update a product
 *     description: Requires `products.update` (super admin and admin by default).
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
 *             properties:
 *               sku:
 *                 type: string
 *                 example: MOUSE-M185
 *               barcode:
 *                 type: string
 *                 example: "5099206027275"
 *               name:
 *                 type: string
 *                 example: Logitech M185 Wireless Mouse
 *               description:
 *                 type: string
 *                 nullable: true
 *               unit:
 *                 type: string
 *                 example: piece
 *               isActive:
 *                 type: boolean
 *                 example: true
 *     responses:
 *       200:
 *         description: Product updated successfully
 *       403:
 *         description: Missing the products.update permission
 *       404:
 *         description: Product not found
 *       422:
 *         description: Validation failed
 */
router.put("/:id", requireAuth, requirePermission("products.update"), productsController.update);

/**
 * @openapi
 * /products/{id}:
 *   delete:
 *     tags:
 *       - Products
 *     summary: Delete a product
 *     description: Soft deletes the product. Requires `products.delete` (super admin and admin by default). Product cannot be deleted while items are still in stock.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: Product deleted successfully
 *       403:
 *         description: Missing the products.delete permission
 *       404:
 *         description: Product not found
 *       422:
 *         description: Product still has items in stock
 */
router.delete("/:id", requireAuth, requirePermission("products.delete"), productsController.remove);

/**
 * @openapi
 * /products/{id}/image:
 *   post:
 *     tags:
 *       - Products
 *     summary: Upload or replace the product image
 *     description: >
 *       Requires `products.update`. multipart/form-data with one file in
 *       the "image" field: JPEG, PNG, WebP or GIF, at most 2 MB. The type
 *       is checked from the file contents. Returns the product with its
 *       new imageUrl; the previous image file is deleted.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Image uploaded
 *       404:
 *         description: Product not found
 *       422:
 *         description: Missing file, not an allowed image, or larger than 2 MB
 *   delete:
 *     tags:
 *       - Products
 *     summary: Remove the product image
 *     description: Requires `products.update`.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Image removed
 */
/**
 * @openapi
 * /products/{id}/movements:
 *   get:
 *     tags:
 *       - Stock Movements
 *     summary: Stock movement history for one product
 *     description: >
 *       Same filters and paging as GET /stock-movements, limited to this
 *       product. Requires `stock_movements.view`.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Movements retrieved
 *       404:
 *         description: Product not found
 */
router.get("/:id/movements", requireAuth, requirePermission("stock_movements.view"), movementsController.listForProduct);

router.post("/:id/image", requireAuth, requirePermission("products.update"), singleImageUpload, productsController.uploadImage);
router.delete("/:id/image", requireAuth, requirePermission("products.update"), productsController.removeImage);

export default router;
