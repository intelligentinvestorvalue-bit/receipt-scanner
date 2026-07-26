import { NextResponse } from "next/server";
import { listPendingItems } from "@/lib/pending";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/pending
 * Ensures the Pending spreadsheet exists (creates + headers on first load),
 * attempts Apps Script attach when newly created, and returns pending rows.
 */
export async function GET() {
  try {
    const { items, bootstrap } = await listPendingItems();
    return NextResponse.json({
      items,
      spreadsheetId: bootstrap.spreadsheetId,
      spreadsheetUrl: bootstrap.spreadsheetUrl,
      created: bootstrap.created,
      script: bootstrap.script,
      scriptInstall: bootstrap.scriptInstall,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load pending";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
