import multer from "multer";
import { ApiError } from "../utils/ApiError";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Accepts a single image in the "image" field, kept in memory so the
 * storage helper decides where it goes. The declared type is checked
 * here; the real type is checked from the file's bytes before saving.
 */
export const singleImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      callback(
        ApiError.unprocessable("Validation failed", { image: ["Upload a JPEG, PNG, WebP or GIF image"] })
      );
      return;
    }
    callback(null, true);
  },
}).single("image");
