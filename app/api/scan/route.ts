import { NextRequest, NextResponse } from "next/server";
import { parseReceipt } from "@/lib/ocr";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/scan
 * Body: { image: "<base64 string>" }
 * Returns: ParsedReceipt (date, amount, description, category, rawText)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const image: string = body?.image;

    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid image field" },
        { status: 400 }
      );
    }

    // Strip data URL prefix if present (e.g. "data:image/jpeg;base64,...")
    const base64 = image.replace(/^data:image\/[a-z]+;base64,/, "");

    const result = await parseReceipt(base64);
    return NextResponse.json(result, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
