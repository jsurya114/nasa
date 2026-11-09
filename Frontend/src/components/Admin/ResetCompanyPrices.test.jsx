import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const { post, toast } = vi.hoisted(() => ({ post: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../redux/slice/axiosInstance", () => ({ default: { post } }));
vi.mock("../../utils/toast", () => ({ toast }));

import ResetCompanyPrices from "./ResetCompanyPrices.jsx";

const CITY = { job: "Lafayette GOFO", city_type: "WEEKLY" };

describe("ResetCompanyPrices", () => {
  afterEach(cleanup);
  beforeEach(() => { post.mockReset(); toast.success.mockReset(); toast.error.mockReset(); });

  it("changes nothing until the owner confirms, and Cancel goes back", () => {
    render(<ResetCompanyPrices city={CITY} />);
    fireEvent.click(screen.getByTestId("reset-company-prices"));
    expect(screen.getByTestId("reset-company-prices-confirm").textContent).toContain("Lafayette GOFO");
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByTestId("reset-company-prices")).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it("sends the chosen city once, says how many routes were reset and refreshes the list", async () => {
    post.mockResolvedValue({ data: { job: "Lafayette GOFO", routesReset: 3 } });
    const onDone = vi.fn();
    render(<ResetCompanyPrices city={CITY} onDone={onDone} />);
    fireEvent.click(screen.getByTestId("reset-company-prices"));
    fireEvent.click(screen.getByTestId("reset-company-prices-yes"));
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("/admin/routes/reset-company-prices", { job: "Lafayette GOFO" });
    expect(toast.success).toHaveBeenCalledWith("Lafayette GOFO: company prices reset to 0 on 3 routes.");
  });

  it("says so when the prices were already 0", async () => {
    post.mockResolvedValue({ data: { job: "Lafayette GOFO", routesReset: 0 } });
    render(<ResetCompanyPrices city={CITY} />);
    fireEvent.click(screen.getByTestId("reset-company-prices"));
    fireEvent.click(screen.getByTestId("reset-company-prices-yes"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Lafayette GOFO: company prices were already 0."));
  });

  it("shows the server's words when the reset is refused, and keeps the confirmation open to retry", async () => {
    post.mockRejectedValue({ response: { status: 403, data: { error: "Access denied." } } });
    const onDone = vi.fn();
    render(<ResetCompanyPrices city={CITY} onDone={onDone} />);
    fireEvent.click(screen.getByTestId("reset-company-prices"));
    fireEvent.click(screen.getByTestId("reset-company-prices-yes"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Access denied."));
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByTestId("reset-company-prices-confirm")).toBeTruthy();
  });
});
