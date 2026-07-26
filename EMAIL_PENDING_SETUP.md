# Email → Pending → Approve (free setup)

This guide wires **Gmail** (including multiple accounts) into your Receipt Scanner **Email Pending** page. Nothing is written to `Transactions` until you tap **Approve** in the app.

**Cost:** $0 — uses Gmail, Google Sheets, and Google Apps Script free quotas.

---

## How it works

```
Bank/card email
    → Gmail filter (label or forward to hub)
    → Apps Script (every 10–15 min)
    → "Pending" tab on a dedicated Sheet
    → Receipt Scanner /pending page
    → You edit + Approve or Discard
    → Approve appends to that month's Transactions
```

---

## Part A — Create the Pending spreadsheet

1. Open [Google Sheets](https://sheets.google.com) while signed into the Gmail you’ll use as the **hub** (the account that will receive forwarded alerts, or your main budget account).
2. Create a new spreadsheet named: **`Receipt Scanner Pending`**
3. Rename the first tab to **`Pending`** (exact name).
4. In row 1, add these headers (A–I):

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| Date | Amount | Description | Category | Source | Status | GmailMessageId | CreatedAt | Snippet |

5. Copy the spreadsheet ID from the URL:  
   `https://docs.google.com/spreadsheets/d/`**`THIS_ID`**`/edit`
6. Share the spreadsheet with your **service account email** as **Editor**  
   (same email as `GOOGLE_SERVICE_ACCOUNT_EMAIL` in the app).
7. In Vercel / `.env.local`, set:

```bash
GOOGLE_PENDING_SHEET_ID=THIS_ID
```

8. Redeploy (or restart `npm run dev`) so the app can read the sheet.

---

## Part B — Choose a hub Gmail (you have 5 accounts)

Pick **one** hub account that will collect card alerts.

### Option 1 — Forward from other accounts (recommended)

On **each** of the other accounts that receive bank/card emails:

1. Gmail → **Settings** (gear) → **See all settings** → **Forwarding and POP/IMAP**
2. Add a forwarding address = your **hub** Gmail → confirm the link Gmail sends.
3. Or use a **filter** (better):  
   **Settings → Filters and Blocked Addresses → Create a new filter**

Suggested filter criteria (tune per bank):

- **From:** your bank/card alert address (e.g. `chase`, `alerts@`, `americanexpress`)  
  **and/or Subject contains:** `charged` OR `purchase` OR `transaction` OR `debit`
- When filter matches:  
  - ✅ **Forward it to:** hub@gmail.com  
  - ✅ **Also apply label** (optional on that account)

On the **hub** account, create label **`card-alerts`**, then a filter:

- Matches forwarded bank mail (From / Subject as above)
- ✅ **Apply the label:** `card-alerts`
- ✅ **Skip the Inbox** (optional, keeps Inbox clean)

### Option 2 — Only one account gets alerts

Skip forwarding. Create label **`card-alerts`** and a filter on that account only.

---

## Part C — Install the Apps Script

1. Open the **Receipt Scanner Pending** spreadsheet.
2. **Extensions → Apps Script**
3. Delete any placeholder code.
4. Paste the contents of `scripts/gmail-to-pending.gs` from this repo.
5. Set:

```javascript
var PENDING_SHEET_ID = "YOUR_PENDING_SPREADSHEET_ID";
```

6. Confirm the search matches your label:

```javascript
var GMAIL_QUERY = 'label:card-alerts newer_than:7d';
```

7. Click **Save** (disk icon). Name the project e.g. `Gmail to Pending`.
8. Select function **`processCardAlertEmails`** → click **Run**.
9. First run: grant permissions (review Gmail + Sheets access) → Allow.
10. Check the Pending tab — if you have matching recent mail with a `$xx.xx` amount, rows should appear with `Status = pending`.

### Add an automatic trigger

1. In Apps Script: left sidebar **Triggers** (clock icon)
2. **Add Trigger**
   - Function: `processCardAlertEmails`
   - Event source: **Time-driven**
   - Type: **Minutes timer** → every **10 minutes** or **15 minutes**
3. Save → authorize if asked.

---

## Part D — Use the app to confirm

1. Open your deployed Receipt Scanner and sign in.
2. Tap **Review email pending →** (or go to `/pending`).
3. For each item:
   - Fix date / amount / description / category if needed
   - **Approve** → writes to that month’s `Transactions` tab, marks Pending `approved`
   - **Discard** → marks `discarded` (never hits Transactions)

Nothing hits your budget sheet until you approve.

---

## Part E — Tune parsing for your banks

Open a real alert email and note the wording (“You made a purchase…”, “A charge of $…”, etc.).

In the Apps Script, adjust:

- `CHARGE_HINTS` — words that mean “this is a charge”
- `GMAIL_QUERY` — tighter From:/subject: rules to cut noise
- `extractMerchant_` / `extractAmount_` — if a bank format is missed

Re-run `processCardAlertEmails` after edits.

---

## Troubleshooting

| Problem | Fix |
|--------|-----|
| App says `GOOGLE_PENDING_SHEET_ID is not set` | Add env var and redeploy |
| App loads but list empty | Script not running, label name mismatch, or no `$12.34`-style amounts in mail |
| Permission / Sheet errors in app | Share Pending spreadsheet with the **service account** as Editor |
| Apps Script can’t read Gmail | Re-run and accept OAuth; script must run as **your** Google user (not the service account) |
| Duplicates | Script dedupes by `GmailMessageId`; don’t clear column G |
| Wrong month on Approve | Edit the **Date** on `/pending` before Approve (app uses that date to find `Monthly Budget_Mon_YYYY`) |

---

## Security notes

- Apps Script runs as **you** and only writes to the Pending sheet.
- The web app still requires login; Approve/Discard call authenticated APIs.
- Pending rows are not Transactions until you approve.
