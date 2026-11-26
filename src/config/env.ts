import "dotenv/config";
import path from "path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === undefined || value === "") return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${name} must be "true" or "false", got "${process.env[name]}"`);
}

type SameSite = "lax" | "strict" | "none";

function parseSameSite(): SameSite {
  const value = (process.env.COOKIE_SAMESITE ?? "lax").trim().toLowerCase();
  if (value === "lax" || value === "strict" || value === "none") return value;
  throw new Error(`COOKIE_SAMESITE must be lax, strict or none, got "${process.env.COOKIE_SAMESITE}"`);
}

const isProduction = process.env.NODE_ENV === "production";
const cookieSameSite = parseSameSite();
const cookieSecure = parseBoolean("COOKIE_SECURE", isProduction);

// Browsers drop SameSite=None cookies that aren't also Secure, which
// would make every login silently fail. Refuse to start instead.
if (cookieSameSite === "none" && !cookieSecure) {
  throw new Error("COOKIE_SAMESITE=none requires COOKIE_SECURE=true");
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "1d",
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(","),
  cookieName: process.env.COOKIE_NAME ?? "besttech_token",
  cookieSameSite,
  cookieSecure,
  isProduction,

  // Public URL of the frontend, used to build links in emails.
  appUrl: (process.env.APP_URL ?? "http://localhost:5173").replace(/\/+$/, ""),

  // Outgoing mail. Leave SMTP_HOST empty to print emails to the console.
  smtp: {
    host: process.env.SMTP_HOST?.trim() || undefined,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: parseBoolean("SMTP_SECURE", false),
    user: process.env.SMTP_USER?.trim() || undefined,
    pass: process.env.SMTP_PASS,
  },
  mailFrom: process.env.MAIL_FROM ?? "BestTech <no-reply@besttch.com>",

  // Public URL of this API, used to build links to uploaded files.
  publicApiUrl: (process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/+$/, ""),

  // Folder for uploaded files (served at /uploads). Relative to the
  // working directory unless absolute.
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? "uploads"),
};
