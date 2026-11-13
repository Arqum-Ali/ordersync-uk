# eBay Order Updater → Shared Google Sheet

A local-first Next.js app. Upload a daily eBay export and it appends new order lines to monthly tabs in the Google Sheet. All partners can use the same deployed site. The Apps Script backend uses `LockService` so simultaneous imports are serialized and duplicate checks happen while the lock is held.

## Important behaviour
- Monthly tab names are `November 2026`, `December 2026`, etc., based on the eBay Sale date.
- A repeat buyer or a shared address is NOT considered a duplicate.
- Duplicate key is `eBay order number + item/transaction ID`; if no item ID exists, it uses order number + normalized product title + variation + quantity.
- Columns A:M follow the user's order sheet. G, H, I remain blank. J receives `=IF(OR(Hrow="",Irow=""),"",Irow-Hrow)`.
- A hidden column N stores the import key. It is used to prevent duplicates without changing the visible A:M layout.
- Existing rows are not rewritten. The app only appends missing lines.

## 1. Configure the Google Sheet backend (one time)
1. Open the Google Sheet: https://docs.google.com/spreadsheets/d/1FKX60y17YJ0km3IreDBXd8lxx5oiYnsJnXldeOXSbQo/edit
2. Open **Extensions → Apps Script**.
3. Replace the editor contents with `google-apps-script/Code.gs` from this project.
4. In `Code.gs`, replace `REPLACE_WITH_THE_SAME_LONG_RANDOM_SECRET_AS_ENV_LOCAL` with a long secret you create. Keep it private.
5. Click **Deploy → New deployment**.
6. Select the gear/type **Web app**.
7. Set **Execute as: Me**. Set **Who has access: Anyone** (the random secret protects the endpoint; do not share the secret).
8. Click Deploy, authorize the script, and copy the Web app URL ending in `/exec`.

The Google Sheet owner must authorize the script. The script edits the spreadsheet identified by `SPREADSHEET_ID` and creates monthly tabs automatically. Partners do not need their own Google API credentials.

## 2. Run on your Windows laptop first
Install Node.js LTS from https://nodejs.org/ and restart the terminal.

Open Command Prompt in this project folder and run:

```bash
npm install
```

Create a file named `.env.local` in the project root with:

```env
GOOGLE_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
IMPORT_SECRET=PASTE_THE_EXACT_SAME_SECRET_USED_IN_CODE_GS
APP_PASSWORD=choose-a-private-password-for-you-and-your-partners
```

Then run:

```bash
npm run dev
```

Open http://localhost:3000, select the daily eBay export, and click **Update Orders**. Check the relevant monthly tab in Google Sheets.

## 3. Deploy to Vercel after local testing
1. Push this project to a private GitHub repository.
2. In Vercel, import that repository.
3. In Vercel → Project → Settings → Environment Variables, add `GOOGLE_SCRIPT_URL`, `IMPORT_SECRET`, and `APP_PASSWORD` with the same values as `.env.local`.
4. Deploy / redeploy.
5. Give your two partners the Vercel website URL and the shared app password. They can all use the same site and shared Google Sheet.

## Export compatibility
The parser searches the first 15 rows for `Order number` and recognizes the eBay column names from the provided export, including `Post to name`, `Post to address 1`, `Post to address 2`, `Post to city`, `Post to county`, `Post to postcode`, `Post to country`, `Post to phone`, `Item title`, `Quantity`, `Sale date`, `Post by date`, and `Tracking number`.

If your next eBay export uses different headings, update the aliases in `lib/transform.ts`.

## Notes / safeguards
- First test with a copy of your Google Sheet or a small export. The script appends rows and does not delete or edit old rows.
- The monthly tabs need to use the target A:M layout. If you already have month tabs with different columns or headers, make a backup before the first import.
- If eBay provides a stable item/transaction ID, that is used to distinguish separate line items in one order. If not, the fallback is order + product + variation + quantity. Two truly identical lines in one order without separate IDs may be treated as one; if your export has a stable transaction ID column, add its exact heading to the `itemId` aliases.
- The current export discussed earlier did not include the exact eBay Order Earnings value, so I and J earnings-based profit remain blank/formula-empty until you enter I manually. This version leaves I blank.
