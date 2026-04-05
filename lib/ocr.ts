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
 * Handles patterns like:
 *   TOTAL         $42.17
 *   Total:        42.17
 *   AMOUNT DUE    $123.00
 *   BALANCE DUE   $58.99
 */
export function extractTotal(text: string): number | null {
  const lines = text.split("\n").map((l) => l.trim());

  // Priority patterns — most specific first
  const totalPatterns = [
    /(?:grand\s+total|total\s+due|amount\s+due|balance\s+due|total\s+amount)[^\d]*\$?([\d,]+\.\d{2})/i,
    /\btotal\b[^\d]*\$?([\d,]+\.\d{2})/i,
    /\bbalance\b[^\d]*\$?([\d,]+\.\d{2})/i,
  ];

  // First try full-text patterns
  for (const pattern of totalPatterns) {
    const match = text.match(pattern);
    if (match) {
      const value = parseFloat(match[1].replace(",", ""));
      if (value > 0) return value;
    }
  }

  // Then scan line by line — look for TOTAL label followed by a dollar amount on the same or next line
  for (let i = 0; i < lines.length; i++) {
    if (/\b(total|balance due|amount due)\b/i.test(lines[i])) {
      // Dollar amount on same line
      const sameLineMatch = lines[i].match(/\$?([\d,]+\.\d{2})/);
      if (sameLineMatch) {
        return parseFloat(sameLineMatch[1].replace(",", ""));
      }
      // Dollar amount on next line
      if (i + 1 < lines.length) {
        const nextLineMatch = lines[i + 1].match(/\$?([\d,]+\.\d{2})/);
        if (nextLineMatch) {
          return parseFloat(nextLineMatch[1].replace(",", ""));
        }
      }
    }
  }

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
