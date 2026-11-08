import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";

afterEach(cleanup);

// The top-level Statements tab is gone (#252): the weekly upload carries the statement. The owner still has Insights, which links to the import history.
vi.mock("./GlassTabBar.jsx", () => ({ default: ({ items }) => <ul>{items.map((i) => <li key={i.to} data-to={i.to}>{i.label}</li>)}</ul> }));

const links = async (isSuperAdmin) => {
  const { default: Nav } = await import("./Nav.jsx");
  const store = configureStore({ reducer: { admin: () => ({ isSuperAdmin }) } });
  const { container } = render(<Provider store={store}><MemoryRouter><Nav /></MemoryRouter></Provider>);
  return [...container.querySelectorAll("li")].map((li) => [li.textContent, li.getAttribute("data-to")]);
};

describe("the admin menu", () => {
  it("has no Statements tab for the owner, and still has File Upload and Insights", async () => {
    const owner = await links(true);
    expect(owner.some(([label]) => label === "Statements")).toBe(false);
    expect(owner.some(([, to]) => to === "/admin/carrier-statements")).toBe(false);
    expect(owner).toContainEqual(["File Upload", "/admin/double-stop"]);
    expect(owner).toContainEqual(["Insights", "/admin/insights"]);
  });

  it("has none for a city admin either, and no owner-only tabs", async () => {
    const city = await links(false);
    expect(city.some(([label]) => label === "Statements" || label === "Insights")).toBe(false);
  });
});
