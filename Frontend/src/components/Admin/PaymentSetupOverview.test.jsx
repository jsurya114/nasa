import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { installServer, resetBrowser } from "../../test/fakeShell";
vi.mock("../../reuse/Header", () => ({ default: () => null }));
vi.mock("../../reuse/Nav", () => ({ default: () => null }));
beforeEach(resetBrowser);
afterEach(cleanup);
const result = (extra = {}) => ({ pageSize: 50, total: 2, environment: "sandbox", configured: true, onboardingEnabled: true, enforced: false, checkedAt: "2026-11-07T01:00:00Z", summary: { localDrivers: 2, complete: 1, wouldHold: 1, needsReview: 0, unclassified: 0, driversWithOpenWork: 1, openWorkRoutes: 1, driversWithOutstandingPayments: 0 }, drivers: [{ driverId: 1, name: "Sample Driver", state: "in-progress", lastCheckedAt: null }, { driverId: 2, name: "Complete Driver", state: "complete", paymentReady: false, lastCheckedAt: "2026-11-07T00:00:00Z" }], ...extra });
const mount = async (handler) => {
  const calls = [];
  await installServer(async config => { calls.push(config); if(config.url === "/admin/get-admin-cities") return {status: 200, data: {cities: [{id: 7,job: "Sample City"}, {id: 8,job: "Empty City"}]}}; return handler(config); });
  const {default: Page} = await import("./PaymentSetupOverview.jsx");
  render(<MemoryRouter><Page /></MemoryRouter>);
  await screen.findByRole("option", {name: "Sample City"});
  fireEvent.change(screen.getByLabelText("City"), {target: {value: "7"}});
  return calls;
};
it("shows preview separately from restrictions and explains payment readiness without any write request", async () => {
  const calls = await mount(async () => ({status: 200, data: result()}));
  expect(await screen.findByText(/Readiness preview/)).toBeTruthy();
  expect(screen.getByText(/Nothing is activated here/)).toBeTruthy();
  expect(screen.getByText(/Onboarding is complete, but Everee payment readiness/)).toBeTruthy();
  expect(screen.getByText(/Not checked yet/)).toBeTruthy();
  expect(calls.every(c=>c.method === "get")).toBe(true);
  expect(screen.queryByRole("button", {name: /enable|activate|pay now/i})).toBeNull();
});
it("resets pagination on filtering and removes the previous city's drivers", async () => {
  const calls = await mount(async c => ({status: 200, data: result(c.params.cityId === "8" ? {drivers: [],total: 0} : {total: 51})}));
  await screen.findByText("Sample Driver");
  fireEvent.click(screen.getByRole("button", {name: "Next"}));
  await waitFor(()=>expect(calls.at(-1).params.page).toBe(2));
  fireEvent.change(screen.getByLabelText("Setup status"), {target: {value: "needs-review"}});
  await waitFor(()=>expect(calls.at(-1).params).toMatchObject({page: 1,state: "needs-review"}));
  fireEvent.change(screen.getByLabelText("City"), {target: {value: "8"}});
  await screen.findByText("No drivers match this selection.");
  expect(screen.queryByText("Sample Driver")).toBeNull();
});
it("retries failed loading and explains the active cash restriction", async () => {
  let fail = true;
  await mount(async () => fail ? {status: 500,data: {}} : {status: 200,data: result({enforced:true})});
  await screen.findByRole("alert");
  fail=false;fireEvent.click(screen.getByRole("button", {name: "Try again"}));
  expect(await screen.findByText(/Restrictions are on/)).toBeTruthy();
  expect(screen.getByText(/including cash/)).toBeTruthy();
});
