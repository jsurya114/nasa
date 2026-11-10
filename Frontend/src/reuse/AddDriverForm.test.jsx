import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import AddDriverForm from "./AddDriverForm.jsx";

afterEach(cleanup);

// The Add / Edit driver form with the Driver Type dropdown. The type is optional: nothing chosen sends nothing, so a new driver is
// "Not set" and an edited driver keeps the type they have.
const mount = (props) => {
  const store = configureStore({
    reducer: {
      admin: (state = { isSuperAdmin: true }) => state,
      users: (state = { city: [{ id: 1, job: "Test City" }], loading: false }) => state,
    },
  });
  const onSubmit = vi.fn();
  render(<Provider store={store}><AddDriverForm onSubmit={onSubmit} onCancel={() => {}} {...props} /></Provider>);
  return onSubmit;
};

const PHONE = "Phone Number (required, 10 digits)";

const fillNewDriver = () => {
  fireEvent.change(screen.getByPlaceholderText("Driver Name"), { target: { value: "Dee Test" } });
  fireEvent.change(screen.getByPlaceholderText("Email"), { target: { value: "dee@example.com" } });
  fireEvent.change(screen.getByPlaceholderText(PHONE), { target: { value: "903-405-8843" } });
  fireEvent.change(screen.getByPlaceholderText("Driver Code"), { target: { value: "123" } });
  fireEvent.change(screen.getByPlaceholderText("Password"), { target: { value: "secret1" } });
  fireEvent.change(screen.getByPlaceholderText("Confirm Password"), { target: { value: "secret1" } });
  fireEvent.change(document.querySelector("select[name=city]"), { target: { value: "Test City" } });
};

describe("Add driver form: Driver Type", () => {
  it("offers Not set, Local and Desi, starting on Not set", () => {
    mount({});
    const select = screen.getByLabelText("Driver Type");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Not set", "Local", "Desi"]);
    expect(select.value).toBe("");
  });

  it("sends the chosen type with the new driver", () => {
    const onSubmit = mount({});
    fillNewDriver();
    fireEvent.change(screen.getByLabelText("Driver Type"), { target: { value: "DESI" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Driver" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: "Dee Test", driverType: "DESI" });
  });

  it("sends no type when none is chosen, and keeps what was chosen after Add (the dialog closes it on success)", () => {
    const onSubmit = mount({});
    fillNewDriver();
    fireEvent.click(screen.getByRole("button", { name: "Add Driver" }));
    expect("driverType" in onSubmit.mock.calls[0][0]).toBe(false);
    fillNewDriver();
    fireEvent.change(screen.getByLabelText("Driver Type"), { target: { value: "LOCAL" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Driver" }));
    expect(screen.getByLabelText("Driver Type").value).toBe("LOCAL");
  });

  it("editing shows the driver's current type, and saving without touching it sends it back unchanged", () => {
    const editData = { id: 7, name: "Eli Test", email: "eli@example.com", phone_number: "903-405-8843", driver_code: 12, job: "Test City", enabled: true, driver_type: "LOCAL" };
    const onSubmit = mount({ isEdit: true, editData });
    expect(screen.getByLabelText("Driver Type").value).toBe("LOCAL");
    fireEvent.click(screen.getByRole("button", { name: "Update Driver" }));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ driverType: "LOCAL" });
  });

  it("editing a driver with no type sends none unless one is chosen", () => {
    const editData = { id: 8, name: "Fay Test", email: "fay@example.com", phone_number: "903-405-8843", driver_code: 13, job: "Test City", enabled: true, driver_type: null };
    const onSubmit = mount({ isEdit: true, editData });
    expect(screen.getByLabelText("Driver Type").value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Update Driver" }));
    expect("driverType" in onSubmit.mock.calls[0][0]).toBe(false);
    fireEvent.change(screen.getByLabelText("Driver Type"), { target: { value: "DESI" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Driver" }));
    expect(onSubmit.mock.calls[1][0]).toMatchObject({ driverType: "DESI" });
  });
});

describe("Add driver form: the phone number is required", () => {
  it("has no optional wording, is marked required, and says what is needed", () => {
    mount({});
    const phone = screen.getByPlaceholderText(PHONE);
        expect(phone.getAttribute("aria-required")).toBe("true");
    expect(screen.queryByPlaceholderText(/optional/i)).toBeNull();
  });

  it("refuses to add a driver with no phone, or one Everee cannot use, and sends nothing", () => {
    const onSubmit = mount({});
    fillNewDriver();
    for (const [value, message] of [["", "Phone number is required"], ["   ", "Phone number is required"], ["12345", "Enter a 10-digit US phone number"], ["903-405-884", "Enter a 10-digit US phone number"], ["call me", "Enter a 10-digit US phone number"]]) {
      fireEvent.change(screen.getByPlaceholderText(PHONE), { target: { value } });
      fireEvent.click(screen.getByRole("button", { name: "Add Driver" }));
      expect(screen.getByText(new RegExp(message)), JSON.stringify(value)).toBeTruthy();
      expect(screen.getByPlaceholderText(PHONE).getAttribute("aria-invalid")).toBe("true");
    }
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("accepts a 10-digit US number in the usual ways, and the error goes away as it is typed", () => {
    const onSubmit = mount({});
    fillNewDriver();
    fireEvent.change(screen.getByPlaceholderText(PHONE), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Driver" }));
    expect(screen.getByText("Phone number is required")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(PHONE), { target: { value: "+1 (903) 405-8843" } });
    expect(screen.queryByText("Phone number is required")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add Driver" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].phoneNumber).toBe("+1 (903) 405-8843");
  });

  it("editing a driver who has no phone asks for one before it saves", () => {
    const onSubmit = mount({ isEdit: true, editData: { id: 9, name: "Gus Test", email: "gus@example.com", phone_number: null, driver_code: 14, job: "Test City", enabled: true, driver_type: null } });
    fireEvent.click(screen.getByRole("button", { name: "Update Driver" }));
    expect(screen.getByText("Phone number is required")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText(PHONE), { target: { value: "903-405-8843" } });
    fireEvent.click(screen.getByRole("button", { name: "Update Driver" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
