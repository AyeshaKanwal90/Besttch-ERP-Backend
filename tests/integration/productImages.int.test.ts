import { existsSync } from "fs";
import path from "path";
import request from "supertest";
import { env } from "../../src/config/env";
import { app, createProduct, prisma, resetDatabase, type TestUsers } from "./helpers";

// A real 1x1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

let users: TestUsers;

beforeEach(async () => {
  users = await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function upload(cookie: string, productId: number, data: Buffer, filename: string, contentType: string) {
  return request(app)
    .post(`/api/products/${productId}/image`)
    .set("Cookie", cookie)
    .attach("image", data, { filename, contentType });
}

function fileFor(url: string) {
  return path.join(env.uploadDir, url.slice(`${env.publicApiUrl}/uploads/`.length));
}

describe("POST /api/products/:id/image", () => {
  it("stores the image, serves it, and replaces the old file", async () => {
    const product = await createProduct(users.admin);

    const first = await upload(users.admin, product.id, PNG, "mouse.png", "image/png");
    expect(first.status).toBe(200);
    const firstUrl: string = first.body.data.imageUrl;
    expect(firstUrl).toMatch(new RegExp(`^${env.publicApiUrl}/uploads/products/[0-9a-f-]+\\.png$`));
    expect(existsSync(fileFor(firstUrl))).toBe(true);

    // Served from /uploads, embeddable from the frontend's origin.
    const served = await request(app).get(new URL(firstUrl).pathname);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.headers["cross-origin-resource-policy"]).toBe("cross-origin");

    // The extension comes from the bytes, not the file name.
    const second = await upload(users.admin, product.id, GIF, "photo.png", "image/png");
    expect(second.status).toBe(200);
    expect(second.body.data.imageUrl).toMatch(/\.gif$/);
    expect(existsSync(fileFor(firstUrl))).toBe(false);
  });

  it("rejects files that aren't images, even with an image name and type", async () => {
    const product = await createProduct(users.admin);

    const text = await upload(users.admin, product.id, Buffer.from("hello"), "notes.txt", "text/plain");
    expect(text.status).toBe(422);

    const disguised = await upload(users.admin, product.id, Buffer.from("<script>alert(1)</script>"), "x.png", "image/png");
    expect(disguised.status).toBe(422);
    expect(disguised.body.errors.image[0]).toMatch(/valid/);

    const svg = await upload(users.admin, product.id, Buffer.from("<svg/>"), "x.svg", "image/svg+xml");
    expect(svg.status).toBe(422);
  });

  it("rejects images over 2 MB", async () => {
    const product = await createProduct(users.admin);
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);

    const res = await upload(users.admin, product.id, big, "big.png", "image/png");
    expect(res.status).toBe(422);
    expect(res.body.errors.image[0]).toMatch(/2 MB/);
  });

  it("requires a file and products.update", async () => {
    const product = await createProduct(users.admin);

    const missing = await request(app).post(`/api/products/${product.id}/image`).set("Cookie", users.admin);
    expect(missing.status).toBe(422);

    const staff = await upload(users.staff, product.id, PNG, "a.png", "image/png");
    expect(staff.status).toBe(403);
  });

  it("returns 404 for an unknown product and removes images on request", async () => {
    expect((await upload(users.admin, 9999, PNG, "a.png", "image/png")).status).toBe(404);

    const product = await createProduct(users.admin);
    const url = (await upload(users.admin, product.id, PNG, "a.png", "image/png")).body.data.imageUrl;

    const removed = await request(app).delete(`/api/products/${product.id}/image`).set("Cookie", users.admin);
    expect(removed.status).toBe(200);
    expect(removed.body.data.imageUrl).toBeNull();
    expect(existsSync(fileFor(url))).toBe(false);
  });

  it("returns 404 for a missing upload instead of an error", async () => {
    const res = await request(app).get("/uploads/products/does-not-exist.png");
    expect(res.status).toBe(404);
  });
});
