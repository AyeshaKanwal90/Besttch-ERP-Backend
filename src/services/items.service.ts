import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";

import { prisma } from "../config/prisma";
import { ApiError } from "../utils/ApiError";
import { recordMovements } from "./stockMovements.service";
import { getLowStockProductIds } from "./stockLevels";

interface CreateItemInput {
  barcode: string;
  serialNumber?: string | null;
  itemName?: string | null;
  // Falls back to the product's unit price.
  price?: number;

  warehouseId: number;

  sku?: string;
  productName?: string;
  description?: string | null;
  unit?: string;
}

interface UpdateItemInput {
  itemName?: string | null;
  serialNumber?: string | null;
  price?: number;
  warehouseId?: number;
}

export type ItemStatusValue = "in_stock" | "sold" | "removed" | "damaged";

interface ListItemsParams {
  search?: string;

  status?: ItemStatusValue;

  productId?: number;
  warehouseId?: number;
  categoryId?: number;
  /** Only items of products at or below their reorder level. */
  lowStock?: boolean;

  page: number;
  perPage: number;
}

const itemSelect = {
  id: true,
  itemCode: true,
  name: true,
  serialNumber: true,
  price: true,
  status: true,
  createdAt: true,
  updatedAt: true,

  product: {
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      description: true,
      unit: true,
      imageUrl: true,
      reorderLevel: true,
      category: { select: { id: true, name: true } },
    },
  },

  warehouse: {
    select: {
      id: true,
      name: true,
      code: true,
    },
  },
} satisfies Prisma.ItemSelect;

/**
 * ADD A NEW PHYSICAL ITEM
 *
 * 1. Look for existing product using barcode.
 * 2. If found -> add Item underneath it.
 * 3. If not found -> create Product first.
 * 4. Create the physical Item.
 */
export async function createItem(
  input: CreateItemInput,
  options: { canCreateProducts: boolean; userId: number }
) {
  await assertWarehouseExists(input.warehouseId);

  if (input.serialNumber) {
    await assertSerialAvailable(input.serialNumber);
  }

  return prisma.$transaction(async (tx) => {
    /*
     * Barcode determines whether this
     * product already exists. Archived
     * products are included because the
     * barcode column is unique: creating a
     * second product with the same barcode
     * would fail on the index.
     */
    let product = await tx.product.findUnique({
      where: {
        barcode: input.barcode,
      },
    });

    /*
     * Without products.create (staff by default) the barcode
     * must already belong to an active product. Restoring an
     * archived product counts as creating one.
     */
    if ((!product || product.deletedAt) && !options.canCreateProducts) {
      throw ApiError.forbidden("Product not found - ask an admin to add it");
    }

    /*
     * Receiving stock for an archived
     * product brings it back.
     */
    if (product?.deletedAt) {
      product = await tx.product.update({
        where: {
          id: product.id,
        },

        data: {
          deletedAt: null,
          isActive: true,
        },
      });
    }

    /*
     * Product doesn't exist.
     * Create product automatically.
     */
    if (!product) {
      if (!input.productName || input.productName.trim() === "") {
        throw ApiError.unprocessable("Product does not exist", {
          productName: [
            "Product name is required when adding the first item of a new product",
          ],
        });
      }

      /*
       * If SKU wasn't supplied,
       * generate one from the barcode.
       */
      const sku = input.sku?.trim() || `SKU-${input.barcode}`;

      const existingSku = await tx.product.findUnique({
        where: {
          sku,
        },
      });

      if (existingSku) {
        throw ApiError.unprocessable("Validation failed", {
          sku: [
            existingSku.deletedAt
              ? "SKU belongs to an archived product"
              : "SKU is already in use",
          ],
        });
      }

      product = await tx.product.create({
        data: {
          sku,

          barcode: input.barcode,

          name: input.productName,

          description: input.description ?? null,

          unit: input.unit ?? "piece",

          // The first item's price becomes the product's default.
          unitPrice: new Prisma.Decimal(input.price ?? 0),

          isActive: true,
        },
      });
    }

    if (!product.isActive) {
      throw ApiError.unprocessable("Product is inactive");
    }

    /*
     * Generate our own unique ERP
     * identifier for every physical unit.
     */
    const itemCode = `BT-${randomUUID()}`;

    /*
     * If itemName wasn't provided,
     * use the product name.
     */
    const itemName = input.itemName?.trim() || product.name;

    const item = await tx.item.create({
      data: {
        itemCode,

        name: itemName,

        serialNumber: input.serialNumber ?? null,

        price: input.price !== undefined ? new Prisma.Decimal(input.price) : product.unitPrice,

        productId: product.id,

        warehouseId: input.warehouseId,

        status: "in_stock",
      },

      select: itemSelect,
    });

    await recordMovements(tx, [
      {
        productId: product.id,
        warehouseId: input.warehouseId,
        itemId: item.id,
        type: "in",
        reason: "receive",
        quantity: 1,
        userId: options.userId,
      },
    ]);

    return item;
  });
}

/**
 * GET / SEARCH ALL ITEMS
 *
 * Search supports:
 * - Item ID
 * - Item name
 * - Item code
 * - Serial number
 * - Product name
 * - Product SKU
 * - Product barcode
 */
export async function listItems(params: ListItemsParams) {
  const search = params.search?.trim();

  const searchConditions: Prisma.ItemWhereInput[] = [];

  if (search) {
    searchConditions.push(
      {
        itemCode: {
          contains: search,

          mode: "insensitive",
        },
      },

      {
        serialNumber: {
          contains: search,

          mode: "insensitive",
        },
      },

      {
        name: {
          contains: search,

          mode: "insensitive",
        },
      },

      {
        product: {
          name: {
            contains: search,

            mode: "insensitive",
          },
        },
      },

      {
        product: {
          sku: {
            contains: search,

            mode: "insensitive",
          },
        },
      },

      {
        product: {
          barcode: {
            contains: search,

            mode: "insensitive",
          },
        },
      }
    );

    /*
     * Numeric search can also
     * represent Item ID.
     */
    if (/^\d+$/.test(search)) {
      searchConditions.push({
        id: Number(search),
      });
    }
  }

  const lowStockIds = params.lowStock ? await getLowStockProductIds() : undefined;

  const where: Prisma.ItemWhereInput = {
    ...(params.categoryId ? { product: { categoryId: params.categoryId } } : {}),

    ...(lowStockIds && !params.productId ? { productId: { in: lowStockIds } } : {}),

    ...(lowStockIds && params.productId && !lowStockIds.includes(params.productId)
      ? { id: { in: [] } }
      : {}),

    ...(params.status
      ? {
          status: params.status,
        }
      : {}),

    ...(params.productId
      ? {
          productId: params.productId,
        }
      : {}),

    ...(params.warehouseId
      ? {
          warehouseId: params.warehouseId,
        }
      : {}),

    ...(searchConditions.length
      ? {
          OR: searchConditions,
        }
      : {}),
  };

  const [total, items] = await Promise.all([
    prisma.item.count({
      where,
    }),

    prisma.item.findMany({
      where,

      select: itemSelect,

      orderBy: {
        createdAt: "desc",
      },

      skip: (params.page - 1) * params.perPage,

      take: params.perPage,
    }),
  ]);

  return {
    items,

    meta: {
      currentPage: params.page,

      perPage: params.perPage,

      total,

      lastPage: Math.max(1, Math.ceil(total / params.perPage)),
    },
  };
}

/**
 * GET ITEM BY DATABASE ID
 */
export async function getItemById(id: number) {
  const item = await prisma.item.findUnique({
    where: {
      id,
    },

    select: itemSelect,
  });

  if (!item) {
    throw ApiError.notFound("Item not found");
  }

  return item;
}

/**
 * GET EXACT PHYSICAL ITEM
 * USING SERIAL NUMBER
 */
export async function getItemBySerial(serialNumber: string) {
  const item = await prisma.item.findUnique({
    where: {
      serialNumber,
    },

    select: itemSelect,
  });

  if (!item) {
    throw ApiError.notFound("Item not found");
  }

  return item;
}

/**
 * GET EXACT PHYSICAL ITEM
 * USING INTERNAL ERP ITEM CODE
 */
export async function getItemByCode(itemCode: string) {
  const item = await prisma.item.findUnique({
    where: {
      itemCode,
    },

    select: itemSelect,
  });

  if (!item) {
    throw ApiError.notFound("Item not found");
  }

  return item;
}

/**
 * UPDATE ITEM
 *
 * Supports updating:
 * - item name
 * - serial number
 * - price
 * - warehouse
 */
export async function updateItem(
  id: number,
  input: UpdateItemInput,
  options: { canUpdatePrice: boolean; userId: number }
) {
  const item = await prisma.item.findUnique({
    where: {
      id,
    },
  });

  if (!item) {
    throw ApiError.notFound("Item not found");
  }

  /*
   * Moving items and fixing names/serials needs items.update;
   * changing the price also needs items.update_price (not given
   * to staff by default). Re-sending the current price is fine
   * so edit forms that post every field still work.
   */
  if (
    !options.canUpdatePrice &&
    input.price !== undefined &&
    !item.price.equals(new Prisma.Decimal(input.price))
  ) {
    throw ApiError.forbidden("You do not have permission to change item prices");
  }

  /*
   * Check serial uniqueness only when
   * serial is actually changing.
   */
  if (input.serialNumber && input.serialNumber !== item.serialNumber) {
    await assertSerialAvailable(input.serialNumber);
  }

  /*
   * Validate warehouse if it
   * is being changed.
   */
  const moving = input.warehouseId !== undefined && input.warehouseId !== item.warehouseId;

  if (moving) {
    await assertWarehouseExists(input.warehouseId!);

    // Only stock that's physically on hand can change warehouse.
    if (item.status !== "in_stock") {
      throw ApiError.unprocessable("Only items in stock can be moved to another warehouse");
    }
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.item.update({
    where: {
      id,
    },

    data: {
      ...(input.itemName !== undefined
        ? {
            name: input.itemName,
          }
        : {}),

      ...(input.serialNumber !== undefined
        ? {
            serialNumber: input.serialNumber,
          }
        : {}),

      ...(input.price !== undefined
        ? {
            price: new Prisma.Decimal(input.price),
          }
        : {}),

      ...(moving
        ? {
            warehouseId: input.warehouseId,
          }
        : {}),
    },

    select: itemSelect,
    });

    if (moving) {
      await recordMovements(tx, [
        {
          productId: item.productId,
          warehouseId: input.warehouseId!,
          fromWarehouseId: item.warehouseId,
          toWarehouseId: input.warehouseId!,
          itemId: item.id,
          type: "transfer",
          reason: "transfer",
          quantity: 1,
          userId: options.userId,
        },
      ]);
    }

    return updated;
  });
}

/**
 * SELL ITEM
 *
 * Quantity automatically decreases
 * because Product quantity counts only
 * items whose status = in_stock.
 */
export async function sellItem(id: number, userId: number, note?: string | null) {
  return changeStatus(id, "sold", userId, note);
}

/**
 * REMOVE ITEM (written off, lost, etc.)
 */
export async function removeItem(id: number, userId: number, note?: string | null) {
  return changeStatus(id, "removed", userId, note);
}

/**
 * MARK ITEM DAMAGED
 */
export async function damageItem(id: number, userId: number, note?: string | null) {
  return changeStatus(id, "damaged", userId, note);
}

/**
 * RETURN ITEM TO STOCK (from sold, removed or damaged)
 */
export async function returnItem(id: number, userId: number, note?: string | null) {
  return changeStatus(id, "in_stock", userId, note);
}

const STATUS_MOVEMENT = {
  sold: { type: "out", reason: "sale" },
  removed: { type: "out", reason: "removal" },
  damaged: { type: "out", reason: "damage" },
  in_stock: { type: "in", reason: "return" },
} as const;

/**
 * INTERNAL STATUS HANDLER
 */
async function changeStatus(
  id: number,
  status: ItemStatusValue,
  userId: number,
  note?: string | null
) {
  const item = await prisma.item.findUnique({
    where: {
      id,
    },
  });

  if (!item) {
    throw ApiError.notFound("Item not found");
  }

  /*
   * Selling/removing is only allowed
   * when an item is currently in stock.
   */
  if (status !== "in_stock" && item.status !== "in_stock") {
    throw ApiError.unprocessable("Item is not currently in stock");
  }

  /*
   * Do not return an already
   * in-stock item.
   */
  if (status === "in_stock" && item.status === "in_stock") {
    throw ApiError.unprocessable("Item is already in stock");
  }

  return prisma.$transaction(async (tx) => {
    // Conditional update: if another request changed the status since we
    // read it, nothing matches and the change is refused.
    const claimed = await tx.item.updateMany({
      where: { id, status: item.status },
      data: { status },
    });

    if (claimed.count !== 1) {
      throw ApiError.unprocessable("The item was changed by someone else. Refresh and try again.");
    }

    await recordMovements(tx, [
      {
        productId: item.productId,
        warehouseId: item.warehouseId,
        itemId: item.id,
        ...STATUS_MOVEMENT[status],
        quantity: 1,
        userId,
        note: note ?? null,
      },
    ]);

    return tx.item.findUniqueOrThrow({ where: { id }, select: itemSelect });
  });
}

/**
 * CHECK SERIAL NUMBER
 */
async function assertSerialAvailable(serialNumber: string) {
  const existing = await prisma.item.findUnique({
    where: {
      serialNumber,
    },
  });

  if (existing) {
    throw ApiError.unprocessable("Validation failed", {
      serialNumber: ["Serial number already exists"],
    });
  }
}

/**
 * CHECK WAREHOUSE
 */
async function assertWarehouseExists(warehouseId: number) {
  const warehouse = await prisma.warehouse.findUnique({
    where: {
      id: warehouseId,
    },
  });

  if (!warehouse) {
    throw ApiError.unprocessable("Validation failed", {
      warehouseId: ["Warehouse does not exist"],
    });
  }

  if (!warehouse.isActive) {
    throw ApiError.unprocessable("Selected warehouse is inactive");
  }

  return warehouse;
}
