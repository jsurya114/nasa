# Everee: read the payment ID from the payable answer when it is a number (issue #31)

- **Date:** 2026-11-06
- **Author:** Jayasoorya (with Claude Code)
- **Issue / PR:** #31 / the pull request for `fix/everee-numeric-payment-id`
- **Branch:** `fix/everee-numeric-payment-id` (from `develop`)
- **Type and scope:** fix(payroll), backend
- **Files touched:** `Backend/services/payments/everee/paymentState.js` (`readPayable`), tests `Backend/tests/evereePaymentState.test.js` and `Backend/tests/evereePaymentStatus.test.js`. No reserved files.

**What happened.** A sandbox payment was approved in Everee and was waiting for the bank deposit. Everee's own answer for the payable already carried the payment ID, but "Check now" and the scheduled check said "Everee has not put this payable in a payment yet", and the item had no payment ID until a webhook arrived.

**Cause.** In Everee's payable answer the `paymentId` is a **number** (for example 29684488); in its webhook events and its Payment Data API it is text. `readPayable` accepted only text, so it ignored the number: the payment was found only when an event happened to name it (the item's `payment_link` was `event`), and a check made before that event could not see the payment at all.

**What changed.** `readPayable` accepts the payment ID as a text ID (as before) or as a positive safe whole number, which it keeps as text. Anything else (zero, negative, a fraction, NaN, infinity, a number beyond the safe range, a boolean, an object, an array, an unsafe text) is still no ID. Nothing else changed: finding the payment, reading its payouts and deciding paid are untouched.

**Database / config / dependencies:** None. **Money impact:** None.

**Tested.** `evereePaymentState.test.js`: a number is read as the same ID as text; bad values are not IDs. `evereePaymentStatus.test.js`, database, rolled back: new end-to-end case where the payable answer has a numeric payment ID: the payment is linked through the payable (`payment_link` = `payable`), a PAID payment with a PENDING payout stays submitted, and once the payout is PAID it is paid. With the old reader, that case and the unit test fail (checked). All Everee tests pass.

**Sandbox evidence (statuses only).** A payable answered `paymentId` as a number and `paymentStatus` PENDING_PAYMENT; the payment itself was APPROVED with deposit status READY_TO_DEPOSIT and no paid time yet, so it was correctly not paid.

**Not tested.** The deposit settling to PAID for that payment (it was still waiting for Everee when this was written).
