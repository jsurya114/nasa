-- Rollback for the driver type column. This DELETES the Local / Desi choices admins made, so export them first if you need them:
--   COPY (SELECT id, driver_type FROM drivers WHERE driver_type IS NOT NULL) TO STDOUT WITH CSV HEADER;
ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_driver_type_check;
ALTER TABLE drivers DROP COLUMN IF EXISTS driver_type;
