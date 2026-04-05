import { google } from "googleapis";
import { ParsedReceipt } from "./ocr";

/**
 * Appends one row to the "Transactions" sheet — Expenses section.
 *
 * Sheet layout (from your screenshot):
 *   Expenses columns: A=Date, B=Amount, C=Description, D=Category
 *   We find the first empty row in column A under the Expenses header (row 4 onward)
 *   and append there.
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL  — from your service account JSON
 *   GOOGLE_PRIVATE_KEY            — from your service account JSON (with \n for newlines)
 *   GOOGLE_SHEET_ID               — the long ID from your sheet URL
 */
export async function appendToSheet(receipt: ParsedReceipt): Promise<void> {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID not set");

  // Format: Date as M/D/YYYY to match your existing sheet style (e.g. 4/1/2026)
  const [year, month, day] = receipt.date.split("-");
  const formattedDate = `${parseInt(month)}/${parseInt(day)}/${year}`;

  // Format: Amount as plain number (the sheet handles $ formatting)
  const formattedAmount = receipt.amount.toFixed(2);

  // Append to Transactions sheet, Expenses section columns A:D
  // Using "USER_ENTERED" so Google Sheets parses the date string naturally
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
