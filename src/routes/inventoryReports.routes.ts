import { Router } from "express";
import * as reportsController from "../controllers/inventoryReports.controller";
import { requireAuth, requirePermission } from "../middleware/auth";

/**
 * @openapi
 * /inventory/low-stock:
 *   get:
 *     tags:
 *       - Inventory Reports
 *     summary: Products at or below their reorder level
 *     description: >
 *       Requires `low_stock.view`. Only products with a reorder level
 *       above 0 are considered. Each row has the current stock, the
 *       threshold, a suggested reorder quantity (enough to reach twice the
 *       reorder level) and stock per warehouse. Most urgent first.
 *     responses:
 *       200:
 *         description: Low-stock products
 */
export const inventoryRouter = Router();
inventoryRouter.get("/low-stock", requireAuth, requirePermission("low_stock.view"), reportsController.lowStock);

/**
 * @openapi
 * /reports/stock-valuation:
 *   get:
 *     tags:
 *       - Inventory Reports
 *     summary: Stock valuation
 *     description: >
 *       Requires `inventory_reports.view`. Total value and unit count of
 *       in-stock items (each at its own price), broken down by product,
 *       warehouse and category (category null = uncategorised). Money
 *       values are strings with 2 decimals. Optional filters narrow every
 *       figure.
 *     parameters:
 *       - { in: query, name: warehouseId, schema: { type: integer } }
 *       - { in: query, name: categoryId, schema: { type: integer } }
 *     responses:
 *       200:
 *         description: Valuation
 */
export const reportsRouter = Router();
reportsRouter.get("/stock-valuation", requireAuth, requirePermission("inventory_reports.view"), reportsController.stockValuation);
