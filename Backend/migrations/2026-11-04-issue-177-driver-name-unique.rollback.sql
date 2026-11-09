-- Rollback for issue #177: removes the normalized-name unique index. The exact UNIQUE (name) constraint stays.
DROP INDEX IF EXISTS drivers_name_normalized_key;
