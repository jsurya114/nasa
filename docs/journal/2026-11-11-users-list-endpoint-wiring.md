# Users page: the list endpoint now uses the new driver list

Review fix for the Users page Everee status, sorting and filters pull request. That pull request added `Backend/services/admin/driverList.js` and a frontend that sends the new filter and sort choices, but `GET /admin/get-users` still ran the old search-only queries. The server ignored the new choices and answered without `counts`, `total`, `everee` or a status per driver, so the Everee column, the chips, the filters and the sorting would all have done nothing.

`getUsers` in `addUserController.js` now checks the query with `parseListQuery` (an unknown choice is a 400 with a message), picks the scope from the token (a super admin sees every driver, any other admin only the drivers in their own cities), and answers with the result of `listDrivers`. The response keeps `drivers`, `page` and `totalPages` and adds `total`, `counts` and `everee`. The old list and count queries in `dbQueries.js` are no longer used by this page and were left in place; removing them is a separate cleanup.

Validation: new `tests/getUsersController.test.js` (an unknown filter, sort or page is a 400; with `PAYROLL_TEST_DB=1` the endpoint returns an Everee status for every driver and counts that match the total). The list database test passes. Not checked: a browser run against real production data.
