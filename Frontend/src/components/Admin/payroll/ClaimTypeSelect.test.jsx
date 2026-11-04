import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ClaimTypeSelect from "./ClaimTypeSelect.jsx";

afterEach(cleanup);

const options = () => [...screen.getByRole("combobox").options].map((o) => o.textContent);

describe("ClaimTypeSelect", () => {
  it("offers the four penalty types after a prompt, and reports the choice", () => {
    const onChange = vi.fn();
    render(<ClaimTypeSelect value="" onChange={onChange} />);
    expect(options()).toEqual(["Choose a claim type", "Fake pod", "Lost", "Tracking interruption", "Damaged item"]);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Lost" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("keeps an older entry's own spelling selectable instead of showing a blank", () => {
    render(<ClaimTypeSelect value="fake pod" onChange={() => {}} />);
    expect(options()).toContain("fake pod");
    expect(screen.getByRole("combobox").value).toBe("fake pod");
  });
});
