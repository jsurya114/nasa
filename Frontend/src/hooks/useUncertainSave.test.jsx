import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import useUncertainSave from "./useUncertainSave.js";
import { markPending, readPending } from "../utils/formDrafts";

const persist = { area: "driver", userId: 7, form: "journey", scope: "2026-11-02" };

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
});

describe("an unconfirmed save that is remembered across a reload", () => {
  it("is blocked from the very first render, before any check has run", async () => {
    markPending("driver", 7, "journey", "2026-11-02");
    const seen = [];
    const check = vi.fn(() => new Promise(() => {}));
    renderHook(() => {
      const save = useUncertainSave({ check, onSaved: () => {}, persist });
      seen.push({ blocked: save.blocked, state: save.state });
      return save;
    });
    expect(seen[0]).toEqual({ blocked: true, state: "checking" });
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
  });

  it("is not blocked when nothing was remembered, or when it was for another submission", async () => {
    const check = vi.fn(async () => false);
    const first = renderHook(() => useUncertainSave({ check, onSaved: () => {}, persist }));
    expect(first.result.current.blocked).toBe(false);
    first.unmount();

    markPending("driver", 7, "journey", "2020-01-01");
    const seen = [];
    renderHook(() => {
      const save = useUncertainSave({ check, onSaved: () => {}, persist });
      seen.push(save.blocked);
      return save;
    });
    expect(seen[0]).toBe(false);
    await waitFor(() => expect(readPending("driver", 7, "journey")).toBeNull());
    expect(check).not.toHaveBeenCalled();
  });

  it("is blocked only once the person's id is known, and remembers nothing without it", async () => {
    const check = vi.fn(async () => true);
    const { result } = renderHook(() => useUncertainSave({ check, onSaved: () => {}, persist: { ...persist, userId: undefined } }));
    await act(async () => { await result.current.begin(); });
    expect(sessionStorage.length).toBe(0);
  });

  it("begin remembers it, a check that cannot reach the server keeps it, and an answer forgets it", async () => {
    let reachable = false;
    let saved = true;
    const onSaved = vi.fn();
    const check = vi.fn(async () => {
      if (!reachable) throw new Error("offline");
      return saved;
    });
    const { result } = renderHook(() => useUncertainSave({ check, onSaved, persist }));

    await act(async () => { await result.current.begin(); });
    expect(readPending("driver", 7, "journey")).toBe("2026-11-02");
    expect(result.current.state).toBe("unconfirmed");
    expect(result.current.blocked).toBe(true);

    reachable = true;
    await act(async () => { await result.current.checkAgain(); });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(readPending("driver", 7, "journey")).toBeNull();
    expect(result.current.blocked).toBe(false);

    saved = false;
    await act(async () => { await result.current.begin(); });
    expect(result.current.state).toBe("notSaved");
    expect(readPending("driver", 7, "journey")).toBeNull();
    expect(result.current.blocked).toBe(false);
  });
});
