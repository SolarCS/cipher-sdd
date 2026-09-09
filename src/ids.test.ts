import { describe, expect, it } from "vitest";

import {
  formatId,
  isId,
  kindOf,
  nearMissPattern,
  nextNumber,
  referencePattern,
  scopeOf,
} from "./ids.js";

describe("the sdd grammar", () => {
  it("accepts a story and a requirement, and tells them apart by the kind letter", () => {
    expect(isId("ZQS-S1", "sdd")).toBe(true);
    expect(isId("ZQS-R7", "sdd")).toBe(true);
    expect(kindOf("ZQS-S1", "sdd")).toBe("story");
    expect(kindOf("ZQS-R7", "sdd")).toBe("requirement");
  });

  it("refuses a bare number, so a catalyst id cannot drift into an sdd register unnoticed", () => {
    expect(isId("ZQS-7", "sdd")).toBe(false);
    expect(kindOf("ZQS-7", "sdd")).toBeNull();
  });

  it("refuses a suffix, a lowercase scope, and a scope longer than five letters", () => {
    for (const bad of ["ZQS-R1a", "src-r1", "SOURCES-R1", "ZQS-X1", "ZQS-R", "ZQS-1R"]) {
      expect(isId(bad, "sdd"), bad).toBe(false);
    }
  });
});

describe("the catalyst compat grammar", () => {
  it("accepts the plain form and calls everything a requirement", () => {
    expect(isId("ZQA-17", "catalyst")).toBe(true);
    expect(kindOf("ZQA-17", "catalyst")).toBe("requirement");
  });

  it("rejects ZQA-US1 as malformed rather than reading it as a story", () => {
    // The decisive constraint: a suffixed sub-namespace is not a second kind, it is a broken id,
    // and it must be reported as one rather than silently skipped.
    expect(isId("ZQA-US1", "catalyst")).toBe(false);
    expect(nearMissPattern("ZQA").test("ZQA-US1")).toBe(true);
  });

  it("has no spelling for a story, and refuses to invent one", () => {
    expect(formatId("ZQA", "story", 1, "catalyst")).toBeNull();
    expect(formatId("ZQA", "requirement", 18, "catalyst")).toBe("ZQA-18");
  });
});

describe("near-miss detection", () => {
  it("matches a bare broken token but never prose that merely opens with the scope", () => {
    const near = nearMissPattern("ZQC");
    expect(near.test("ZQC-29a")).toBe(true);
    expect(near.test("zqc-29")).toBe(true);
    // The reference records this exact false positive: a table whose first cell is prose.
    expect(near.test("ZQC-29 rec-4 assertion shape")).toBe(false);
  });
});

describe("allocation", () => {
  it("reads the highest number rather than counting, so a retired id is never reissued", () => {
    // ZQS-R2 retired and absent from the live list; counting would hand out 3 again.
    const live = ["ZQS-R1", "ZQS-R3", "ZQS-S1"];
    expect(nextNumber(live, "requirement", "sdd")).toBe(4);
  });

  it("numbers stories and requirements independently", () => {
    const ids = ["ZQS-S1", "ZQS-S2", "ZQS-R1"];
    expect(nextNumber(ids, "story", "sdd")).toBe(3);
    expect(nextNumber(ids, "requirement", "sdd")).toBe(2);
  });

  it("starts at 1 for an empty scope", () => {
    expect(nextNumber([], "story", "sdd")).toBe(1);
  });

  it("round-trips through formatId", () => {
    expect(formatId("ZQS", "story", 4, "sdd")).toBe("ZQS-S4");
    expect(formatId("ZQS", "requirement", 12, "sdd")).toBe("ZQS-R12");
  });
});

describe("reference scanning", () => {
  it("finds every id of a known scope in prose and test titles", () => {
    const re = referencePattern(["ZQS", "ZQB"], "sdd");
    const text = 'it("refuses an unsigned record (ZQS-R7)", …) and see ZQS-S1, ZQB-R2';
    expect(text.match(re ?? /$^/)).toEqual(["ZQS-R7", "ZQS-S1", "ZQB-R2"]);
  });

  it("is word-bounded, so ZQS-R7 never matches inside ZQS-R70", () => {
    const re = referencePattern(["ZQS"], "sdd");
    expect("ZQS-R70".match(re ?? /$^/)).toEqual(["ZQS-R70"]);
  });

  it("returns null when no scope is declared, rather than a regex that matches everything", () => {
    expect(referencePattern([], "sdd")).toBeNull();
  });
});

describe("scopeOf", () => {
  it("splits on the first hyphen under both grammars", () => {
    expect(scopeOf("ZQS-R7")).toBe("ZQS");
    expect(scopeOf("ZQA-17")).toBe("ZQA");
  });
});
