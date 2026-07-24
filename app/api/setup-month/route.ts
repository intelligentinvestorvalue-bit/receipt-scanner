import { NextResponse } from "next/server";
import {
  assertSetupSecret,
  runSetupMonth,
  SetupAuthError,
} from "@/lib/setup-month";

export const runtime = "nodejs";

/**
 * POST /api/setup-month
 *
 * Automates new-month setup. Always requires SETUP_SECRET via x-setup-secret
 * (fail closed — unset secret refuses the request). Prefer the authenticated
 * server action from the UI; this route is for scripts/automation.
 *
 * Required env vars:
 *   SETUP_SECRET, GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY,
 *   GOOGLE_OWNER_EMAIL (recommended)
 */
export async function POST(req: Request) {
  try {
    assertSetupSecret(req.headers.get("x-setup-secret"));
    const result = await runSetupMonth();
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof SetupAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : "Setup failed";
    const status = message.includes("No template found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
