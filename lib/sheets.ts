import { google } from "googleapis";
import { ParsedReceipt } from "./ocr";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// Cache spreadsheet IDs in /tmp so warm serverless instances skip the Drive API call.
const TMP_DIR = "/tmp/receipt-scanner";
const CACHE_FILE = join(TMP_DIR, "sheet-id-cache.json");

function readCache(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeCache(cache: Record<string, string>) {
  try {
    mkdirSync(TMP_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch { /* non-fatal */ }
}

/**
 * Uses Google Drive API to find this month's spreadsheet by name.
 * Tries 4 case-insensitive name variants, e.g.:
 *   "Monthly Budget_Apr_2026", "Monthly budget_Apr_2026",
 *   "Monthly Budget_April_2026", "Monthly budget_April_2026"
 *
 * Falls back to GOOGLE_SHEET_ID env var if set (manual override).
 * Throws if nothing is found.
 */
async function resolveSpreadsheetId(
  auth: InstanceType<typeof google.auth.JWT>,
  month: string,
  year: string
): Promise<string> {
  // Manual override always wins — skip cache and Drive lookup entirely
  if (process.env.GOOGLE_SHEET_ID) return process.env.GOOGLE_SHEET_ID;

  // Return cached ID if we already resolved this month
  const cacheKey = `${year}-${month}`;
  const cachedMap = readCache();
  if (cachedMap[cacheKey]) return cachedMap[cacheKey];

  const idx = parseInt(month) - 1;
  const nameCandidates = [
    `Monthly Budget_${MONTH_ABBR[idx]}_${year}`,
    `Monthly budget_${MONTH_ABBR[idx]}_${year}`,
    `Monthly Budget_${MONTH_FULL[idx]}_${year}`,
    `Monthly budget_${MONTH_FULL[idx]}_${year}`,
  ];

  // Build Drive query: name = 'X' or name = 'Y' ...
  const nameFilters = nameCandidates
    .map((n) => `name = '${n}'`)
    .join(" or ");
  const query = `(${nameFilters}) and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;

  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    pageSize: 5,
  });

  const files = res.data.files ?? [];
  if (files.length === 0) {
    throw new Error(
      `No spreadsheet found for ${MONTH_ABBR[idx]} ${year}. ` +
      `Expected a name like "${nameCandidates[0]}". ` +
      `Make sure it's shared with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`
    );
  }

  // Prefer exact match order; Drive query is case-sensitive so first result is fine
  const resolvedId = files[0].id!;
  const cache = readCache();
  cache[cacheKey] = resolvedId;
  writeCache(cache);
  return resolvedId;
}

/**
 * Appends one row to the "Transactions" tab of this month's spreadsheet.
 *
 * Spreadsheet is auto-discovered via Drive API by name (e.g. "Monthly Budget_Apr_2026").
 * Set GOOGLE_SHEET_ID in .env.local to override with a specific spreadsheet ID.
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  — from your service account JSON
 *   GOOGLE_PRIVATE_KEY            — from your service account JSON (with \n for newlines)
 *   GOOGLE_SHEET_ID               — (optional) hard-coded spreadsheet ID override
 */
export async function appendToSheet(receipt: ParsedReceipt): Promise<void> {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ],
  });

  // Format: Date as M/D/YYYY to match your existing sheet style (e.g. 4/1/2026)
  const [year, month, day] = receipt.date.split("-");
  const formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;
  const formattedAmount = receipt.amount.toFixed(2);

  const spreadsheetId = await resolveSpreadsheetId(auth, month, year);

  const sheets = google.sheets({ version: "v4", auth });

  // Append to the Transactions tab, columns A:D
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Transactions!A:D",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [formattedDate, formattedAmount, receipt.description, receipt.category],
      ],
    },
  });
}
