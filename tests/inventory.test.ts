import request from "supertest";
import { Prisma } from "@prisma/client";

jest.mock("../src/config/prisma", () => {
  const prisma: Record<string, any> = {
    product: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    item: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    rolePermission: {
      findMany: jest.fn(),
    },
    warehouse: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  // Interactive transactions just run the callback against the same mocks.
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma));

  return { prisma };
});

import { prisma } from "../src/config/prisma";
import { createApp } from "../src/app";
import {
  makeAuthCookie,
  FAKE_ADMIN,
  FAKE_CLIENT,
  FAKE_STAFF,
  FAKE_SUPER_ADMIN,
} from "./helpers/authToken";
import { useDefaultPermissions } from "./helpers/permissions";

const app = createApp();

const db = prisma as unknown as {
  product: Record<string, jest.Mock>;
  item: Record<string, jest.Mock>;
  warehouse: Record<string, jest.Mock>;
  rolePermission: Record<string, jest.Mock>;
};

const ACTIVE_WAREHOUSE = { id: 2, name: "Second", code: "SEC", isActive: true };

function storedItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    itemCode: "BT-test",
    name: "Mouse",
    serialNumber: null,
    price: new Prisma.Decimal(10),
    productId: 1,
    warehouseId: 1,
    status: "in_stock",
    ...overrides,
  };
}

function prismaKnownError(code: string, meta?: Record<string, unknown>) {
  return new Prisma.PrismaClientKnownRequestError("Prisma error", {
    code,
    clientVersion: "5.22.0",
    meta,
  });
}

beforeEach(() => {
  for (const model of [db.product, db.item, db.warehouse]) {
    Object.values(model).forEach((fn) => fn.mockReset());
  }
  useDefaultPermissions(db.rolePermission.findMany);
});

describe("inventory access by role", () => {
  it.each(["/api/products", "/api/items", "/api/warehouses"])(
    "returns 403 to clients on GET %s",
    async (path) => {
      const res = await request(app).get(path).set("Cookie", makeAuthCookie(FAKE_CLIENT));

      expect(res.status).toBe(403);
      expect(db.product.findMany).not.toHaveBeenCalled();
      expect(db.item.findMany).not.toHaveBeenCalled();
      expect(db.warehouse.findMany).not.toHaveBeenCalled();
    }
  );

  it("lets staff list products", async () => {
    db.product.count.mockResolvedValue(0);
    db.product.findMany.mockResolvedValue([]);

    const res = await request(app).get("/api/products").set("Cookie", makeAuthCookie(FAKE_STAFF));

    expect(res.status).toBe(200);
  });

  it("does not let staff create products", async () => {
    const res = await request(app)
      .post("/api/products")
      .set("Cookie", makeAuthCookie(FAKE_STAFF))
      .send({ sku: "MOUSE-1", barcode: "111", name: "Mouse" });

    expect(res.status).toBe(403);
    expect(db.product.create).not.toHaveBeenCalled();
  });

  it("does not let staff create or delete warehouses", async () => {
    const create = await request(app)
      .post("/api/warehouses")
      .set("Cookie", makeAuthCookie(FAKE_STAFF))
      .send({ name: "New", code: "NEW" });
    const remove = await request(app)
      .delete("/api/warehouses/1")
      .set("Cookie", makeAuthCookie(FAKE_STAFF));

    expect(create.status).toBe(403);
    expect(remove.status).toBe(403);
    expect(db.warehouse.create).not.toHaveBeenCalled();
    expect(db.warehouse.update).not.toHaveBeenCalled();
  });
});

describe("PUT /api/items/:id as staff", () => {
  it("refuses a price change", async () => {
    db.item.findUnique.mockResolvedValue(storedItem());

    const res = await request(app)
      .put("/api/items/1")
      .set("Cookie", makeAuthCookie(FAKE_STAFF))
      .send({ price: 99 });

    expect(res.status).toBe(403);
    expect(db.item.update).not.toHaveBeenCalled();
  });

  it("lets an admin change the price", async () => {
    db.item.findUnique.mockResolvedValue(storedItem());
    db.item.update.mockResolvedValue(storedItem({ price: new Prisma.Decimal(99) }));

    const res = await request(app)
      .put("/api/items/1")
      .set("Cookie", makeAuthCookie(FAKE_ADMIN))
      .send({ price: 99 });

    expect(res.status).toBe(200);
  });

  it("moves an item to another warehouse (re-sending the same price is fine)", async () => {
    db.item.findUnique.mockResolvedValue(storedItem());
    db.warehouse.findUnique.mockResolvedValue(ACTIVE_WAREHOUSE);
    db.item.update.mockResolvedValue(storedItem({ warehouseId: 2 }));

    const res = await request(app)
      .put("/api/items/1")
      .set("Cookie", makeAuthCookie(FAKE_STAFF))
      .send({ warehouseId: 2, price: 10 });

    expect(res.status).toBe(200);
    expect(db.item.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ warehouseId: 2 }),
      })
    );
  });

  it("stores an empty serial number as null", async () => {
    db.item.findUnique.mockResolvedValue(storedItem({ serialNumber: "OLD" }));
    db.item.update.mockResolvedValue(storedItem());

    const res = await request(app)
      .put("/api/items/1")
      .set("Cookie", makeAuthCookie(FAKE_STAFF))
      .send({ serialNumber: "" });

    expect(res.status).toBe(200);
    expect(db.item.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { serialNumber: null } })
    );
  });
});

describe("deleting products and warehouses", () => {
  it("lets super admin delete a product with no stock", async () => {
    db.product.findFirst.mockResolvedValue({ id: 1, deletedAt: null });
    db.item.count.mockResolvedValue(0);
    db.product.update.mockResolvedValue({});

    const res = await request(app)
      .delete("/api/products/1")
      .set("Cookie", makeAuthCookie(FAKE_SUPER_ADMIN));

    expect(res.status).toBe(204);
    expect(db.product.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isActive: false, deletedAt: expect.any(Date) },
    });
  });

  it("lets super admin deactivate an empty warehouse", async () => {
    db.warehouse.findUnique.mockResolvedValue({ id: 1, isActive: true });
    db.item.count.mockResolvedValue(0);
    db.warehouse.update.mockResolvedValue({ id: 1, isActive: false });

    const res = await request(app)
      .delete("/api/warehouses/1")
      .set("Cookie", makeAuthCookie(FAKE_SUPER_ADMIN));

    expect(res.status).toBe(200);
    expect(db.warehouse.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 }, data: { isActive: false } })
    );
  });

  it("refuses to delete a product that still has stock", async () => {
    db.product.findFirst.mockResolvedValue({ id: 1, deletedAt: null });
    db.item.count.mockResolvedValue(3);

    const res = await request(app)
      .delete("/api/products/1")
      .set("Cookie", makeAuthCookie(FAKE_ADMIN));

    expect(res.status).toBe(422);
    expect(res.body.errors.product[0]).toMatch(/3 item/);
    expect(db.product.update).not.toHaveBeenCalled();
  });

  it("refuses to delete a warehouse that still has stock", async () => {
    db.warehouse.findUnique.mockResolvedValue({ id: 1, isActive: true });
    db.item.count.mockResolvedValue(2);

    const res = await request(app)
      .delete("/api/warehouses/1")
      .set("Cookie", makeAuthCookie(FAKE_ADMIN));

    expect(res.status).toBe(422);
    expect(db.warehouse.update).not.toHaveBeenCalled();
  });
});

describe("route ids", () => {
  it.each([
    ["get", "/api/products/abc"],
    ["get", "/api/items/1.5"],
    ["delete", "/api/warehouses/xyz"],
    ["post", "/api/items/abc/sell"],
  ] as const)("%s %s returns 404 without querying the database", async (method, path) => {
    const res = await request(app)[method](path).set("Cookie", makeAuthCookie(FAKE_SUPER_ADMIN));

    expect(res.status).toBe(404);
    expect(db.product.findFirst).not.toHaveBeenCalled();
    expect(db.item.findUnique).not.toHaveBeenCalled();
    expect(db.warehouse.findUnique).not.toHaveBeenCalled();
  });
});

describe("POST /api/items", () => {
  it("restores an archived product instead of creating a duplicate", async () => {
    db.warehouse.findUnique.mockResolvedValue(ACTIVE_WAREHOUSE);
    db.product.findUnique.mockResolvedValue({
      id: 7,
      barcode: "5099206027275",
      name: "Logitech M185",
      isActive: false,
      deletedAt: new Date("2026-01-01"),
    });
    db.product.update.mockResolvedValue({
      id: 7,
      barcode: "5099206027275",
      name: "Logitech M185",
      isActive: true,
      deletedAt: null,
    });
    db.item.create.mockResolvedValue(storedItem({ productId: 7 }));

    const res = await request(app)
      .post("/api/items")
      .set("Cookie", makeAuthCookie(FAKE_ADMIN))
      .send({ barcode: "5099206027275", price: 19.99, warehouseId: 2 });

    expect(res.status).toBe(201);
    expect(db.product.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { deletedAt: null, isActive: true },
    });
    expect(db.product.create).not.toHaveBeenCalled();
    expect(db.item.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ productId: 7 }) })
    );
  });

  it("returns 422 when a unique constraint is hit by a concurrent insert", async () => {
    db.warehouse.findUnique.mockResolvedValue(ACTIVE_WAREHOUSE);
    db.item.findUnique.mockResolvedValue(null); // serial looked free
    db.product.findUnique.mockResolvedValue({ id: 7, name: "Mouse", isActive: true, deletedAt: null });
    db.item.create.mockRejectedValue(prismaKnownError("P2002", { target: ["serial_number"] }));

    const res = await request(app)
      .post("/api/items")
      .set("Cookie", makeAuthCookie(FAKE_ADMIN))
      .send({ barcode: "111", serialNumber: "SN-1", price: 5, warehouseId: 2 });

    expect(res.status).toBe(422);
    expect(res.body.errors.serial_number).toBeDefined();
  });
});

describe("Prisma not-found errors", () => {
  it("maps P2025 to 404", async () => {
    db.item.findUnique.mockResolvedValue(storedItem());
    db.item.update.mockRejectedValue(prismaKnownError("P2025"));

    const res = await request(app)
      .post("/api/items/1/sell")
      .set("Cookie", makeAuthCookie(FAKE_ADMIN));

    expect(res.status).toBe(404);
  });
});
