# Hide company-only prices from the driver delivery summary

| Field | Value |
|---|---|
| Date | 1 November 2026 |
| Author | Jayasoorya Suryadas, with Claude Code |
| Issue / PR | `#11` / pull request into `develop` |
| Branch | `fix/hide-company-prices` |
| Type / scope | `fix(deliveries)` |
| Files touched | `Backend/services/driver/deliveryQuery.js` |
| Reserved files touched | None |

## What and why

`GET /driver/deliveries/:driverId` returned the company's own route and double-stop prices to every driver. Drivers only need their own prices. The two company fields (`company_route_price`, `company_doublestop_price`) are removed from the response. All other fields, including `driver_route_price`, `driver_doublestop_price` and `earning`, are unchanged.

The driver frontend was searched: nothing in `Frontend/src` reads either company field, so the delivery page looks and totals the same.

**Database.** None. **Config and dependencies.** None.

**Money impact.** None. Pay is read from the stored `driver_payment` column, which this query does not change. No Excel, pay or dashboard file was touched.

**Tested.** `node --check` passes. The two fields were confirmed absent from the frontend by search. Not tested: the delivery page against a real database.

**Risks and follow-ups.** The admin side still returns company prices, which is intended. Any other client reading these two fields from the driver endpoint would now get `undefined`; none exists in this repository.
