import { NextRequest, NextResponse } from "next/server";
import { discardPendingItem } from "@/lib/pending";

export const runtime = "nodejs";

/**
 * POST /api/pending/discard
 * Body: { rowNumber }
 * Marks the Pending row discarded (no Transactions write).
 */
export async function POST(req: NextRequest) {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 }
    );
  }

  try {
    const body = await req.json();
    const { rowNumber } = body ?? {};

    if (typeof rowNumber !== "number" || rowNumber < 2) {
      return NextResponse.json({ error: "Invalid rowNumber" }, { status: 400 });
    }

    await discardPendingItem(rowNumber);
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Discard failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
