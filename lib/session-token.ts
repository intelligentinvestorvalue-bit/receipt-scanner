import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "rs_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type SessionPayload = {
  sub: string;
  exp: number;
};

function getSecretKey(): Uint8Array | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  return new TextEncoder().encode(secret);
}

export async function encryptSession(subject = "owner"): Promise<string> {
  const key = getSecretKey();
  if (!key) {
    throw new Error(
      "SESSION_SECRET must be set to a random string of at least 32 characters"
    );
  }
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  return new SignJWT({ sub: subject })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key);
}

export async function decryptSession(
  token: string | undefined
): Promise<SessionPayload | null> {
  if (!token) return null;
  const key = getSecretKey();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string") return null;
    return {
      sub: payload.sub,
      exp: typeof payload.exp === "number" ? payload.exp : 0,
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    sameSite: "lax" as const,
    path: "/",
  };
}

export function sessionExpiresAt(): Date {
  return new Date(Date.now() + SESSION_DURATION_MS);
}
