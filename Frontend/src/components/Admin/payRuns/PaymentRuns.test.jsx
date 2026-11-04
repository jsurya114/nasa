import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { installServer, resetBrowser } from "../../../test/fakeShell.js";

const driver = (id, name, net) => ({
  statementId: id,
  driverId: id,
  driverName: name,
  payoutStatus: "not_submitted",
  eligible: true,
  amounts: { net },
  blockers: [],
  payment: null,
});
const setup = async ({
  blocked = false,
  history = false,
  lostReply = false,
} = {}) => {
  const drivers = [
    driver(1, "Dee Test", "40.00"),
    driver(2, "Eli Test", "190.00"),
  ];
  if (blocked) {
    drivers[0].eligible = false;
    drivers[0].payoutStatus = "submitted";
    drivers[0].blockers = [
      {
        severity: "blocking",
        code: "payout_in_progress",
        message: "Payment is processing. Reconcile it before continuing.",
      },
    ];
  }
  const state = { posts: [], receipts: new Map(), lostReply };
  const run = {
    id: 17,
    city_id: 3,
    city: "Synthetic City",
    period_start: "2026-11-01",
    period_end: "2026-11-07",
    data_type: "weekly",
    status: "finalized",
  };
  const receipt = {
    id: 1,
    drivers: 2,
    total: "230.00",
    paid_on: "2026-11-04",
    method: "cash",
    reference: "Synthetic cash payment",
    recorded_by_name: "Synthetic Admin",
  };
  if (history)
    drivers.forEach((d) => {
      d.payoutStatus = "paid";
      d.eligible = false;
      d.payment = receipt;
    });
  await installServer(async (config) => {
    if (config.url === "/admin/payroll/payments/runs") {
      const paid = drivers.filter((d) => d.payoutStatus === "paid").length;
      const show =
        config.params.view === "history" ? paid > 0 : paid < drivers.length;
      return {
        status: 200,
        data: {
          runs: show
            ? [
                {
                  ...run,
                  drivers: 2,
                  paid,
                  processing: blocked ? 1 : 0,
                  total: "230.00",
                  remaining: drivers
                    .filter((d) => d.payoutStatus !== "paid")
                    .reduce((n, d) => n + Number(d.amounts.net), 0)
                    .toFixed(2),
                },
              ]
            : [],
          nextBeforeId: null,
        },
      };
    }
    if (config.url.endsWith("/record")) {
      const body = JSON.parse(config.data);
      state.posts.push(body);
      if (state.receipts.has(body.requestId))
        return {
          status: 200,
          data: { receipt: state.receipts.get(body.requestId), replay: true },
        };
      const chosen = drivers.filter(
        (d) =>
          d.payoutStatus !== "paid" &&
          (!body.statementIds || body.statementIds.includes(d.statementId)),
      );
      const saved = {
        ...receipt,
        drivers: chosen.length,
        total: chosen.reduce((n, d) => n + Number(d.amounts.net), 0).toFixed(2),
        method: body.method,
        reference: body.reference,
        paid_on: body.paidOn,
      };
      chosen.forEach((d) => {
        d.payoutStatus = "paid";
        d.eligible = false;
        d.payment = saved;
      });
      state.receipts.set(body.requestId, saved);
      if (state.lostReply) {
        state.lostReply = false;
        throw new Error("Synthetic lost reply");
      }
      return { status: 200, data: { receipt: saved, replay: false } };
    }
    return {
      status: 200,
      data: {
        run,
        drivers: drivers.map((d) => ({ ...d })),
        summary: { pendingClaims: { total: 0 } },
      },
    };
  });
  const { default: PaymentRuns } = await import("./PaymentRuns.jsx");
  const recorded = vi.fn();
  render(
    <MemoryRouter>
      <PaymentRuns
        cities={[{ id: 3, job: "Synthetic City" }]}
        onRecorded={recorded}
      />
    </MemoryRouter>,
  );
  return { ...state, recorded };
};
const fill = () => {
  const next = screen.queryByRole("button", {
    name: "Continue to payment details",
  });
  if (next) fireEvent.click(next);
  fireEvent.change(screen.getByLabelText("Payment method"), {
    target: { value: "cash" },
  });
  fireEvent.change(screen.getByLabelText("Reference / payment note"), {
    target: { value: "Synthetic cash receipt" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /I confirm/ }));
};
beforeEach(async () => {
  await resetBrowser();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows approved payments independently of delivery dates and records all with explicit confirmation", async () => {
  const s = await setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Mark all 2 as paid" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Continue to payment details" }),
  );
  const submit = await screen.findByRole("button", { name: "Mark 2 as paid" });
  fireEvent.click(submit);
  expect(s.posts).toHaveLength(0);
  expect(
    await screen.findByText("Confirm receipt before recording payment."),
  ).toBeTruthy();
  fill();
  fireEvent.click(submit);
  await screen.findByRole("heading", { name: "Payment recorded" });
  expect(s.posts[0]).toMatchObject({
    method: "cash",
    reference: "Synthetic cash receipt",
    confirmed: true,
    statementIds: null,
  });
  expect(s.recorded).toHaveBeenCalledTimes(1);
  expect(
    screen.getByText(/remaining driver debt stays outstanding/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await screen.findByText(/No approved pay runs are awaiting payment/);
  fireEvent.click(screen.getByRole("button", { name: "Payment history" }));
  expect(
    await screen.findByRole("button", { name: "View payment records" }),
  ).toBeTruthy();
});
it("records selected drivers only, and retries a lost response with the same request ID", async () => {
  const s = await setup({ lostReply: true });
  fireEvent.click(
    await screen.findByRole("button", { name: "Mark all 2 as paid" }),
  );
  await screen.findByRole("checkbox", { name: /Eli Test/ });
  fireEvent.click(screen.getByRole("checkbox", { name: /Eli Test/ }));
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Mark 1 as paid" }));
  await screen.findByText(/result could not be confirmed/);
  fireEvent.click(screen.getByRole("button", { name: "Mark 1 as paid" }));
  await screen.findByRole("heading", { name: "Payment recorded" });
  expect(s.posts.map((p) => p.requestId)).toEqual([
    s.posts[0].requestId,
    s.posts[0].requestId,
  ]);
  expect(s.posts[0].statementIds).toEqual([1]);
  expect(s.receipts.size).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(
    await screen.findByRole("button", { name: "Mark remaining 1 as paid" }),
  ).toBeTruthy();
});
it("processing payments cannot be included in confirmation", async () => {
  const s = await setup({ blocked: true });
  fireEvent.click(
    await screen.findByRole("button", { name: "Mark all 2 as paid" }),
  );
  const submit = await screen.findByRole("button", {
    name: "Continue to payment details",
  });
  expect(submit.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: /Dee Test/ }));
  expect(
    screen.getByRole("button", { name: "Continue to payment details" })
      .disabled,
  ).toBe(false);
  expect(s.posts).toHaveLength(0);
});
it("paid history shows receipts without asking for another payment", async () => {
  await setup({ history: true });
  fireEvent.click(screen.getByRole("button", { name: "Payment history" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "View payment records" }),
  );
  await screen.findByRole("heading", { name: "Payment records" });
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByLabelText("Payment method")).toBeNull();
  expect(within(dialog).getAllByText(/Synthetic cash payment/)).toHaveLength(2);
  expect(within(dialog).getByRole("button", { name: "Done" })).toBeTruthy();
});

it("keeps payment details when going back but requires confirmation again if the drivers change", async () => {
  const s = await setup();
  fireEvent.click(
    await screen.findByRole("button", { name: "Mark all 2 as paid" }),
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: /Eli Test/ }));
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("checkbox", { name: /Eli Test/ }).checked).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: /Eli Test/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to payment details" }),
  );
  expect(screen.getByLabelText("Payment method").value).toBe("cash");
  expect(screen.getByLabelText("Reference / payment note").value).toBe(
    "Synthetic cash receipt",
  );
  expect(screen.getByRole("checkbox", { name: /I confirm/ }).checked).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Mark 2 as paid" }));
  expect(s.posts).toHaveLength(0);
});
