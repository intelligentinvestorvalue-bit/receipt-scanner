import { google } from "googleapis";
import { ExpenseCategory } from "./categories";
import {
  appendToSheet,
  getGoogleAuth,
} from "./sheets";

/**
 * Pending email charges live in a dedicated spreadsheet (free — just another Sheet).
 *
 * Tab: Pending
 * Columns:
 *   A Date (YYYY-MM-DD)
 *   B Amount
 *   C Description
 *   D Category
 *   E Source (From / Subject)
 *   F Status (pending | approved | discarded)
 *   G GmailMessageId
 *   H CreatedAt (ISO)
 *   I Snippet
 */

export const PENDING_TAB = "Pending";
export const PENDING_RANGE = `${PENDING_TAB}!A:I`;

export type PendingStatus = "pending" | "approved" | "discarded";

export interface PendingItem {
  /** 1-based sheet row number (includes header row offset; data starts at 2). */
  rowNumber: number;
  date: string;
  amount: number;
  description: string;
  category: string;
  source: string;
  status: PendingStatus;
  gmailMessageId: string;
  createdAt: string;
  snippet: string;
}

function pendingSpreadsheetId(): string {
  const id = process.env.GOOGLE_PENDING_SHEET_ID;
  if (!id) {
    throw new Error(
      "GOOGLE_PENDING_SHEET_ID is not set. Create a Sheet named for pending email charges and put its ID in the env."
    );
  }
  return id;
}

function sheetsClient() {
  const auth = getGoogleAuth([
    "https://www.googleapis.com/auth/spreadsheets",
  ]);
  return google.sheets({ version: "v4", auth });
}

function parseAmount(raw: unknown): number {
  if (typeof raw === "number") return raw;
  const s = String(raw ?? "").replace(/[$,]/g, "").trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function normalizeDate(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function rowToItem(rowNumber: number, row: string[]): PendingItem | null {
  const status = (row[5] ?? "pending").toLowerCase().trim() as PendingStatus;
  if (status !== "pending") return null;

  return {
    rowNumber,
    date: normalizeDate(row[0] ?? ""),
    amount: parseAmount(row[1]),
    description: (row[2] ?? "").trim() || "Email charge",
    category: (row[3] ?? "Personal").trim() || "Personal",
    source: (row[4] ?? "").trim(),
    status,
    gmailMessageId: (row[6] ?? "").trim(),
    createdAt: (row[7] ?? "").trim(),
    snippet: (row[8] ?? "").trim(),
  };
}

/** List rows with Status = pending. */
export async function listPendingItems(): Promise<PendingItem[]> {
  const sheets = sheetsClient();
  const spreadsheetId = pendingSpreadsheetId();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: PENDING_RANGE,
  });

  const rows = res.data.values ?? [];
  if (rows.length <= 1) return [];

  const items: PendingItem[] = [];
  for (let i = 1; i < rows.length; i++) {
    const item = rowToItem(i + 1, rows[i] as string[]);
    if (item) items.push(item);
  }
  // Newest first when CreatedAt present
  items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return items;
}

async function updatePendingStatus(
  rowNumber: number,
  status: PendingStatus
): Promise<void> {
  const sheets = sheetsClient();
  const spreadsheetId = pendingSpreadsheetId();
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${PENDING_TAB}!F${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[status]] },
  });
}

/** Approve: append to monthly Transactions, then mark Pending row approved. */
export async function approvePendingItem(input: {
  rowNumber: number;
  date: string;
  amount: number;
  description: string;
  category: ExpenseCategory;
}): Promise<void> {
  await appendToSheet({
    date: input.date,
    amount: input.amount,
    description: input.description,
    category: input.category,
    rawText: "",
    amountCandidates: [input.amount],
    needsAmount: false,
  });
  await updatePendingStatus(input.rowNumber, "approved");
}

/** Discard: mark Pending row discarded (does not touch Transactions). */
export async function discardPendingItem(rowNumber: number): Promise<void> {
  await updatePendingStatus(rowNumber, "discarded");
}
