import { api, createProduct, createWarehouse, prisma, resetDatabase, type TestUsers } from "./helpers";

let users: TestUsers;
let main: { id: number };
let backup: { id: number };
let product: { id: number; barcode: string };

beforeEach(async () => {
  users = await resetDatabase();
  main = await createWarehouse(users.admin, "MAIN");
  backup = await createWarehouse(users.admin, "BACKUP");
  product = await createProduct(users.admin, { unitPrice: 20 });
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function receive(cookie: string, warehouseId = main.id) {
  const res = await api(cookie).post("/items", { barcode: product.barcode, warehouseId });
  expect(res.status).toBe(201);
  return res.body.data as { id: number };
}

/** in - out per warehouse, with transfers moving stock between them. */
async function ledgerStock() {
  const rows = await prisma.stockMovement.findMany({ where: { productId: product.id } });
  const stock = new Map<number, number>();
  const add = (warehouseId: number, n: number) => stock.set(warehouseId, (stock.get(warehouseId) ?? 0) + n);
  for (const m of rows) {
    if (m.type === "in") add(m.warehouseId, m.quantity);
    else if (m.type === "out") add(m.warehouseId, -m.quantity);
    else if (m.type === "transfer") {
      add(m.fromWarehouseId!, -m.quantity);
      add(m.toWarehouseId!, m.quantity);
    }
  }
  // Warehouses that net to zero have no in-stock items to compare with.
  return new Map([...stock].filter(([, n]) => n !== 0));
}

async function actualStock() {
  const groups = await prisma.item.groupBy({
    by: ["warehouseId"],
    where: { productId: product.id, status: "in_stock" },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.warehouseId, g._count._all]));
}

describe("every stock change is recorded", () => {
  it("records receive, sale, removal, damage and return with the user", async () => {
    const a = await receive(users.staff);
    const b = await receive(users.staff);
    const c = await receive(users.staff);

    expect((await api(users.staff).post(`/items/${a.id}/sell`, { note: "Invoice 42" })).status).toBe(200);
    expect((await api(users.staff).post(`/items/${b.id}/remove`)).status).toBe(200);
    const damaged = await api(users.staff).post(`/items/${c.id}/damage`, { note: "Dropped" });
    expect(damaged.status).toBe(200);
    expect(damaged.body.data.status).toBe("damaged");
    expect((await api(users.admin).post(`/items/${c.id}/return`)).status).toBe(200);

    const res = await api(users.admin).get(`/stock-movements?productId=${product.id}&per_page=100`);
    expect(res.status).toBe(200);
    const summary = res.body.data
      .map((m: { type: string; reason: string; item: { id: number }; user: { id: number }; note: string | null }) => [
        m.type,
        m.reason,
        m.item.id,
        m.user.id,
        m.note,
      ])
      .reverse();

    expect(summary).toEqual([
      ["in", "receive", a.id, users.ids.staff, null],
      ["in", "receive", b.id, users.ids.staff, null],
      ["in", "receive", c.id, users.ids.staff, null],
      ["out", "sale", a.id, users.ids.staff, "Invoice 42"],
      ["out", "removal", b.id, users.ids.staff, null],
      ["out", "damage", c.id, users.ids.staff, "Dropped"],
      ["in", "return", c.id, users.ids.admin, null],
    ]);

    expect(await ledgerStock()).toEqual(await actualStock());
  });

  it("records warehouse transfers with both warehouses", async () => {
    const item = await receive(users.staff);

    const moved = await api(users.staff).put(`/items/${item.id}`, { warehouseId: backup.id });
    expect(moved.status).toBe(200);

    const transfer = await prisma.stockMovement.findFirstOrThrow({ where: { type: "transfer" } });
    expect(transfer).toMatchObject({
      reason: "transfer",
      quantity: 1,
      itemId: item.id,
      fromWarehouseId: main.id,
      toWarehouseId: backup.id,
      warehouseId: backup.id,
      userId: users.ids.staff,
    });

    // The transfer shows up when filtering by either warehouse.
    const fromMain = await api(users.admin).get(`/stock-movements?warehouseId=${main.id}`);
    const fromBackup = await api(users.admin).get(`/stock-movements?warehouseId=${backup.id}`);
    expect(fromMain.body.data.some((m: { type: string }) => m.type === "transfer")).toBe(true);
    expect(fromBackup.body.data.some((m: { type: string }) => m.type === "transfer")).toBe(true);

    expect(await ledgerStock()).toEqual(await actualStock());
  });

  it("doesn't record anything for edits that don't change stock", async () => {
    const item = await receive(users.admin);
    const before = await prisma.stockMovement.count();

    await api(users.admin).put(`/items/${item.id}`, { itemName: "Renamed", price: 30, warehouseId: main.id });

    expect(await prisma.stockMovement.count()).toBe(before);
  });

  it("refuses to move an item that isn't in stock", async () => {
    const item = await receive(users.admin);
    await api(users.admin).post(`/items/${item.id}/sell`);

    const res = await api(users.admin).put(`/items/${item.id}`, { warehouseId: backup.id });
    expect(res.status).toBe(422);
    expect(await prisma.stockMovement.count({ where: { type: "transfer" } })).toBe(0);
  });

  it("lets only one of two simultaneous sales through", async () => {
    const item = await receive(users.admin);

    const results = await Promise.all([
      api(users.admin).post(`/items/${item.id}/sell`),
      api(users.staff).post(`/items/${item.id}/sell`),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await prisma.stockMovement.count({ where: { reason: "sale" } })).toBe(1);
  });

  it("rolls back the status change if the movement can't be written", async () => {
    const item = await receive(users.admin);
    // Make the database refuse sale movements, so the movement insert fails
    // after the status update in the same transaction.
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    await prisma.$executeRawUnsafe(`ALTER TABLE stock_movements ADD CONSTRAINT test_block_sales CHECK (reason <> 'sale')`);
    try {
      const res = await api(users.admin).post(`/items/${item.id}/sell`);
      expect(res.status).toBe(500);
      const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
      expect(after.status).toBe("in_stock");
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE stock_movements DROP CONSTRAINT test_block_sales`);
    }
  });
});

describe("GET /api/stock-movements", () => {
  it("filters by type, reason, user and date, and paginates", async () => {
    const items = [await receive(users.admin), await receive(users.staff), await receive(users.staff)];
    await api(users.staff).post(`/items/${items[0].id}/sell`);

    const sales = await api(users.admin).get("/stock-movements?reason=sale");
    expect(sales.body.data).toHaveLength(1);

    const outs = await api(users.admin).get("/stock-movements?type=out");
    expect(outs.body.meta.total).toBe(1);

    const byStaff = await api(users.admin).get(`/stock-movements?userId=${users.ids.staff}`);
    expect(byStaff.body.meta.total).toBe(3);

    const today = new Date().toISOString().slice(0, 10);
    const todayOnly = await api(users.admin).get(`/stock-movements?from=${today}&to=${today}`);
    expect(todayOnly.body.meta.total).toBe(4);
    const past = await api(users.admin).get("/stock-movements?to=2000-01-01");
    expect(past.body.meta.total).toBe(0);

    const page = await api(users.admin).get("/stock-movements?per_page=3&page=2");
    expect(page.body.data).toHaveLength(1);
    expect(page.body.meta).toMatchObject({ total: 4, last_page: 2, current_page: 2 });
  });

  it("rejects bad filters and checks permissions", async () => {
    expect((await api(users.admin).get("/stock-movements?type=sideways")).status).toBe(422);
    expect((await api(users.admin).get("/stock-movements?from=yesterday")).status).toBe(422);
    expect((await api(users.staff).get("/stock-movements")).status).toBe(200);
    expect((await api(users.client).get("/stock-movements")).status).toBe(403);
  });
});

describe("GET /api/products/:id/movements", () => {
  it("lists one product's movements", async () => {
    const other = await createProduct(users.admin);
    await receive(users.admin);
    await api(users.admin).post("/items", { barcode: other.barcode, warehouseId: main.id });

    const res = await api(users.staff).get(`/products/${product.id}/movements`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].product.id).toBe(product.id);

    expect((await api(users.admin).get("/products/9999/movements")).status).toBe(404);
  });
});
