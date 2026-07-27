import { google } from "googleapis";
import { ExpenseCategory } from "./categories";
import { appendToSheet, getGoogleAuth, resolveSpreadsheetId } from "./sheets";
import { buildGmailPendingScript } from "./gmail-script";

/**
 * Pending email charges live on a "Pending" tab of this month's budget spreadsheet
 * (same file the scanner already uses — already shared with the service account).
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
  spreadsheetName: string;
  /** True when the Pending tab was created on this request. */
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

const DRIVE_SHEETS_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

const SCRIPT_SCOPES = [
  ...DRIVE_SHEETS_SCOPES,
  "https://www.googleapis.com/auth/script.projects",
];

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function authFor(scopes: string[]) {
  return getGoogleAuth(scopes);
}

function sheetsClient(scopes: string[] = DRIVE_SHEETS_SCOPES) {
  return google.sheets({ version: "v4", auth: authFor(scopes) });
}

function currentMonthYear(): { month: string; year: string; label: string } {
  const now = new Date();
  const monthIdx = now.getMonth();
  const month = String(monthIdx + 1).padStart(2, "0");
  const year = String(now.getFullYear());
  return {
    month,
    year,
    label: `Monthly Budget_${MONTH_ABBR[monthIdx]}_${year}`,
  };
}

/**
 * Resolve this month's budget spreadsheet (or GOOGLE_PENDING_SHEET_ID /
 * GOOGLE_SHEET_ID override).
 */
async function resolveMonthlySpreadsheetId(): Promise<{
  spreadsheetId: string;
  label: string;
}> {
  if (process.env.GOOGLE_PENDING_SHEET_ID) {
    return {
      spreadsheetId: process.env.GOOGLE_PENDING_SHEET_ID,
      label: "GOOGLE_PENDING_SHEET_ID",
    };
  }

  const { month, year, label } = currentMonthYear();
  const auth = authFor([
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
  ]);
  const spreadsheetId = await resolveSpreadsheetId(auth, month, year);
  return { spreadsheetId, label };
}

/**
 * Ensure the Pending tab exists with header row. Returns true if the tab was
 * newly created.
 */
async function ensurePendingTabAndHeaders(
  spreadsheetId: string
): Promise<boolean> {
  const sheets = sheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const titles = (meta.data.sheets ?? []).map((s) => s.properties?.title ?? "");
  let tabCreated = false;

  if (!titles.includes(PENDING_TAB)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: PENDING_TAB } } }],
      },
    });
    tabCreated = true;
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

  return tabCreated;
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
 * Find this month's budget spreadsheet, ensure a Pending tab + headers exist,
 * and prepare Apps Script text. Called on first load of the pending page.
 */
export async function ensurePendingBootstrap(): Promise<PendingBootstrap> {
  const { spreadsheetId, label } = await resolveMonthlySpreadsheetId();
  const created = await ensurePendingTabAndHeaders(spreadsheetId);

  const script = buildGmailPendingScript(spreadsheetId);
  // Service accounts usually cannot own Apps Script projects. Only attempt when
  // the Pending tab is first created; UI always offers a pre-filled copy/paste script.
  const scriptInstall = created
    ? await tryInstallAppsScript(spreadsheetId, script)
    : {
        attempted: false,
        ok: false,
        message:
          "Pending tab ready on this month's budget sheet. If Apps Script is not attached yet, copy the script below into Extensions → Apps Script, run once, then add a time trigger.",
      };

  return {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    spreadsheetName: label,
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
    gmailMessageId: (row[6] ?? "").trim().replace(/^gid:/i, "").replace(/^'/, ""),
    createdAt: (row[7] ?? "").trim(),
    snippet: (row[8] ?? "").trim(),
  };
}

async function resolvePendingId(): Promise<string> {
  const boot = await ensurePendingBootstrap();
  return boot.spreadsheetId;
}

/** List rows with Status = pending (ensures Pending tab exists first). */
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
