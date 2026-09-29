# Spending Analyzer

A private spending dashboard that runs entirely in the browser. Drop in a bank CSV or a text-based statement PDF, then review income, spending, categories, merchants, and months. Nothing is uploaded.

## Use it

1. Open `index.html` in a browser, or serve this folder (see below).
2. Drop a statement on the importer, or press Enter on that box to choose files. You can also **Load sample data** to try the dashboard without a statement.
3. Check the amount style in the header.
   - **Bank** means negative amounts are money out (typical checking export).
   - **Card** means positive charges are money out (typical credit-card export).
   - **Auto** looks at purchases it recognizes. If income and spending look swapped, switch the style. The choice is saved with your data.
4. Click a category to filter, or change a merchant’s category in the table. That choice is remembered for the same merchant next time.
5. Use the date, amount, and search filters to narrow the tables, chart, and export. **Export CSV** downloads the rows you are currently looking at.

Transfers (Zelle, Venmo, card payments, and similar) stay in the transaction list but are left out of income, spending, and the savings rate so a card payment is not counted as a purchase.

### Add or remove a row

Use **Add a transaction** when a statement missed something. Amounts are stored with the amount style you have selected. **Remove** on a row deletes just that transaction and can be undone for a few seconds. **Clear data** deletes every saved transaction and category choice from this browser.

## CSV files

The importer accepts a header row. These names are recognized (extra columns are ignored):

| Role | Headers it looks for |
| --- | --- |
| Date | Date, Transaction Date, Posted Date, Posting Date |
| Description | Description, Memo, Payee, Name |
| Amount | Amount, or a Debit column and a Credit column |
| Balance | Balance, Running Balance (not treated as the amount) |
| Category | Category, when the value is one of this app’s categories |

A file with no header should be `date, description, amount`. A trailing running-balance column is detected when the balances line up. Quoted commas, a UTF-8 BOM, `;` or tab separators, ISO dates (`2026-01-05`), US dates (`01/05/2026`), `($12.50)`, `12.50 CR`, and a trailing minus (`40.00-`) are supported.

Examples live in [`examples/`](examples/):

- `simple.csv` — date, description, amount
- `bank-with-balance.csv` — amount plus running balance, parentheses, CR, trailing minus
- `debit-credit.csv` — separate debit and credit columns
- `card-charges.csv` — card-style positive charges
- `chase-like.csv` — transaction date, post date, description, amount, memo
- `statement.pdf` — a tiny text statement (payroll, a purchase, Total Wine, and summary lines that should be ignored)

Dates are read as month/day/year. Re-importing an export from this app works: the file is `Date,Description,Merchant,Category,Amount`, and Amount is the signed number shown in the app (negative means money out).

## PDF statements

PDF text is extracted in the browser with the vendored [PDF.js](vendor/README.md) build. Scanned statements (pages that are only images) will not import. Lines that look like balances, credit limits, or a bare “Total” are skipped. A transaction amount is preferred over a running balance on the same line.

Serve the folder over HTTP before importing a PDF. Opening `index.html` from disk is enough for CSV, but the PDF worker is more reliable from a local server:

```bash
python3 -m http.server 8765
```

Then open `http://127.0.0.1:8765/`.

The same folder can be published on GitHub Pages. There is no build step.

## Privacy

Parsing, charts, and storage all happen on your device.

- Saved data is in `localStorage` under the key `spend_v3` (transactions, category overrides, amount style, theme, date filters, and the last tab).
- Chart.js and PDF.js are files in `vendor/`. The page does not call a CDN.
- There is no account, analytics script, or network upload.

## Tests

Logic tests use the built-in Node test runner and do not need a browser:

```bash
node --test test/logic.test.js
```

## Limits

- One currency display: US dollars.
- Category guesses are keyword rules, not a model. A wrong guess is fixed by setting the merchant’s category.
- PDF layout varies by bank. If a PDF imports nothing useful, export a CSV instead.
- The tool does not connect to a bank, track budgets, or sync between devices.
