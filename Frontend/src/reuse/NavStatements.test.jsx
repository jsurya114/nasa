import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";

afterEach(cleanup);

// The Statements tab was taken out when the weekly upload started to carry the statement (#252, #262). It is back for the super admin only, because the
// upload's own link is easy to miss when a week stays "estimated" and the statement has to be reviewed by hand.
vi.mock("./GlassTabBar.jsx", () => ({ default: ({ items }) => <ul>{items.map((i) => <li key={i.to} data-to={i.to}>{i.label}</li>)}</ul> }));

const links = async (isSuperAdmin) => {
  const { default: Nav } = await import("./Nav.jsx");
  const store = configureStore({ reducer: { admin: () => ({ isSuperAdmin }) } });
  const { container } = render(<Provider store={store}><MemoryRouter><Nav /></MemoryRouter></Provider>);
  return [...container.querySelectorAll("li")].map((li) => [li.textContent, li.getAttribute("data-to")]);
};

describe("the admin menu", () => {
  it("has a Statements tab for the owner, next to File Upload and Insights", async () => {
    const owner = await links(true);
    expect(owner).toContainEqual(["Statements", "/admin/carrier-statements"]);
    expect(owner).toContainEqual(["File Upload", "/admin/double-stop"]);
    expect(owner).toContainEqual(["Insights", "/admin/insights"]);
  });

  it("has no Statements or Insights tab for a city admin", async () => {
    const city = await links(false);
    expect(city.some(([label]) => label === "Statements" || label === "Insights")).toBe(false);
  });
});
