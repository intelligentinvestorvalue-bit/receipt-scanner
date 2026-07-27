import { google } from "googleapis";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTH_FULL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

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

export type SetupMonthResult =
  | { status: "already_exists"; name: string; id: string }
  | { status: "created"; name: string; id: string };

/**
 * Copy last month's budget sheet into the current month and clear Transactions.
 */
export async function runSetupMonth(): Promise<SetupMonthResult> {
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

  const existingId = await findSpreadsheetId(drive, monthIdx, year);
  if (existingId) {
    return { status: "already_exists", name: canonicalName, id: existingId };
  }

  const prevMonthIdx = monthIdx === 0 ? 11 : monthIdx - 1;
  const prevYear = monthIdx === 0 ? (parseInt(year) - 1).toString() : year;
  const templateId = await findSpreadsheetId(drive, prevMonthIdx, prevYear);

  if (!templateId) {
    throw new Error(
      `No template found — could not find last month's spreadsheet. ` +
        `Please create "${canonicalName}" manually, share it with ` +
        `${process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL}, then try again.`
    );
  }

  const copyRes = await drive.files.copy({
    fileId: templateId,
    requestBody: { name: canonicalName },
    fields: "id, name",
  });
  const newId = copyRes.data.id;
  if (!newId) {
    throw new Error("Drive copy succeeded but returned no file id");
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: newId,
    range: "Transactions!A2:Z",
  });

  const ownerEmail = process.env.GOOGLE_OWNER_EMAIL;
  if (ownerEmail) {
    await drive.permissions.create({
      fileId: newId,
      requestBody: { type: "user", role: "writer", emailAddress: ownerEmail },
      sendNotificationEmail: false,
    });
  }

  return { status: "created", name: canonicalName, id: newId };
}

/** Fail-closed: SETUP_SECRET must be configured and match. */
export function assertSetupSecret(provided: string | null): void {
  const secret = process.env.SETUP_SECRET;
  if (!secret) {
    throw new SetupAuthError(
      "SETUP_SECRET is not configured. Refusing to run monthly setup."
    );
  }
  if (!provided || provided !== secret) {
    throw new SetupAuthError("Unauthorized");
  }
}

export class SetupAuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = "SetupAuthError";
  }
}
