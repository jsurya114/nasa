import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, clearDrafts, clearPending, markPending, readDraft, readPending, writeDraft } from "./formDrafts";

beforeEach(() => sessionStorage.clear());

describe("form drafts", () => {
  it("keeps plain text per area, person and form", () => {
    writeDraft("driver", 7, "journey", { route: "3", start_sequence: "10", end_sequence: "" });
    expect(readDraft("driver", 7, "journey")).toEqual({ route: "3", start_sequence: "10" });
    expect(readDraft("driver", 8, "journey")).toBeNull();
    expect(readDraft("admin", 7, "journey")).toBeNull();
    expect(readDraft("driver", 7, "agreement")).toBeNull();
  });

  it("an empty form removes its draft instead of storing blanks", () => {
    writeDraft("driver", 7, "journey", { route: "3" });
    writeDraft("driver", 7, "journey", { route: "", start_sequence: "" });
    expect(readDraft("driver", 7, "journey")).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("keeps only short text values, whatever was stored", () => {
    writeDraft("driver", 7, "journey", { ok: "yes", long: "x".repeat(501), n: 5, nested: { a: 1 }, list: ["a"] });
    expect(readDraft("driver", 7, "journey")).toEqual({ ok: "yes" });
    sessionStorage.setItem("nasa.draft.driver.7.journey", JSON.stringify({ a: "b", c: { d: 1 }, e: 3 }));
    expect(readDraft("driver", 7, "journey")).toEqual({ a: "b" });
    for (const bad of ["not json", "[]", "null", "5", '"text"', "{}"]) {
      sessionStorage.setItem("nasa.draft.driver.7.journey", bad);
      expect(readDraft("driver", 7, "journey")).toBeNull();
    }
  });

  it("clearing one draft leaves the others; clearing an area removes all of its drafts and no other storage", () => {
    writeDraft("driver", 7, "journey", { route: "3" });
    writeDraft("driver", 8, "journey", { route: "4" });
    writeDraft("admin", 1, "journey", { route: "5" });
    sessionStorage.setItem("unrelated", "keep");
    clearDraft("driver", 7, "journey");
    expect(readDraft("driver", 7, "journey")).toBeNull();
    expect(readDraft("driver", 8, "journey")).toEqual({ route: "4" });
    clearDrafts("driver");
    expect(readDraft("driver", 8, "journey")).toBeNull();
    expect(readDraft("admin", 1, "journey")).toEqual({ route: "5" });
    expect(sessionStorage.getItem("unrelated")).toBe("keep");
  });

  it("an unconfirmed save is remembered per area, person and form, with the submission it belongs to", () => {
    markPending("driver", 7, "journey", "2026-11-02");
    expect(readPending("driver", 7, "journey")).toBe("2026-11-02");
    expect(readPending("driver", 8, "journey")).toBeNull();
    expect(readPending("admin", 7, "journey")).toBeNull();
    expect(readPending("driver", 7, "agreement")).toBeNull();
    clearPending("driver", 7, "journey");
    expect(readPending("driver", 7, "journey")).toBeNull();
  });

  it("an unconfirmed save is not a draft, and clearing a draft does not forget it", () => {
    markPending("driver", 7, "journey", "2026-11-02");
    expect(readDraft("driver", 7, "journey")).toBeNull();
    writeDraft("driver", 7, "journey", { route: "3" });
    clearDraft("driver", 7, "journey");
    expect(readPending("driver", 7, "journey")).toBe("2026-11-02");
  });

  it("signing out removes the area's unconfirmed saves too, and only that area's", () => {
    markPending("driver", 7, "journey", "2026-11-02");
    markPending("driver", 8, "journey", "2026-11-02");
    markPending("admin", 1, "journey", "2026-11-02");
    clearDrafts("driver");
    expect(readPending("driver", 7, "journey")).toBeNull();
    expect(readPending("driver", 8, "journey")).toBeNull();
    expect(readPending("admin", 1, "journey")).toBe("2026-11-02");
  });

  it("never throws when storage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    try {
      expect(() => writeDraft("driver", 7, "journey", { route: "3" })).not.toThrow();
      expect(readDraft("driver", 7, "journey")).toBeNull();
      expect(() => clearDraft("driver", 7, "journey")).not.toThrow();
      expect(() => clearDrafts("driver")).not.toThrow();
      expect(() => markPending("driver", 7, "journey", "2026-11-02")).not.toThrow();
      expect(readPending("driver", 7, "journey")).toBeNull();
      expect(() => clearPending("driver", 7, "journey")).not.toThrow();
    } finally {
      Object.defineProperty(window, "sessionStorage", original);
    }
  });
});
