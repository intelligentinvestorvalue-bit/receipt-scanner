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
 * Extract total amount from OCR text.
 * Handles many real-world receipt formats:
 *   TOTAL         $42.17
 *   Total:        42.17
 *   TOTAL - $58.99
 *   TOTAL.....$12.00
 *   AMOUNT DUE    $123.00
 *   BALANCE DUE   $58.99
 *   Total Amount Due: $9.75
 *   Sale Total    8.49
 *   T O T A L     15.00   (spaced letters)
 */
export function extractTotal(text: string): number | null {
  const lines = text.split("\n").map((l) => l.trim());

  // Normalise spaced letters like "T O T A L" → "TOTAL"
  const normalised = text.replace(/\b([A-Z])(?:\s+([A-Z])){2,}\b/g, (m) =>
    m.replace(/\s+/g, "")
  );

  // Separator between label and amount: spaces, dashes, dots, colons, or any combo
  const sep = "[\\s\\-.:_*]+";

  // Priority patterns — most specific first
  const totalPatterns = [
    new RegExp(`(?:grand\\s+total|total\\s+due|amount\\s+due|balance\\s+due|total\\s+amount(?:\\s+due)?)${sep}\\$?([\\d,]+\\.\\d{2})`, "i"),
    new RegExp(`(?:sale\\s+total|subtotal\\s+due|net\\s+total)${sep}\\$?([\\d,]+\\.\\d{2})`, "i"),
    new RegExp(`\\btotal\\b${sep}\\$?([\\d,]+\\.\\d{2})`, "i"),
    new RegExp(`\\bbalance\\b${sep}\\$?([\\d,]+\\.\\d{2})`, "i"),
    new RegExp(`\\bamount\\b${sep}\\$?([\\d,]+\\.\\d{2})`, "i"),
  ];

  // Try normalised full-text patterns
  for (const pattern of totalPatterns) {
    const match = normalised.match(pattern);
    if (match) {
      const value = parseFloat(match[1].replace(/,/g, ""));
      if (value > 0) return value;
    }
  }

  // Line-by-line scan — label on one line, amount on same line or up to 2 lines below
  const totalLabelRe = /\b(grand\s+total|total\s+due|amount\s+due|balance\s+due|total\s+amount|sale\s+total|total|balance|amount\s+paid)\b/i;
  const amountRe = /\$?([\d,]+\.\d{2})/;

  for (let i = 0; i < lines.length; i++) {
    const normLine = lines[i].replace(/\b([A-Z])(?:\s+([A-Z])){2,}\b/g, (m) => m.replace(/\s+/g, ""));
    if (!totalLabelRe.test(normLine)) continue;

    // Check same line first, then next 2 lines
    for (let offset = 0; offset <= 2; offset++) {
      const target = lines[i + offset];
      if (!target) break;
      const m = target.match(amountRe);
      if (m) {
        const value = parseFloat(m[1].replace(/,/g, ""));
        // Sanity check: plausible receipt total ($0.01 – $9,999)
        if (value > 0 && value < 10000) return value;
      }
    }
  }

  // Last resort: find the largest dollar amount on the page
  // (total is usually the biggest number on a receipt)
  const allAmounts = [...normalised.matchAll(/\$([\d,]+\.\d{2})/g)]
    .map((m) => parseFloat(m[1].replace(/,/g, "")))
    .filter((v) => v > 0 && v < 10000);
  if (allAmounts.length > 0) return Math.max(...allAmounts);

  return null;
}

/**
 * Extract merchant/store name from OCR text.
 * Receipts almost always print the store name in the first 1-3 lines.
 */
export function extractMerchant(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2);

  // Skip very short lines and lines that look like addresses (numbers + street words)
  const addressPattern = /\d{2,}\s+(st|ave|blvd|rd|dr|ln|way|ct|street|avenue|road)/i;
  const phonePattern = /[\d\-().]{7,}/;

  for (const line of lines.slice(0, 5)) {
    if (addressPattern.test(line)) continue;
    if (phonePattern.test(line)) continue;
    if (/^(receipt|welcome|thank you|store)/i.test(line)) continue;
    // Likely the merchant name
    return line;
  }

  return lines[0] ?? "Unknown Store";
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
