// Runs in every integration test worker before the app is loaded.
require("dotenv").config();

if (!process.env.TEST_DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL is not set. See .env.example.");
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Keep uploads from tests out of the real uploads folder.
process.env.UPLOAD_DIR = require("path").join(require("os").tmpdir(), "besttech-test-uploads");
