import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import Modal from "./Modal.jsx";

afterEach(cleanup);

const Harness = ({ busy = false, onClose = () => {} }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && (
        <Modal title="Add Thing" busy={busy} onClose={() => { onClose(); setOpen(false); }}>
          <input aria-label="First field" />
          <button type="button">Inner</button>
        </Modal>
      )}
    </>
  );
};

const open = () => fireEvent.click(screen.getByText("Open"));

describe("Modal", () => {
  it("shows the title in a labelled dialog, moves focus to the first field, and locks the page behind it", () => {
    render(<Harness />);
    open();
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("heading", { name: "Add Thing" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("First field"));
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("closes with the X button, Escape and a click on the backdrop, and gives the page and focus back", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const opener = screen.getByText("Open");

    opener.focus(); // a real click focuses the button; fireEvent does not
    open();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
    expect(document.activeElement).toBe(opener);

    open();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    open();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("does not close when the dialog itself is clicked", () => {
    render(<Harness />);
    open();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    fireEvent.mouseDown(screen.getByLabelText("First field"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("cannot be closed while busy: X is disabled, Escape and the backdrop do nothing", () => {
    const onClose = vi.fn();
    render(<Harness busy onClose={onClose} />);
    open();
    expect(screen.getByRole("button", { name: "Close" }).disabled).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("keeps Tab inside the dialog", () => {
    render(<Harness />);
    open();
    const close = screen.getByRole("button", { name: "Close" });
    const inner = screen.getByText("Inner");
    inner.focus();
    fireEvent.keyDown(inner, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(inner);
  });

  it("scrolls long content inside the dialog, not the page", () => {
    render(<Harness />);
    open();
    const dialog = screen.getByRole("dialog");
    expect(dialog.className).toContain("max-h-[calc(100dvh-1.5rem)]");
    expect(dialog.querySelector(".overflow-y-auto")).toBeTruthy();
  });
});
