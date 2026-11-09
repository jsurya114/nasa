import pool from "../../config/db.js";
import logger from "../../utils/logger.js";
import { withTransaction } from "../../services/payroll/claims/claimsStore.js";
import { PayrollError } from "../../services/payroll/payRuns/payRunStore.js";
import {
  listPaymentRuns,
  parsePaymentRecord,
  paymentId,
  recordRunPayment,
  reviewRunPayments,
} from "../../services/payroll/payRuns/paymentRecords.js";
import { notifyDriverPaid } from "../../services/push/pushEvents.js";

const fail = (res, error) => {
  if (error instanceof PayrollError)
    return res.status(error.status).json({ message: error.message, ...(error.code === 'onboarding_required' && { code: error.code }) });
  if (error.code === "23505")
    return res
      .status(409)
      .json({
        message:
          "A payment was already recorded. Refresh the run before continuing.",
      });
  logger.error("Payment recording failed", {
    code: error.code,
    message: error.message,
  });
  return res
    .status(error.code === "42P01" ? 503 : 500)
    .json({
      message: "Payments could not be loaded or recorded. Please try again.",
    });
};
export const getPaymentRuns = async (req, res) => {
  const { view = "ready", cityId, beforeId } = req.query;
  if (
    !["ready", "history"].includes(view) ||
    (cityId && !paymentId(cityId)) ||
    (beforeId && !paymentId(beforeId))
  )
    return res
      .status(400)
      .json({ message: "Choose a valid city and payment view." });
  try {
    return res.json(
      await listPaymentRuns(pool, req.admin, {
        view,
        cityId: cityId ? paymentId(cityId) : null,
        beforeId: beforeId ? paymentId(beforeId) : null,
      }),
    );
  } catch (error) {
    return fail(res, error);
  }
};
export const getPaymentReview = async (req, res) => {
  const runId = paymentId(req.params.runId);
  if (!runId)
    return res.status(400).json({ message: "Choose a valid pay run." });
  try {
    return res.json(await reviewRunPayments(pool, req.admin, runId));
  } catch (error) {
    return fail(res, error);
  }
};
export const postPaymentRecord = async (req, res) => {
  const runId = paymentId(req.params.runId);
  const parsed = parsePaymentRecord(req.body);
  if (!runId || parsed.errors)
    return res
      .status(400)
      .json({
        message: "Check the highlighted fields.",
        errors: parsed.errors ?? { runId: "Choose a valid pay run." },
      });
  try {
    const { driverNames, ...result } = await withTransaction(pool, (db) =>
      recordRunPayment(db, req.admin, runId, parsed.request),
    );
    // Preserve the existing paid-notification behavior, after the transaction succeeds and only on its first application.
    for (const name of driverNames) notifyDriverPaid(name);
    logger.info("External payment recorded", {
      runId,
      adminId: req.admin.id,
      receiptId: result.receipt?.id,
      replay: result.replay,
    });
    return res.json(result);
  } catch (error) {
    return fail(res, error);
  }
};
