import React from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { installServer, resetBrowser } from "../../test/fakeShell";

// Look up, Link and Unlink on one driver's card, with a fake server. Nothing leaves this machine.
beforeEach(resetBrowser);
afterEach(cleanup);

const DRIVER = { driverId: 41, name: "Active Driver", state: "needs-review" };
const worker = { workerId: "W-1", firstName: "Sam", lastName: "Lee", maskedEmail: "s***@example.com", maskedPhone: "***0001", matchedOn: ["email", "phone"], conflicts: [] };
const heldBy = (extra = {}) => ({ driverId: 7, name: "Sam Lee (old)", driverCode: 391331, enabled: false, cityId: 3, outstandingPayments: false, ...extra });
const mount = async (handler) => {
  const posts = [];
  await installServer(async (config) => {
    posts.push({ url: config.url, body: config.data ? JSON.parse(config.data) : null });
    return handler(config);
  });
  const { default: Panel } = await import("./EvereeLinkPanel.jsx");
  let changed = 0;
  render(<Panel driver={DRIVER} cityId="3" onChanged={() => { changed += 1; }} />);
  return { posts, changed: () => changed };
};

it("moves a link from an old disabled record: shows who holds it, needs a reason, removes that link, looks up again and links", async () => {
  let removed = false;
  const view = await mount(async (c) => {
    if (c.url.endsWith("/lookup")) return { status: 200, data: removed
      ? { result: "match", reason: null, issues: [], matches: [{ ...worker, linkedTo: null, linkedDriver: null }] }
      : { result: "blocked", reason: "worker_linked_to_another_driver", issues: [], matches: [{ ...worker, linkedTo: "another_driver", linkedDriver: heldBy() }] } };
    if (c.url.endsWith("/unlink")) { removed = true; return { status: 200, data: { unlinked: true } }; }
    if (c.url.endsWith("/link")) return { status: 200, data: { link: { workerId: "W-1" } } };
    return { status: 404, data: {} };
  });
  fireEvent.click(screen.getByRole("button", { name: "Look up in Everee" }));
  expect(await screen.findByText(/Sam Lee$/)).toBeTruthy();
  expect(screen.getByText(/s\*\*\*@example.com/)).toBeTruthy(); // masked, never the full email
  expect(screen.getByText(/driver code 391331, disabled/)).toBeTruthy();
  const unlink = screen.getByRole("button", { name: "Remove link from that record" });
  expect(unlink.disabled).toBe(true); // a reason is required
  fireEvent.change(screen.getByLabelText("Why is the link being moved?"), { target: { value: "same person, moved to the active record" } });
  expect(unlink.disabled).toBe(false);
  fireEvent.click(unlink);
  const link = await screen.findByRole("button", { name: "Link this worker" });
  const unlinkCall = view.posts.find((p) => p.url.endsWith("/unlink"));
  expect(unlinkCall.body).toEqual({ cityId: 3, driverId: 7, reason: "same person, moved to the active record", acknowledgeOutstanding: false }); // the OTHER record, in its own city
  fireEvent.click(link);
  expect(await screen.findByText(/Linked\./)).toBeTruthy();
  expect(view.posts.at(-1).body).toEqual({ cityId: 3, driverId: 41, workerId: "W-1" });
  expect(view.changed()).toBe(1);
});

it("warns about unsettled payments on the old record and needs a confirmation before the link is moved", async () => {
  await mount(async () => ({ status: 200, data: { result: "blocked", reason: "worker_linked_to_another_driver", issues: [], matches: [{ ...worker, linkedTo: "another_driver", linkedDriver: heldBy({ outstandingPayments: true }) }] } }));
  fireEvent.click(screen.getByRole("button", { name: "Look up in Everee" }));
  expect(await screen.findByText(/payments that are not settled yet/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Why is the link being moved?"), { target: { value: "moved to the active record" } });
  const unlink = screen.getByRole("button", { name: "Remove link from that record" });
  expect(unlink.disabled).toBe(true);
  fireEvent.click(screen.getByLabelText(/I checked the unsettled payments/));
  expect(unlink.disabled).toBe(false);
});

it("explains no match, a conflict and an incomplete driver without offering to link, and shows a server refusal", async () => {
  const answers = [
    { result: "no_match", reason: null, issues: [], matches: [] },
    { result: "conflict", reason: null, issues: [], matches: [{ ...worker, matchedOn: ["phone"], conflicts: ["email"], linkedTo: null, linkedDriver: null }] },
    { result: "blocked", reason: "driver_data", issues: [{ code: "no_valid_phone", message: "there is no valid 10-digit phone number" }], matches: [] },
  ];
  let n = 0;
  await mount(async () => (n < answers.length ? { status: 200, data: answers[n++] } : { status: 409, data: { message: "this driver or this Everee worker is already linked" } }));
  const lookupButton = () => screen.getByRole("button", { name: /Look up in Everee|Looking up/ });
  fireEvent.click(lookupButton());
  expect(await screen.findByText(/No Everee worker has this driver's email or phone/)).toBeTruthy();
  fireEvent.click(lookupButton());
  expect(await screen.findByText(/matches on one detail but the other is different/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Link this worker" })).toBeNull();
  fireEvent.click(lookupButton());
  expect(await screen.findByText(/no valid 10-digit phone number/)).toBeTruthy();
  fireEvent.click(lookupButton());
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/already linked/));
});
