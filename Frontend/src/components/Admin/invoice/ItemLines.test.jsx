import React, { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ItemLines from "./ItemLines.jsx";

// The item-based lines: OT (hrs) and OT rate sit after the quantity, and the line's total is rate x quantity + OT hours x OT rate.
const Form = () => {
  const [entries, setEntries] = useState({});
  return <ItemLines start="2026-06-01" end="2026-06-02" entries={entries} onChange={setEntries} errors={{}} disabled={false} />;
};
const type = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

afterEach(cleanup);

describe("item lines with overtime", () => {
  it("shows OT (hrs) and OT rate after the quantity and adds them to the line: 100 x 2 + 2 x 30 = $260.00", () => {
    render(<Form />);
    const labels = [...screen.getByTestId("line-2026-06-01").querySelectorAll("input")].map((i) => i.getAttribute("aria-label"));
    expect(labels).toEqual(["Item, Monday 06/01/2026", "Rate, 06/01/2026", "Quantity, 06/01/2026", "OT hours, 06/01/2026", "OT rate, 06/01/2026"]);
    type("Item, Monday 06/01/2026", "Box truck");
    type("Rate, 06/01/2026", "100");
    type("Quantity, 06/01/2026", "2");
    expect(screen.getByTestId("line-2026-06-01-total").textContent).toBe("$200.00");
    type("OT hours, 06/01/2026", "2");
    // Half an overtime is flagged and not totalled until the rate is there too.
    expect(screen.getByTestId("line-2026-06-01-total").textContent).toBe("—");
    expect(screen.getByTestId("line-2026-06-01-problem").textContent).toMatch(/both the OT hours and the OT rate/);
    type("OT rate, 06/01/2026", "30");
    expect(screen.getByTestId("line-2026-06-01-total").textContent).toBe("$260.00");
    expect(screen.getByTestId("item-subtotal").textContent).toBe("$260.00");
    expect(screen.queryByTestId("line-2026-06-01-problem")).toBeNull();
  });
});
