/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  // Integration tests need a database; they run with `npm run test:integration`.
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/tests/integration/"],
  setupFiles: ["dotenv/config"],
};
