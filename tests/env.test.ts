// env.ts reads process.env once at import time, so each case loads a
// fresh copy of the module with the variables it needs.
function loadEnv(vars: Record<string, string | undefined>) {
  const saved = { ...process.env };
  Object.assign(process.env, { DATABASE_URL: "postgres://x", JWT_SECRET: "x" });

  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  try {
    let loaded: typeof import("../src/config/env").env | undefined;
    jest.isolateModules(() => {
      loaded = require("../src/config/env").env;
    });
    return loaded!;
  } finally {
    process.env = saved;
  }
}

describe("cookie settings", () => {
  it("defaults to SameSite=lax and not secure outside production", () => {
    const env = loadEnv({ NODE_ENV: "development", COOKIE_SAMESITE: undefined, COOKIE_SECURE: undefined });

    expect(env.cookieSameSite).toBe("lax");
    expect(env.cookieSecure).toBe(false);
  });

  it("defaults to secure in production", () => {
    const env = loadEnv({ NODE_ENV: "production", COOKIE_SAMESITE: undefined, COOKIE_SECURE: undefined });

    expect(env.cookieSecure).toBe(true);
  });

  it("reads COOKIE_SAMESITE and COOKIE_SECURE", () => {
    const env = loadEnv({ COOKIE_SAMESITE: "None", COOKIE_SECURE: "true" });

    expect(env.cookieSameSite).toBe("none");
    expect(env.cookieSecure).toBe(true);
  });

  it("refuses SameSite=none without Secure", () => {
    expect(() => loadEnv({ COOKIE_SAMESITE: "none", COOKIE_SECURE: "false" })).toThrow(/COOKIE_SECURE=true/);
  });

  it("rejects unknown values", () => {
    expect(() => loadEnv({ COOKIE_SAMESITE: "sometimes" })).toThrow(/COOKIE_SAMESITE/);
    expect(() => loadEnv({ COOKIE_SECURE: "yes" })).toThrow(/COOKIE_SECURE/);
  });
});
