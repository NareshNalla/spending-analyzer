# Contributing

Thanks for helping improve Spending Analyzer. The app is a static site with no build step and no server. New features should stay that way unless a change is discussed first.

## Run it locally

```bash
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/`. Opening `index.html` from disk is enough for CSV import. PDF import needs the local server so the PDF.js worker can load.

## Tests

```bash
node --test test/logic.test.js
```

Parsing, categories, totals, budgets, goals, and backup live in `logic.js`. That file has no DOM dependency, so add tests there when you change those rules. `app.js` is the browser UI.

## What to keep stable

- Data stays in the browser. Do not add accounts, analytics, or uploads.
- The local storage key stays `spend_v3`. New fields should be optional so older saved data still loads.
- CSV export stays `Date,Description,Merchant,Category,Amount`, with Amount as the signed flow (negative means money out).
- Chart.js and PDF.js stay as the copies in `vendor/`. Do not point the page at a CDN.
- Scripts stay classic (not ES modules) so the site works from disk and from GitHub Pages.

## Pull requests

Describe what changed, how you checked it, and anything you deliberately left out. Screenshots help for visual changes. See [ROADMAP.md](ROADMAP.md) for the larger feature list.
