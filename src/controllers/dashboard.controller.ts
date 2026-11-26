import { Request, Response } from "express";
import { asyncHandler } from "../utils/asyncHandler";
import { success } from "../utils/apiResponse";
import { prisma } from "../config/prisma";
import { hasPermission } from "../services/permissions.service";
import { countLowStockProducts, getStockValue } from "../services/inventoryReports.service";

export const stats = asyncHandler(async (req: Request, res: Response) => {
  // Stock value is financial data; only roles that can see inventory
  // reports get it (staff don't by default).
  const canSeeValue = req.user ? await hasPermission(req.user.roleName, "inventory_reports.view") : false;

  const [totalUsers, activeUsers, totalRoles, totalProducts, totalWarehouses, lowStockItems, stock] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, status: "active" } }),
    prisma.role.count(),
    prisma.product.count({ where: { deletedAt: null } }),
    prisma.warehouse.count(),
    countLowStockProducts(),
    getStockValue(),
  ]);

  success(res, {
    totalUsers,
    activeUsers,
    totalRoles,
    inventory: {
      totalProducts,
      totalWarehouses,
      /** Products at or below their reorder level. */
      lowStockItems,
      itemsInStock: stock.units,
      /** Sum of in-stock item prices, or null without inventory_reports.view. */
      stockValue: canSeeValue ? stock.value : null,
    },
  });
});
