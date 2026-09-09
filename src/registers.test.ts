import { describe, expect, it } from "vitest";

import { parseRegister, parseSpecRegister, parseTableRegister } from "./registers.js";
import type { RegisterConfig } from "./registers.js";

const ZQS: RegisterConfig = { scope: "ZQS", file: "specs/sources/spec.md", format: "sdd" };
const spec = (body: string, reg: RegisterConfig = ZQS) => parseSpecRegister(body, reg, "sdd");
const kinds = (r: ReturnType<typeof spec>) => r.problems.map((p) => p.kind);

describe("the table format (legacy compat)", () => {
  const ZQB: RegisterConfig = { scope: "ZQB", file: "legacy/x/spec.md" };

  it("reads rows and ignores everything that is not one", () => {
    const { entries } = parseTableRegister(
      ["prose", "| ZQB-1 | — | Building | MUST verify. |", "| not a row"].join("\n"),
      ZQB,
      "catalyst",
    );
    expect(entries.map((e) => e.id)).toEqual(["ZQB-1"]);
    expect(entries[0]?.kind).toBe("requirement");
  });

  it("treats a WHOLE cell of 'Withdrawn' as retirement, never the word in prose", () => {
    // The reference records this: a requirement reading "…whose grant has been withdrawn" was
    // silently retired by a substring match.
    const { entries } = parseTableRegister(
      [
        "| ZQB-1 | — | Building | MUST refuse a grant that has been withdrawn. |",
        "| ZQB-2 | — | Withdrawn | Superseded by ZQB-1. |",
      ].join("\n"),
      ZQB,
      "catalyst",
    );
    expect(entries.find((e) => e.id === "ZQB-1")?.withdrawn).toBe(false);
    expect(entries.find((e) => e.id === "ZQB-2")?.withdrawn).toBe(true);
  });

  it("reports a near-miss row rather than dropping it", () => {
    const { entries, malformed } = parseTableRegister(
      "| ZQB-1a | — | Building | broken |",
      ZQB,
      "catalyst",
    );
    expect(entries).toEqual([]);
    expect(malformed).toEqual(["ZQB-1a"]);
  });
});

describe("the sdd format — sections decide state", () => {
  it("reads stories and requirements out of one document", () => {
    const r = spec(
      [
        "## User Stories",
        "### User Story: ZQS-S1 — Register a path pattern",
        "## Requirements",
        "### Requirement: ZQS-R1 — MUST accept a param segment",
        "> Story: ZQS-S1",
      ].join("\n"),
    );
    expect(r.entries.map((e) => [e.id, e.kind])).toEqual([
      ["ZQS-S1", "story"],
      ["ZQS-R1", "requirement"],
    ]);
    expect(r.entries[1]?.stories).toEqual(["ZQS-S1"]);
    expect(r.problems).toEqual([]);
  });

  it("marks proposed entries as declared-but-not-gated, and retired ones as withdrawn", () => {
    const r = spec(
      [
        "## Proposed Requirements",
        "### Requirement: ZQS-R2 — MUST rank literal over param",
        "## Retired Requirements",
        "### Requirement: ZQS-R3 — replaced by a whole-grant read",
        "> Retired 2026-09-04 by `af8b0690`.",
      ].join("\n"),
    );
    const byId = new Map(r.entries.map((e) => [e.id, e]));
    expect(byId.get("ZQS-R2")?.proposed).toBe(true);
    expect(byId.get("ZQS-R2")?.withdrawn).toBe(false);
    expect(byId.get("ZQS-R3")?.withdrawn).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("demands a dated record on a retired entry, so the reason is never lost", () => {
    const r = spec(
      ["## Retired Requirements", "### Requirement: ZQS-R3 — gone with no reason"].join("\n"),
    );
    expect(kinds(r)).toEqual(["retired-no-record"]);
  });

  it("flags a misspelt retired heading, which would otherwise gate every id beneath it", () => {
    const r = spec(
      ["## Retired requirement", "### Requirement: ZQS-R3 — filed under a typo"].join("\n"),
    );
    expect(kinds(r)).toContain("retired-heading-spelling");
  });

  it("flags an entry outside any known section rather than counting it", () => {
    const r = spec(["## Notes", "### Requirement: ZQS-R9 — orphaned"].join("\n"));
    expect(kinds(r)).toEqual(["orphan"]);
    expect(r.entries).toEqual([]);
  });
});

describe("the sdd format — kind must agree with its filing", () => {
  it("flags a requirement filed under User Stories", () => {
    const r = spec(["## User Stories", "### Requirement: ZQS-R1 — misfiled"].join("\n"));
    expect(kinds(r)).toEqual(["kind-section-mismatch"]);
    expect(r.entries).toEqual([]);
  });

  it("flags a heading whose keyword and id disagree about kind", () => {
    const r = spec(["## User Stories", "### User Story: ZQS-R4 — heading says story"].join("\n"));
    expect(kinds(r)).toEqual(["kind-id-mismatch"]);
    expect(r.entries).toEqual([]);
  });
});

describe("the sdd format — text that only looks like a declaration", () => {
  it("ignores a requirement inside a fenced block", () => {
    const r = spec(
      [
        "## Requirements",
        "```markdown",
        "### Requirement: ZQS-R99 — an example in the docs",
        "```",
        "### Requirement: ZQS-R1 — the real one",
      ].join("\n"),
    );
    expect(r.entries.map((e) => e.id)).toEqual(["ZQS-R1"]);
  });

  it("closes a fence only on a run of the same character and at least the same length", () => {
    const r = spec(
      [
        "## Requirements",
        "````",
        "```",
        "### Requirement: ZQS-R99 — still fenced",
        "````",
        "### Requirement: ZQS-R1 — after the real close",
      ].join("\n"),
    );
    expect(r.entries.map((e) => e.id)).toEqual(["ZQS-R1"]);
  });

  it("ignores a requirement commented out, including across lines", () => {
    const r = spec(
      [
        "## Requirements",
        "<!--",
        "### Requirement: ZQS-R99 — the scaffold's worked example",
        "-->",
        "### Requirement: ZQS-R1 — live",
      ].join("\n"),
    );
    expect(r.entries.map((e) => e.id)).toEqual(["ZQS-R1"]);
  });

  it("reports an unresolved question in the live section but tolerates it in proposed", () => {
    const live = spec(
      [
        "## Requirements",
        "### Requirement: ZQS-R1 — MUST accept [NEEDS CLARIFICATION: which encodings?]",
      ].join("\n"),
    );
    expect(kinds(live)).toEqual(["clarification"]);

    const proposed = spec(
      [
        "## Proposed Requirements",
        "### Requirement: ZQS-R1 — MUST accept [NEEDS CLARIFICATION: which encodings?]",
      ].join("\n"),
    );
    expect(kinds(proposed)).toEqual([]);
  });
});

describe("the sdd format — scenarios", () => {
  const strict: RegisterConfig = { ...ZQS, requireScenarios: true };

  it("demands WHEN and THEN when the register asks for scenarios", () => {
    const r = parseSpecRegister(
      [
        "## Requirements",
        "### Requirement: ZQS-R1 — MUST match one segment",
        "#### Scenario: a bare param",
        "- **GIVEN** a registered pattern",
        "- **WHEN** a request arrives",
      ].join("\n"),
      strict,
      "sdd",
    );
    expect(kinds(r)).toEqual(["scenario-no-then"]);
  });

  it("demands at least one scenario per live requirement, but never on a retired one", () => {
    const r = parseSpecRegister(
      [
        "## Requirements",
        "### Requirement: ZQS-R1 — no scenario at all",
        "## Retired Requirements",
        "### Requirement: ZQS-R2 — retired, exempt",
        "> Retired 2026-09-04 by `abc1234`.",
      ].join("\n"),
      strict,
      "sdd",
    );
    expect(kinds(r)).toEqual(["no-scenario"]);
  });
});

describe("story links", () => {
  it("reads several stories off one line", () => {
    const r = spec(
      [
        "## Requirements",
        "### Requirement: ZQS-R1 — serves two slices",
        "> Story: ZQS-S1, ZQS-S2",
      ].join("\n"),
    );
    expect(r.entries[0]?.stories).toEqual(["ZQS-S1", "ZQS-S2"]);
  });

  it("leaves stories empty when the line is absent, for the checker to judge", () => {
    const r = spec(["## Requirements", "### Requirement: ZQS-R1 — orphan behaviour"].join("\n"));
    expect(r.entries[0]?.stories).toEqual([]);
  });
});

describe("the table format's lifecycle status", () => {
  const ZQB: RegisterConfig = { scope: "ZQB", file: "legacy/x/spec.md", format: "table" };
  const read = (body: string) => parseTableRegister(body, ZQB, "catalyst").status;

  it("reads Draft, Building and Shipped from the opening blockquote", () => {
    for (const want of ["Draft", "Building", "Shipped"]) {
      expect(read(`> **Status:** Spec — ${want}\n\n| ZQB-1 | — | x | y |`)).toBe(want);
    }
  });

  it("reads the FIRST match only, so a document quoting the contract keeps its own status", () => {
    // A document explaining the format quotes `> **Status:** Spec — Draft`. Reading the last match
    // would give the explanation's status to the spec.
    const body = [
      "> **Status:** Spec — Shipped",
      "",
      "The contract requires an opening line reading:",
      "",
      "> **Status:** Spec — Draft",
    ].join("\n");
    expect(read(body)).toBe("Shipped");
  });

  it("reports no status when the document declares none", () => {
    expect(read("| ZQB-1 | — | x | y |")).toBeUndefined();
  });

  it("tolerates a hyphen where the convention writes an em dash", () => {
    expect(read("> **Status:** Spec - Building\n\n| ZQB-1 | — | x | y |")).toBe("Building");
  });
});

describe("format dispatch", () => {
  it("defaults to the table format", () => {
    const r = parseRegister(
      "| ZQB-1 | — | Building | x |",
      { scope: "ZQB", file: "f" },
      "catalyst",
    );
    expect(r.entries.map((e) => e.id)).toEqual(["ZQB-1"]);
  });

  it("reports an unknown format rather than falling back to a parser that finds nothing", () => {
    const r = parseRegister(
      "anything",
      {
        scope: "ZQB",
        file: "f",
        format: "openspec" as never,
      },
      "catalyst",
    );
    expect(r.unknownFormat).toBe("openspec");
    expect(r.entries).toEqual([]);
  });
});
