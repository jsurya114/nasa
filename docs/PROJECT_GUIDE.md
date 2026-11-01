# NASA Logistics: project guide

Written from the code on the `develop` branch on 2026-11-01. It holds **names only, never values**: no passwords, keys, real driver data or Excel files. If the code and this page disagree, the code wins; fix the page in a pull request. The Excel and pay sections are Jasil's to update when his accuracy work changes them.

## What the system is

NASA Logistics manages delivery drivers: their routes, daily journeys, availability, agreements and pay. Admins and drivers use one web app.

- **Frontend:** React 19, Vite, Redux Toolkit, Tailwind. Folder `Frontend/`.
- **Backend:** Node 22, Express 5, ES modules. Folder `Backend/`.
- **Data:** PostgreSQL (all business data), Redis (list of signed-out tokens), Cloudinary (access code images).
- **Layers in the backend:** routes only wire URLs to controllers and middleware; controllers read the request and send the response; services (`Backend/services/`) hold the SQL and rules.

## Run it on your computer

1. Use Node 22 (the repo has `.nvmrc`).
2. Backend: `cd Backend`, copy `.env.example` to `.env`, fill in the values you were given, `npm install`, then `npm run dev` (or `npm start`).
3. Frontend: `cd Frontend`, `npm install`, set `VITE_BACKEND_LOCALHOST_ROUTE` to the backend address, then `npm run dev`.
4. You need a PostgreSQL database and a Redis server you can reach. Never point a test at the live database.
5. There are no automated tests yet. Manual checks are the safety net (see [CONTRIBUTING.md](../CONTRIBUTING.md) section 6).

## Settings (names only)

| Where | Name | What it is for |
|---|---|---|
| Backend | `PORT`, `NODE_ENV`, `FRONTEND_URL` | Port, mode, the allowed web address (CORS) |
| Backend | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` | PostgreSQL connection |
| Backend | `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD` | Redis connection |
| Backend | `JWT_SECRET`, `REFRESH_TOKEN_SECRET` | Sign-in tokens. Two different long random values. The server will not start if either is missing or they are equal |
| Backend | `TRUST_PROXY` | Number of proxies in front of the app (`0` if none, `1` behind one hosting proxy). **Required in production**: the login limits depend on it |
| Backend | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Access code images |
| Frontend | `VITE_BACKEND_LOCALHOST_ROUTE` | Backend address the web app calls |

## Hosting and deployment

- **Frontend:** Vercel. Its Production Branch must be `main`; pull request branches only make Preview deploys. GitHub's default branch is `develop`, which does not decide what Vercel publishes. Check now and then: Vercel, project, Settings, Git.
- **Backend host:** *to be filled in by the owner*: which provider, which branch it deploys, how many proxies sit in front of it.
- **Branches:** work branches off `develop`; every pull request targets `develop`; `main` is live production and only changes when the owner says "raise pr to main from develop".
- **Merging:** "Squash and merge" for every pull request. The pull request title becomes the commit message (`type(scope): subject`, 72 characters or fewer). Never merge your own pull request or one with failing CI.
- **Journal:** every code, database or configuration change adds one new file in `docs/journal/` in the same pull request. Read the newest files and [OWNERSHIP.md](OWNERSHIP.md) before you start. See [JOURNAL.md](JOURNAL.md).
- **Database changes are not deployed by merging.** Someone must run the SQL on the real database: back up, try on a copy, then run. Migration files live in `Backend/migrations/`, each with a rollback.

### Database changes waiting to run in production

| Change | File | Notes |
|---|---|---|
| `routes.deleted_at` column | `Backend/migrations/2026-11-01-issue-013-routes-deleted-at.sql` | Run before the route-archiving release |
| `access_codes.city_id` column, foreign key, index | `Backend/migrations/2026-11-01-issue-012-access-codes-city-id.sql` | Then assign a city to every existing access code, then release the access code changes |

Keep this table current: remove a row once the change has run in production.

## Roles

| Role | What they can do |
|---|---|
| **driver** | Sign in, sign the agreement, set availability, save the day's journey (route and sequence range), see their own deliveries and pay summary, look up and add access codes, choose English or Spanish. Only their own data |
| **admin** | Works only in the cities assigned to them: drivers, routes, journeys, agreements, availability, access codes, dashboard and uploads |
| **superadmin** | Everything in every city. Also creates cities, routes and admins, and can reset all drivers' availability |

- Sign-in uses a short access token (15 minutes) and a refresh token (7 days). Signing out revokes both. Each token carries its role, and each area (admin, driver) keeps its own tokens.
- Login is rate limited per account and per address.
- An admin's cities come from the table `admin_city_ref`. Identity always comes from the token, never from the URL or body.

## Database tables

The schema notes in `Backend/config/dbquery.txt` are an **older snapshot**; the live database has more columns (for example driver timezone and agreement fields, `insurance_deduction`). When in doubt, run `\d table` on a copy.

| Table | Holds |
|---|---|
| `admin`, `admin_city_ref` | Admins (role admin or superadmin) and the cities each may use |
| `city` | Cities; `job` is the city's job name, `city_type` is DAILY or WEEKLY |
| `drivers` | Drivers: login, city, enabled flag, availability by weekday, agreement fields, language, timezone |
| `routes` | Routes with `job` (city), the four prices (company and driver, route and double stop), `route_code_in_string`, `enabled`, `deleted_at` (archived) |
| `route_taken_by_driver` | Which driver took which route and sequence range |
| `dashboard_data` | One row per journey: driver, route, date, sequence range, counts (delivered, failed, no scanned, double stops, first stops), paid flag |
| `deliveries` | One row per package of a journey (sequence number, address, status, final result) |
| `payment_dashboard` | Pay record per journey: counts, `driver_payment`, `company_earnings`, `insurance_deduction`, `closed`, `paid` |
| `todays_excel_data`, `staging_excel_upload` | The last daily Excel upload (rebuilt every upload) |
| `weeklycount`, `weekly_excel_data` | The weekly Excel upload: counts per delivery id (driver code), route and date in `weeklycount`; `weekly_excel_data` is an older table of matched driver names |
| `access_codes` | Gate and building codes with address, zip code, up to 3 image links, and the city |

The production database also has triggers on `dashboard_data` that fill and update `payment_dashboard` and clean up deliveries. **They are not in this repository.** Save a copy under `Backend/migrations/` the next time someone has database access.

## Excel upload flow (as the code is today)

### Daily upload (SpeedX): `POST /admin/doubleStop/dailyFileUpload`

1. The admin picks a date and a file. The sheet must be named `result`.
2. Everything runs in one database transaction. The table `todays_excel_data` is dropped and rebuilt from the file (route, sequence, address in lower case, unit, zip, tracking number, recipient, status, complete time). Each row gets `seq_route_code`: the sequence followed by the route text without its first 4 characters.
3. Each row is matched to a delivery by `seq_route_code` and date. The delivery gets the address, unit, zip, tracking number, recipient and status.
4. Final result per delivery: status `FAILED_ATTEMPT` is **failed_attempt**; `NEW`, `OUT_FOR_DELIVERY`, an empty status, or an untouched placeholder row is **no_scanned**; the rest is decided in step 5.
5. For the remaining deliveries, group by driver, route, date, address and unit. A group with one delivery, or the lowest sequence in a group, is a **first_stop**. The others are **double_stop**.
6. Counts on the unpaid journeys of that date are reset to 0 and recomputed from the deliveries: `delivered` is first stops plus double stops. Journeys already marked paid are not recounted.
7. Any error rolls the whole upload back.

### Weekly upload (GOFO): `POST /admin/doubleStop/weekly-upload`

1. The file needs the sheet `Details of Delivery Fees` with the columns Region/Route, Courier, Delivery ID, Signing Time and Stop Point Details. Delivery ID, signing time and stop point are required; rows missing them are skipped.
2. Rows are grouped by date, delivery id and route. Each group counts total deliveries, first stops (`fs`) and double stops (`ds`) in `weeklycount`; repeats of the same key add up.
3. When the admin confirms (`update-weekly-excel-to-dashboard`), each `weeklycount` row is matched to a driver by **driver code** (the file's Delivery ID is the driver's `driver_code`) and to a route by **route code** (`routes.route_code_in_string`, route must be enabled and the driver enabled). Rows that match create the journey (`dashboard_data`) and its pay record (`payment_dashboard`) and calculate pay; journeys that already exist for that driver and date are not created twice.
4. The insurance deduction is then applied (see Pay rules).
5. `weekly_excel_data` is an older table (driver names matched from the file, with an `ambiguous` flag). One pay update still refers to it. Ask Jasil whether it is still needed.

## Pay rules (as the code is today)

- **Per journey (dashboard "Calculate payment"):**
  - driver pay = double stops x driver double-stop price + first stops x driver route price
  - company earnings = double stops x (company double-stop price minus driver double-stop price) + first stops x (company route price minus driver route price)
  - The journey is then marked **closed**.
- **Prices** come from the route (`routes`). Drivers must never see company prices (the driver summary does not return them).
- **Insurance:** the weekly import takes **$1.92 per driver per working day**, applied once to one journey row of that driver-day even if the driver drove several routes (constant `INSURANCE_RATE_PER_DAY` in the weekly queries).
- **Mark as paid** (`POST /admin/dashboard/payDriver`): by driver name, optional date range, type (daily or weekly) and city. It only marks journeys that are **closed**. Paid rows are never recalculated.
- Pay, rate, deduction and import changes are high risk: show before and after totals in the pull request ([ENGINEERING_STANDARD.md](ENGINEERING_STANDARD.md) section 6).

## Where to find things

- Rules for everyone (people and AI tools): [AGENTS.md](../AGENTS.md), [CONTRIBUTING.md](../CONTRIBUTING.md), [ENGINEERING_STANDARD.md](ENGINEERING_STANDARD.md).
- Who owns what: [OWNERSHIP.md](OWNERSHIP.md). Jasil owns the Excel, pay and dashboard zone; ask before editing it.
- What changed and why: [journal/](journal/), one file per task.
- Work list: the GitHub issues.
