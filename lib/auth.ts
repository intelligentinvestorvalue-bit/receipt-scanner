import "server-only";
import { timingSafeEqual } from "crypto";

/**
 * Constant-time password comparison against APP_PASSWORD.
 * Returns false if APP_PASSWORD is unset (fail closed).
 */
export function verifyAppPassword(provided: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected || expected.length === 0) return false;
  if (typeof provided !== "string") return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isAuthConfigured(): boolean {
  const password = process.env.APP_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  return Boolean(password && password.length > 0 && secret && secret.length >= 32);
}
