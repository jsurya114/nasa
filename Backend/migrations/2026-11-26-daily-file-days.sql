-- Daily upload that finds drivers by name: remember which driver days the file made, so uploading the same day again rebuilds them from the file
-- (a corrected name match then moves the parcels to the right driver instead of leaving them with the old one as well). Days entered by hand are
-- not listed here and are never rebuilt. A day that is paid, in a pay statement or matched to a carrier statement is never rebuilt either.
--
-- HOW TO RUN: BACK UP THE DATABASE FIRST and run on a copy first. Run after 2026-11-26-daily-match-by-name.sql and before deploying the code that
-- uses it. Safe to run more than once. Rollback: the .rollback.sql file next to this one.

CREATE TABLE IF NOT EXISTS daily_file_days (
  dashboard_data_id integer PRIMARY KEY REFERENCES dashboard_data(id) ON DELETE CASCADE,
  journey_date      date NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS daily_file_days_journey_date ON daily_file_days (journey_date);
