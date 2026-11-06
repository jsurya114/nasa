import { describe, expect, it } from "vitest";
import { checkSession, readEvent } from "./embedRules.js";
import { validateDetails } from "./setupRules.js";

describe("the link of a session", () => {
  it("is accepted only as https on an everee.com host, with the origin that goes with it", () => {
    expect(checkSession({ url: "https://embed.everee.com/s/abc?x=1", origin: "https://embed.everee.com" })).toEqual({ src: "https://embed.everee.com/s/abc?x=1", origin: "https://embed.everee.com" });
    expect(checkSession({ url: "https://everee.com/s" })).toMatchObject({ origin: "https://everee.com" });
  });
  it.each([
    ["http", { url: "http://embed.everee.com/s" }],
    ["another site", { url: "https://evil.example.com/s" }],
    ["a look-alike host", { url: "https://everee.com.evil.example/s" }],
    ["a look-alike prefix", { url: "https://noteveree.com/s" }],
    ["a javascript link", { url: "javascript:alert(1)" }],
    ["a different origin", { url: "https://embed.everee.com/s", origin: "https://other.everee.com" }],
    ["nothing", {}],
    ["no session", null],
  ])("is refused: %s", (_name, session) => {
    expect(checkSession(session)).toBeNull();
  });
});

describe("an event from the port", () => {
  const ok = { eventType: "DISMISS", eventHandlerName: "nasaEvereeEmbed" };
  it("is read when it is a plain object with a known type and this session's handler name", () => {
    expect(readEvent(ok, "nasaEvereeEmbed")).toEqual({ type: "DISMISS", error: false, errorCode: null });
    expect(readEvent({ eventType: "MESSAGE_PORT_REGISTERED" }, "nasaEvereeEmbed")).toMatchObject({ type: "MESSAGE_PORT_REGISTERED" });
    expect(readEvent({ ...ok, error: true, errorCode: "EMB-101" }, "nasaEvereeEmbed")).toEqual({ type: "DISMISS", error: true, errorCode: "EMB-101" });
  });
  it.each([
    ["another handler name", { ...ok, eventHandlerName: "someoneElse" }],
    ["an unknown type", { eventType: "PAY_NOW", eventHandlerName: "nasaEvereeEmbed" }],
    ["a type that is not text", { eventType: 5 }],
    ["a string", "DISMISS"],
    ["an array", [ok]],
    ["null", null],
  ])("is ignored: %s", (_name, data) => {
    expect(readEvent(data, "nasaEvereeEmbed")).toBeNull();
  });
});

describe("the setup form", () => {
  const good = { line1: "1 Test Street", line2: "", city: "Austin", state: "tx", postalCode: "78701", startDate: "2026-10-01" };
  it("needs an address, a 2-letter state and a 5-digit ZIP, and a start date only when asked", () => {
    expect(validateDetails(good, true)).toEqual({});
    expect(validateDetails({ ...good, startDate: "" }, false)).toEqual({});
    expect(validateDetails({ ...good, startDate: "" }, true)).toEqual({ startDate: "psetFieldStartRequired" });
    expect(validateDetails({ ...good, line1: " ", city: "", state: "Texas", postalCode: "787" }, false)).toEqual({
      line1: "psetFieldLine1Required", city: "psetFieldCityRequired", state: "psetFieldStateInvalid", postalCode: "psetFieldZipInvalid",
    });
  });
});
