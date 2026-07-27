"use server";

import { redirect } from "next/navigation";
import { verifyAppPassword, isAuthConfigured } from "@/lib/auth";
import { createSession, deleteSession } from "@/lib/session";

export type LoginState = {
  error?: string;
} | undefined;

export async function login(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  if (!isAuthConfigured()) {
    return {
      error:
        "Auth is not configured. Set APP_PASSWORD and SESSION_SECRET (32+ chars) in the environment.",
    };
  }

  const password = String(formData.get("password") ?? "");
  if (!verifyAppPassword(password)) {
    return { error: "Incorrect password" };
  }

  await createSession();
  redirect("/");
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}
