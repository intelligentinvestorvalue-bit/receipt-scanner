import { NextRequest, NextResponse } from "next/server";
import { parseReceipt } from "@/lib/ocr";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";
export const maxDuration = 30;

// ── Persistent rate limiter using /tmp (survives warm serverless instances) ───
// Vision API free tier: 1,000 calls/month. Hard cap at 950.
// Per-minute burst limit: max 20 scans/60s.
const MONTHLY_CAP = 950;
const SCAN_WINDOW_MS = 60_000;
const MAX_SCANS_PER_WINDOW = 20;
const TMP_DIR = "/tmp/receipt-scanner";
const COUNTER_FILE = join(TMP_DIR, "scan-counter.json");

interface ScanCounter {
  month: string;       // "YYYY-MM"
  count: number;       // total this month
  timestamps: number[]; // recent per-minute timestamps
}

function readCounter(): ScanCounter {
  try {
    return JSON.parse(readFileSync(COUNTER_FILE, "utf8")) as ScanCounter;
  } catch {
    return { month: "", count: 0, timestamps: [] };
  }
}

function writeCounter(c: ScanCounter) {
  try {
    mkdirSync(TMP_DIR, { recursive: true });
    writeFileSync(COUNTER_FILE, JSON.stringify(c));
  } catch { /* non-fatal — best effort */ }
}

function checkLimits(): "ok" | "rate" | "monthly" {
  const nowMs = Date.now();
  const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const c = readCounter();

  // Reset if new month
  if (c.month !== currentMonth) {
    c.month = currentMonth;
    c.count = 0;
    c.timestamps = [];
  }

  // Monthly hard cap
  if (c.count >= MONTHLY_CAP) return "monthly";

  // Per-minute rate limit
  c.timestamps = c.timestamps.filter((t) => t > nowMs - SCAN_WINDOW_MS);
  if (c.timestamps.length >= MAX_SCANS_PER_WINDOW) return "rate";

  c.timestamps.push(nowMs);
  c.count++;
  writeCounter(c);
  return "ok";
}

// ── Valid base64 characters (RFC 4648) ────────────────────────────────────────
// Uses a length-based heuristic — must be at least 1KB (real image) and contain
// only base64 chars. Avoids false-rejecting valid images on edge cases.
const BASE64_RE = /^[A-Za-z0-9+/\s]+=*$/;

/**
 * POST /api/scan
 * Body (application/json): { image: "<base64 or data-URL string>" }
 * Returns: ParsedReceipt fields (date, amount, description, category)
 */
export async function POST(req: NextRequest) {
  // Require JSON content-type to reject non-JSON bodies early
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  const limitResult = checkLimits();
  if (limitResult === "monthly") {
    return NextResponse.json(
      { error: "Monthly scan limit reached (950). Resets next month. This keeps your Google Cloud bill at $0." },
      { status: 429 }
    );
  }
  if (limitResult === "rate") {
    return NextResponse.json(
      { error: "Too many scan requests — please wait a moment before trying again." },
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

    // Strip data URL prefix if present (e.g. "data:image/jpeg;base64,...")
    const base64 = image.replace(/^data:image\/[a-z]+;base64,/, "");

    // Guard: reject payloads > ~10 MB (base64 of 10 MB binary ≈ 13.3 M chars)
    if (base64.length > 14_000_000) {
      return NextResponse.json({ error: "Image too large (max 10 MB)" }, { status: 413 });
    }

    // Guard: reject clearly non-image data before hitting the paid Vision API
    // Only check minimum length (real images are > 1KB encoded) and presence of valid chars
    if (base64.length < 1000 || !BASE64_RE.test(base64)) {
      return NextResponse.json({ error: "Invalid image encoding" }, { status: 400 });
    }

    const result = await parseReceipt(base64);
    // Return parsed fields only — never send rawText (full OCR dump) to the client
    const { rawText: _raw, ...safeResult } = result;
    return NextResponse.json(safeResult, { status: 200 });
  } catch (err: unknown) {
    console.error("[/api/scan] error:", err);
    const message = err instanceof Error ? err.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
