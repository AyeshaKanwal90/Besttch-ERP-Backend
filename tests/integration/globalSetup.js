const { execSync } = require("child_process");
require("dotenv").config();

/**
 * Rebuilds the test database from the migrations once per run.
 * Refuses to touch anything that doesn't look like a test database.
 */
module.exports = async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL;

  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. See .env.example.");
  }

  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to reset "${dbName}": the test database name must contain "test".`);
  }

  execSync("npx prisma migrate reset --force --skip-seed --skip-generate", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
};
