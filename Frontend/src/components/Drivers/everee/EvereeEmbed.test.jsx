import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { installServer, removeShell, resetBrowser } from "../../../test/fakeShell";

// The embedded Everee screen on its own, with REAL timers and short waits (no fake clock), so the result does not depend on how fast the machine is.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const session = (expiresInMs = 60_000) => ({ url: "https://embed.everee.com/s/single-use-token", origin: "https://embed.everee.com", expiresAt: new Date(Date.now() + expiresInMs).toISOString(), eventHandlerName: "nasaEvereeEmbed" });
let channels;

const mount = async (props) => {
  await installServer(async () => ({ status: 200, data: {} }));
  const [{ configureStore }, { Provider }, { MemoryRouter }] = await Promise.all([import("@reduxjs/toolkit"), import("react-redux"), import("react-router-dom")]);
  const languageReducer = (await import("../../../redux/slice/languageSlice.js")).default;
  const { default: EvereeEmbed } = await import("./EvereeEmbed.jsx");
  const store = configureStore({ reducer: { language: languageReducer } });
  const problems = vi.fn();
  const finished = vi.fn();
  const tree = (extra = {}) => <Provider store={store}><MemoryRouter><EvereeEmbed session={props.session} connectTimeoutMs={props.connectTimeoutMs} onProblem={problems} onFinished={finished} onClose={() => {}} {...extra} /></MemoryRouter></Provider>;
  const view = render(tree());
  const frame = document.querySelector("iframe");
  const post = vi.fn();
  if (frame) {
    Object.defineProperty(frame, "contentWindow", { value: { postMessage: post }, configurable: true });
    fireEvent.load(frame);
  }
  const speak = (data) => act(() => channels.at(-1).port1.onmessage({ data }));
  return { ...view, problems, finished, post, speak, again: (extra) => view.rerender(tree(extra)) };
};

beforeEach(async () => {
  removeShell();
  await resetBrowser();
  channels = [];
  vi.stubGlobal("MessageChannel", class { constructor() { this.port1 = { onmessage: null, close: vi.fn() }; this.port2 = {}; channels.push(this); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const REGISTERED = { eventType: "MESSAGE_PORT_REGISTERED", eventHandlerName: "nasaEvereeEmbed" };

describe("the connection wait", () => {
  it("a screen that registered stays open past the wait, past the link's expiry and through unrelated re-renders", async () => {
    const { speak, problems, again } = await mount({ session: session(120), connectTimeoutMs: 80 });
    speak(REGISTERED); // hides the "Opening Everee…" line: a re-render
    again({ onFinished: () => {} });
    again({ onClose: () => {} });
    await act(async () => { await sleep(400); }); // far past both the 80 ms wait and the 120 ms expiry
    expect(problems).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Everee payment setup" })).toBeTruthy();
  });

  it("registering before anything else has run still counts for good (nothing resets it)", async () => {
    const { speak, problems, again } = await mount({ session: session(60_000), connectTimeoutMs: 80 });
    speak(REGISTERED);
    speak(REGISTERED); // a repeated message changes nothing
    again({});
    await act(async () => { await sleep(300); });
    expect(problems).not.toHaveBeenCalled();
  });

  it("a screen that never registers is closed as 'no connection' after the wait", async () => {
    const { problems } = await mount({ session: session(60_000), connectTimeoutMs: 80 });
    await act(async () => { await sleep(300); });
    expect(problems).toHaveBeenCalledWith("no_connection");
    expect(problems).toHaveBeenCalledTimes(1);
  });

  it("a link that runs out before the screen registers is closed as 'expired'", async () => {
    const { problems } = await mount({ session: session(60), connectTimeoutMs: 5_000 });
    await act(async () => { await sleep(300); });
    expect(problems).toHaveBeenCalledWith("expired");
  });
});

describe("events and links", () => {
  it("a completion event or a close asks the page to finish, and anything else is ignored", async () => {
    const { speak, finished, problems } = await mount({ session: session(), connectTimeoutMs: 5_000 });
    speak(REGISTERED);
    speak({ eventType: "ONBOARDING_DOCUMENTS_COMPLETE", eventHandlerName: "nasaEvereeEmbed" });
    speak({ eventType: "DISMISS", eventHandlerName: "someoneElse" });
    expect(finished).not.toHaveBeenCalled();
    speak({ eventType: "WORKER_ONBOARDING_COMPLETE", eventHandlerName: "nasaEvereeEmbed" });
    expect(finished).toHaveBeenCalledTimes(1);
    speak({ eventType: "DISMISS", eventHandlerName: "nasaEvereeEmbed", error: true, errorCode: "EMB-101" });
    expect(problems).toHaveBeenCalledWith("screen_error");
  });

  it("the port goes only to the link's own origin, and a bad link renders no frame", async () => {
    const good = await mount({ session: session(), connectTimeoutMs: 5_000 });
    expect(good.post.mock.calls[0][1]).toBe("https://embed.everee.com");
    cleanup();
    channels = [];
    const bad = await mount({ session: { ...session(), url: "https://evil.example.com/s", origin: "https://evil.example.com" }, connectTimeoutMs: 5_000 });
    expect(document.querySelector("iframe")).toBeNull();
    expect(bad.problems).toHaveBeenCalledWith("bad_session");
  });
});
