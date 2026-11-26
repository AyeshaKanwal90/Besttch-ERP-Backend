import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { env } from "../config/env";

/**
 * Where uploaded files live. Only local disk is implemented; an S3 or
 * Cloudinary driver needs to provide the same two methods and be picked
 * in `createStorage()`. Callers only ever see public URLs.
 */
export interface FileStorage {
  /** Stores the file and returns its public URL. */
  save(data: Buffer, options: { folder: string; extension: string; contentType: string }): Promise<string>;
  /** Deletes a file previously returned by save(). Unknown URLs are ignored. */
  remove(url: string): Promise<void>;
}

/** Files under UPLOAD_DIR, served by the API at /uploads. */
class LocalDiskStorage implements FileStorage {
  constructor(
    private readonly root: string,
    private readonly publicBase: string
  ) {}

  async save(data: Buffer, options: { folder: string; extension: string }) {
    const folder = options.folder.replace(/[^a-z0-9_-]/gi, "");
    const name = `${randomUUID()}.${options.extension}`;
    const dir = path.join(this.root, folder);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, name), data);
    return `${this.publicBase}/${folder}/${name}`;
  }

  async remove(url: string) {
    if (!url.startsWith(`${this.publicBase}/`)) return;
    const relative = url.slice(this.publicBase.length + 1);
    const target = path.resolve(this.root, relative);
    // Never delete outside the upload directory.
    if (!target.startsWith(path.resolve(this.root) + path.sep)) return;
    await fs.rm(target, { force: true });
  }
}

function createStorage(): FileStorage {
  return new LocalDiskStorage(env.uploadDir, `${env.publicApiUrl}/uploads`);
}

export const storage: FileStorage = createStorage();

/**
 * Identifies an image from its first bytes rather than trusting the
 * file name or the browser-supplied content type.
 */
export function detectImageType(data: Buffer): { extension: string; contentType: string } | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { extension: "jpg", contentType: "image/jpeg" };
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { extension: "png", contentType: "image/png" };
  }
  if (data.length >= 6 && (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return { extension: "gif", contentType: "image/gif" };
  }
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return { extension: "webp", contentType: "image/webp" };
  }
  return null;
}
