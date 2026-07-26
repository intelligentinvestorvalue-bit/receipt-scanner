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

## Part A — Pending spreadsheet (auto-created by the app)

1. Deploy the app with `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, and `GOOGLE_OWNER_EMAIL` set.
2. Sign in and open **`/pending`** (or **Review email pending →**).
3. On first load the app will:
   - Create a Google Sheet named **`Receipt Scanner Pending`**
   - Add a **`Pending`** tab with headers: Date, Amount, Description, Category, Source, Status, GmailMessageId, CreatedAt, Snippet
   - Share / transfer it to `GOOGLE_OWNER_EMAIL` when possible
   - Try to attach Apps Script via API (often blocked for service accounts)
   - Show a **Copy script (ID filled in)** button with your sheet ID already set
4. Optional: you can still set `GOOGLE_PENDING_SHEET_ID` to force a specific spreadsheet; otherwise the app finds/creates by name.

### Finish Apps Script (one-time, required for Gmail)

Google does **not** let the service account authorize **your** Gmail inbox. You must run the script once as yourself:

1. On `/pending`, click **Open sheet** → **Extensions → Apps Script**
2. Click **Copy script (ID filled in)** in the app and paste into the script editor (replace any stub)
3. Run **`processCardAlertEmails`** → Allow Gmail + Sheets permissions
4. **Triggers** → time-driven every 10–15 minutes

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

## Part C — Apps Script (if you did not use the in-app Copy button)

1. Open the **Receipt Scanner Pending** spreadsheet (link from `/pending`).
2. **Extensions → Apps Script**
3. Paste from the app’s **Copy script (ID filled in)**, or from `scripts/gmail-to-pending.gs` with `PENDING_SHEET_ID` set.
4. Save → Run **`processCardAlertEmails`** → authorize.
5. Add a **time-driven trigger** every 10–15 minutes.

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
