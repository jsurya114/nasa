import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  parsePaymentRecord,
  recordRunPayment,
  listPaymentRuns,
  reviewRunPayments,
} from "../services/payroll/payRuns/paymentRecords.js";
import {
  generateRun,
  finalizeRun,
  getRun,
  setRecoveryLimit,
  voidRun,
} from "../services/payroll/payRuns/payRunStore.js";
import { createEntry } from "../services/payroll/ledger/ledgerStore.js";
import { parseNewEntry } from "../services/payroll/ledger/ledgerRules.js";
import { getDriverBalances } from "../services/payroll/statements/statementStore.js";

test("payment confirmation requires a date, method, reference and explicit receipt confirmation", () => {
  const body = {
    requestId: randomUUID(),
    paidOn: "2026-11-04",
    method: "cash",
    reference: "Synthetic cash receipt",
    confirmed: true,
  };
  assert.ok(parsePaymentRecord(body).request);
  assert.ok(parsePaymentRecord({ ...body, method: "check" }).request, "a check can be recorded");
  for (const change of [
    { confirmed: false },
    { method: "everee" },
    { paidOn: "2026-02-30" },
    { reference: "x" },
    { statementIds: [] },
    { statementIds: [-1] },
  ])
    assert.ok(parsePaymentRecord({ ...body, ...change }).errors);
  assert.deepEqual(
    parsePaymentRecord({ ...body, statementIds: [2, 1, 2] }).request
      .statementIds,
    [1, 2],
  );
});

test(
  "approved payments are scoped, atomic, idempotent and preserve frozen money and debt",
  {
    skip:
      process.env.PAYROLL_TEST_DB !== "1" &&
      "set PAYROLL_TEST_DB=1 on a local copy",
  },
  async (t) => {
    const { default: pool } = await import("../config/db.js");
    const db = await pool.connect();
    const one = async (sql, args) => (await db.query(sql, args)).rows[0];
    try {
      await db.query("BEGIN");
      for (const file of [
        "2026-11-03-issue-141-courier-claims.sql",
        "2026-11-03-issue-142-driver-ledger.sql",
        "2026-11-03-issue-143-pay-runs.sql",
        "2026-11-03-issue-166-ledger-settlements.sql",
        "2026-11-04-issue-180-claim-courier-name.sql",
        "2026-11-04-approved-run-payment-records.sql",
        "2026-11-13-payment-method-check.sql",
      ])
        await db.query(
          readFileSync(
            new URL(`../migrations/${file}`, import.meta.url),
            "utf8",
          ),
        );
      const city = (
        await one(
          "INSERT INTO city(job,city_code,city_type) VALUES('Synthetic Payment City','TEST-PAY','WEEKLY') RETURNING id",
        )
      ).id;
      const other = (
        await one(
          "INSERT INTO city(job,city_code,city_type) VALUES('Synthetic Other City','TEST-OTHER','WEEKLY') RETURNING id",
        )
      ).id;
      const route = (
        await one(
          "INSERT INTO routes(name,job,company_route_price,driver_route_price,company_doublestop_price,driver_doublestop_price,route_code_in_string) VALUES('Synthetic Route','Synthetic Payment City',2,1,1,1,'TESTPAY') RETURNING id",
        )
      ).id;
      const makeAdmin = async (role) =>
        one(
          "INSERT INTO admin(name,email,password,role) VALUES($1,$2,'x',$3) RETURNING id,role",
          [
            `Synthetic ${role} ${randomUUID()}`,
            `${randomUUID()}@example.test`,
            role,
          ],
        );
      const superAdmin = await makeAdmin("superadmin"),
        admin = await makeAdmin("admin"),
        outsider = await makeAdmin("admin");
      await db.query(
        "INSERT INTO admin_city_ref(admin_id,city_id) VALUES($1,$2),($3,$4)",
        [admin.id, city, outsider.id, other],
      );
      const drivers = [];
      for (let i = 0; i < 2; i++)
        drivers.push(
          (
            await one(
              "INSERT INTO drivers(name,email,password,driver_code,city_id,driver_type) VALUES($1,$2,'x',$3,$4,'LOCAL') RETURNING id",
              [
                `Synthetic Payment Driver ${i}`,
                `${randomUUID()}@example.test`,
                8800100 + i,
                city,
              ],
            )
          ).id,
        );
      const today = (
        await one("SELECT to_char(CURRENT_DATE,'YYYY-MM-DD') AS d")
      ).d;
      const start = (
        await one("SELECT to_char(CURRENT_DATE-6,'YYYY-MM-DD') AS d")
      ).d;
      await setRecoveryLimit(
        db,
        superAdmin,
        { type: "fixed_amount", value: "1000.00" },
        "Synthetic test limit",
      );
      const payIds = [];
      for (let i = 0; i < 2; i++) {
        const dd = (
          await one(
            "INSERT INTO dashboard_data(driver_id,route_id,start_seq,end_seq,journey_date,packages) VALUES($1,$2,0,0,$3,10) RETURNING id",
            [drivers[i], route, today],
          )
        ).id;
        payIds.push(
          (
            await one(
              "UPDATE payment_dashboard SET closed=true,paid=false,driver_payment=$2,insurance_deduction=10 WHERE dashboard_data_id=$1 RETURNING id",
              [dd, 100 + i * 100],
            )
          ).id,
        );
      }
      await createEntry(
        db,
        admin,
        parseNewEntry({
          requestId: randomUUID(),
          type: "advance",
          driverId: drivers[0],
          cityId: city,
          amount: "100",
          reason: "Synthetic cash advance",
          effectiveDate: today,
          disbursedOutsidePayroll: true,
          recoveryPlan: "installments",
          installmentAmount: "50",
        }).entry,
      );
      const makeRun = () =>
        generateRun(db, admin, {
          requestId: randomUUID(),
          cityId: city,
          periodStart: start,
          periodEnd: today,
          dataType: "weekly",
        });
      const run = (await makeRun()).run;
      const request = (extra = {}) =>
        parsePaymentRecord({
          requestId: randomUUID(),
          paidOn: today,
          method: "cash",
          reference: "Synthetic batch reference",
          confirmed: true,
          ...extra,
        }).request;
      const isolated = async (fn) => {
        await db.query("SAVEPOINT payment_case");
        try {
          await fn();
        } finally {
          await db.query("ROLLBACK TO SAVEPOINT payment_case");
        }
      };
      await t.test("an unapproved run cannot be marked paid", async () => {
        await assert.rejects(recordRunPayment(db, admin, run.id, request()), {
          status: 409,
        });
      });
      await finalizeRun(db, admin, run.id);
      const frozen = (await getRun(db, admin, run.id)).statements;
      const first = frozen.find((s) => s.driver_id === drivers[0]),
        second = frozen.find((s) => s.driver_id === drivers[1]);
      assert.deepEqual([first.net, first.carried_forward], ["40.00", "50.00"]);

      await t.test(
        "city access and statement membership are checked before any payment",
        async () =>
          isolated(async () => {
            await assert.rejects(
              recordRunPayment(db, outsider, run.id, request()),
              { status: 403 },
            );
            await assert.rejects(
              listPaymentRuns(db, outsider, { cityId: city }),
              { status: 403 },
            );
            assert.deepEqual((await listPaymentRuns(db, outsider)).runs, []);
            await assert.rejects(
              recordRunPayment(
                db,
                admin,
                run.id,
                request({ statementIds: [999999999] }),
              ),
              { status: 400 },
            );
            await assert.rejects(
              recordRunPayment(
                db,
                admin,
                run.id,
                request({ paidOn: "2999-01-01" }),
              ),
              { status: 400 },
            );
          }),
      );
      await t.test(
        "a Desi driver is paid by check and a Local driver in cash, one row per driver; the type is kept as it was and a later change does not rewrite it",
        async () =>
          isolated(async () => {
            await db.query("UPDATE drivers SET driver_type='DESI' WHERE id=$1", [drivers[0]]);
            await db.query("UPDATE drivers SET driver_type='LOCAL' WHERE id=$1", [drivers[1]]);
            const review = await reviewRunPayments(db, admin, run.id);
            const typeOf = (driver) => review.drivers.find((d) => d.driverId === driver).driverType;
            assert.deepEqual([typeOf(drivers[0]), typeOf(drivers[1])], ["DESI", "LOCAL"]);
            const done = await recordRunPayment(db, admin, run.id, request({ method: "check", statementIds: [first.id] }));
            const doneLocal = await recordRunPayment(db, admin, run.id, request({ method: "cash", statementIds: [second.id] }));
            assert.deepEqual([done.receipt.method, done.receipt.drivers, doneLocal.receipt.method, doneLocal.receipt.drivers], ["check", 1, "cash", 1]);
            const rows = (
              await db.query(
                "SELECT driver_id,driver_type,amount::text FROM pay_run_payment_items WHERE payment_record_id = ANY($1::bigint[]) ORDER BY driver_id",
                [[done.receipt.id, doneLocal.receipt.id]],
              )
            ).rows;
            assert.deepEqual(
              rows.map((r) => [r.driver_id, r.driver_type]),
              [[drivers[0], "DESI"], [drivers[1], "LOCAL"]].sort((a, b) => a[0] - b[0]),
              "one row per driver, each with the type the driver had when paid",
            );
            await db.query("UPDATE drivers SET driver_type='LOCAL' WHERE id=$1", [drivers[0]]);
            const after = (
              await db.query(
                "SELECT driver_id,driver_type FROM pay_run_payment_items WHERE payment_record_id=$1 AND driver_id=$2",
                [done.receipt.id, drivers[0]],
              )
            ).rows[0];
            assert.equal(after.driver_type, "DESI", "changing the type later does not rewrite history");
            const history = await reviewRunPayments(db, admin, run.id);
            assert.equal(
              history.drivers.find((d) => d.driverId === drivers[0]).payment.driver_type,
              "DESI",
            );
          }),
      );
      await t.test(
        "a check is recorded as a check for Desi drivers",
        async () =>
          isolated(async () => {
            await db.query("UPDATE drivers SET driver_type='DESI' WHERE id=ANY($1::int[])", [drivers]);
            const done = await recordRunPayment(db, admin, run.id, request({ method: "check" }));
            assert.equal(done.receipt.method, "check");
            assert.equal((await one("SELECT method FROM pay_run_payment_records WHERE id=$1", [done.receipt.id])).method, "check");
          }),
      );
      await t.test(
        "a new cash payment for a Desi driver is refused and writes nothing, while an older cash request still replays its receipt",
        async () =>
          isolated(async () => {
            // An older cash payment, recorded while the drivers were Local (the way cash payments were recorded before this change).
            await db.query("UPDATE drivers SET driver_type='LOCAL' WHERE id=ANY($1::int[])", [drivers]);
            const legacy = request({ method: "cash" });
            const recorded = await recordRunPayment(db, admin, run.id, legacy);
            assert.equal(recorded.receipt.method, "cash");
            const before = Number((await one("SELECT count(*) n FROM pay_run_payment_records WHERE pay_run_id=$1", [run.id])).n);
            // The drivers are Desi now. Retrying the same request ID replays the saved receipt: nothing new is written.
            await db.query("UPDATE drivers SET driver_type='DESI' WHERE id=ANY($1::int[])", [drivers]);
            const again = await recordRunPayment(db, admin, run.id, legacy);
            assert.deepEqual([again.replay, again.receipt.id, again.receipt.method], [true, recorded.receipt.id, "cash"]);
            assert.equal(Number((await one("SELECT count(*) n FROM pay_run_payment_records WHERE pay_run_id=$1", [run.id])).n), before);
          }),
      );
      await t.test(
        "a new Desi cash request (an older client) is refused and nothing is written",
        async () =>
          isolated(async () => {
            await db.query("UPDATE drivers SET driver_type='DESI' WHERE id=ANY($1::int[])", [drivers]);
            await assert.rejects(recordRunPayment(db, admin, run.id, request({ method: "cash" })), { status: 409, message: /not allowed/ });
            assert.equal(Number((await one("SELECT count(*) n FROM pay_run_payment_records WHERE pay_run_id=$1", [run.id])).n), 0);
            assert.equal(Number((await one("SELECT count(*) n FROM pay_statements WHERE pay_run_id=$1 AND payout_status='paid'", [run.id])).n), 0);
          }),
      );
      await t.test(
        "a check is refused for a Local driver and nothing is written",
        async () =>
          isolated(async () => {
            await db.query("UPDATE drivers SET driver_type='LOCAL' WHERE id=ANY($1::int[])", [drivers]);
            await assert.rejects(recordRunPayment(db, admin, run.id, request({ method: "check" })), { status: 409 });
            assert.equal(Number((await one("SELECT count(*) n FROM pay_run_payment_records WHERE pay_run_id=$1", [run.id])).n), 0);
          }),
      );
      await t.test(
        "a driver with no type is never paid: review blocks them, and recording one refuses the whole selection and writes nothing",
        async () =>
          isolated(async () => {
            await db.query("UPDATE drivers SET driver_type='LOCAL' WHERE id=$1", [drivers[0]]);
            await db.query("UPDATE drivers SET driver_type=NULL WHERE id=$1", [drivers[1]]);
            const review = await reviewRunPayments(db, admin, run.id);
            const untyped = review.drivers.find((d) => d.driverId === drivers[1]);
            assert.equal(untyped.eligible, false);
            assert.ok(untyped.blockers.some((b) => b.code === "driver_type_not_set" && b.severity === "blocking"));
            assert.equal(review.drivers.find((d) => d.driverId === drivers[0]).eligible, true);
            // One good driver and one untyped: all or nothing.
            await assert.rejects(recordRunPayment(db, admin, run.id, request()), { status: 409 });
            await assert.rejects(
              recordRunPayment(db, admin, run.id, request({ statementIds: [second.id] })),
              { status: 409 },
            );
            assert.equal(
              Number((await one("SELECT count(*) n FROM pay_run_payment_records WHERE pay_run_id=$1", [run.id])).n),
              0,
            );
            assert.deepEqual(
              (await db.query("SELECT payout_status FROM pay_statements WHERE pay_run_id=$1 ORDER BY id", [run.id])).rows.map((r) => r.payout_status),
              ["not_submitted", "not_submitted"],
            );
            // The good driver alone can still be paid.
            const ok = await recordRunPayment(db, admin, run.id, request({ statementIds: [first.id] }));
            assert.equal(ok.receipt.drivers, 1);
          }),
      );
      await t.test(
        "only cash or a check can be recorded by hand: the request check and the server both refuse any other method",
        async () =>
          isolated(async () => {
            for (const method of ["bank_transfer", "other", "everee", "CASH", ""])
              assert.ok(parsePaymentRecord({ requestId: randomUUID(), paidOn: today, method, reference: "Synthetic note", confirmed: true }).errors?.method, method);
            await db.query("UPDATE drivers SET driver_type='LOCAL' WHERE id=ANY($1::int[])", [drivers]);
            await assert.rejects(
              recordRunPayment(db, admin, run.id, { ...request(), method: "other" }),
              { status: 409 },
            );
            await assert.rejects(
              recordRunPayment(db, admin, run.id, { ...request(), method: "everee" }),
              { status: 409 },
            );
            assert.equal(
              Number((await one("SELECT count(*) n FROM pay_run_payment_records WHERE pay_run_id=$1", [run.id])).n),
              0,
            );
          }),
      );
      await t.test(
        "processing payments block the whole selection and are disclosed in review",
        async () =>
          isolated(async () => {
            await db.query(
              "UPDATE pay_statements SET payout_status='submitted' WHERE id=$1",
              [first.id],
            );
            const review = await reviewRunPayments(db, admin, run.id);
            assert.equal(
              review.drivers.find(
                (d) => String(d.statementId) === String(first.id),
              ).eligible,
              false,
            );
            await assert.rejects(
              recordRunPayment(db, admin, run.id, request()),
              { status: 409 },
            );
            assert.equal(
              Number(
                (
                  await one(
                    "SELECT count(*) n FROM pay_run_payment_records WHERE pay_run_id=$1",
                    [run.id],
                  )
                ).n,
              ),
              0,
            );
          }),
      );
      await t.test(
        "a failed write rolls back payment flags and the receipt together",
        async () =>
          isolated(async () => {
            await db.query("SAVEPOINT failed_payment");
            const broken = {
              query: (sql, args) =>
                sql.startsWith("UPDATE pay_statements SET payout_status")
                  ? Promise.reject(new Error("Synthetic failure"))
                  : db.query(sql, args),
            };
            await assert.rejects(
              recordRunPayment(broken, admin, run.id, request()),
              /Synthetic failure/,
            );
            await db.query("ROLLBACK TO SAVEPOINT failed_payment");
            assert.equal(
              Number(
                (
                  await one(
                    "SELECT count(*) n FROM payment_dashboard WHERE id=ANY($1::int[]) AND paid",
                    [payIds],
                  )
                ).n,
              ),
              0,
            );
            assert.equal(
              Number(
                (
                  await one(
                    "SELECT count(*) n FROM pay_run_payment_records WHERE pay_run_id=$1",
                    [run.id],
                  )
                ).n,
              ),
              0,
            );
          }),
      );
      await t.test(
        "changed or legacy-marked earnings are blocked without creating a receipt",
        async () =>
          isolated(async () => {
            await db.query(
              "UPDATE payment_dashboard SET paid=true WHERE id=$1",
              [payIds[0]],
            );
            assert.equal(
              (await reviewRunPayments(db, admin, run.id)).drivers.find(
                (d) => String(d.statementId) === String(first.id),
              ).eligible,
              false,
            );
            await assert.rejects(
              recordRunPayment(db, admin, run.id, request()),
              { status: 409 },
            );
            await db.query(
              "UPDATE payment_dashboard SET paid=false,insurance_deduction=11 WHERE id=$1",
              [payIds[0]],
            );
            await assert.rejects(
              recordRunPayment(db, admin, run.id, request()),
              { status: 409 },
            );
          }),
      );
      await t.test(
        "the Everee onboarding gate holds a Local driver for cash too: the whole selection is refused with a stable reason and nothing is written",
        async () =>
          isolated(async () => {
            for (const file of [
              "2026-11-04-issue-031-everee-workers.sql",
              "2026-11-07-issue-242-everee-driver-onboarding.sql",
            ])
              await db.query(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
            const keys = ["EVEREE_API_TOKEN", "EVEREE_TENANT_ID", "EVEREE_DRIVER_ONBOARDING_ENABLED", "EVEREE_ONBOARDING_ENFORCED"];
            const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
            const records = async () => Number((await one("SELECT count(*) n FROM pay_run_payment_records WHERE pay_run_id=$1", [run.id])).n);
            const link = (driverId, complete, tenant = "4321") =>
              db.query(
                `INSERT INTO everee_workers(driver_id,environment,tenant_id,everee_worker_id,link_source,onboarding_complete,linked_by)
                 VALUES($1,'sandbox',$2,$3,'matched_email',$4,$5)`,
                [driverId, tenant, `W-${driverId}-${tenant}`, complete, admin.id],
              );
            const eligible = async (statement) =>
              (await reviewRunPayments(db, admin, run.id)).drivers.find((d) => String(d.statementId) === String(statement.id));
            try {
              // Off (flags absent): nobody is held, as before.
              assert.equal((await eligible(first)).eligible, true);
              Object.assign(process.env, {
                EVEREE_API_TOKEN: "tsk_test_ABCDEF123456",
                EVEREE_TENANT_ID: "4321",
                EVEREE_DRIVER_ONBOARDING_ENABLED: "true",
                EVEREE_ONBOARDING_ENFORCED: "true",
              });
              await link(drivers[1], true);
              const held = await eligible(first);
              assert.equal(held.eligible, false);
              assert.ok(held.blockers.some((b) => b.code === "onboarding_required" && b.severity === "blocking"));
              assert.equal((await eligible(second)).eligible, true);
              const before = await records();
              // A mixed selection is refused whole: the verified driver is not paid either.
              await assert.rejects(recordRunPayment(db, admin, run.id, request()), { status: 409, code: "onboarding_required" });
              await assert.rejects(recordRunPayment(db, admin, run.id, request({ statementIds: [Number(first.id)] })), { status: 409, code: "onboarding_required" });
              assert.equal(await records(), before);
              assert.equal((await one("SELECT payout_status FROM pay_statements WHERE id=$1", [second.id])).payout_status, "not_submitted");
              // An incomplete link, a legacy link with no tenant and a link of another tenant do not count.
              await link(drivers[0], false);
              await assert.rejects(recordRunPayment(db, admin, run.id, request()), { code: "onboarding_required" });
              await db.query("UPDATE everee_workers SET onboarding_complete = true WHERE driver_id = $1", [drivers[0]]);
              await db.query("UPDATE everee_workers SET unlinked_by = $2, unlinked_at = now(), unlink_reason = 'test' WHERE driver_id = $1", [drivers[0], admin.id]);
              await link(drivers[0], true, null);
              await assert.rejects(recordRunPayment(db, admin, run.id, request()), { code: "onboarding_required" });
              // The verified driver alone can be paid; the held one cannot be.
              const paid = await recordRunPayment(db, admin, run.id, request({ statementIds: [Number(second.id)] }));
              assert.equal(paid.receipt.drivers, 1);
              await assert.rejects(recordRunPayment(db, admin, run.id, request({ statementIds: [Number(first.id)] })), { code: "onboarding_required" });
              // A Desi driver is not held by this gate (its own cash-only rule applies).
              await db.query("UPDATE drivers SET driver_type='DESI' WHERE id=$1", [drivers[0]]);
              assert.equal((await eligible(first)).eligible, true);
            } finally {
              for (const k of keys) {
                if (saved[k] === undefined) delete process.env[k];
                else process.env[k] = saved[k];
              }
            }
          }),
      );
      await t.test(
        "partial payment, replay and completion update only included work, preserving the debt",
        async () => {
          const partial = request({ statementIds: [Number(first.id)] });
          const result = await recordRunPayment(db, admin, run.id, partial);
          assert.deepEqual(
            [
              result.receipt.drivers,
              result.receipt.total,
              result.receipt.recorded_by,
            ],
            [1, "40.00", admin.id],
          );
          await db.query("SAVEPOINT permanent_receipt");
          await assert.rejects(
            db.query(
              "UPDATE pay_run_payment_records SET reference='Changed' WHERE id=$1",
              [result.receipt.id],
            ),
            /payment history is permanent/,
          );
          await db.query("ROLLBACK TO SAVEPOINT permanent_receipt");
          await assert.rejects(
            db.query(
              "DELETE FROM pay_run_payment_items WHERE payment_record_id=$1",
              [result.receipt.id],
            ),
            /payment history is permanent/,
          );
          await db.query("ROLLBACK TO SAVEPOINT permanent_receipt");
          assert.equal(
            (await recordRunPayment(db, admin, run.id, partial)).replay,
            true,
          );
          await assert.rejects(
            recordRunPayment(db, admin, run.id, {
              ...partial,
              reference: "Different reference",
            }),
            { status: 409 },
          );
          const cards = (await listPaymentRuns(db, admin)).runs;
          const card = cards.find((r) => String(r.id) === String(run.id));
          assert.deepEqual(
            [card.paid, card.drivers, card.remaining],
            [1, 2, "190.00"],
          );
          assert.equal(
            (
              await one("SELECT paid FROM payment_dashboard WHERE id=$1", [
                payIds[0],
              ])
            ).paid,
            true,
          );
          assert.equal(
            (
              await one("SELECT paid FROM payment_dashboard WHERE id=$1", [
                payIds[1],
              ])
            ).paid,
            false,
          );
          assert.equal(
            (
              await one(
                "SELECT dd.paid FROM dashboard_data dd JOIN payment_dashboard pd ON pd.dashboard_data_id=dd.id WHERE pd.id=$1",
                [payIds[0]],
              )
            ).paid,
            true,
          );
          assert.equal(
            (await getDriverBalances(db, admin, drivers[0], city)).totals
              .owedByDriver,
            "50.00",
          );
          const review = await reviewRunPayments(db, admin, run.id);
          assert.equal(
            review.drivers.find(
              (d) => String(d.statementId) === String(first.id),
            ).payment.reference,
            partial.reference,
          );
          assert.equal(
            (
              await recordRunPayment(
                db,
                admin,
                run.id,
                request({ statementIds: [Number(first.id)] }),
              )
            ).alreadyPaid,
            true,
          );
          const remaining = await recordRunPayment(
            db,
            admin,
            run.id,
            request(),
          );
          assert.deepEqual(
            [remaining.receipt.drivers, remaining.receipt.total],
            [1, "190.00"],
          );
          assert.equal(
            (await listPaymentRuns(db, admin)).runs.some(
              (r) => String(r.id) === String(run.id),
            ),
            false,
          );
          assert.equal(
            (await listPaymentRuns(db, admin, { view: "history" })).runs.some(
              (r) => String(r.id) === String(run.id),
            ),
            true,
          );
          const after = (await getRun(db, admin, run.id)).statements;
          for (const old of frozen) {
            const current = after.find((s) => s.id === old.id);
            for (const key of [
              "gross",
              "insurance",
              "recoveries",
              "net",
              "carried_forward",
            ])
              assert.equal(current[key], old[key]);
          }
          await assert.rejects(
            voidRun(db, superAdmin, run.id, "Synthetic void attempt"),
            { status: 409 },
          );
          assert.equal(
            Number(
              (
                await one(
                  "SELECT count(*) n FROM pay_run_payment_items i JOIN pay_statements s ON s.id=i.statement_id WHERE s.pay_run_id=$1",
                  [run.id],
                )
              ).n,
            ),
            2,
          );
        },
      );
    } finally {
      await db.query("ROLLBACK");
      db.release();
      await pool.end();
    }
  },
);
