import { NextRequest, NextResponse } from "next/server";
import { parseReceipt } from "@/lib/ocr";
import { checkScanLimits, recordSuccessfulScan } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 30;

// ── Valid base64 characters (RFC 4648) ────────────────────────────────────────
const BASE64_RE = /^[A-Za-z0-9+/\s]+=*$/;

/**
 * POST /api/scan
 * Body (application/json): { image: "<base64 or data-URL string>" }
 * Returns: ParsedReceipt fields + amountCandidates + needsAmount
 * Quota is charged only after a successful Vision OCR call.
 */
export async function POST(req: NextRequest) {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 }
    );
  }

  const limitResult = await checkScanLimits();
  if (limitResult === "monthly") {
    return NextResponse.json(
      {
        error:
          "Monthly scan limit reached (950). Resets next month. This keeps your Google Cloud bill at $0.",
      },
      { status: 429 }
    );
  }
  if (limitResult === "rate") {
    return NextResponse.json(
      {
        error:
          "Too many scan requests — please wait a moment before trying again.",
      },
      { status: 429 }
    );
  }

  try {
    const body = await req.json();
    const image: string = body?.image;

    if (!image || typeof image !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid image field" },
        { status: 400 }
      );
    }

    const base64 = image.replace(/^data:image\/[a-z]+;base64,/, "");

    if (base64.length > 14_000_000) {
      return NextResponse.json(
        { error: "Image too large (max 10 MB)" },
        { status: 413 }
      );
    }

    if (base64.length < 1000 || !BASE64_RE.test(base64)) {
      return NextResponse.json(
        { error: "Invalid image encoding" },
        { status: 400 }
      );
    }

    const result = await parseReceipt(base64);
    await recordSuccessfulScan();

    // Never send rawText (full OCR dump) to the client
    const { rawText, ...safeResult } = result;
    void rawText;
    return NextResponse.json(safeResult, { status: 200 });
  } catch (err: unknown) {
    console.error("[/api/scan] error:", err);
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
