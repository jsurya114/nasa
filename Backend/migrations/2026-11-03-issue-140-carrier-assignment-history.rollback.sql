-- Rollback for issue #140. This deletes all retained carrier assignment evidence. Back up first.
DROP VIEW IF EXISTS carrier_package_assignments_live;
DROP TABLE IF EXISTS carrier_assignment_sightings;
DROP TABLE IF EXISTS carrier_package_assignments;
DROP TABLE IF EXISTS carrier_assignment_imports;
DROP FUNCTION IF EXISTS carrier_assignment_sightings_guard();
DROP FUNCTION IF EXISTS carrier_package_assignments_guard();
DROP FUNCTION IF EXISTS carrier_assignment_imports_guard();
