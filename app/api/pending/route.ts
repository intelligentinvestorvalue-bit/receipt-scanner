import { NextResponse } from "next/server";
import { listPendingItems } from "@/lib/pending";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/pending
 * Resolves this month's budget spreadsheet, ensures a Pending tab + headers,
 * attempts Apps Script attach when the tab is newly created, and returns rows.
 */
export async function GET() {
  try {
    const { items, bootstrap } = await listPendingItems();
    return NextResponse.json({
      items,
      spreadsheetId: bootstrap.spreadsheetId,
      spreadsheetUrl: bootstrap.spreadsheetUrl,
      spreadsheetName: bootstrap.spreadsheetName,
      created: bootstrap.created,
      script: bootstrap.script,
      scriptInstall: bootstrap.scriptInstall,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load pending";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
