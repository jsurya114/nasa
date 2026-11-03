import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import UploadResultSummary from "./UploadResultSummary";

afterEach(cleanup);

// Made-up answers, shaped as the weekly upload returns them (#160).
const HISTORY = { saved: true, recorded: 12, alreadyKnown: 3, problems: 0, leftOut: 0 };
const STORED = {
  found: true, stored: true, cityId: 3, inFile: 4, inserted: 3, duplicates: 1, amended: 0, held: 0,
  matched: { chargeable: 1, exempt: 1 }, waiting: { unresolved: 1, ambiguous: 0 }, onHold: 0, problems: 0, problemRows: [],
};
const show = (claims, assignmentHistory = HISTORY) => render(<UploadResultSummary result={{ claims, assignmentHistory }} />);

describe("claims summary after a weekly upload", () => {
  it("shows stored claims: new, already recorded, matched, exempt and the note that nothing is deducted yet", () => {
    show(STORED);
    expect(screen.getByText("4 claims read from the file.")).toBeTruthy();
    expect(screen.getByText(/New: 3\. Already recorded: 1\. Changed amount \(new version\): 0\./)).toBeTruthy();
    expect(screen.getByText(/Matched to a driver: 1 to charge, 1 exempt \(no deduction\)\./)).toBeTruthy();
    expect(screen.getByText(/Nothing is deducted until a pay run/)).toBeTruthy();
  });

  it("shows a claim that is waiting for delivery history", () => {
    show({ ...STORED, inFile: 1, inserted: 1, duplicates: 0, matched: { chargeable: 0, exempt: 0 }, waiting: { unresolved: 1, ambiguous: 0 } });
    expect(screen.getByText(/Waiting for delivery history: 1\. Not clear which driver or city: 0\./)).toBeTruthy();
  });

  it("lists bad rows with their Excel row number and reason", () => {
    show({ ...STORED, problems: 2, problemRows: [{ row: 5, message: "the charge is not a number" }, { row: 9, message: "claim type is missing" }] });
    expect(screen.getByText("Rows that could not be read (2):")).toBeTruthy();
    expect(screen.getByText("Row 5: the charge is not a number")).toBeTruthy();
    expect(screen.getByText("Row 9: claim type is missing")).toBeTruthy();
  });

  it("says when only the first rows are shown", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ row: i + 2, message: "claim date is missing or not a real date" }));
    show({ ...STORED, problems: 31, problemRows: rows });
    expect(screen.getByText(/Showing the first 20/)).toBeTruthy();
  });

  it("explains in plain words why nothing was stored (unknown route), and that the pay upload was not affected", () => {
    show({ found: true, stored: false, inFile: 3, problems: 0, problemRows: [], reason: "Claims were not stored: 1 route in the report is not set up (NOSUCH 99-9), so the city cannot be confirmed. Add the route and upload again." });
    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("The claims in this file were not stored.")).toBeTruthy();
    expect(within(alert).getByText(/NOSUCH 99-9/)).toBeTruthy();
    expect(within(alert).getByText(/3 claims in the file\. Nothing was deducted\. The pay upload itself was not affected\./)).toBeTruthy();
  });

  it("explains a report whose routes belong to more than one city", () => {
    show({ found: true, stored: false, inFile: 1, problems: 0, problemRows: [], reason: "Claims were not stored: the report's routes belong to more than one city. Upload one city's report at a time." });
    expect(screen.getByText(/more than one city/)).toBeTruthy();
  });

  it("says so when the file has no Claims Detail sheet", () => {
    show({ found: false, stored: false });
    expect(screen.getByText("This file has no Claims Detail sheet, so no claims were read.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the not-stored count only when the server sends it (super admin), and held claims when there are any", () => {
    const { rerender } = show({ ...STORED, notStored: 2, held: 1 });
    expect(screen.getByText("Not stored because they already belong to another city: 2.")).toBeTruthy();
    expect(screen.getByText(/Held for review, because the same claim was already entered by hand: 1\./)).toBeTruthy();
    rerender(<UploadResultSummary result={{ claims: STORED, assignmentHistory: HISTORY }} />);
    expect(screen.queryByText(/already belong to another city/)).toBeNull();
    expect(screen.queryByText(/Held for review/)).toBeNull();
  });

  it("tells the admin when the carrier history could not be saved, without blaming the pay upload", () => {
    show(STORED, { saved: false, reason: "Assignment history is not set up in the database yet." });
    expect(screen.getByText(/Carrier history was not saved: Assignment history is not set up in the database yet\. The pay data was stored as usual\./)).toBeTruthy();
  });

  it("shows nothing before an upload has answered", () => {
    const { container } = render(<UploadResultSummary result={null} />);
    expect(container.innerHTML).toBe("");
  });
});
