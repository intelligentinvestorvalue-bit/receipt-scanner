"use server";

import { isAuthenticated } from "@/lib/session";
import { runSetupMonth, SetupAuthError } from "@/lib/setup-month";

export type SetupResult =
  | { ok: true; status: "already_exists" | "created"; name: string; id: string }
  | { ok: false; error: string };

/**
 * Authenticated UI path for monthly setup. Never exposes SETUP_SECRET to the
 * client — it only verifies the secret is configured server-side (fail closed).
 */
export async function setupMonthAction(): Promise<SetupResult> {
  if (!(await isAuthenticated())) {
    return { ok: false, error: "Unauthorized" };
  }

  if (!process.env.SETUP_SECRET) {
    return {
      ok: false,
      error:
        "SETUP_SECRET is not configured. Set it in the environment to enable monthly sheet setup.",
    };
  }

  try {
    const result = await runSetupMonth();
    return { ok: true, ...result };
  } catch (err: unknown) {
    if (err instanceof SetupAuthError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Setup failed",
    };
  }
}
