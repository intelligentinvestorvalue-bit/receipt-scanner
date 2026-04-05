import { classifyMerchant, ExpenseCategory } from "./categories";

export interface ParsedReceipt {
  date: string;           // YYYY-MM-DD
  amount: number;         // numeric total
  description: string;    // merchant / store name
  category: ExpenseCategory;
  rawText: string;        // full OCR text for debugging
}

/**
 * Call Google Cloud Vision API to OCR a receipt image (base64).
 * Runs server-side only — API key stays in env vars, never in browser.
 */
export async function ocrReceiptImage(base64Image: string): Promise<string> {
  const apiKey = process.env.GOOGLE_VISION_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_VISION_API_KEY not set");

  const response = await fetch(
    `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: [
          {
            image: { content: base64Image },
            features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Vision API error: ${err}`);
  }

  const data = await response.json();
  const text: string =
    data?.responses?.[0]?.textAnnotations?.[0]?.description ?? "";

  if (!text) throw new Error("No text detected in image");
  return text;
}

/**
 * Normalise raw OCR text before parsing:
 * - Collapse spaced letters "T O T A L" → "TOTAL"
 * - Strip common OCR noise characters
 * - Normalise currency symbols to $
 */
function normaliseText(text: string): string {
  return text
    .replace(/\b([A-Z])(?:\s+([A-Z])){2,}\b/g, (m) => m.replace(/\s+/g, "")) // spaced letters
    .replace(/[£€¥₹]/g, "$")       // treat all currencies the same
    .replace(/\|/g, "")             // OCR pipe noise
    .replace(/\s{2,}/g, " ");       // collapse multiple spaces
}

/**
 * Parse a raw amount string → number. Handles "1,234.56", "1.234,56" (EU), "1234.56"
 */
function parseAmount(raw: string): number {
  // EU format: 1.234,56 → swap . and ,
  const euFormat = /^\d{1,3}(\.\d{3})+(,\d{2})$/.test(raw);
  const cleaned = euFormat
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw.replace(/,/g, "");
  return parseFloat(cleaned);
}

/**
 * Extract total amount from OCR text.
 *
 * Handles paper receipts AND digital/email receipts:
 *
 * Paper:
 *   TOTAL $42.17 | TOTAL - $58.99 | TOTAL.....12.00 | T O T A L 15.00
 *   AMOUNT DUE $123.00 | BALANCE DUE $58.99 | GRAND TOTAL $9.75
 *
 * Email / digital (Amazon, Uber, DoorDash, PayPal, etc.):
 *   Order Total: $42.17
 *   Total Charged: $38.00
 *   Charged to your card: $15.74
 *   You were charged $29.99
 *   Payment of $12.50
 *   Transaction Total $99.00
 *   Amount Charged $7.49
 *   Total Payment: $55.00
 *   Charge: $18.25
 */
export function extractTotal(text: string): number | null {
  const norm = normaliseText(text);
  const lines = norm.split("\n").map((l) => l.trim());

  // Separator: any combo of spaces, dashes, dots, colons, pipes
  const sep = "[\\s\\-.:_*|]+";
  // Amount pattern: optional $, digits with optional comma grouping, decimal
  const amt = "\\$?([\\d,]+\\.\\d{2})";

  // ── Tier 1: High-confidence specific patterns ──────────────────────────────
  // Order matters: most specific first to avoid false positives
  const tier1 = [
    // Email receipt patterns
    `(?:order|transaction|invoice)\\s+total${sep}${amt}`,
    `total\\s+(?:charged|billed|payment|amount|due|cost)${sep}${amt}`,
    `(?:amount|total)\\s+charged${sep}${amt}`,
    `charged\\s+to\\s+(?:your\\s+)?(?:card|account|visa|mastercard|amex)${sep}${amt}`,
    `you\\s+(?:were\\s+)?(?:charged|paid|billed)${sep}${amt}`,
    `payment\\s+(?:of|total|amount)${sep}${amt}`,
    `total\\s+payment${sep}${amt}`,
    `amount\\s+paid${sep}${amt}`,
    // Paper receipt patterns
    `grand\\s+total${sep}${amt}`,
    `total\\s+due${sep}${amt}`,
    `amount\\s+due${sep}${amt}`,
    `balance\\s+due${sep}${amt}`,
    `total\\s+amount(?:\\s+due)?${sep}${amt}`,
    `sale\\s+total${sep}${amt}`,
    `net\\s+total${sep}${amt}`,
    `subtotal\\s+due${sep}${amt}`,
  ];

  for (const pattern of tier1) {
    const m = norm.match(new RegExp(pattern, "i"));
    if (m) {
      const v = parseAmount(m[1]);
      if (v > 0 && v < 99999) return v;
    }
  }

  // ── Tier 2: Generic "total" and "charge" labels ────────────────────────────
  const tier2 = [
    `\\btotal\\b${sep}${amt}`,
    `\\bcharge\\b${sep}${amt}`,
    `\\bbalance\\b${sep}${amt}`,
  ];

  for (const pattern of tier2) {
    const m = norm.match(new RegExp(pattern, "i"));
    if (m) {
      const v = parseAmount(m[1]);
      if (v > 0 && v < 99999) return v;
    }
  }

  // ── Tier 3: Line-by-line — label on one line, amount up to 2 lines below ──
  const labelRe = /\b(grand\s+total|order\s+total|total\s+charged|total\s+due|amount\s+due|balance\s+due|total\s+amount|sale\s+total|total\s+payment|amount\s+paid|total|balance|charge)\b/i;
  const amountRe = /\$?([\d,]+\.\d{2})/;

  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue;
    for (let offset = 0; offset <= 2; offset++) {
      const target = lines[i + offset];
      if (!target) break;
      const m = target.match(amountRe);
      if (m) {
        const v = parseAmount(m[1]);
        if (v > 0 && v < 99999) return v;
      }
    }
  }

  // ── Tier 4: Last resort — largest dollar amount on the page ───────────────
  // Works for simple email receipts where the total is the only prominently
  // displayed amount (e.g. "Your total is $12.50" in a PayPal notification)
  const allAmounts = [...norm.matchAll(/\$?([\d,]+\.\d{2})/g)]
    .map((m) => parseAmount(m[1]))
    .filter((v) => v > 0 && v < 99999);
  if (allAmounts.length > 0) return Math.max(...allAmounts);

  return null;
}

/**
 * Extract merchant/store name from OCR text.
 * Handles both paper receipts and email/digital receipts.
 */
export function extractMerchant(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2);

  // ── Email receipt: look for "From: Merchant Name" or "receipt from X" ──────
  for (const line of lines.slice(0, 15)) {
    // "From: Amazon.com" or "From: Uber Receipts"
    const fromMatch = line.match(/^from\s*[:\-]\s*(.+)/i);
    if (fromMatch) return fromMatch[1].replace(/<[^>]+>/g, "").trim();

    // "Your receipt from Starbucks"
    const receiptFromMatch = line.match(/receipt\s+from\s+(.+)/i);
    if (receiptFromMatch) return receiptFromMatch[1].trim();

    // "Thank you for your [order/purchase] at/from/with X"
    const thankMatch = line.match(/(?:order|purchase|shopping)\s+(?:at|from|with)\s+(.+)/i);
    if (thankMatch) return thankMatch[1].trim();
  }

  // ── Paper receipt: store name is typically in the first few lines ──────────
  const skipRe = /^(receipt|welcome|thank|store\s*#|invoice|order\s*#|date|time|tel|phone|www\.|http|cashier|server|table|guest)/i;
  const addressRe = /\d{2,}\s+(st|ave|blvd|rd|dr|ln|way|ct|street|avenue|road)/i;
  const phoneRe = /[\d\-().]{7,}/;
  const numberOnlyRe = /^[\d\s\-#]+$/;

  for (const line of lines.slice(0, 8)) {
    if (skipRe.test(line)) continue;
    if (addressRe.test(line)) continue;
    if (phoneRe.test(line)) continue;
    if (numberOnlyRe.test(line)) continue;
    if (line.length < 3) continue;
    return line;
  }

  return lines[0] ?? "Unknown";
}

/**
 * Full pipeline: base64 image → ParsedReceipt
 */
export async function parseReceipt(base64Image: string): Promise<ParsedReceipt> {
  const rawText = await ocrReceiptImage(base64Image);

  const amount = extractTotal(rawText);
  const description = extractMerchant(rawText);
  const category = classifyMerchant(description);
  const date = new Date().toISOString().split("T")[0]; // today's date, user can correct

  if (amount === null) {
    throw new Error("Could not detect a total amount on this receipt");
  }

  return { date, amount, description, category, rawText };
}
