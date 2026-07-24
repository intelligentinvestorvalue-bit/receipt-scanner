# Receipt Scanner

Mobile-first Next.js app that OCR-scans receipts (or accepts manual entry), lets you review the fields, and appends a row to your monthly Google Sheets budget workbook.

**Flow:** Capture / upload → Google Cloud Vision OCR → review & edit → append to `Transactions` on `Monthly Budget_{Mon}_{YYYY}`.

---

## Features

- Scan receipts with camera or gallery upload
- Manual entry when you skip OCR
- Confirm/edit date, amount, description, and category before save
- Amount disambiguation when OCR finds multiple totals
- OCR failure → continue with manual entry
- Monthly sheet setup (copy last month, clear Transactions)
- Password-protected UI and APIs
- Vision API rate limits (950/month, 20/min) with Upstash Redis when configured

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
| `GOOGLE_VISION_API_KEY` | Cloud Vision OCR |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account email |
| `GOOGLE_PRIVATE_KEY` | Service account private key (`\n` as literal `\n`) |
| `GOOGLE_OWNER_EMAIL` | Your Gmail — new month sheets are shared here |

**Strongly recommended:**

| Variable | Purpose |
|----------|---------|
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Durable Vision rate limits across serverless instances |

**Optional:**

| Variable | Purpose |
|----------|---------|
| `GOOGLE_SHEET_ID` | Force all saves to one spreadsheet (ignores month discovery) |

Generate secrets:

```bash
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 24   # SETUP_SECRET / APP_PASSWORD
```

### 3. Google Cloud

1. Enable **Cloud Vision API**, **Google Sheets API**, and **Google Drive API**.
2. Create an API key restricted to Vision; put it in `GOOGLE_VISION_API_KEY`.
3. Create a service account, download the JSON key, and set email + private key.
4. Share each monthly spreadsheet with the service account email as **Editor**.

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

### 6. Deploy (Vercel)

1. Push the repo and import into Vercel.
2. Add all env vars from `.env.local` (keep `GOOGLE_PRIVATE_KEY` with `\n` escapes).
3. Create a free [Upstash Redis](https://upstash.com/) database and add the REST URL/token.
4. Deploy. Use the login password — do not leave the app public.

---

## Scripts

```bash
npm run dev      # local development
npm run build    # production build
npm run start    # run production server
npm run lint     # ESLint
npm test         # Vitest unit tests (OCR + categories)
```

---

## Security model

- **App password** (`APP_PASSWORD`) + signed HttpOnly cookie (`SESSION_SECRET`)
- Unauthenticated users are redirected to `/login`; APIs return `401`
- **Setup** never uses a `NEXT_PUBLIC_*` secret. The UI calls a server action; the API route requires `SETUP_SECRET` and refuses to run if it is unset
- Vision scan/save routes are session-protected
- Rate limits prefer Upstash; `/tmp` is only a degraded local fallback

---

## Categories

Category list and merchant keyword rules live in `lib/categories.ts`. Edit that file to match your Summary sheet labels and local stores.
