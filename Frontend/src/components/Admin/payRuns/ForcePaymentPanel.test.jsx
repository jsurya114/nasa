import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installServer, resetBrowser } from "../../../test/fakeShell.js";

// "Force mark as paid" for one driver: a date, a written reason and an explicit confirmation, then one request. The server decides; this collects and shows.
const DRIVER = { statementId: 31, driverName: "Dee Test", amounts: { net: "190.00" } };
const mount = async (reply, onDone = vi.fn()) => {
  const posts = [];
  await installServer(async (config) => {
    posts.push({ url: config.url, body: JSON.parse(config.data) });
    return reply(posts.length, config);
  });
  const { default: ForcePaymentPanel } = await import("./ForcePaymentPanel.jsx");
  const onSubmitForm = vi.fn((e) => e.preventDefault());
  render(<form onSubmit={onSubmitForm}><ForcePaymentPanel runId={7} driver={DRIVER} onDone={onDone} /></form>);
  return { posts, onDone, onSubmitForm };
};
const open = () => fireEvent.click(screen.getByRole("button", { name: "Force mark as paid" }));
const fillIn = (reason = "Paid in cash at the depot") => {
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: reason } });
  fireEvent.click(screen.getByRole("checkbox", { name: /I confirm/ }));
};
const submit = () => screen.getByRole("button", { name: "Mark as paid" });

beforeEach(async () => { await resetBrowser(); });
afterEach(cleanup);

it("opens on request, says what it does, and cannot be sent without a reason and a confirmation", async () => {
  const s = await mount(() => ({ status: 200, data: {} }));
  expect(screen.queryByRole("group", { name: /Force mark Dee Test as paid/ })).toBeNull();
  open();
  const panel = screen.getByRole("group", { name: "Force mark Dee Test as paid" });
  expect(panel.textContent).toMatch(/\$190\.00 is recorded as paid and nothing is sent to Everee or QuickBooks/);
  expect(panel.textContent).toMatch(/could be paid twice/);
  expect(submit().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "too short" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /I confirm/ }));
  expect(submit().disabled).toBe(true); // the reason is under 10 characters
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Paid in cash at the depot" } });
  expect(submit().disabled).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: /I confirm/ }));
  expect(submit().disabled).toBe(true); // not confirmed any more
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("group")).toBeNull();
  expect(s.posts).toHaveLength(0);
});

it("sends the chosen driver, the date, the trimmed reason and the confirmation once, then closes and tells the caller", async () => {
  const s = await mount(() => ({ status: 200, data: { receipt: { id: 1 } } }));
  open();
  fillIn("  Paid in cash at the depot  ");
  fireEvent.click(submit());
  await waitFor(() => expect(s.onDone).toHaveBeenCalledTimes(1));
  expect(s.posts).toHaveLength(1);
  expect(s.posts[0].url).toBe("/admin/payroll/payments/runs/7/force-paid");
  expect(s.posts[0].body).toMatchObject({ reason: "Paid in cash at the depot", confirmed: true, statementIds: [31] });
  expect(s.posts[0].body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  expect(s.posts[0].body.paidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(screen.queryByRole("group")).toBeNull();
});

it("shows the server's refusal, stays open, and a retry with the same answers uses the same request ID; changing an answer makes a new one", async () => {
  const s = await mount((n) => (n === 1
    ? { status: 403, data: { message: "Only a super admin can mark a payment as paid by force." } }
    : { status: 200, data: {} }));
  open();
  fillIn();
  fireEvent.click(submit());
  expect(await screen.findByText("Only a super admin can mark a payment as paid by force.")).toBeTruthy();
  expect(s.onDone).not.toHaveBeenCalled();
  expect(screen.getByRole("group")).toBeTruthy();
  fireEvent.click(submit());
  await waitFor(() => expect(s.onDone).toHaveBeenCalledTimes(1));
  expect(s.posts[1].body.requestId).toBe(s.posts[0].body.requestId);
});

it("shows what the server says is wrong with a field, and Enter in a field never submits the payment dialog around it", async () => {
  const s = await mount(() => ({ status: 400, data: { message: "Check the highlighted fields.", errors: { reason: "Say why this driver is marked paid (10–180 characters)." } } }));
  open();
  fillIn();
  expect(fireEvent.keyDown(screen.getByLabelText("Reason"), { key: "Enter" })).toBe(false); // the default (submitting the form) is prevented
  fireEvent.click(submit());
  expect(await screen.findByText("Say why this driver is marked paid (10–180 characters).")).toBeTruthy();
  expect(screen.getByText("Check the highlighted fields.")).toBeTruthy();
  expect(s.onSubmitForm).not.toHaveBeenCalled();
});
