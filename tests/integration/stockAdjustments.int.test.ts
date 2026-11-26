import { api, createProduct, createWarehouse, prisma, resetDatabase, type TestUsers } from "./helpers";

let users: TestUsers;
let main: { id: number };
let backup: { id: number };
let product: { id: number; barcode: string };

beforeEach(async () => {
  users = await resetDatabase();
  main = await createWarehouse(users.admin, "MAIN");
  backup = await createWarehouse(users.admin, "BACKUP");
  product = await createProduct(users.admin, { unitPrice: 15 });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const line = (overrides: Record<string, unknown> = {}) => ({
  productId: product.id,
  warehouseId: main.id,
  quantity: 1,
  ...overrides,
});

async function adjust(cookie: string, type: string, lines: object[], reason = "Test") {
  return api(cookie).post("/stock-adjustments", { type, reason, lines });
}

async function inStock(warehouseId = main.id) {
  return prisma.item.count({ where: { productId: product.id, warehouseId, status: "in_stock" } });
}

/** Receive n units as admin (applied immediately) and return the items, oldest first. */
async function stock(n: number, warehouseId = main.id, serials: string[] = []) {
  const res = await adjust(users.admin, "receive", [line({ quantity: n, warehouseId, serials })]);
  expect(res.status).toBe(201);
  return prisma.item.findMany({ where: { productId: product.id, warehouseId }, orderBy: { id: "asc" } });
}

describe("approval flow", () => {
  it("keeps staff submissions pending until an admin approves them", async () => {
    const submitted = await adjust(users.staff, "receive", [line({ quantity: 3, serials: ["S-1", "S-2"] })], "Delivery PO-1");
    expect(submitted.status).toBe(201);
    expect(submitted.body.message).toMatch(/submitted for approval/);
    expect(submitted.body.data).toMatchObject({ status: "pending", type: "receive", totalUnits: 3 });
    expect(await inStock()).toBe(0);

    const pending = await api(users.admin).get("/stock-adjustments?status=pending");
    expect(pending.body.data.map((a: { id: number }) => a.id)).toEqual([submitted.body.data.id]);

    const approved = await api(users.admin).post(`/stock-adjustments/${submitted.body.data.id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.data).toMatchObject({ status: "approved", reviewedBy: { id: users.ids.admin } });
    expect(approved.body.data.reviewedAt).toBeTruthy();

    const items = await prisma.item.findMany({ where: { productId: product.id }, orderBy: { id: "asc" } });
    expect(items.map((i) => [i.serialNumber, i.price.toString(), i.status])).toEqual([
      ["S-1", "15", "in_stock"],
      ["S-2", "15", "in_stock"],
      [null, "15", "in_stock"],
    ]);

    const movements = await prisma.stockMovement.findMany({ where: { adjustmentId: submitted.body.data.id } });
    expect(movements).toEqual([
      expect.objectContaining({ type: "in", reason: "receive", quantity: 3, warehouseId: main.id, userId: users.ids.admin }),
    ]);
  });

  it("applies an admin's own adjustment straight away, with a price override", async () => {
    const res = await adjust(users.admin, "receive", [line({ quantity: 2, unitPrice: 9.5 })]);
    expect(res.status).toBe(201);
    expect(res.body.message).toBe("Adjustment applied");
    expect(res.body.data.status).toBe("approved");

    const prices = await prisma.item.findMany({ where: { productId: product.id }, select: { price: true } });
    expect(prices.map((p) => p.price.toString())).toEqual(["9.5", "9.5"]);
  });

  it("receives many units in one adjustment", async () => {
    await adjust(users.admin, "receive", [line({ quantity: 50 }), line({ quantity: 10, warehouseId: backup.id })]);
    expect(await inStock(main.id)).toBe(50);
    expect(await inStock(backup.id)).toBe(10);
  });

  it("rejects with a reason, and can't be reviewed twice", async () => {
    const { id } = (await adjust(users.staff, "receive", [line()])).body.data;

    expect((await api(users.admin).post(`/stock-adjustments/${id}/reject`, {})).status).toBe(422);
    const rejected = await api(users.admin).post(`/stock-adjustments/${id}/reject`, { reason: "Wrong product" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data).toMatchObject({ status: "rejected", rejectReason: "Wrong product" });

    const again = await api(users.admin).post(`/stock-adjustments/${id}/approve`);
    expect(again.status).toBe(422);
    expect(again.body.message).toMatch(/already been rejected/);
    expect(await inStock()).toBe(0);
  });

  it("applies only once when approved twice at the same time", async () => {
    const { id } = (await adjust(users.staff, "receive", [line({ quantity: 4 })])).body.data;

    const results = await Promise.all([
      api(users.admin).post(`/stock-adjustments/${id}/approve`),
      api(users.superAdmin).post(`/stock-adjustments/${id}/approve`),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await inStock()).toBe(4);
    expect(await prisma.stockMovement.count({ where: { adjustmentId: id } })).toBe(1);
  });

  it("leaves everything unchanged when a line can't be applied at approval time", async () => {
    await stock(2);
    const { id } = (
      await adjust(users.staff, "damage", [line({ quantity: 1 }), line({ quantity: 2, warehouseId: main.id })])
    ).body.data;

    // One unit sells before approval, so the second line no longer fits.
    const first = await prisma.item.findFirstOrThrow({ where: { productId: product.id, status: "in_stock" } });
    await api(users.admin).post(`/items/${first.id}/sell`);

    const res = await api(users.admin).post(`/stock-adjustments/${id}/approve`);
    expect(res.status).toBe(422);
    expect(res.body.errors["lines.1"][0]).toMatch(/Only 0 item/);

    expect(await prisma.item.count({ where: { status: "damaged" } })).toBe(0);
    expect((await prisma.stockAdjustment.findUniqueOrThrow({ where: { id } })).status).toBe("pending");
    expect(await prisma.stockMovement.count({ where: { adjustmentId: id } })).toBe(0);
  });
});

describe("adjustment types", () => {
  it("damages the listed serials, or the oldest items", async () => {
    const items = await stock(4, main.id, ["A", "B", "C", "D"]);

    await adjust(users.admin, "damage", [line({ quantity: 1, serials: ["C"] })]);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: items[2].id } })).status).toBe("damaged");

    await adjust(users.admin, "damage", [line({ quantity: 2 })]);
    const statuses = await prisma.item.findMany({ where: { productId: product.id }, orderBy: { id: "asc" } });
    expect(statuses.map((i) => i.status)).toEqual(["damaged", "damaged", "damaged", "in_stock"]);

    const movements = await prisma.stockMovement.findMany({ where: { reason: "damage" } });
    expect(movements.map((m) => [m.type, m.quantity])).toEqual([["out", 1], ["out", 2]]);
  });

  it("returns sold items into the chosen warehouse", async () => {
    const items = await stock(3);
    await api(users.admin).post(`/items/${items[0].id}/sell`);
    await api(users.admin).post(`/items/${items[1].id}/sell`);

    const tooMany = await adjust(users.admin, "return", [line({ quantity: 3, warehouseId: backup.id })]);
    expect(tooMany.status).toBe(422);

    const res = await adjust(users.admin, "return", [line({ quantity: 2, warehouseId: backup.id })]);
    expect(res.status).toBe(201);
    expect(await inStock(backup.id)).toBe(2);
    expect(await inStock(main.id)).toBe(1);
  });

  it("corrects stock up and down", async () => {
    await stock(2);

    await adjust(users.admin, "correction", [line({ quantity: 3 })], "Stock count found extra units");
    expect(await inStock()).toBe(5);

    await adjust(users.admin, "correction", [line({ quantity: -4 })], "Stock count");
    expect(await inStock()).toBe(1);
    expect(await prisma.item.count({ where: { status: "removed" } })).toBe(4);

    const corrections = await prisma.stockMovement.findMany({ where: { reason: "correction" }, orderBy: { id: "asc" } });
    expect(corrections.map((m) => [m.type, m.quantity])).toEqual([["in", 3], ["out", 4]]);
  });

  it("keeps the ledger equal to actual stock", async () => {
    await stock(5);
    await adjust(users.admin, "damage", [line({ quantity: 2 })]);
    await adjust(users.admin, "correction", [line({ quantity: 1, warehouseId: backup.id })]);

    const movements = await prisma.stockMovement.findMany({ where: { productId: product.id } });
    const net = movements.reduce((sum, m) => sum + (m.type === "in" ? m.quantity : m.type === "out" ? -m.quantity : 0), 0);
    expect(net).toBe((await inStock(main.id)) + (await inStock(backup.id)));
  });
});

describe("validation and access", () => {
  it.each([
    ["receive with a negative quantity", "receive", [{ quantity: -1 }]],
    ["more serials than units", "receive", [{ quantity: 1, serials: ["X", "Y"] }]],
    ["a serial repeated across lines", "receive", [{ serials: ["X"] }, { serials: ["X"] }]],
    ["a price on a damage line", "damage", [{ unitPrice: 5 }]],
    ["the wrong number of serials when damaging", "damage", [{ quantity: 2, serials: ["X"] }]],
    ["an unknown product", "receive", [{ productId: 9999 }]],
    ["a zero correction", "correction", [{ quantity: 0 }]],
  ])("rejects %s", async (_label, type, lines) => {
    const res = await adjust(users.admin, type as string, (lines as Record<string, unknown>[]).map((l) => line(l)));
    expect(res.status).toBe(422);
  });

  it("rejects serials that already exist and inactive warehouses", async () => {
    await stock(1, main.id, ["TAKEN"]);
    expect((await adjust(users.admin, "receive", [line({ serials: ["TAKEN"] })])).status).toBe(422);

    await prisma.warehouse.update({ where: { id: backup.id }, data: { isActive: false } });
    expect((await adjust(users.admin, "receive", [line({ warehouseId: backup.id })])).status).toBe(422);
  });

  it("checks permissions and hides other people's requests from staff", async () => {
    expect((await adjust(users.client, "receive", [line()])).status).toBe(403);

    const { id } = (await adjust(users.admin, "receive", [line()])).body.data;
    const staffOwn = (await adjust(users.staff, "receive", [line()])).body.data;

    expect((await api(users.staff).post(`/stock-adjustments/${staffOwn.id}/approve`)).status).toBe(403);
    expect((await api(users.staff).get(`/stock-adjustments/${id}`)).status).toBe(404);
    expect((await api(users.staff).get(`/stock-adjustments/${staffOwn.id}`)).status).toBe(200);

    const staffList = await api(users.staff).get("/stock-adjustments");
    expect(staffList.body.data.map((a: { id: number }) => a.id)).toEqual([staffOwn.id]);

    const adminList = await api(users.admin).get("/stock-adjustments");
    expect(adminList.body.meta.total).toBe(2);
  });
});
