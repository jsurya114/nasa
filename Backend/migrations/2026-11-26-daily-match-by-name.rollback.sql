-- Removes the remembered daily name matches and sub-route choices. The daily upload then finds drivers only by their exact name in the app
-- (or, with the switch off, works as before). No driver, route, delivery or pay row is changed.
DROP TABLE IF EXISTS daily_subroute_choices;
DROP TABLE IF EXISTS daily_name_matches;
