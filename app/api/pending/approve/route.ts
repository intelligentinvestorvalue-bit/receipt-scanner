import { NextRequest, NextResponse } from "next/server";
import { approvePendingItem } from "@/lib/pending";
import { EXPENSE_CATEGORIES, ExpenseCategory } from "@/lib/categories";

export const runtime = "nodejs";

/**
 * POST /api/pending/approve
 * Body: { rowNumber, date, amount, description, category }
 * Writes to Transactions, then marks the Pending row approved.
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
    const { rowNumber, date, amount, description, category } = body ?? {};

    if (typeof rowNumber !== "number" || rowNumber < 2) {
      return NextResponse.json({ error: "Invalid rowNumber" }, { status: 400 });
    }
    if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: "Invalid or missing date (expected YYYY-MM-DD)" },
        { status: 400 }
      );
    }
    if (typeof amount !== "number" || amount <= 0 || amount > 99_999.99) {
      return NextResponse.json(
        { error: "Amount must be between $0.01 and $99,999.99" },
        { status: 400 }
      );
    }
    if (
      !description ||
      typeof description !== "string" ||
      description.trim() === "" ||
      description.length > 500
    ) {
      return NextResponse.json(
        { error: "Invalid or missing description (max 500 chars)" },
        { status: 400 }
      );
    }
    if (!category || !EXPENSE_CATEGORIES.includes(category as ExpenseCategory)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${EXPENSE_CATEGORIES.join(", ")}` },
        { status: 400 }
      );
    }

    await approvePendingItem({
      rowNumber,
      date,
      amount,
      description: description.trim(),
      category: category as ExpenseCategory,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Approve failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
