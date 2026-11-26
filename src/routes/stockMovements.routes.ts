import { Router } from "express";
import * as movementsController from "../controllers/stockMovements.controller";
import { requireAuth, requirePermission } from "../middleware/auth";

const router = Router();

/**
 * @openapi
 * /stock-movements:
 *   get:
 *     tags:
 *       - Stock Movements
 *     summary: Stock movement history
 *     description: >
 *       Append-only ledger of every stock change (receive, sale, removal,
 *       damage, return, transfer, correction), newest first. Requires
 *       `stock_movements.view`. warehouseId matches movements into, out
 *       of, or transferred from that warehouse. A date-only `to` includes
 *       the whole day.
 *     parameters:
 *       - { in: query, name: productId, schema: { type: integer } }
 *       - { in: query, name: warehouseId, schema: { type: integer } }
 *       - { in: query, name: itemId, schema: { type: integer } }
 *       - { in: query, name: userId, schema: { type: integer } }
 *       - { in: query, name: type, schema: { type: string, enum: [in, out, adjustment, transfer] } }
 *       - { in: query, name: reason, schema: { type: string, enum: [receive, sale, removal, damage, return, transfer, correction] } }
 *       - { in: query, name: from, schema: { type: string, format: date }, example: "2026-11-01" }
 *       - { in: query, name: to, schema: { type: string, format: date }, example: "2026-11-30" }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: per_page, schema: { type: integer, default: 25, maximum: 100 } }
 *     responses:
 *       200:
 *         description: Movements retrieved
 *       422:
 *         description: Invalid filter
 */
router.get("/", requireAuth, requirePermission("stock_movements.view"), movementsController.list);

export default router;
