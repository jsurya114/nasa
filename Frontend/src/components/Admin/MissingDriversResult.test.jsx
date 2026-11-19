import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import UploadResultSummary from "./UploadResultSummary";

afterEach(cleanup);

// Made-up answers, shaped as the weekly upload returns `missingDrivers`.
const show = (missingDrivers) => render(<UploadResultSummary result={{ claims: { found: false }, missingDrivers }} />);
const box = () => screen.getByTestId("missing-drivers");

describe("drivers missing from a weekly file", () => {
  it("lists them by city with their code, and says it is a warning only", () => {
    show({
      checked: true, cities: ["Alpha City", "Beta City"], total: 3, shown: 3,
      drivers: [
        { driverId: 1, name: "Ann Test", driverCode: 8801, city: "Alpha City" },
        { driverId: 2, name: "Bob Test", driverCode: 8802, city: "Alpha City" },
        { driverId: 3, name: "Cy Test", driverCode: 8803, city: "Beta City" },
      ],
    });
    expect(within(box()).getByText(/3 enabled drivers of Alpha City, Beta City are not in this file\./)).toBeTruthy();
    expect(within(box()).getByText("Alpha City")).toBeTruthy();
    expect(within(box()).getByText("Ann Test · code 8801")).toBeTruthy();
    expect(within(box()).getByText("Cy Test · code 8803")).toBeTruthy();
    expect(within(box()).getByText(/Pay, claims and the weekly data are not affected/)).toBeTruthy();
  });

  it("says so when nobody is missing", () => {
    show({ checked: true, cities: ["Alpha City"], total: 0, shown: 0, drivers: [] });
    expect(within(box()).getByText("Every enabled driver of Alpha City is in this file.")).toBeTruthy();
  });

  it("says when only the first drivers are shown", () => {
    show({ checked: true, cities: ["Alpha City"], total: 250, shown: 1, drivers: [{ driverId: 1, name: "Ann Test", driverCode: 8801, city: "Alpha City" }] });
    expect(within(box()).getByText("Showing the first 1 of 250.")).toBeTruthy();
  });

  it("says the check did not run, without calling the upload a failure", () => {
    show({ checked: false });
    expect(within(box()).getByText(/Could not check which drivers are missing\. The upload itself was stored as usual\./)).toBeTruthy();
  });

  it("shows nothing when the server sent no answer", () => {
    show(undefined);
    expect(screen.queryByTestId("missing-drivers")).toBeNull();
  });
});
