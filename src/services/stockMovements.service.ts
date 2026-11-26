import { MovementReason, MovementType, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

/**
 * The stock ledger. Every change to stock goes through recordMovement(s)
 * inside the same transaction as the change itself, so the two can never
 * disagree. Rows are never updated or deleted.
 */

export interface MovementInput {
  productId: number;
  /** Destination for in/transfer, source for out. */
  warehouseId: number;
  type: MovementType;
  reason: MovementReason;
  /** Positive. For corrections the type says whether stock went up or down. */
  quantity: number;
  userId: number | null;
  itemId?: number | null;
  fromWarehouseId?: number | null;
  toWarehouseId?: number | null;
  reference?: string | null;
  note?: string | null;
  adjustmentId?: number | null;
}

export async function recordMovements(tx: Prisma.TransactionClient, movements: MovementInput[]) {
  if (!movements.length) return;
  await tx.stockMovement.createMany({
    data: movements.map((m) => ({
      productId: m.productId,
      warehouseId: m.warehouseId,
      type: m.type,
      reason: m.reason,
      quantity: m.quantity,
      userId: m.userId,
      itemId: m.itemId ?? null,
      fromWarehouseId: m.fromWarehouseId ?? null,
      toWarehouseId: m.toWarehouseId ?? null,
      reference: m.reference ?? null,
      note: m.note ?? null,
      adjustmentId: m.adjustmentId ?? null,
    })),
  });
}

export const movementSelect = {
  id: true,
  type: true,
  reason: true,
  quantity: true,
  reference: true,
  note: true,
  createdAt: true,
  product: { select: { id: true, name: true, sku: true } },
  warehouse: { select: { id: true, name: true, code: true } },
  fromWarehouse: { select: { id: true, name: true, code: true } },
  toWarehouse: { select: { id: true, name: true, code: true } },
  item: { select: { id: true, itemCode: true, serialNumber: true } },
  user: { select: { id: true, name: true } },
  adjustmentId: true,
} satisfies Prisma.StockMovementSelect;

export interface ListMovementsParams {
  productId?: number;
  /** Matches movements into, out of, or transferred from the warehouse. */
  warehouseId?: number;
  itemId?: number;
  userId?: number;
  type?: MovementType;
  reason?: MovementReason;
  from?: Date;
  to?: Date;
  page: number;
  perPage: number;
}

export async function listMovements(params: ListMovementsParams) {
  const where: Prisma.StockMovementWhereInput = {
    ...(params.productId ? { productId: params.productId } : {}),
    ...(params.itemId ? { itemId: params.itemId } : {}),
    ...(params.userId ? { userId: params.userId } : {}),
    ...(params.type ? { type: params.type } : {}),
    ...(params.reason ? { reason: params.reason } : {}),
    ...(params.warehouseId
      ? { OR: [{ warehouseId: params.warehouseId }, { fromWarehouseId: params.warehouseId }] }
      : {}),
    ...(params.from || params.to
      ? { createdAt: { ...(params.from ? { gte: params.from } : {}), ...(params.to ? { lte: params.to } : {}) } }
      : {}),
  };

  const [total, movements] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      select: movementSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
    }),
  ]);

  return {
    movements,
    meta: {
      currentPage: params.page,
      perPage: params.perPage,
      total,
      lastPage: Math.max(1, Math.ceil(total / params.perPage)),
    },
  };
}

export async function latestMovementsForProduct(productId: number, take = 10) {
  return prisma.stockMovement.findMany({
    where: { productId },
    select: movementSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
  });
}
