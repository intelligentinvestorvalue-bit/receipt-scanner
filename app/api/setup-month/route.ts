import { NextResponse } from "next/server";
import { google } from "googleapis";

export const runtime = "nodejs";

const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function nameCandidates(monthIdx: number, year: string): string[] {
  return [
    `Monthly Budget_${MONTH_ABBR[monthIdx]}_${year}`,
    `Monthly budget_${MONTH_ABBR[monthIdx]}_${year}`,
    `Monthly Budget_${MONTH_FULL[monthIdx]}_${year}`,
    `Monthly budget_${MONTH_FULL[monthIdx]}_${year}`,
  ];
}

async function findSpreadsheetId(
  drive: ReturnType<typeof google.drive>,
  monthIdx: number,
  year: string
): Promise<string | null> {
  const candidates = nameCandidates(monthIdx, year);
  const nameFilters = candidates.map((n) => `name = '${n}'`).join(" or ");
  const q = `(${nameFilters}) and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const res = await drive.files.list({ q, fields: "files(id, name)", pageSize: 5 });
  return res.data.files?.[0]?.id ?? null;
}

/**
 * POST /api/setup-month
 *
 * Automates new-month setup:
 *  1. Checks if this month's spreadsheet already exists (shared with service account)
 *  2. Finds last month's spreadsheet as a template
 *  3. Copies it, renames to current month (e.g. "Monthly Budget_May_2026")
 *  4. Clears all data rows in the Transactions tab (keeps headers)
 *  5. Shares the new sheet with GOOGLE_OWNER_EMAIL so it appears in your Drive
 *
 * Required env vars:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_OWNER_EMAIL
 */
export async function POST(req: Request) {
  // Require a secret token to prevent unauthorized triggering
  const secret = process.env.SETUP_SECRET;
  if (secret) {
    const provided = req.headers.get("x-setup-secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive",
      ],
    });

    const drive = google.drive({ version: "v3", auth });
    const sheets = google.sheets({ version: "v4", auth });

    const now = new Date();
    const year = now.getFullYear().toString();
    const monthIdx = now.getMonth();
    const canonicalName = `Monthly Budget_${MONTH_ABBR[monthIdx]}_${year}`;

    // 1. Check if this month already exists
    const existingId = await findSpreadsheetId(drive, monthIdx, year);
    if (existingId) {
      return NextResponse.json({ status: "already_exists", name: canonicalName, id: existingId });
    }

    // 2. Find last month as template
    const prevMonthIdx = monthIdx === 0 ? 11 : monthIdx - 1;
    const prevYear = monthIdx === 0 ? (parseInt(year) - 1).toString() : year;
    const templateId = await findSpreadsheetId(drive, prevMonthIdx, prevYear);

    if (!templateId) {
      return NextResponse.json(
        {
          error:
            `No template found — could not find last month's spreadsheet. ` +
            `Please create "${canonicalName}" manually, share it with ` +
            `${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}, then try again.`,
        },
        { status: 404 }
      );
    }

    // 3. Copy template and rename to this month
    const copyRes = await drive.files.copy({
      fileId: templateId,
      requestBody: { name: canonicalName },
      fields: "id, name",
    });
    const newId = copyRes.data.id!;

    // 4. Clear all data rows in Transactions tab (preserves headers and formatting)
    await sheets.spreadsheets.values.clear({
      spreadsheetId: newId,
      range: "Transactions!A2:Z",
    });

    // 5. Share with the owner's Gmail so it appears in their Drive
    const ownerEmail = process.env.GOOGLE_OWNER_EMAIL;
    if (ownerEmail) {
      await drive.permissions.create({
        fileId: newId,
        requestBody: { type: "user", role: "writer", emailAddress: ownerEmail },
        sendNotificationEmail: false,
      });
    }

    return NextResponse.json({ status: "created", name: canonicalName, id: newId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Setup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
