import { NextResponse } from "next/server";
import { listPendingItems } from "@/lib/pending";

export const runtime = "nodejs";

/**
 * GET /api/pending
 * Returns email charges waiting for review (Status = pending).
 */
export async function GET() {
  try {
    const items = await listPendingItems();
    return NextResponse.json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load pending";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
