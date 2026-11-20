-- Synthetic data for the STAGING load-test database only. Every name, email, phone number and address is fictional.
-- Volumes match production row counts measured on 2026-11-20 (counts only; no production row was read):
--   8 cities, 100 routes, 10 admins, 786 drivers, ~30,370 dashboard rows, ~1.13 million deliveries,
--   30,370 payment rows, 11 pay runs, 470 pay statements, ~3,300 statement lines.
-- Run with psql: psql -v pwhash="'<bcrypt hash>'" -f seed-synthetic.sql   (the hash is of a random test password)
\set ON_ERROR_STOP on
BEGIN;

-- Refuse to run anywhere except the staging test database.
DO $$ BEGIN
  IF current_database() <> 'nasa_staging' THEN RAISE EXCEPTION 'seed refused: database % is not nasa_staging', current_database(); END IF;
  IF EXISTS (SELECT 1 FROM drivers) THEN RAISE EXCEPTION 'seed refused: drivers already has rows'; END IF;
END $$;

SELECT setseed(0.42); -- the same data on every run, so totals can be compared

INSERT INTO city (id, job, city_code, enabled, city_type)
SELECT i, 'Staging Job ' || i, 'STG' || lpad(i::text, 2, '0'), true, CASE WHEN i <= 6 THEN 'DAILY' ELSE 'WEEKLY' END
FROM generate_series(1, 8) i;

-- 100 routes; route r belongs to city ((r-1) % 8) + 1. Per-stop prices in dollars.
INSERT INTO routes (id, name, job, company_route_price, driver_route_price, company_doublestop_price, driver_doublestop_price, enabled, route_code_in_string)
SELECT r, 'Staging Route ' || r, 'Staging Job ' || ((r - 1) % 8 + 1), 2.10, 1.50, 1.05, 0.75, true, 'STGR' || lpad(r::text, 3, '0')
FROM generate_series(1, 100) r;

INSERT INTO admin (id, password, name, email, role, is_active)
SELECT i, :pwhash, 'Load Test Admin ' || i, 'loadtest-admin-' || lpad(i::text, 2, '0') || '@example.invalid',
       CASE WHEN i = 1 THEN 'superadmin' ELSE 'admin' END, true
FROM generate_series(1, 10) i;

-- Each city admin covers 2 or 3 cities (23 links, as in production).
INSERT INTO admin_city_ref (admin_id, city_id)
SELECT a, c FROM generate_series(2, 10) a, generate_series(1, 8) c
WHERE (c - a + 16) % 8 < CASE WHEN a <= 6 THEN 3 ELSE 2 END
LIMIT 23;

INSERT INTO drivers (id, password, name, email, driver_code, city_id, enabled, monday, tuesday, wednesday, thursday, friday, saturday, sunday,
                     availability_updated_at, phone_number, timezone, preferred_language, agreement_signed, agreement_signed_at,
                     agreement_signature_name, agreement_joining_date, driver_type)
SELECT d, :pwhash, 'Load Test Driver ' || lpad(d::text, 4, '0'), 'loadtest-driver-' || lpad(d::text, 4, '0') || '@example.invalid',
       100000 + d, (d - 1) % 8 + 1, true,
       random() < 0.8, random() < 0.8, random() < 0.8, random() < 0.8, random() < 0.8, random() < 0.5, random() < 0.3,
       now() - (random() * interval '30 days'), '555' || lpad(d::text, 7, '0'), 'America/Chicago', CASE WHEN d % 5 = 0 THEN 'es' ELSE 'en' END,
       true, now() - interval '200 days', 'Load Test Driver ' || lpad(d::text, 4, '0'), current_date - 200, CASE WHEN d % 5 = 0 THEN 'DESI' ELSE 'LOCAL' END
FROM generate_series(1, 786) d;

-- One dashboard row per driver working day: 30,370 rows over the last 365 days, a route of the driver's own city.
CREATE TEMP TABLE work_days AS
SELECT i AS id,
       1 + (i * 7919) % 786 AS driver_id,
       current_date - (i % 365) AS journey_date,
       25 + (i % 25) AS packages
FROM generate_series(1, 30370) i;
ALTER TABLE work_days ADD COLUMN route_id int;
UPDATE work_days SET route_id = LEAST(100, ((driver_id - 1) % 8 + 1) + 8 * ((id / 7) % 12));

INSERT INTO dashboard_data (id, driver_id, journey_date, route_id, packages, no_scanned, failed_attempt, ds, delivered, closed,
                            driver_payment, paid, start_seq, end_seq, first_stop, is_deliveries_count_added, company_earnings)
SELECT w.id, w.driver_id, w.journey_date, w.route_id, w.packages, 1, 1, w.packages / 5, w.packages - 2, w.journey_date < current_date - 7,
       ((w.packages - w.packages / 5) * 1.50 + (w.packages / 5) * 0.75)::numeric(10,2), w.journey_date < current_date - 14,
       1, w.packages, w.packages - w.packages / 5, true,
       ((w.packages - w.packages / 5) * 0.60 + (w.packages / 5) * 0.30)::numeric(10,2)
FROM work_days w;

-- The after_dashboard_insert trigger has already created one payment_dashboard row per dashboard row (ids, dates,
-- packages, sequences), exactly as in production. Fill in the payment fields the trigger leaves empty.
UPDATE payment_dashboard pd
SET no_scanned = d.no_scanned, failed_attempt = d.failed_attempt, fs = d.packages - d.ds, ds = d.ds, delivered = d.delivered,
    closed = d.closed, payment_date = CASE WHEN d.paid THEN d.journey_date + 7 END, driver_payment = d.driver_payment, paid = d.paid,
    first_stop = d.first_stop, company_earnings = d.company_earnings, insurance_deduction = CASE WHEN d.driver_payment >= 5 THEN 1.00 ELSE 0 END
FROM dashboard_data d
WHERE pd.dashboard_data_id = d.id;

-- ~1.13 million deliveries: one per package, linked to its dashboard row. Fictional recipients and addresses.
INSERT INTO deliveries (driver_id, driver_set_date, route_id, sequence_number, address, zip_code, recp_name, recipient_phone,
                        status, courier_code, address_unit, seq_route_code, final_result, dashboard_data_id)
SELECT w.driver_id, w.journey_date, w.route_id, s,
       s || ' Test Street', 75000 + (w.driver_id % 100), 'Test Recipient', '5550000000', 'Delivered', 'NA', 'No_Address_Unit',
       'D' || w.driver_id || 'R' || w.route_id || 'S' || s,
       (CASE WHEN s % 5 = 0 THEN 'double_stop' WHEN s = w.packages THEN 'failed_attempt' ELSE 'first_stop' END)::final_result_enum,
       w.id
FROM work_days w, generate_series(1, w.packages) s;

-- 11 finalized weekly pay runs and 470 statements; each statement has ~7 earning lines tied to real payment rows.
INSERT INTO pay_runs (id, request_id, city_id, period_start, period_end, data_type, status, created_by, created_at, finalized_by, finalized_at)
SELECT r, gen_random_uuid(), (r - 1) % 8 + 1, current_date - 7 * (r + 2), current_date - 7 * (r + 2) + 6, 'weekly', 'finalized', 1,
       now() - interval '1 day' * 7 * (r + 1), 1, now() - interval '1 day' * 7 * (r + 1)
FROM generate_series(1, 11) r;

CREATE TEMP TABLE stmt AS
SELECT s AS id, (s - 1) % 11 + 1 AS pay_run_id FROM generate_series(1, 470) s;
ALTER TABLE stmt ADD COLUMN driver_id int;
UPDATE stmt SET driver_id = (SELECT d.id FROM drivers d WHERE d.city_id = (stmt.pay_run_id - 1) % 8 + 1 ORDER BY d.id OFFSET (stmt.id / 11) % 98 LIMIT 1);

CREATE TEMP TABLE stmt_lines AS
SELECT st.id AS statement_id, pd.id AS payment_dashboard_id, pd.driver_payment AS amount, pd.journey_date,
       row_number() OVER (PARTITION BY st.id ORDER BY pd.journey_date) AS n
FROM stmt st JOIN pay_runs r ON r.id = st.pay_run_id
JOIN LATERAL (SELECT p.* FROM payment_dashboard p WHERE p.driver_id = st.driver_id ORDER BY p.journey_date DESC OFFSET 30 + st.pay_run_id * 3 LIMIT 7) pd ON true;

INSERT INTO pay_statements (id, pay_run_id, driver_id, gross, insurance, reimbursements, claim_deductions, recoveries, net, carried_forward, payout_status, paid_at)
SELECT st.id, st.pay_run_id, st.driver_id, g.gross, 0, 0, 0, 0, g.gross, 0, 'paid', now() - interval '3 days'
FROM stmt st JOIN (SELECT statement_id, sum(amount) AS gross FROM stmt_lines GROUP BY statement_id) g ON g.statement_id = st.id;

INSERT INTO pay_statement_lines (statement_id, line_type, amount, payment_dashboard_id, journey_date, active)
SELECT l.statement_id, 'earning', l.amount, l.payment_dashboard_id, l.journey_date, true
FROM stmt_lines l WHERE l.statement_id IN (SELECT id FROM pay_statements);

-- Move every id sequence past the seeded ids so the application can insert new rows.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT s.relname AS seq, t.relname AS tbl, a.attname AS col
           FROM pg_class s JOIN pg_depend d ON d.objid = s.oid JOIN pg_class t ON t.oid = d.refobjid
           JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
           WHERE s.relkind = 'S' AND t.relnamespace = 'public'::regnamespace LOOP
    EXECUTE format('SELECT setval(%L, GREATEST(1, (SELECT COALESCE(max(%I), 0) FROM %I)))', 'public.' || r.seq, r.col, r.tbl);
  END LOOP;
END $$;

-- Insights reads the reporting views through a separate read-only login (the bootstrap creates the role).
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'nasa_reporting_reader') THEN
    GRANT USAGE ON SCHEMA reporting TO nasa_reporting_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA reporting TO nasa_reporting_reader;
  END IF;
END $$;

COMMIT;
ANALYZE;

-- Expected-total fixture: the load test compares these after it runs.
SELECT 'drivers' AS item, count(*)::text AS value FROM drivers
UNION ALL SELECT 'deliveries', count(*)::text FROM deliveries
UNION ALL SELECT 'dashboard_data', count(*)::text FROM dashboard_data
UNION ALL SELECT 'payment_dashboard driver_payment total', sum(driver_payment)::text FROM payment_dashboard
UNION ALL SELECT 'pay_statements', count(*)::text FROM pay_statements
UNION ALL SELECT 'pay_statements net total', sum(net)::text FROM pay_statements
UNION ALL SELECT 'database size', pg_size_pretty(pg_database_size(current_database()));
