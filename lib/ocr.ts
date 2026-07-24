import { classifyMerchant, ExpenseCategory } from "./categories";

export interface ParsedReceipt {
  date: string;           // YYYY-MM-DD
  amount: number;         // numeric total (0 if undetected)
  description: string;    // merchant / store name
  category: ExpenseCategory;
  rawText: string;        // full OCR text for debugging
  /** Distinct amount candidates, preferred first. Empty if none found. */
  amountCandidates: number[];
  /** True when OCR ran but no confident total was found. */
  needsAmount: boolean;
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

function pushUnique(list: number[], value: number) {
  if (!list.includes(value)) list.push(value);
}

/**
 * Collect amount candidates from OCR text (preferred first).
 * Used for disambiguation when multiple plausible totals appear.
 */
export function extractAmountCandidates(text: string): number[] {
  const norm = normaliseText(text);
  const lines = norm.split("\n").map((l) => l.trim());
  const preferred: number[] = [];
  const secondary: number[] = [];

  const sep = "[\\s\\-.:_*|]+";
  const amt = "\\$?([\\d,]+\\.\\d{2})";

  const tier1 = [
    `(?:order|transaction|invoice)\\s+total${sep}${amt}`,
    `total\\s+(?:charged|billed|payment|amount|due|cost)${sep}${amt}`,
    `(?:amount|total)\\s+charged${sep}${amt}`,
    `charged\\s+to\\s+(?:your\\s+)?(?:card|account|visa|mastercard|amex)${sep}${amt}`,
    `you\\s+(?:were\\s+)?(?:charged|paid|billed)${sep}${amt}`,
    `payment\\s+(?:of|total|amount)${sep}${amt}`,
    `total\\s+payment${sep}${amt}`,
    `amount\\s+paid${sep}${amt}`,
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
      if (v > 0 && v < 99999) pushUnique(preferred, v);
    }
  }

  const tier2 = [
    `\\btotal\\b${sep}${amt}`,
    `\\bcharge\\b${sep}${amt}`,
    `\\bbalance\\b${sep}${amt}`,
  ];

  for (const pattern of tier2) {
    const m = norm.match(new RegExp(pattern, "i"));
    if (m) {
      const v = parseAmount(m[1]);
      if (v > 0 && v < 99999) pushUnique(preferred, v);
    }
  }

  const labelRe =
    /\b(grand\s+total|order\s+total|total\s+charged|total\s+due|amount\s+due|balance\s+due|total\s+amount|sale\s+total|total\s+payment|amount\s+paid|total|balance|charge)\b/i;
  const amountRe = /\$?([\d,]+\.\d{2})/;

  for (let i = 0; i < lines.length; i++) {
    if (!labelRe.test(lines[i])) continue;
    for (let offset = 0; offset <= 2; offset++) {
      const target = lines[i + offset];
      if (!target) break;
      const m = target.match(amountRe);
      if (m) {
        const v = parseAmount(m[1]);
        if (v > 0 && v < 99999) pushUnique(preferred, v);
      }
    }
  }

  const allAmounts = [...norm.matchAll(/\$?([\d,]+\.\d{2})/g)]
    .map((m) => parseAmount(m[1]))
    .filter((v) => v > 0 && v < 99999)
    .sort((a, b) => b - a);

  for (const v of allAmounts) pushUnique(secondary, v);

  const merged: number[] = [];
  for (const v of preferred) pushUnique(merged, v);
  for (const v of secondary) pushUnique(merged, v);
  return merged.slice(0, 6);
}

/**
 * Extract the best single total from OCR text, or null if none found.
 */
export function extractTotal(text: string): number | null {
  const candidates = extractAmountCandidates(text);
  return candidates[0] ?? null;
}

/**
 * Extract date from OCR text.
 * Returns YYYY-MM-DD string, or null if not found.
 *
 * Handles:
 *   Labeled:  "Date: 04/05/2026"  "Order Date: April 5, 2026"
 *   ISO:      "2026-04-05"
 *   US:       "04/05/2026"  "04-05-2026"  "04.05.2026"
 *   Long:     "April 5, 2026"  "Apr 5 2026"  "5 April 2026"
 *   Short yr: "04/05/26"
 */
export function extractDate(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim());

  const MONTH_MAP: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };
  const MONTH_NAMES = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

  function toISO(year: string, month: string, day: string): string | null {
    const y = year.length === 2 ? `20${year}` : year;
    const m = month.padStart(2, "0");
    const d = day.padStart(2, "0");
    if (isNaN(Date.parse(`${y}-${m}-${d}`))) return null;
    return `${y}-${m}-${d}`;
  }

  function tryParse(s: string): string | null {
    let m: RegExpMatchArray | null;

    // ISO: 2026-04-05
    m = s.match(/\b(20\d{2})[-\/](0?[1-9]|1[0-2])[-\/](0?[1-9]|[12]\d|3[01])\b/);
    if (m) return toISO(m[1], m[2], m[3]);

    // US: MM/DD/YYYY or MM-DD-YYYY or MM.DD.YYYY (short or long year)
    m = s.match(/\b(0?[1-9]|1[0-2])[\/\-\.](0?[1-9]|[12]\d|3[01])[\/\-\.](20\d{2}|\d{2})\b/);
    if (m) return toISO(m[3], m[1], m[2]);

    // "April 5, 2026" or "Apr 5 2026" or "April 5th, 2026"
    m = s.match(new RegExp(`\\b(${MONTH_NAMES})[.\\s,]+(\\d{1,2})(?:st|nd|rd|th)?[,\\s]+(20\\d{2})\\b`, "i"));
    if (m) {
      const mon = MONTH_MAP[m[1].toLowerCase().slice(0, 3)];
      if (mon) return toISO(m[m.length - 1], mon, m[m.length - 2]);
    }

    // "5 April 2026" or "5th April 2026"
    m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[.\\s]+(${MONTH_NAMES})[.\\s,]+(20\\d{2})\\b`, "i"));
    if (m) {
      const mon = MONTH_MAP[m[2].toLowerCase().slice(0, 3)];
      if (mon) return toISO(m[m.length - 1], mon, m[1]);
    }

    return null;
  }

  // Tier 1: labeled date lines ("Date: ...", "Order Date: ...")
  const labelRe = /^(?:date|purchase\s+date|transaction\s+date|order\s+date|invoice\s+date|receipt\s+date|sale\s+date|visit\s+date|posted|billing\s+date)\s*[:\-]\s*(.+)/i;
  for (const line of lines) {
    const lm = line.match(labelRe);
    if (lm) {
      const result = tryParse(lm[1]);
      if (result) return result;
    }
  }

  // Tier 2: scan every line for any recognisable date pattern
  for (const line of lines) {
    const result = tryParse(line);
    if (result) return result;
  }

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
 * Does not throw when amount is missing — sets needsAmount and returns candidates.
 */
export async function parseReceipt(base64Image: string): Promise<ParsedReceipt> {
  const rawText = await ocrReceiptImage(base64Image);

  const amountCandidates = extractAmountCandidates(rawText);
  const amount = amountCandidates[0] ?? 0;
  const description = extractMerchant(rawText);
  const category = classifyMerchant(description);
  const date = extractDate(rawText) ?? new Date().toISOString().split("T")[0];

  return {
    date,
    amount,
    description,
    category,
    rawText,
    amountCandidates,
    needsAmount: amountCandidates.length === 0,
  };
}
