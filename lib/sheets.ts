import { google } from "googleapis";
import { ParsedReceipt } from "./ocr";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

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

export function getGoogleAuth(scopes: string[]) {
  return new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes,
  });
}

/**
 * Resolve this month's budget spreadsheet ID (or GOOGLE_SHEET_ID override).
 * `month` is 1-12 as a string ("04"), `year` is "2026".
 */
export async function resolveSpreadsheetId(
  auth: InstanceType<typeof google.auth.JWT>,
  month: string,
  year: string
): Promise<string> {
  if (process.env.GOOGLE_SHEET_ID) return process.env.GOOGLE_SHEET_ID;

  const cacheKey = `${year}-${month}`;
  const cachedMap = readCache();
  if (cachedMap[cacheKey]) return cachedMap[cacheKey];

  const idx = parseInt(month) - 1;

  const monthTokens = [MONTH_ABBR[idx], MONTH_FULL[idx]];
  const monthFilters = monthTokens.map(
    (tok) => `name contains '${tok}_${year}'`
  );
  const query =
    `(${monthFilters.join(" or ")}) and ` +
    `(mimeType = 'application/vnd.google-apps.spreadsheet' or ` +
    ` mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') and ` +
    `trashed = false`;

  const drive = google.drive({ version: "v3", auth });
  const res = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    pageSize: 10,
  });

  const allFiles = res.data.files ?? [];
  const files =
    allFiles.filter((f) => /budget/i.test(f.name ?? "")).length > 0
      ? allFiles.filter((f) => /budget/i.test(f.name ?? ""))
      : allFiles;

  if (files.length === 0) {
    const example = `Monthly Budget_${MONTH_ABBR[idx]}_${year}`;
    throw new Error(
      `No spreadsheet found for ${MONTH_ABBR[idx]} ${year}. ` +
      `Expected a name like "${example}". ` +
      `Make sure it's shared with ${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}`
    );
  }

  const resolvedId = files[0].id!;
  const cache = readCache();
  cache[cacheKey] = resolvedId;
  writeCache(cache);
  return resolvedId;
}

/** Format YYYY-MM-DD → M/D/YYYY for the budget sheet style. */
export function formatSheetDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${parseInt(month)}/${parseInt(day)}/${year}`;
}

/**
 * Appends one row to the "Transactions" tab of this month's spreadsheet.
 */
export async function appendToSheet(receipt: ParsedReceipt): Promise<void> {
  const auth = getGoogleAuth([
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
  ]);

  const [year, month] = receipt.date.split("-");
  const spreadsheetId = await resolveSpreadsheetId(auth, month, year);
  const sheets = google.sheets({ version: "v4", auth });

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: "Transactions!A:D",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [
        [
          formatSheetDate(receipt.date),
          receipt.amount.toFixed(2),
          receipt.description,
          receipt.category,
        ],
      ],
    },
  });
}
