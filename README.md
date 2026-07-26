# Receipt Scanner

Mobile-first Next.js app that OCR-scans receipts (or accepts manual entry), lets you review the fields, and appends a row to your monthly Google Sheets budget workbook.

**Flow:** Capture / upload → **on-device Tesseract.js OCR** → review & edit → append to `Transactions` on `Monthly Budget_{Mon}_{YYYY}`.

OCR runs entirely in the browser. No Google Cloud Vision (and no Vision billing) is required.

---

## Features

- Scan receipts with camera or gallery upload (Tesseract.js, on-device)
- Manual entry when you skip OCR or OCR fails
- Confirm/edit date, amount, description, and category before save
- Amount disambiguation when OCR finds multiple totals
- OCR failure → continue with manual entry
- Monthly sheet setup (copy last month, clear Transactions)
- Password-protected UI and APIs

---

## Setup

### 1. Install

```bash
npm install
cp env.example .env.local
```

### 2. Fill `.env.local`

See `env.example` for every variable. Minimum required for a working deploy:

| Variable | Purpose |
|----------|---------|
| `APP_PASSWORD` | Login password for the app |
| `SESSION_SECRET` | ≥32 random chars for signing session cookies |
| `SETUP_SECRET` | Server-only secret; required for monthly sheet setup |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email |
| `GOOGLE_PRIVATE_KEY` | Service account private key (`\n` as literal `\n`) |
| `GOOGLE_OWNER_EMAIL` | Your Gmail — new month sheets are shared here |
| `GOOGLE_PENDING_SHEET_ID` | Optional override; otherwise auto-created as **Receipt Scanner Pending** on first `/pending` visit |

**Optional:**

| Variable | Purpose |
|----------|---------|
| `GOOGLE_SHEET_ID` | Force all saves to one spreadsheet (ignores month discovery) |

Generate secrets:

```bash
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 24   # SETUP_SECRET / APP_PASSWORD
```

### 3. Google Cloud (Sheets + Drive only)

1. Enable **Google Sheets API** and **Google Drive API** (Vision is not needed).
2. Create a service account, download the JSON key, and set email + private key.
3. Share each monthly spreadsheet with the service account email as **Editor**.

### 4. Spreadsheet naming

Sheets are discovered by name (unless `GOOGLE_SHEET_ID` is set):

- `Monthly Budget_Apr_2026` (preferred)
- Also tolerates `April` / lowercase `budget`

Each workbook needs a tab named **`Transactions`** with columns:

`Date | Amount | Description | Category`

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with `APP_PASSWORD`.

First scan downloads the Tesseract English language model from jsDelivr (cached afterward in the browser).

### 6. Deploy (Vercel)

1. Push the repo and import into Vercel.
2. Add all env vars from `.env.local` (keep `GOOGLE_PRIVATE_KEY` with `\n` escapes).
3. Deploy. Use the login password — do not leave the app public.
4. You can remove any old `GOOGLE_VISION_API_KEY` / Upstash vars; they are unused.

---

## Scripts

```bash
npm run dev      # local development
npm run build    # production build
npm run start    # run production server
npm run lint     # ESLint
npm test         # Vitest unit tests (OCR parsers + categories)
```

---

## OCR notes

- Engine: [Tesseract.js](https://github.com/naptha/tesseract.js) (open source), English (`eng`)
- Runs on the user's device; receipt images are not sent to Google for OCR
- Accuracy is usually good on clear, well-lit, flat receipts; blurry or angled photos may need manual correction (the review step is designed for that)
- Large images are downscaled before OCR for mobile performance

---

## Security model

- **App password** (`APP_PASSWORD`) + signed HttpOnly cookie (`SESSION_SECRET`)
- Unauthenticated users are redirected to `/login`; APIs return `401`
- **Setup** never uses a `NEXT_PUBLIC_*` secret. The UI calls a server action; the API route requires `SETUP_SECRET` and refuses to run if it is unset
- Save / setup routes are session-protected (setup API also requires `SETUP_SECRET`)

---

## Email pending (Gmail → review → Sheets)

Card/bank emails can be collected into a **Pending** spreadsheet via free Gmail filters + Apps Script. Open **`/pending`** in the app to edit, **Approve** (writes `Transactions`), or **Discard**.

On first visit, the app **creates** `Receipt Scanner Pending` (headers included), shares it with `GOOGLE_OWNER_EMAIL`, and offers a **Copy script** with the sheet ID already filled in. Gmail authorization still requires you to run the script once as yourself (Google limitation).

Full setup (multi-account Gmail, triggers): see **[EMAIL_PENDING_SETUP.md](./EMAIL_PENDING_SETUP.md)**. Sample script: `scripts/gmail-to-pending.gs`.

---

## Categories

Category list and merchant keyword rules live in `lib/categories.ts`. Edit that file to match your Summary sheet labels and local stores.
