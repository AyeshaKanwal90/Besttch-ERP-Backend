import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { getLowStockProductIds } from "./stockLevels";

const money = (value: Prisma.Decimal | null | undefined) => (value ?? new Prisma.Decimal(0)).toFixed(2);

const warehouseSelect = { id: true, name: true, code: true } as const;

/** In-stock unit count per warehouse for one or more products. */
export async function stockByWarehouse(productIds: number[]) {
  if (!productIds.length) return new Map<number, { warehouse: { id: number; name: string; code: string }; quantity: number }[]>();

  const groups = await prisma.item.groupBy({
    by: ["productId", "warehouseId"],
    where: { productId: { in: productIds }, status: "in_stock" },
    _count: { _all: true },
  });
  const warehouses = await prisma.warehouse.findMany({
    where: { id: { in: [...new Set(groups.map((g) => g.warehouseId))] } },
    select: warehouseSelect,
  });
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

  const result = new Map<number, { warehouse: { id: number; name: string; code: string }; quantity: number }[]>();
  for (const g of groups) {
    const list = result.get(g.productId) ?? [];
    list.push({ warehouse: warehouseById.get(g.warehouseId)!, quantity: g._count._all });
    result.set(g.productId, list);
  }
  for (const list of result.values()) list.sort((a, b) => b.quantity - a.quantity || a.warehouse.name.localeCompare(b.warehouse.name));
  return result;
}

/**
 * Suggested order: enough to bring stock back up to twice the reorder
 * level, which leaves a buffer above the alert line. At least 1.
 */
export function suggestedReorderQuantity(stock: number, reorderLevel: number) {
  return Math.max(reorderLevel * 2 - stock, 1);
}

/** Products at or below their reorder level, most urgent first. */
export async function getLowStock() {
  const ids = await getLowStockProductIds();
  if (!ids.length) return [];

  const [products, perWarehouse] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        imageUrl: true,
        unitPrice: true,
        reorderLevel: true,
        category: { select: { id: true, name: true } },
        _count: { select: { items: { where: { status: "in_stock" } } } },
      },
    }),
    stockByWarehouse(ids),
  ]);

  return products
    .map(({ _count, ...product }) => {
      const stock = _count.items;
      return {
        ...product,
        stock,
        threshold: product.reorderLevel,
        outOfStock: stock === 0,
        suggestedReorderQuantity: suggestedReorderQuantity(stock, product.reorderLevel),
        stockByWarehouse: perWarehouse.get(product.id) ?? [],
      };
    })
    .sort((a, b) => a.stock / a.threshold - b.stock / b.threshold || a.name.localeCompare(b.name));
}

export async function countLowStockProducts() {
  return (await getLowStockProductIds()).length;
}

/** Value of in-stock items (sum of each item's price). */
export async function getStockValue(where: Prisma.ItemWhereInput = {}) {
  const totals = await prisma.item.aggregate({
    where: { ...where, status: "in_stock" },
    _sum: { price: true },
    _count: { _all: true },
  });
  return { value: money(totals._sum.price), units: totals._count._all };
}

/**
 * Stock valuation: total value of in-stock items, broken down by product,
 * warehouse and category. Each item counts at its own price.
 */
export async function getStockValuation(filters: { warehouseId?: number; categoryId?: number } = {}) {
  const where: Prisma.ItemWhereInput = {
    status: "in_stock",
    ...(filters.warehouseId ? { warehouseId: filters.warehouseId } : {}),
    ...(filters.categoryId ? { product: { categoryId: filters.categoryId } } : {}),
  };

  const groups = await prisma.item.groupBy({
    by: ["productId", "warehouseId"],
    where,
    _sum: { price: true },
    _count: { _all: true },
  });

  const productIds = [...new Set(groups.map((g) => g.productId))];
  const warehouseIds = [...new Set(groups.map((g) => g.warehouseId))];
  const [products, warehouses] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, sku: true, category: { select: { id: true, name: true } } },
    }),
    prisma.warehouse.findMany({ where: { id: { in: warehouseIds } }, select: warehouseSelect }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

  type Bucket = { value: Prisma.Decimal; units: number };
  const add = (map: Map<string, Bucket>, key: string, value: Prisma.Decimal, units: number) => {
    const bucket = map.get(key) ?? { value: new Prisma.Decimal(0), units: 0 };
    bucket.value = bucket.value.plus(value);
    bucket.units += units;
    map.set(key, bucket);
  };

  const byProduct = new Map<string, Bucket>();
  const byWarehouse = new Map<string, Bucket>();
  const byCategory = new Map<string, Bucket>();
  let total = new Prisma.Decimal(0);
  let units = 0;

  for (const g of groups) {
    const value = g._sum.price ?? new Prisma.Decimal(0);
    const count = g._count._all;
    const categoryId = productById.get(g.productId)?.category?.id;
    add(byProduct, String(g.productId), value, count);
    add(byWarehouse, String(g.warehouseId), value, count);
    add(byCategory, categoryId ? String(categoryId) : "none", value, count);
    total = total.plus(value);
    units += count;
  }

  const sorted = <T extends { value: string }>(rows: T[]) =>
    rows.sort((a, b) => new Prisma.Decimal(b.value).cmp(new Prisma.Decimal(a.value)));

  return {
    totalValue: money(total),
    totalUnits: units,
    byProduct: sorted(
      [...byProduct].map(([id, b]) => {
        const p = productById.get(Number(id))!;
        return { product: { id: p.id, name: p.name, sku: p.sku }, units: b.units, value: money(b.value) };
      })
    ),
    byWarehouse: sorted(
      [...byWarehouse].map(([id, b]) => ({ warehouse: warehouseById.get(Number(id))!, units: b.units, value: money(b.value) }))
    ),
    byCategory: sorted(
      [...byCategory].map(([id, b]) => {
        const category =
          id === "none" ? null : [...productById.values()].find((p) => p.category?.id === Number(id))!.category;
        return { category, units: b.units, value: money(b.value) };
      })
    ),
  };
}
