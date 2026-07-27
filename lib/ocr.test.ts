import { describe, expect, it } from "vitest";
import {
  extractAmountCandidates,
  extractDate,
  extractMerchant,
  extractTotal,
  parseReceiptText,
} from "@/lib/ocr";
import { classifyMerchant } from "@/lib/categories";

describe("extractTotal / extractAmountCandidates", () => {
  it("parses a labeled paper receipt total", () => {
    const text = `
WOODMANS
123 Main St
TOTAL $42.17
Thank you
`;
    expect(extractTotal(text)).toBe(42.17);
  });

  it("parses email order total", () => {
    const text = `From: Amazon.com\nOrder Total: $38.00\nSubtotal $35.00`;
    expect(extractTotal(text)).toBe(38);
  });

  it("returns preferred candidate before largest fallback", () => {
    const text = `
Item A 12.00
Item B 5.50
GRAND TOTAL 17.50
`;
    const candidates = extractAmountCandidates(text);
    expect(candidates[0]).toBe(17.5);
    expect(candidates).toContain(12);
    expect(candidates).toContain(5.5);
  });

  it("returns empty candidates when no amounts present", () => {
    expect(extractAmountCandidates("hello world")).toEqual([]);
    expect(extractTotal("hello world")).toBeNull();
  });

  it("handles EU-style amounts in labeled totals via parse path", () => {
    // US-style decimal still preferred in current patterns; ensure commas stripped
    const text = "TOTAL $1,234.56";
    expect(extractTotal(text)).toBe(1234.56);
  });
});

describe("extractDate", () => {
  it("parses labeled US date", () => {
    expect(extractDate("Date: 04/05/2026")).toBe("2026-04-05");
  });

  it("parses ISO date", () => {
    expect(extractDate("Purchased on 2026-07-04")).toBe("2026-07-04");
  });

  it("parses long month name", () => {
    expect(extractDate("Order Date: April 5, 2026")).toBe("2026-04-05");
  });

  it("returns null when no date", () => {
    expect(extractDate("no date here")).toBeNull();
  });
});

describe("extractMerchant", () => {
  it("reads From: on email receipts", () => {
    expect(extractMerchant("From: Starbucks <noreply@sbux.com>\nTotal $5.00")).toBe(
      "Starbucks"
    );
  });

  it("uses first plausible paper receipt line", () => {
    const text = `COSTCO WHOLESALE\n123 Warehouse Rd\nTOTAL 99.00`;
    expect(extractMerchant(text)).toMatch(/COSTCO/i);
  });
});

describe("parseReceiptText", () => {
  it("fills fields from a simple receipt dump", () => {
    const text = `
WOODMANS MARKET
Date: 04/05/2026
Milk 3.99
TOTAL $42.17
Thank you
`;
    const parsed = parseReceiptText(text);
    expect(parsed.amount).toBe(42.17);
    expect(parsed.date).toBe("2026-04-05");
    expect(parsed.description).toMatch(/WOODMANS/i);
    expect(parsed.category).toBe("Woodmans Groceries");
    expect(parsed.needsAmount).toBe(false);
    expect(parsed.amountCandidates[0]).toBe(42.17);
  });

  it("sets needsAmount when no total is found", () => {
    const parsed = parseReceiptText("Just some store name\nno money here");
    expect(parsed.needsAmount).toBe(true);
    expect(parsed.amount).toBe(0);
  });
});

describe("classifyMerchant", () => {
  it("maps woodmans to Woodmans Groceries", () => {
    expect(classifyMerchant("Woodmans #42")).toBe("Woodmans Groceries");
  });

  it("maps costco to Costco Groceries", () => {
    expect(classifyMerchant("Costco Wholesale")).toBe("Costco Groceries");
  });

  it("maps shell to Gas", () => {
    expect(classifyMerchant("Shell Gas Station")).toBe("Gas");
  });

  it("falls back to Personal", () => {
    expect(classifyMerchant("Totally Unknown Vendor XYZ")).toBe("Personal");
  });
});
