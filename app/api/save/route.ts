import { NextRequest, NextResponse } from "next/server";
import { appendToSheet } from "@/lib/sheets";
import { EXPENSE_CATEGORIES, ExpenseCategory } from "@/lib/categories";
import { ParsedReceipt } from "@/lib/ocr";

export const runtime = "nodejs";

/**
 * POST /api/save
 * Body: ParsedReceipt { date, amount, description, category }
 * Appends one row to the Transactions sheet.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { date, amount, description, category } = body as Partial<ParsedReceipt>;

    // Validate required fields
    if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid or missing date (expected YYYY-MM-DD)" }, { status: 400 });
    }
    if (typeof amount !== "number" || amount <= 0) {
      return NextResponse.json({ error: "Invalid or missing amount" }, { status: 400 });
    }
    if (!description || typeof description !== "string") {
      return NextResponse.json({ error: "Invalid or missing description" }, { status: 400 });
    }
    if (!category || !EXPENSE_CATEGORIES.includes(category as ExpenseCategory)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${EXPENSE_CATEGORIES.join(", ")}` },
        { status: 400 }
      );
    }

    await appendToSheet({ date, amount, description, category: category as ExpenseCategory, rawText: "" });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Save failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
