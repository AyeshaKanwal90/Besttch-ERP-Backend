/**
 * Integration tests run the real services against a real Postgres database
 * (TEST_DATABASE_URL), which is reset from the migrations before each run.
 *
 *   npm run test:integration
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/integration/**/*.int.test.ts"],
  globalSetup: "<rootDir>/tests/integration/globalSetup.js",
  // Point the app at the test database before any module reads env.
  setupFiles: ["<rootDir>/tests/integration/useTestDatabase.js"],
  testTimeout: 30000,
};
