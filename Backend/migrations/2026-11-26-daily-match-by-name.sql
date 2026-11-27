-- Daily upload, drivers found by name (the daily file names the driver on every row; it has no Delivery ID). Two remembered choices, per city:
--
-- daily_name_matches       "this name in the file = this driver". Used when a file name does not match a driver's name in the app.
-- daily_subroute_choices   "on this main route, this driver gets this sub-route" (for example DFW 053 A-1 -> DFW 053 A-1:B). The file only names the
--                          main route; the sub-route decides the price and keeps two drivers who share sequence numbers apart.
--
-- Both keep who set the choice and when. An admin can see, change and undo every entry (undo deletes the row). Nothing existing changes.
--
-- Pre-fill (at the end): from the last 28 days of daily work, a driver who was on exactly one sub-route of a main route, and never on that main route
-- itself, gets that sub-route as their choice (source 'history', set_by NULL). Anyone else gets no entry and is paid at the main route's price
-- (each upload lists them). Run the SELECT at the bottom to see what was pre-filled.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Run BEFORE deploying the code that reads the tables. Safe to run more than once
-- (the pre-fill never overwrites an entry that exists). Rollback: the .rollback.sql file next to this one.

CREATE TABLE IF NOT EXISTS daily_name_matches (
  id         serial PRIMARY KEY,
  city_id    integer NOT NULL REFERENCES city(id) ON DELETE CASCADE,
  name_key   text    NOT NULL,                      -- the file name as NAME_KEY_SQL makes it (case, spaces, NFC)
  file_name  text    NOT NULL,                      -- the name as it was in the file, for display
  driver_id  integer NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  set_by     integer REFERENCES admin(id) ON DELETE SET NULL,
  set_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, name_key)
);

CREATE TABLE IF NOT EXISTS daily_subroute_choices (
  id             serial PRIMARY KEY,
  city_id        integer NOT NULL REFERENCES city(id) ON DELETE CASCADE,
  main_route_id  integer NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  driver_id      integer NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  sub_route_id   integer NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  source         text    NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'history')),
  set_by         integer REFERENCES admin(id) ON DELETE SET NULL,
  set_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, main_route_id, driver_id),
  CHECK (sub_route_id <> main_route_id)
);

-- Pre-fill from history (see the header).
WITH recent AS (
  SELECT dd.driver_id, r.id AS route_id, r.job, r.route_code_in_string AS code
    FROM dashboard_data dd JOIN routes r ON r.id = dd.route_id
   WHERE (dd.start_seq <> 0 OR dd.end_seq <> 0) AND dd.journey_date > current_date - 28
), on_sub AS (
  SELECT rc.driver_id, m.id AS main_route_id, rc.job, rc.route_id AS sub_route_id
    FROM recent rc JOIN routes m ON m.job = rc.job AND m.route_code_in_string = split_part(rc.code, ':', 1) AND m.deleted_at IS NULL
   WHERE rc.code LIKE '%:%'
), single AS (
  SELECT driver_id, main_route_id, job, min(sub_route_id) AS sub_route_id
    FROM on_sub GROUP BY driver_id, main_route_id, job
  HAVING count(DISTINCT sub_route_id) = 1
)
INSERT INTO daily_subroute_choices (city_id, main_route_id, driver_id, sub_route_id, source, set_by)
SELECT c.id, s.main_route_id, s.driver_id, s.sub_route_id, 'history', NULL
  FROM single s JOIN city c ON c.job = s.job
 WHERE NOT EXISTS (SELECT 1 FROM recent rc WHERE rc.driver_id = s.driver_id AND rc.route_id = s.main_route_id)
ON CONFLICT (city_id, main_route_id, driver_id) DO NOTHING;

-- What was pre-filled (driver id and route codes only).
SELECT ch.driver_id, m.route_code_in_string AS main_route, s.route_code_in_string AS sub_route
  FROM daily_subroute_choices ch JOIN routes m ON m.id = ch.main_route_id JOIN routes s ON s.id = ch.sub_route_id
 WHERE ch.source = 'history' ORDER BY 2, 3, 1;
