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
    expect(isId("SRC-S1", "sdd")).toBe(true);
    expect(isId("SRC-R7", "sdd")).toBe(true);
    expect(kindOf("SRC-S1", "sdd")).toBe("story");
    expect(kindOf("SRC-R7", "sdd")).toBe("requirement");
  });

  it("refuses a bare number, so a catalyst id cannot drift into an sdd register unnoticed", () => {
    expect(isId("SRC-7", "sdd")).toBe(false);
    expect(kindOf("SRC-7", "sdd")).toBeNull();
  });

  it("refuses a suffix, a lowercase scope, and a scope longer than five letters", () => {
    for (const bad of ["SRC-R1a", "src-r1", "SOURCES-R1", "SRC-X1", "SRC-R", "SRC-1R"]) {
      expect(isId(bad, "sdd"), bad).toBe(false);
    }
  });
});

describe("the catalyst compat grammar", () => {
  it("accepts the plain form and calls everything a requirement", () => {
    expect(isId("SGE-17", "catalyst")).toBe(true);
    expect(kindOf("SGE-17", "catalyst")).toBe("requirement");
  });

  it("rejects SGE-US1 as malformed rather than reading it as a story", () => {
    // The decisive constraint: a suffixed sub-namespace is not a second kind, it is a broken id,
    // and it must be reported as one rather than silently skipped.
    expect(isId("SGE-US1", "catalyst")).toBe(false);
    expect(nearMissPattern("SGE").test("SGE-US1")).toBe(true);
  });

  it("has no spelling for a story, and refuses to invent one", () => {
    expect(formatId("SGE", "story", 1, "catalyst")).toBeNull();
    expect(formatId("SGE", "requirement", 18, "catalyst")).toBe("SGE-18");
  });
});

describe("near-miss detection", () => {
  it("matches a bare broken token but never prose that merely opens with the scope", () => {
    const near = nearMissPattern("SEC");
    expect(near.test("SEC-29a")).toBe(true);
    expect(near.test("sec-29")).toBe(true);
    // The reference records this exact false positive: a table whose first cell is prose.
    expect(near.test("SEC-29 rec-4 assertion shape")).toBe(false);
  });
});

describe("allocation", () => {
  it("reads the highest number rather than counting, so a retired id is never reissued", () => {
    // SRC-R2 retired and absent from the live list; counting would hand out 3 again.
    const live = ["SRC-R1", "SRC-R3", "SRC-S1"];
    expect(nextNumber(live, "requirement", "sdd")).toBe(4);
  });

  it("numbers stories and requirements independently", () => {
    const ids = ["SRC-S1", "SRC-S2", "SRC-R1"];
    expect(nextNumber(ids, "story", "sdd")).toBe(3);
    expect(nextNumber(ids, "requirement", "sdd")).toBe(2);
  });

  it("starts at 1 for an empty scope", () => {
    expect(nextNumber([], "story", "sdd")).toBe(1);
  });

  it("round-trips through formatId", () => {
    expect(formatId("SRC", "story", 4, "sdd")).toBe("SRC-S4");
    expect(formatId("SRC", "requirement", 12, "sdd")).toBe("SRC-R12");
  });
});

describe("reference scanning", () => {
  it("finds every id of a known scope in prose and test titles", () => {
    const re = referencePattern(["SRC", "WHK"], "sdd");
    const text = 'it("refuses an unsigned record (SRC-R7)", …) and see SRC-S1, WHK-R2';
    expect(text.match(re ?? /$^/)).toEqual(["SRC-R7", "SRC-S1", "WHK-R2"]);
  });

  it("is word-bounded, so SRC-R7 never matches inside SRC-R70", () => {
    const re = referencePattern(["SRC"], "sdd");
    expect("SRC-R70".match(re ?? /$^/)).toEqual(["SRC-R70"]);
  });

  it("returns null when no scope is declared, rather than a regex that matches everything", () => {
    expect(referencePattern([], "sdd")).toBeNull();
  });
});

describe("scopeOf", () => {
  it("splits on the first hyphen under both grammars", () => {
    expect(scopeOf("SRC-R7")).toBe("SRC");
    expect(scopeOf("SGE-17")).toBe("SGE");
  });
});
