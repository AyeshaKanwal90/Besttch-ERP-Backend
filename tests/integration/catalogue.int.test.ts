import { api, createProduct, createWarehouse, prisma, resetDatabase, type TestUsers } from "./helpers";

let users: TestUsers;

beforeEach(async () => {
  users = await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("categories", () => {
  it("lets admins create, nest, rename and delete categories", async () => {
    const admin = api(users.admin);

    const parent = await admin.post("/categories", { name: "Computer Peripherals" });
    expect(parent.status).toBe(201);
    expect(parent.body.data.slug).toBe("computer-peripherals");

    const child = await admin.post("/categories", { name: "Mice", parentId: parent.body.data.id });
    expect(child.status).toBe(201);

    const list = await api(users.staff).get("/categories");
    expect(list.status).toBe(200);
    expect(list.body.data.map((c: { name: string }) => c.name)).toEqual(["Computer Peripherals", "Mice"]);
    expect(list.body.data[0].childCount).toBe(1);

    const renamed = await admin.put(`/categories/${child.body.data.id}`, { name: "Mice & Trackpads" });
    expect(renamed.status).toBe(200);

    // A parent with children can't be deleted.
    expect((await admin.delete(`/categories/${parent.body.data.id}`)).status).toBe(422);
    expect((await admin.delete(`/categories/${child.body.data.id}`)).status).toBe(204);
    expect((await admin.delete(`/categories/${parent.body.data.id}`)).status).toBe(204);
  });

  it("rejects duplicate slugs and cycles", async () => {
    const admin = api(users.admin);
    const a = (await admin.post("/categories", { name: "A" })).body.data;
    const b = (await admin.post("/categories", { name: "B", parentId: a.id })).body.data;

    expect((await admin.post("/categories", { name: "a" })).status).toBe(422);
    expect((await admin.put(`/categories/${a.id}`, { parentId: b.id })).status).toBe(422);
    expect((await admin.put(`/categories/${a.id}`, { parentId: a.id })).status).toBe(422);
  });

  it("is read-only for staff and closed to clients", async () => {
    expect((await api(users.staff).post("/categories", { name: "X" })).status).toBe(403);
    expect((await api(users.client).get("/categories")).status).toBe(403);
  });

  it("leaves products uncategorised when their category is deleted", async () => {
    const admin = api(users.admin);
    const category = (await admin.post("/categories", { name: "Cables" })).body.data;
    const product = await createProduct(users.admin, { categoryId: category.id });

    await admin.delete(`/categories/${category.id}`);

    const after = await admin.get(`/products/${product.id}`);
    expect(after.body.data.categoryId).toBeNull();
  });
});

describe("product pricing, category and reorder level", () => {
  it("stores category, unit price and reorder level, and flags low stock", async () => {
    const admin = api(users.admin);
    const category = (await admin.post("/categories", { name: "Keyboards" })).body.data;
    const warehouse = await createWarehouse(users.admin, "MAIN");
    const product = await createProduct(users.admin, { categoryId: category.id, unitPrice: 49.5, reorderLevel: 2 });

    let detail = (await admin.get(`/products/${product.id}`)).body.data;
    expect(detail.category).toEqual({ id: category.id, name: "Keyboards", slug: "keyboards" });
    expect(detail.unitPrice).toBe("49.5");
    expect(detail.reorderLevel).toBe(2);
    expect(detail.lowStock).toBe(true); // 0 in stock

    for (let i = 0; i < 3; i++) {
      await admin.post("/items", { barcode: product.barcode, warehouseId: warehouse.id });
    }
    detail = (await admin.get(`/products/${product.id}`)).body.data;
    expect(detail.quantity).toBe(3);
    expect(detail.lowStock).toBe(false);
  });

  it("uses the product's unit price when an item is received without one", async () => {
    const warehouse = await createWarehouse(users.admin, "MAIN");
    const product = await createProduct(users.admin, { unitPrice: 12.75 });

    const item = await api(users.staff).post("/items", { barcode: product.barcode, warehouseId: warehouse.id });
    expect(item.status).toBe(201);
    expect(item.body.data.price).toBe("12.75");

    const priced = await api(users.admin).post("/items", { barcode: product.barcode, warehouseId: warehouse.id, price: 9 });
    expect(priced.body.data.price).toBe("9");
  });

  it("filters products by category and low stock", async () => {
    const admin = api(users.admin);
    const category = (await admin.post("/categories", { name: "Monitors" })).body.data;
    const low = await createProduct(users.admin, { categoryId: category.id, reorderLevel: 5 });
    await createProduct(users.admin, { reorderLevel: 0 });

    const byCategory = await admin.get(`/products?categoryId=${category.id}`);
    expect(byCategory.body.data.map((p: { id: number }) => p.id)).toEqual([low.id]);

    const lowStock = await admin.get("/products?lowStock=true");
    expect(lowStock.body.data.map((p: { id: number }) => p.id)).toEqual([low.id]);
  });

  it("only lets roles with low_stock.manage change the reorder level", async () => {
    const product = await createProduct(users.admin);

    // Staff can't edit products at all; give them products.update to isolate the rule.
    const staffRole = await prisma.role.findUniqueOrThrow({ where: { name: "staff" } });
    const updatePerm = await prisma.permission.findUniqueOrThrow({ where: { name: "products.update" } });
    await prisma.rolePermission.create({ data: { roleId: staffRole.id, permissionId: updatePerm.id } });
    const { clearPermissionCache } = await import("../../src/services/permissions.service");
    clearPermissionCache();

    expect((await api(users.staff).put(`/products/${product.id}`, { name: "Renamed" })).status).toBe(200);
    expect((await api(users.staff).put(`/products/${product.id}`, { reorderLevel: 3 })).status).toBe(403);
    expect((await api(users.admin).put(`/products/${product.id}`, { reorderLevel: 3 })).status).toBe(200);
  });

  it("rejects an unknown category", async () => {
    const res = await api(users.admin).post("/products", { sku: "X1", barcode: "X1", name: "Thing", categoryId: 999 });
    expect(res.status).toBe(422);
    expect(res.body.errors.categoryId).toBeDefined();
  });
});
