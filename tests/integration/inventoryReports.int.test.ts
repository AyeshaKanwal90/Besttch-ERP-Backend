import { clearPermissionCache } from "../../src/services/permissions.service";
import { api, createProduct, createWarehouse, prisma, resetDatabase, type TestUsers } from "./helpers";

let users: TestUsers;
let main: { id: number };
let backup: { id: number };

beforeEach(async () => {
  users = await resetDatabase();
  main = await createWarehouse(users.admin, "MAIN");
  backup = await createWarehouse(users.admin, "BACKUP");
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function receive(productId: number, warehouseId: number, quantity: number, unitPrice?: number) {
  const res = await api(users.admin).post("/stock-adjustments", {
    type: "receive",
    reason: "Setup",
    lines: [{ productId, warehouseId, quantity, ...(unitPrice !== undefined ? { unitPrice } : {}) }],
  });
  expect(res.status).toBe(201);
}

describe("GET /api/inventory/low-stock", () => {
  it("lists products at or below their reorder level, most urgent first", async () => {
    const low = await createProduct(users.admin, { name: "Keyboard", reorderLevel: 5 });
    const empty = await createProduct(users.admin, { name: "Mouse", reorderLevel: 3 });
    const fine = await createProduct(users.admin, { name: "Cable", reorderLevel: 2 });
    const untracked = await createProduct(users.admin, { name: "Sticker", reorderLevel: 0 });

    await receive(low.id, main.id, 2);
    await receive(low.id, backup.id, 1);
    await receive(fine.id, main.id, 4);

    const res = await api(users.staff).get("/inventory/low-stock");
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { id: number }) => p.id)).toEqual([empty.id, low.id]);
    expect(res.body.data.map((p: { id: number }) => p.id)).not.toContain(untracked.id);

    expect(res.body.data[0]).toMatchObject({ stock: 0, threshold: 3, outOfStock: true, suggestedReorderQuantity: 6, stockByWarehouse: [] });
    expect(res.body.data[1]).toMatchObject({
      stock: 3,
      threshold: 5,
      outOfStock: false,
      suggestedReorderQuantity: 7,
      stockByWarehouse: [
        { warehouse: { id: main.id, code: "MAIN" }, quantity: 2 },
        { warehouse: { id: backup.id, code: "BACKUP" }, quantity: 1 },
      ],
    });
  });

  it("is closed to clients", async () => {
    expect((await api(users.client).get("/inventory/low-stock")).status).toBe(403);
  });
});

describe("GET /api/reports/stock-valuation", () => {
  it("values in-stock items at their own prices by product, warehouse and category", async () => {
    const category = (await api(users.admin).post("/categories", { name: "Keyboards" })).body.data;
    const keyboard = await createProduct(users.admin, { name: "Keyboard", unitPrice: 10, categoryId: category.id });
    const cable = await createProduct(users.admin, { name: "Cable", unitPrice: 5 });

    await receive(keyboard.id, main.id, 2); // 2 x 10
    await receive(keyboard.id, backup.id, 1, 20); // 1 x 20
    await receive(cable.id, main.id, 4); // 4 x 5

    // Sold stock doesn't count.
    const sold = await prisma.item.findFirstOrThrow({ where: { productId: cable.id } });
    await api(users.admin).post(`/items/${sold.id}/sell`);

    const res = await api(users.admin).get("/reports/stock-valuation");
    expect(res.status).toBe(200);
    expect(res.body.data.totalValue).toBe("55.00");
    expect(res.body.data.totalUnits).toBe(6);
    expect(res.body.data.byProduct).toEqual([
      { product: { id: keyboard.id, name: "Keyboard", sku: expect.any(String) }, units: 3, value: "40.00" },
      { product: { id: cable.id, name: "Cable", sku: expect.any(String) }, units: 3, value: "15.00" },
    ]);
    expect(res.body.data.byWarehouse).toEqual([
      { warehouse: { id: main.id, name: "Warehouse MAIN", code: "MAIN" }, units: 5, value: "35.00" },
      { warehouse: { id: backup.id, name: "Warehouse BACKUP", code: "BACKUP" }, units: 1, value: "20.00" },
    ]);
    expect(res.body.data.byCategory).toEqual([
      { category: { id: category.id, name: "Keyboards" }, units: 3, value: "40.00" },
      { category: null, units: 3, value: "15.00" },
    ]);

    const backupOnly = await api(users.admin).get(`/reports/stock-valuation?warehouseId=${backup.id}`);
    expect(backupOnly.body.data.totalValue).toBe("20.00");
  });

  it("is limited to roles with inventory_reports.view", async () => {
    expect((await api(users.staff).get("/reports/stock-valuation")).status).toBe(403);
    expect((await api(users.superAdmin).get("/reports/stock-valuation")).status).toBe(200);
  });
});

describe("product detail", () => {
  it("includes stock per warehouse and the 10 latest movements", async () => {
    const product = await createProduct(users.admin);
    await receive(product.id, main.id, 3);
    for (let i = 0; i < 11; i++) await receive(product.id, backup.id, 1);

    const res = await api(users.staff).get(`/products/${product.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.stockByWarehouse).toEqual([
      { warehouse: expect.objectContaining({ id: backup.id }), quantity: 11 },
      { warehouse: expect.objectContaining({ id: main.id }), quantity: 3 },
    ]);
    expect(res.body.data.latestMovements).toHaveLength(10);
    expect(res.body.data.latestMovements[0].warehouse.id).toBe(backup.id);
  });

  it("leaves out movements for roles that can't see them", async () => {
    const product = await createProduct(users.admin);
    const staffRole = await prisma.role.findUniqueOrThrow({ where: { name: "staff" } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { name: "stock_movements.view" } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: staffRole.id, permissionId: permission.id } } });
    clearPermissionCache();

    const res = await api(users.staff).get(`/products/${product.id}`);
    expect(res.body.data.latestMovements).toBeNull();
    expect(res.body.data.stockByWarehouse).toEqual([]);
  });
});

describe("dashboard stats", () => {
  it("reports real low-stock and stock figures, with value only for report viewers", async () => {
    const product = await createProduct(users.admin, { unitPrice: 12.5, reorderLevel: 3 });
    await receive(product.id, main.id, 2);

    const admin = await api(users.admin).get("/dashboard/stats");
    expect(admin.body.data.inventory).toMatchObject({ lowStockItems: 1, itemsInStock: 2, stockValue: "25.00" });

    const staff = await api(users.staff).get("/dashboard/stats");
    expect(staff.body.data.inventory).toMatchObject({ lowStockItems: 1, itemsInStock: 2, stockValue: null });
  });
});
