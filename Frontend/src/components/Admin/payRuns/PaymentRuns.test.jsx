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
    name: "Continue with payment",
  });
  if (next) fireEvent.click(next);
  fireEvent.change(screen.getByLabelText("Payment method"), {
    target: { value: "cash" },
  });
  fireEvent.change(screen.getByLabelText("Payment note"), {
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
    await screen.findByRole("button", { name: "Pay to drivers" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Continue with payment" }),
  );
  const submit = await screen.findByRole("button", { name: "Pay" });
  fireEvent.click(submit);
  expect(s.posts).toHaveLength(0);
  expect(
    await screen.findByText("Choose how the drivers are paid."),
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
    await screen.findByRole("button", { name: "Pay to drivers" }),
  );
  await screen.findByRole("checkbox", { name: /Eli Test/ });
  fireEvent.click(screen.getByRole("checkbox", { name: /Eli Test/ }));
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Pay" }));
  await screen.findByText(/result could not be confirmed/);
  fireEvent.click(screen.getByRole("button", { name: "Pay" }));
  await screen.findByRole("heading", { name: "Payment recorded" });
  expect(s.posts.map((p) => p.requestId)).toEqual([
    s.posts[0].requestId,
    s.posts[0].requestId,
  ]);
  expect(s.posts[0].statementIds).toEqual([1]);
  expect(s.receipts.size).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(
    await screen.findByRole("button", { name: "Pay to drivers" }),
  ).toBeTruthy();
});
it("processing payments cannot be included in confirmation: the driver is not selectable and not counted, and is labelled as processing", async () => {
  const s = await setup({ blocked: true });
  fireEvent.click(
    await screen.findByRole("button", { name: "Pay to drivers" }),
  );
  const submit = await screen.findByRole("button", {
    name: "Continue with payment",
  });
  const dialog = screen.getByRole("dialog");
  // the processing driver has no checkbox and says so; only the other driver is selected, and the total is theirs alone
  expect(screen.queryByRole("checkbox", { name: /Dee Test/ })).toBeNull();
  expect(within(dialog).getByText("Payment processing")).toBeTruthy();
  expect(within(dialog).getByText(/Selected: 1 of 1 unpaid drivers · 1 payment\(s\) processing, not counted/)).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: /Eli Test/ }).checked).toBe(true);
  expect(within(dialog).getByText("$190.00", { selector: "p" })).toBeTruthy();
  expect(submit.disabled).toBe(false);
  // "Select all unpaid" never brings the processing driver back
  fireEvent.click(within(dialog).getByRole("button", { name: "Deselect all" }));
  expect(screen.getByRole("button", { name: "Continue with payment" }).disabled).toBe(true);
  fireEvent.click(within(dialog).getByRole("button", { name: "Select all unpaid" }));
  expect(screen.queryByRole("checkbox", { name: /Dee Test/ })).toBeNull();
  expect(screen.getByRole("checkbox", { name: /Eli Test/ }).checked).toBe(true);
  expect(s.posts).toHaveLength(0);
});
const CARD = { id: 17, city_id: 3, city: "Synthetic City", period_start: "2026-11-01", period_end: "2026-11-07", data_type: "weekly", status: "finalized", drivers: 2, paid: 0, total: "230.00" };
const renderCard = async (run) => {
  await installServer(async (config) => ({ status: 200, data: config.url === "/admin/payroll/payments/runs" ? { runs: [run], nextBeforeId: null } : {} }));
  const { default: PaymentRuns } = await import("./PaymentRuns.jsx");
  render(<MemoryRouter><PaymentRuns cities={[{ id: 3, job: "Synthetic City" }]} onRecorded={vi.fn()} /></MemoryRouter>);
};
it("the card keeps the processing payment out of the remaining pay and shows it apart; when only processing is left there is nothing to pay", async () => {
  // Dee (40.00) is processing and Eli (190.00) is not: the server's remaining leaves Dee out and reports her apart
  await renderCard({ ...CARD, processing: 1, remaining: "190.00", processing_total: "40.00" });
  expect(await screen.findByText("$190.00")).toBeTruthy();
  expect(screen.getByTestId("processing-amount").textContent).toContain("$40.00");
  expect(screen.getByTestId("processing-amount").textContent).toContain("1 driver");
  expect(screen.getByText("Payment processing", { selector: "span" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Pay to drivers" })).toBeTruthy();
  cleanup();
  // both are processing: nothing is left to pay, and the card says so instead of offering to pay again
  await renderCard({ ...CARD, processing: 2, remaining: "0.00", processing_total: "230.00" });
  expect(await screen.findByText("$0.00")).toBeTruthy();
  expect(screen.getByTestId("processing-amount").textContent).toContain("$230.00");
  expect(screen.getByRole("button", { name: "View payment status" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Pay to drivers" })).toBeNull();
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
    await screen.findByRole("button", { name: "Pay to drivers" }),
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: /Eli Test/ }));
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("checkbox", { name: /Eli Test/ }).checked).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("checkbox", { name: /Eli Test/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Continue with payment" }),
  );
  expect(screen.getByLabelText("Payment method").value).toBe("cash");
  expect(screen.getByLabelText("Payment note").value).toBe(
    "Synthetic cash receipt",
  );
  expect(screen.getByRole("checkbox", { name: /I confirm/ }).checked).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "Pay" }));
  expect(s.posts).toHaveLength(0);
});
