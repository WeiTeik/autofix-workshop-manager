# AutoFix Workshop

A Next.js, TypeScript, Tailwind CSS and SQLite app built from the three supplied files. Includes parts CRUD, stock IN/OUT, movement history, dashboard, repair estimates, supplier order planning, duplicate warnings, Excel export and import of new parts.

## Separate frontend and backend

The app has two independent projects connected only by HTTP APIs:

```text
frontend/                  Next.js UI, port 3000
  app/page.tsx             Screens, forms and browser API calls
  app/globals.css          Frontend styling
  app/layout.tsx           HTML layout
  next.config.ts
  package.json
backend/                   Independent Node.js API, port 3001
  src/server.ts            HTTP server, database, business rules and API endpoints
  data/                    Existing SQLite database and sample seed data
  tests/                   Backend tests
  package.json
```

The frontend has no imports from the backend and no database dependencies. It fetches its initial inventory, saves forms and calculates estimates through the backend API. Each project has its own dependencies, TypeScript configuration and build. The root package uses npm workspaces to install and run both conveniently. The previous combined `frontend.tsx` and `backend.ts` files have been removed.

## Run locally

Requires Node.js 22 or newer. From the project root:

```sh
npm install
npm run dev
```

Open http://127.0.0.1:3000. Both services run together. You can also run them in separate terminals:

```sh
npm run dev:frontend
npm run dev:backend
```

Production:

```sh
npm run build
npm start
```

Checks:

```sh
npm run typecheck
npm test
```

The frontend reads `NEXT_PUBLIC_API_URL`, defaulting to `http://127.0.0.1:3001`. To change it, copy `frontend/.env.example` to `frontend/.env.local`, edit the URL, and restart/rebuild the frontend.

The backend accepts `PORT` (default 3001), `HOST` (default 127.0.0.1), `DATABASE_PATH` (optional), and `FRONTEND_ORIGINS` (comma-separated allowed browser origins). By default it allows `http://127.0.0.1:3000` and `http://localhost:3000`. See `backend/.env.example`; pass these as environment variables or use Node's `--env-file` option when launching the backend. CORS permits the separate frontend to read responses and submit forms.

## API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/state` | Inventory, transactions, settings and usage window |
| POST / PUT / DELETE | `/api/parts` | Add, edit or archive a part |
| POST | `/api/transactions` | Record stock IN or OUT |
| PUT | `/api/settings` | Update pricing and shipping settings |
| POST | `/api/calculate` | Calculate repair or supplier order totals |
| GET | `/api/export` | Download the Excel report |
| POST | `/api/import` | Import new parts with an Excel file |

All endpoint URLs are relative to the backend, for example `http://127.0.0.1:3001/api/state`.

## Data and business rules

- The 30 sample parts and 38 historical movements are loaded once on first start. `backend/data/seed.json` was extracted from both supplied Excel files without changing them.
- Parts quantities are treated as the current stock snapshot. Historical movements are retained and **not replayed** against stock.
- Dates and the rolling 30-day usage window use Malaysia time. The window includes today and the preceding 29 days. Fast-moving means at least five separate OUT movements, interpreting “used 5 or more times” literally. Units used are shown separately; none of the supplied parts have five OUT events in the current window.
- Low stock: quantity at or below reorder level, or strictly below twice that level for fast-moving parts.
- OEM markup 10%; Aftermarket markup 25%. Repair quotes calculate parts plus labour, then tax on that subtotal. Money is rounded to cents per line, labour and tax.
- Supplier discounts apply per part: 1–9 units 0%, 10–49 units 5%, 50+ units 12%. Shipping is charged once on the whole order after discounts, without a shipping discount. Defaults: RM25 below RM200, free at RM200 or more.
- Labour defaults to RM80/hour and tax to 0% because these were not specified. Adjust them in Settings. Shipping settings are also editable.
- Missing costs remain null and block calculations. They are excluded from the known inventory valuation, which shows an exclusion note. A zero cost is valid.
- Names are compared ignoring case and whitespace. Similar names warn but do not merge OEM and Aftermarket variants. Users must acknowledge a warning when saving a similar part.
- Stock IN requires the actual received per-unit invoice cost after discounts, excluding shipping, and updates the current part cost. OUT uses the current recorded cost and cannot exceed available stock. All stock writes are transactional.
- Existing part quantities cannot be edited directly. Use stock movements to preserve history. Delete requires zero stock and archives the part while retaining movement history.
- Excel import adds new part IDs only. Use a Parts sheet with the original column names and plain values. All rows are validated within one transaction; any invalid or existing ID cancels the entire import. Opening stock is recorded once. Formula cells are rejected. Historical transaction import is intentionally not exposed.
- Excel export includes active Parts, all Transactions (including archived parts), and Summary. Importing the unmodified export will fail because those IDs already exist; use it as a template for new rows.
- Estimates and order plans are calculations only. Printing or calculating does not reserve stock or record purchases. Quotes warn about quantities that exceed stock.

## Persistence and backups

SQLite lives at `backend/data/workshop.sqlite` (override with `DATABASE_PATH`). Back up the database with a SQLite backup tool, or stop the server before copying the SQLite file and any adjacent `-wal`/`-shm` files. Do not delete the database to reset it unless you intend to discard changes. Excel exports are reports rather than full database backups.

This is a local workshop app without user accounts. A shared or public deployment needs authentication and a persistent writable database volume on the backend. The frontend can be hosted independently; configure its API URL and the backend’s allowed origins for that deployment.
# autofix-workshop-manager
