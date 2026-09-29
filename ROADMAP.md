# Roadmap

Spending Analyzer is a private, in-browser tool for spending, saving, and expenses. There is no account and no bank login. New work should stay client-side and fit the split between `logic.js` (rules and math) and `app.js` (the page).

Status values:

- **Shipped** — in the current foundation pull request
- **Partial** — a useful slice is shipped; the rest is later
- **Later** — not in this pull request

## Phase 1 — Bring your own transactions

| Feature | Status | Notes |
| --- | --- | --- |
| Add, remove, and undo a transaction by hand | Shipped | Amounts follow the selected bank or card style |
| CSV import | Shipped | Headers or `date, description, amount`; debit/credit columns; running balance; quoted fields; BOM; `;` and tab; parentheses, CR/DR, trailing minus, European decimals |
| Bank-statement PDF import | Shipped | Text PDFs only, with the local PDF.js copy. Scans are not read |
| Categories | Shipped | Built-in list, grouped, including housing, utilities, household help, food, transport, family, education, health, loans, and savings. Older names still resolve |
| Auto-categorization rules | Shipped | Changing a category updates every row from that same merchant and is saved for later imports. A different merchant is left alone |
| Income tracking | Shipped | Income, spending, net, and savings rate. Transfers are listed but left out of those totals |

## Phase 2 — See the picture

| Feature | Status | Notes |
| --- | --- | --- |
| Dashboard | Shipped | Income, spending, net, savings rate, top category, biggest purchase, biggest merchant |
| Monthly trend | Shipped | Income and spending bars by month |
| Category trend | Shipped | Share of spending, click to filter |
| Month drill-down | Shipped | Years, then months (newest first), with spending, income, savings, and net. Open a month for its categories and transactions |
| Year-over-year | Later | Same calendar month compared across years. Months are already grouped by year |
| Search and filter | Shipped | Text, category, date range, and amount range. Search does not rebuild the page, so the field keeps focus |
| Dark mode | Shipped | Light, dark, or match the system |
| Projections | Shipped | Own menu after Savings goals. End-of-month pace and yearly estimates for the selected month, labeled as estimates |

## Phase 3 — Plan spending and saving

| Feature | Status | Notes |
| --- | --- | --- |
| Monthly budgets per category | Shipped | One limit per spending category. Compared with the latest month in the data, or the month you filter to |
| Budget alerts | Shipped | Amber at 80% of the limit, red when spending goes past it. Landing exactly on the limit stays on budget |
| Savings goals with progress | Shipped | Name, target, amount saved, optional deadline, and an add-to-goal control. This is a tally you enter, not a bank balance |
| Savings category | Shipped | Money moved to savings, deposits, SIPs, PPF, and similar is not counted as spending |
| JSON backup and restore | Shipped | Full `spend_v3` snapshot, including budgets and goals. A raw older snapshot restores too |
| CSV export | Shipped | The rows in the current view, same columns as before |

## Phase 4 — Recurring money and longer trends

| Feature | Status | Notes |
| --- | --- | --- |
| Repeating merchants | Shipped in logic | The page is scoped to one month, so the repeating-merchant card stays hidden |
| Subscription detection | Later | Cadence, price changes, and a “this looks like a subscription” flag beyond the merchant list |
| Recurring expense calendar | Later | Expected next date for rent, bills, and subscriptions |
| Refunds against a budget | Later | A category budget currently counts money out. A refund in that category does not lower the spent amount |

## Phase 5 — Take it with you

| Feature | Status | Notes |
| --- | --- | --- |
| Multi-currency | Later | Display is US dollars. Mixed-currency files are not converted |
| Offline / PWA install | Later | CSV works from a saved copy of the site. There is no manifest, service worker, or install prompt yet |
| Accessibility pass | Partial | Labels, keyboard drop zone, visible focus, progress bars, and reduced motion are in. A fuller audit (screen reader pass, contrast on every state, skip link) is still open |
| More statement layouts | Later | Day/month/year dates, image-only PDFs, and OFX/QFX |
| Rules editor | Later | Edit or delete a merchant rule without finding one of its rows |

## Out of scope for this app

Bank connections, logins, and any upload of statements. Moving data between devices is the JSON backup. A hosted sync service would break the privacy promise this project is built on.
