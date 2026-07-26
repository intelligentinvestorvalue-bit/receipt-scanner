/**
 * Apps Script source for Gmail → Pending.
 * Kept in code (not only on disk) so Vercel serverless can serve it.
 * scripts/gmail-to-pending.gs mirrors this for copy/paste from the repo.
 */
const GMAIL_PENDING_SCRIPT_TEMPLATE = `/**
 * Gmail → Pending Sheet (free Apps Script)
 * Bound to your auto-created Pending spreadsheet — sheet ID is already filled in.
 * Open the sheet → Extensions → Apps Script → paste → Run processCardAlertEmails once.
 *
 * See EMAIL_PENDING_SETUP.md for full setup steps.
 */

// ── Config ──────────────────────────────────────────────────────────────────
var PENDING_SHEET_ID = "__PENDING_SHEET_ID__";

// Gmail search for labeled card/bank alerts (adjust after you create the label)
var GMAIL_QUERY = 'label:card-alerts newer_than:7d';

var CHARGE_HINTS = [
  "charged",
  "charge of",
  "purchase",
  "purchased",
  "spent",
  "transaction",
  "debit",
  "payment of",
  "you paid",
  "amount",
];

var PENDING_HEADERS = [
  "Date",
  "Amount",
  "Description",
  "Category",
  "Source",
  "Status",
  "GmailMessageId",
  "CreatedAt",
  "Snippet",
];

function getPendingSpreadsheet_() {
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (e) {}
  return SpreadsheetApp.openById(PENDING_SHEET_ID);
}

function processCardAlertEmails() {
  var ss = getPendingSpreadsheet_();
  var sheet = ss.getSheetByName("Pending");
  if (!sheet) {
    sheet = ss.insertSheet("Pending");
  }
  ensureHeaders_(sheet);

  var existingIds = loadExistingMessageIds_(sheet);
  var threads = GmailApp.search(GMAIL_QUERY, 0, 50);

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      var id = msg.getId();
      if (existingIds[id]) continue;

      var subject = msg.getSubject() || "";
      var body = msg.getPlainBody() || "";
      var from = msg.getFrom() || "";
      var haystack = (subject + "\\n" + body).toLowerCase();

      if (!looksLikeCharge_(haystack)) continue;

      var amount = extractAmount_(subject + "\\n" + body);
      if (!amount) continue;

      var merchant = extractMerchant_(subject, body, from);
      var dateIso = Utilities.formatDate(
        msg.getDate(),
        Session.getScriptTimeZone(),
        "yyyy-MM-dd"
      );
      var source = from + " | " + subject;
      var snippet = (body || subject).replace(/\\s+/g, " ").trim().slice(0, 240);

      sheet.appendRow([
        dateIso,
        amount,
        merchant,
        "Personal",
        source,
        "pending",
        id,
        new Date().toISOString(),
        snippet,
      ]);

      existingIds[id] = true;
    }
  }
}

function ensureHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (sheet.getLastRow() === 0 || lastCol === 0) {
    sheet.getRange(1, 1, 1, PENDING_HEADERS.length).setValues([PENDING_HEADERS]);
    return;
  }
  var header = sheet.getRange(1, 1, 1, PENDING_HEADERS.length).getValues()[0];
  if (!header[0]) {
    sheet.getRange(1, 1, 1, PENDING_HEADERS.length).setValues([PENDING_HEADERS]);
  }
}

function loadExistingMessageIds_(sheet) {
  var map = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return map;
  var values = sheet.getRange(2, 7, lastRow, 7).getValues();
  for (var i = 0; i < values.length; i++) {
    var id = String(values[i][0] || "").trim();
    if (id) map[id] = true;
  }
  return map;
}

function looksLikeCharge_(haystack) {
  for (var i = 0; i < CHARGE_HINTS.length; i++) {
    if (haystack.indexOf(CHARGE_HINTS[i]) !== -1) return true;
  }
  return /\\$\\s?\\d/.test(haystack);
}

function extractAmount_(text) {
  var labeled = text.match(
    /(?:charged|charge(?:d)?(?:\\s+of)?|spent|purchase(?:d)?|payment(?:\\s+of)?|debit|amount)[^\\d$]{0,20}\\$?\\s*([\\d,]+\\.\\d{2})/i
  );
  if (labeled) return parseFloat(labeled[1].replace(/,/g, ""));

  var all = text.match(/\\$\\s*([\\d,]+\\.\\d{2})/g);
  if (!all || !all.length) return null;
  var best = 0;
  for (var i = 0; i < all.length; i++) {
    var n = parseFloat(all[i].replace(/[$,]/g, ""));
    if (n > best && n < 99999) best = n;
  }
  return best > 0 ? best : null;
}

function extractMerchant_(subject, body, from) {
  var at = subject.match(/\\bat\\s+(.+)$/i);
  if (at) return cleanMerchant_(at[1]);

  var withM = subject.match(/\\bwith\\s+(.+)$/i);
  if (withM) return cleanMerchant_(withM[1]);

  var purchased = (subject + "\\n" + body).match(
    /(?:purchased?|spent|charged)\\s+(?:at|with|to)\\s+([^\\n$.]+)/i
  );
  if (purchased) return cleanMerchant_(purchased[1]);

  var name = from.replace(/<[^>]+>/g, "").replace(/"/g, "").trim();
  return cleanMerchant_(name || "Email charge");
}

function cleanMerchant_(s) {
  return String(s)
    .replace(/\\s+/g, " ")
    .replace(/[|].*$/, "")
    .trim()
    .slice(0, 120);
}
`;

/**
 * Return the Gmail→Pending Apps Script with PENDING_SHEET_ID filled in.
 */
export function buildGmailPendingScript(spreadsheetId: string): string {
  return GMAIL_PENDING_SCRIPT_TEMPLATE.replace(
    "__PENDING_SHEET_ID__",
    spreadsheetId
  );
}
