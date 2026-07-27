import "server-only";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE,
  encryptSession,
  decryptSession,
  sessionCookieOptions,
  sessionExpiresAt,
} from "./session-token";

export async function createSession(): Promise<void> {
  const expiresAt = sessionExpiresAt();
  const token = await encryptSession("owner");
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return decryptSession(token);
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getSession()) !== null;
}
