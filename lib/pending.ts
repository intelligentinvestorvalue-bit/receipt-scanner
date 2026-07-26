import { google } from "googleapis";
import { ExpenseCategory } from "./categories";
import { appendToSheet, getGoogleAuth } from "./sheets";
import { buildGmailPendingScript } from "./gmail-script";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

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

export const PENDING_SHEET_TITLE = "Receipt Scanner Pending";
export const PENDING_TAB = "Pending";
export const PENDING_RANGE = `${PENDING_TAB}!A:I`;

export const PENDING_HEADERS = [
  "Date",
  "Amount",
  "Description",
  "Category",
  "Source",
  "Status",
  "GmailMessageId",
  "CreatedAt",
  "Snippet",
] as const;

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

export interface PendingBootstrap {
  spreadsheetId: string;
  spreadsheetUrl: string;
  created: boolean;
  script: string;
  /** Apps Script API install attempt result (service accounts usually cannot own scripts). */
  scriptInstall: {
    attempted: boolean;
    ok: boolean;
    scriptId?: string;
    message: string;
  };
}

const TMP_DIR = "/tmp/receipt-scanner";
const PENDING_ID_CACHE = join(TMP_DIR, "pending-sheet-id.json");

const DRIVE_SHEETS_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

const SCRIPT_SCOPES = [
  ...DRIVE_SHEETS_SCOPES,
  "https://www.googleapis.com/auth/script.projects",
];

function readCachedPendingId(): string | null {
  try {
    const data = JSON.parse(readFileSync(PENDING_ID_CACHE, "utf8")) as {
      id?: string;
    };
    return data.id ?? null;
  } catch {
    return null;
  }
}

function writeCachedPendingId(id: string) {
  try {
    mkdirSync(TMP_DIR, { recursive: true });
    writeFileSync(PENDING_ID_CACHE, JSON.stringify({ id }));
  } catch {
    /* non-fatal */
  }
}

function authFor(scopes: string[]) {
  return getGoogleAuth(scopes);
}

function sheetsClient(scopes: string[] = DRIVE_SHEETS_SCOPES) {
  return google.sheets({ version: "v4", auth: authFor(scopes) });
}

function driveClient(scopes: string[] = DRIVE_SHEETS_SCOPES) {
  return google.drive({ version: "v3", auth: authFor(scopes) });
}

async function findPendingSpreadsheetId(): Promise<string | null> {
  if (process.env.GOOGLE_PENDING_SHEET_ID) {
    return process.env.GOOGLE_PENDING_SHEET_ID;
  }

  const cached = readCachedPendingId();
  if (cached) return cached;

  const drive = driveClient();
  const q =
    `name = '${PENDING_SHEET_TITLE}' and ` +
    `mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const res = await drive.files.list({
    q,
    fields: "files(id, name)",
    pageSize: 5,
  });
  const id = res.data.files?.[0]?.id ?? null;
  if (id) writeCachedPendingId(id);
  return id;
}

async function ensurePendingTabAndHeaders(spreadsheetId: string): Promise<void> {
  const sheets = sheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const titles = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? "");
  if (!titles.includes(PENDING_TAB)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: PENDING_TAB } } }],
      },
    });
  }

  const headerRes = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${PENDING_TAB}!A1:I1`,
  });
  const existing = headerRes.data.values?.[0] ?? [];
  const needsHeaders =
    existing.length === 0 ||
    PENDING_HEADERS.some((h, i) => (existing[i] ?? "") !== h);

  if (needsHeaders) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${PENDING_TAB}!A1:I1`,
      valueInputOption: "RAW",
      requestBody: { values: [Array.from(PENDING_HEADERS)] },
    });
  }
}

async function shareWithOwner(spreadsheetId: string): Promise<void> {
  const ownerEmail = process.env.GOOGLE_OWNER_EMAIL;
  if (!ownerEmail) return;

  const drive = driveClient();
  try {
    await drive.permissions.create({
      fileId: spreadsheetId,
      transferOwnership: true,
      sendNotificationEmail: false,
      requestBody: {
        type: "user",
        role: "owner",
        emailAddress: ownerEmail,
      },
    });
  } catch {
    // Transfer may fail if SA isn't allowed to transfer; fall back to writer share.
    try {
      await drive.permissions.create({
        fileId: spreadsheetId,
        sendNotificationEmail: false,
        requestBody: {
          type: "user",
          role: "writer",
          emailAddress: ownerEmail,
        },
      });
    } catch {
      /* already shared or non-fatal */
    }
  }
}

async function createPendingSpreadsheet(): Promise<string> {
  const sheets = sheetsClient();
  const created = await sheets.spreadsheets.create({
    requestBody: {
      properties: { title: PENDING_SHEET_TITLE },
      sheets: [{ properties: { title: PENDING_TAB } }],
    },
    fields: "spreadsheetId",
  });
  const id = created.data.spreadsheetId;
  if (!id) throw new Error("Failed to create Pending spreadsheet");

  await sheets.spreadsheets.values.update({
    spreadsheetId: id,
    range: `${PENDING_TAB}!A1:I1`,
    valueInputOption: "RAW",
    requestBody: { values: [Array.from(PENDING_HEADERS)] },
  });

  await shareWithOwner(id);
  writeCachedPendingId(id);
  return id;
}

/**
 * Try to attach Apps Script via API. Service accounts usually cannot own
 * script projects — failures are expected; UI falls back to copy/paste.
 */
async function tryInstallAppsScript(
  spreadsheetId: string,
  source: string
): Promise<PendingBootstrap["scriptInstall"]> {
  try {
    const auth = authFor(SCRIPT_SCOPES);
    const script = google.script({ version: "v1", auth });
    const project = await script.projects.create({
      requestBody: {
        title: "Gmail to Pending",
        parentId: spreadsheetId,
      },
    });
    const scriptId = project.data.scriptId;
    if (!scriptId) {
      return {
        attempted: true,
        ok: false,
        message:
          "Apps Script API created no scriptId. Paste the script via Extensions → Apps Script.",
      };
    }

    await script.projects.updateContent({
      scriptId,
      requestBody: {
        files: [
          {
            name: "Code",
            type: "SERVER_JS",
            source,
          },
          {
            name: "appsscript",
            type: "JSON",
            source: JSON.stringify({
              timeZone: "America/Chicago",
              exceptionLogging: "STACKDRIVER",
              runtimeVersion: "V8",
            }),
          },
        ],
      },
    });

    return {
      attempted: true,
      ok: true,
      scriptId,
      message:
        "Script project created on the sheet. Open Extensions → Apps Script, run processCardAlertEmails once, and authorize Gmail.",
    };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Apps Script API install failed";
    return {
      attempted: true,
      ok: false,
      message:
        `Could not auto-attach Apps Script (${message}). ` +
        `This is normal for service accounts — use Copy script below, then Extensions → Apps Script on the sheet.`,
    };
  }
}

/**
 * Find or create the Pending spreadsheet, ensure headers, prepare Apps Script text.
 * Called on first load of the pending page.
 */
export async function ensurePendingBootstrap(): Promise<PendingBootstrap> {
  let created = false;
  let spreadsheetId = await findPendingSpreadsheetId();
  if (!spreadsheetId) {
    spreadsheetId = await createPendingSpreadsheet();
    created = true;
  } else {
    await ensurePendingTabAndHeaders(spreadsheetId);
    // Keep owner shared even for pre-existing sheets
    await shareWithOwner(spreadsheetId);
    writeCachedPendingId(spreadsheetId);
  }

  const script = buildGmailPendingScript(spreadsheetId);
  // Service accounts usually cannot own Apps Script projects. Only attempt once
  // when the sheet is first created; UI always offers a pre-filled copy/paste script.
  const scriptInstall = created
    ? await tryInstallAppsScript(spreadsheetId, script)
    : {
        attempted: false,
        ok: false,
        message:
          "Sheet ready. If Apps Script is not attached yet, copy the script below into Extensions → Apps Script, run once, then add a time trigger.",
      };

  return {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    created,
    script,
    scriptInstall,
  };
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

async function resolvePendingId(): Promise<string> {
  const boot = await ensurePendingBootstrap();
  return boot.spreadsheetId;
}

/** List rows with Status = pending (ensures sheet exists first). */
export async function listPendingItems(): Promise<{
  items: PendingItem[];
  bootstrap: PendingBootstrap;
}> {
  const bootstrap = await ensurePendingBootstrap();
  const sheets = sheetsClient();

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: bootstrap.spreadsheetId,
    range: PENDING_RANGE,
  });

  const rows = res.data.values ?? [];
  if (rows.length <= 1) {
    return { items: [], bootstrap };
  }

  const items: PendingItem[] = [];
  for (let i = 1; i < rows.length; i++) {
    const item = rowToItem(i + 1, rows[i] as string[]);
    if (item) items.push(item);
  }
  items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return { items, bootstrap };
}

async function updatePendingStatus(
  rowNumber: number,
  status: PendingStatus
): Promise<void> {
  const spreadsheetId = await resolvePendingId();
  const sheets = sheetsClient();
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
