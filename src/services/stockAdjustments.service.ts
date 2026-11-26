import { randomUUID } from "crypto";
import { AdjustmentStatus, AdjustmentType, Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import { MovementInput, recordMovements } from "./stockMovements.service";

/**
 * Stock adjustments change stock in bulk:
 *
 *   receive     create N new items (optionally with serials and a price)
 *   damage      mark N in-stock items damaged
 *   return      put N sold items back in stock
 *   correction  positive: add N items; negative: remove N in-stock items
 *
 * Users without stock_adjustments.approve submit them as pending; an
 * approver applies them. Approvers' own adjustments are applied at once.
 * Applying runs in one transaction: item changes and stock movements
 * either all happen or none do.
 */

export interface AdjustmentLineInput {
  productId: number;
  warehouseId: number;
  quantity: number;
  serials?: string[];
  unitPrice?: number | null;
}

export interface AdjustmentInput {
  type: AdjustmentType;
  reason: string;
  note?: string | null;
  lines: AdjustmentLineInput[];
}

type Tx = Prisma.TransactionClient;

const adjustmentSelect = {
  id: true,
  type: true,
  status: true,
  reason: true,
  note: true,
  rejectReason: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
  requestedBy: { select: { id: true, name: true } },
  reviewedBy: { select: { id: true, name: true } },
  lines: {
    select: {
      id: true,
      quantity: true,
      serials: true,
      unitPrice: true,
      product: { select: { id: true, name: true, sku: true } },
      warehouse: { select: { id: true, name: true, code: true } },
    },
    orderBy: { id: "asc" },
  },
} satisfies Prisma.StockAdjustmentSelect;

function lineError(index: number, message: string): never {
  throw ApiError.unprocessable("Validation failed", { [`lines.${index}`]: [message] });
}

/**
 * Checks everything that doesn't depend on current stock levels: shape
 * rules per type, products and warehouses exist and are active, serials.
 */
async function validateLines(type: AdjustmentType, lines: AdjustmentLineInput[], db: Tx | typeof prisma = prisma) {
  const productIds = [...new Set(lines.map((l) => l.productId))];
  const warehouseIds = [...new Set(lines.map((l) => l.warehouseId))];

  const [products, warehouses] = await Promise.all([
    db.product.findMany({ where: { id: { in: productIds } }, select: { id: true, deletedAt: true, isActive: true } }),
    db.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: { id: true, isActive: true } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

  const newSerials = new Set<string>();

  for (const [i, line] of lines.entries()) {
    const product = productById.get(line.productId);
    if (!product || product.deletedAt) lineError(i, "Product does not exist");
    if (!product.isActive && adds(type, line)) lineError(i, "Product is inactive");

    const warehouse = warehouseById.get(line.warehouseId);
    if (!warehouse) lineError(i, "Warehouse does not exist");
    if (!warehouse.isActive) lineError(i, "Warehouse is inactive");

    if (line.quantity === 0) lineError(i, "Quantity can't be zero");
    if (type !== "correction" && line.quantity < 0) lineError(i, "Quantity must be positive");

    const serials = line.serials ?? [];
    const count = Math.abs(line.quantity);

    if (adds(type, line)) {
      if (serials.length > count) lineError(i, `${serials.length} serial numbers for ${count} unit(s)`);
      for (const serial of serials) {
        if (newSerials.has(serial)) lineError(i, `Serial number ${serial} is listed twice`);
        newSerials.add(serial);
      }
    } else {
      if (serials.length && serials.length !== count) {
        lineError(i, `List exactly ${count} serial number(s), or none to pick items automatically`);
      }
      if (line.unitPrice !== undefined && line.unitPrice !== null) {
        lineError(i, "A unit price only applies when stock is added");
      }
    }
  }

  if (newSerials.size) {
    const taken = await db.item.findMany({
      where: { serialNumber: { in: [...newSerials] } },
      select: { serialNumber: true },
    });
    if (taken.length) {
      throw ApiError.unprocessable("Validation failed", {
        serials: [`Serial number(s) already in use: ${taken.map((t) => t.serialNumber).join(", ")}`],
      });
    }
  }
}

/** Does this line add new items (receive, or a positive correction)? */
function adds(type: AdjustmentType, line: { quantity: number }) {
  return type === "receive" || (type === "correction" && line.quantity > 0);
}

/**
 * Picks the items a removing line acts on: the listed serials, or else
 * the oldest matching items (first in, first out) for damage/correction
 * and the most recently sold for returns.
 */
async function pickItems(
  tx: Tx,
  type: AdjustmentType,
  line: { productId: number; warehouseId: number; quantity: number; serials: string[] },
  index: number
) {
  const count = Math.abs(line.quantity);
  const returning = type === "return";

  if (line.serials.length) {
    const items = await tx.item.findMany({
      where: { serialNumber: { in: line.serials }, productId: line.productId },
      select: { id: true, serialNumber: true, status: true, warehouseId: true },
    });
    for (const serial of line.serials) {
      const item = items.find((it) => it.serialNumber === serial);
      if (!item) lineError(index, `No item of this product has serial number ${serial}`);
      if (returning && item.status === "in_stock") lineError(index, `Item ${serial} is already in stock`);
      if (!returning && (item.status !== "in_stock" || item.warehouseId !== line.warehouseId)) {
        lineError(index, `Item ${serial} isn't in stock in this warehouse`);
      }
    }
    return items;
  }

  const items = await tx.item.findMany({
    where: returning
      ? { productId: line.productId, status: "sold" }
      : { productId: line.productId, warehouseId: line.warehouseId, status: "in_stock" },
    orderBy: returning ? [{ updatedAt: "desc" }, { id: "desc" }] : [{ createdAt: "asc" }, { id: "asc" }],
    take: count,
    select: { id: true, serialNumber: true, status: true, warehouseId: true },
  });

  if (items.length < count) {
    lineError(
      index,
      returning
        ? `Only ${items.length} sold item(s) of this product can be returned`
        : `Only ${items.length} item(s) of this product are in stock in this warehouse`
    );
  }
  return items;
}

/** Applies an adjustment's lines. Must run inside the approving transaction. */
async function applyAdjustment(
  tx: Tx,
  adjustment: { id: number; type: AdjustmentType; reason: string; note: string | null },
  lines: { productId: number; warehouseId: number; quantity: number; serials: string[]; unitPrice: Prisma.Decimal | null }[],
  userId: number
) {
  const movements: MovementInput[] = [];
  const reference = `adjustment:${adjustment.id}`;
  const note = adjustment.note ? `${adjustment.reason}: ${adjustment.note}` : adjustment.reason;

  for (const [i, line] of lines.entries()) {
    const count = Math.abs(line.quantity);
    const base = {
      productId: line.productId,
      warehouseId: line.warehouseId,
      quantity: count,
      userId,
      reference,
      note,
    };

    if (adds(adjustment.type, line)) {
      const product = await tx.product.findUniqueOrThrow({
        where: { id: line.productId },
        select: { name: true, unitPrice: true },
      });
      const price = line.unitPrice ?? product.unitPrice;
      await tx.item.createMany({
        data: Array.from({ length: count }, (_, n) => ({
          itemCode: `BT-${randomUUID()}`,
          name: product.name,
          serialNumber: line.serials[n] ?? null,
          price,
          productId: line.productId,
          warehouseId: line.warehouseId,
          status: "in_stock" as const,
        })),
      });
      movements.push({ ...base, type: "in", reason: adjustment.type === "receive" ? "receive" : "correction" });
      continue;
    }

    const items = await pickItems(tx, adjustment.type, line, i);
    const ids = items.map((it) => it.id);

    if (adjustment.type === "return") {
      // Returned items go into this line's warehouse.
      const updated = await tx.item.updateMany({
        where: { id: { in: ids }, status: { not: "in_stock" } },
        data: { status: "in_stock", warehouseId: line.warehouseId },
      });
      if (updated.count !== ids.length) lineError(i, "Some items changed while this was being applied. Try again.");
      movements.push({ ...base, type: "in", reason: "return" });
    } else {
      const status = adjustment.type === "damage" ? "damaged" : "removed";
      const updated = await tx.item.updateMany({
        where: { id: { in: ids }, status: "in_stock", warehouseId: line.warehouseId },
        data: { status },
      });
      if (updated.count !== ids.length) lineError(i, "Some items changed while this was being applied. Try again.");
      movements.push({ ...base, type: "out", reason: adjustment.type === "damage" ? "damage" : "correction" });
    }
  }

  await recordMovements(
    tx,
    movements.map((m) => ({ ...m, adjustmentId: adjustment.id }))
  );
}

export async function createAdjustment(input: AdjustmentInput, actor: { id: number; canApprove: boolean }) {
  const lines = input.lines.map((l) => ({ ...l, serials: (l.serials ?? []).map((s) => s.trim()).filter(Boolean) }));
  await validateLines(input.type, lines);

  const created = await prisma.stockAdjustment.create({
    data: {
      type: input.type,
      reason: input.reason,
      note: input.note ?? null,
      requestedById: actor.id,
      lines: {
        create: lines.map((l) => ({
          productId: l.productId,
          warehouseId: l.warehouseId,
          quantity: l.quantity,
          serials: l.serials,
          unitPrice: l.unitPrice === undefined || l.unitPrice === null ? null : new Prisma.Decimal(l.unitPrice),
        })),
      },
    },
    select: { id: true },
  });

  if (!actor.canApprove) {
    return getAdjustment(created.id);
  }

  // Approvers' own adjustments apply straight away. If applying fails the
  // request is removed again, so nothing half-done is left behind.
  try {
    return await approveAdjustment(created.id, actor.id);
  } catch (err) {
    await prisma.stockAdjustment.delete({ where: { id: created.id } });
    throw err;
  }
}

export async function approveAdjustment(id: number, reviewerId: number) {
  await prisma.$transaction(async (tx) => {
    // Claim it: only one approval or rejection can win.
    const claimed = await tx.stockAdjustment.updateMany({
      where: { id, status: "pending" },
      data: { status: "approved", reviewedById: reviewerId, reviewedAt: new Date() },
    });
    if (claimed.count !== 1) {
      const exists = await tx.stockAdjustment.findUnique({ where: { id }, select: { status: true } });
      if (!exists) throw ApiError.notFound("Stock adjustment not found");
      throw ApiError.unprocessable(`This adjustment has already been ${exists.status}`);
    }

    const adjustment = await tx.stockAdjustment.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        type: true,
        reason: true,
        note: true,
        lines: {
          select: { productId: true, warehouseId: true, quantity: true, serials: true, unitPrice: true },
          orderBy: { id: "asc" },
        },
      },
    });

    // Re-check against current data: things may have changed since it
    // was submitted.
    await validateLines(
      adjustment.type,
      adjustment.lines.map((l) => ({ ...l, unitPrice: l.unitPrice === null ? null : Number(l.unitPrice) })),
      tx
    );
    await applyAdjustment(tx, adjustment, adjustment.lines, reviewerId);
  });

  return getAdjustment(id);
}

export async function rejectAdjustment(id: number, reviewerId: number, rejectReason: string) {
  const updated = await prisma.stockAdjustment.updateMany({
    where: { id, status: "pending" },
    data: { status: "rejected", reviewedById: reviewerId, reviewedAt: new Date(), rejectReason },
  });
  if (updated.count !== 1) {
    const exists = await prisma.stockAdjustment.findUnique({ where: { id }, select: { status: true } });
    if (!exists) throw ApiError.notFound("Stock adjustment not found");
    throw ApiError.unprocessable(`This adjustment has already been ${exists.status}`);
  }
  return getAdjustment(id);
}

export async function getAdjustment(id: number, viewer?: { id: number; canSeeAll: boolean }) {
  const adjustment = await prisma.stockAdjustment.findUnique({ where: { id }, select: adjustmentSelect });
  // Users who can't approve only see their own requests.
  if (!adjustment || (viewer && !viewer.canSeeAll && adjustment.requestedBy.id !== viewer.id)) {
    throw ApiError.notFound("Stock adjustment not found");
  }
  return withTotals(adjustment);
}

export async function listAdjustments(params: {
  status?: AdjustmentStatus;
  type?: AdjustmentType;
  requestedById?: number;
  viewer: { id: number; canSeeAll: boolean };
  page: number;
  perPage: number;
}) {
  const where: Prisma.StockAdjustmentWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.type ? { type: params.type } : {}),
    ...(params.viewer.canSeeAll
      ? params.requestedById
        ? { requestedById: params.requestedById }
        : {}
      : { requestedById: params.viewer.id }),
  };

  const [total, adjustments] = await Promise.all([
    prisma.stockAdjustment.count({ where }),
    prisma.stockAdjustment.findMany({
      where,
      select: adjustmentSelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (params.page - 1) * params.perPage,
      take: params.perPage,
    }),
  ]);

  return {
    adjustments: adjustments.map(withTotals),
    meta: {
      currentPage: params.page,
      perPage: params.perPage,
      total,
      lastPage: Math.max(1, Math.ceil(total / params.perPage)),
    },
  };
}

function withTotals<T extends { lines: { quantity: number }[] }>(adjustment: T) {
  return { ...adjustment, totalUnits: adjustment.lines.reduce((sum, l) => sum + Math.abs(l.quantity), 0) };
}
