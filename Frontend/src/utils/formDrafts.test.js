import { beforeEach, describe, expect, it } from "vitest";
import { clearDraft, clearDrafts, readDraft, writeDraft } from "./formDrafts";

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

  it("never throws when storage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
    Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
    try {
      expect(() => writeDraft("driver", 7, "journey", { route: "3" })).not.toThrow();
      expect(readDraft("driver", 7, "journey")).toBeNull();
      expect(() => clearDraft("driver", 7, "journey")).not.toThrow();
      expect(() => clearDrafts("driver")).not.toThrow();
    } finally {
      Object.defineProperty(window, "sessionStorage", original);
    }
  });
});
