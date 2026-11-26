import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Stock is the number of `in_stock` items. A product is "low" when it has a
 * reorder level above 0 and its stock is at or below it.
 */
export function isLowStock(quantity: number, reorderLevel: number): boolean {
  return reorderLevel > 0 && quantity <= reorderLevel;
}

/** Ids of active products whose stock is at or below their reorder level. */
export async function getLowStockProductIds(db: Db = prisma): Promise<number[]> {
  const rows = await db.$queryRaw<{ id: number }[]>`
    SELECT p.id
    FROM products p
    LEFT JOIN items i ON i.product_id = p.id AND i.status = 'in_stock'
    WHERE p.deleted_at IS NULL AND p.is_active = true AND p.reorder_level > 0
    GROUP BY p.id
    HAVING COUNT(i.id) <= p.reorder_level
  `;
  return rows.map((row) => Number(row.id));
}
