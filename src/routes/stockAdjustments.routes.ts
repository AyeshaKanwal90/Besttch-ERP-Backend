import { Router } from "express";
import * as adjustmentsController from "../controllers/stockAdjustments.controller";
import { requireAuth, requirePermission } from "../middleware/auth";

const router = Router();

/**
 * @openapi
 * /stock-adjustments:
 *   get:
 *     tags:
 *       - Stock Adjustments
 *     summary: List stock adjustments
 *     description: >
 *       Requires `stock_adjustments.submit` or `.approve`. Approvers see
 *       everyone's adjustments; others only their own.
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [pending, approved, rejected] } }
 *       - { in: query, name: type, schema: { type: string, enum: [receive, damage, return, correction] } }
 *       - { in: query, name: requestedById, schema: { type: integer } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page, schema: { type: integer, default: 20 } }
 *     responses:
 *       200:
 *         description: Adjustments retrieved
 *   post:
 *     tags:
 *       - Stock Adjustments
 *     summary: Submit a stock adjustment
 *     description: >
 *       Requires `stock_adjustments.submit`. Users who also have
 *       `stock_adjustments.approve` get it applied at once (status
 *       approved); everyone else's stays pending until approved.
 *
 *       Types: **receive** creates `quantity` new items per line (bulk
 *       receiving), using `serials` for the first ones and `unitPrice` or
 *       the product's unit price. **damage** marks in-stock items damaged.
 *       **return** puts sold items back in stock in the line's warehouse.
 *       **correction** adds items (positive quantity) or removes in-stock
 *       items (negative). For damage/return/negative corrections, list
 *       exactly |quantity| serials to choose the items, or none to pick
 *       automatically (oldest first; most recently sold for returns).
 *       Every applied line writes a stock movement.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, reason, lines]
 *             properties:
 *               type: { type: string, enum: [receive, damage, return, correction] }
 *               reason: { type: string, example: "Supplier delivery PO-4412" }
 *               note: { type: string, nullable: true }
 *               lines:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [productId, warehouseId, quantity]
 *                   properties:
 *                     productId: { type: integer }
 *                     warehouseId: { type: integer }
 *                     quantity: { type: integer, example: 25 }
 *                     serials: { type: array, items: { type: string } }
 *                     unitPrice: { type: number, nullable: true }
 *     responses:
 *       201:
 *         description: Submitted (pending) or applied (approved)
 *       422:
 *         description: Invalid lines, not enough stock, or serials already in use
 */
router.get("/", requireAuth, requirePermission("stock_adjustments.submit"), adjustmentsController.list);
router.post("/", requireAuth, requirePermission("stock_adjustments.submit"), adjustmentsController.create);

/**
 * @openapi
 * /stock-adjustments/{id}:
 *   get:
 *     tags:
 *       - Stock Adjustments
 *     summary: Get a stock adjustment with its lines
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Adjustment retrieved
 *       404:
 *         description: Not found (or not yours, without approve permission)
 */
router.get("/:id", requireAuth, requirePermission("stock_adjustments.submit"), adjustmentsController.getOne);

/**
 * @openapi
 * /stock-adjustments/{id}/approve:
 *   post:
 *     tags:
 *       - Stock Adjustments
 *     summary: Approve and apply a pending adjustment
 *     description: >
 *       Requires `stock_adjustments.approve`. Re-checks every line against
 *       current stock and applies it all in one transaction; on any error
 *       nothing changes and it stays pending.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Approved and applied
 *       422:
 *         description: Already reviewed, or a line can't be applied
 * /stock-adjustments/{id}/reject:
 *   post:
 *     tags:
 *       - Stock Adjustments
 *     summary: Reject a pending adjustment
 *     description: Requires `stock_adjustments.approve`. Body { reason }.
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Rejected
 *       422:
 *         description: Already reviewed, or no reason given
 */
router.post("/:id/approve", requireAuth, requirePermission("stock_adjustments.approve"), adjustmentsController.approve);
router.post("/:id/reject", requireAuth, requirePermission("stock_adjustments.approve"), adjustmentsController.reject);

export default router;
