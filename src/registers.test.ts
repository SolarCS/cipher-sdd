import { describe, expect, it } from "vitest";

import { parseRegister, parseSpecRegister, parseTableRegister } from "./registers.js";
import type { RegisterConfig } from "./registers.js";

const SRC: RegisterConfig = { scope: "SRC", file: "specs/sources/spec.md", format: "sdd" };
const spec = (body: string, reg: RegisterConfig = SRC) => parseSpecRegister(body, reg, "sdd");
const kinds = (r: ReturnType<typeof spec>) => r.problems.map((p) => p.kind);

describe("the table format (legacy compat)", () => {
  const WHK: RegisterConfig = { scope: "WHK", file: "docs/specs/x/spec.md" };

  it("reads rows and ignores everything that is not one", () => {
    const { entries } = parseTableRegister(
      ["prose", "| WHK-1 | — | Building | MUST verify. |", "| not a row"].join("\n"),
      WHK,
      "catalyst",
    );
    expect(entries.map((e) => e.id)).toEqual(["WHK-1"]);
    expect(entries[0]?.kind).toBe("requirement");
  });

  it("treats a WHOLE cell of 'Withdrawn' as retirement, never the word in prose", () => {
    // The reference records this: a requirement reading "…whose grant has been withdrawn" was
    // silently retired by a substring match.
    const { entries } = parseTableRegister(
      [
        "| WHK-1 | — | Building | MUST refuse a grant that has been withdrawn. |",
        "| WHK-2 | — | Withdrawn | Superseded by WHK-1. |",
      ].join("\n"),
      WHK,
      "catalyst",
    );
    expect(entries.find((e) => e.id === "WHK-1")?.withdrawn).toBe(false);
    expect(entries.find((e) => e.id === "WHK-2")?.withdrawn).toBe(true);
  });

  it("reports a near-miss row rather than dropping it", () => {
    const { entries, malformed } = parseTableRegister(
      "| WHK-1a | — | Building | broken |",
      WHK,
      "catalyst",
    );
    expect(entries).toEqual([]);
    expect(malformed).toEqual(["WHK-1a"]);
  });
});

describe("the sdd format — sections decide state", () => {
  it("reads stories and requirements out of one document", () => {
    const r = spec(
      [
        "## User Stories",
        "### User Story: SRC-S1 — Register a path pattern",
        "## Requirements",
        "### Requirement: SRC-R1 — MUST accept a param segment",
        "> Story: SRC-S1",
      ].join("\n"),
    );
    expect(r.entries.map((e) => [e.id, e.kind])).toEqual([
      ["SRC-S1", "story"],
      ["SRC-R1", "requirement"],
    ]);
    expect(r.entries[1]?.stories).toEqual(["SRC-S1"]);
    expect(r.problems).toEqual([]);
  });

  it("marks proposed entries as declared-but-not-gated, and retired ones as withdrawn", () => {
    const r = spec(
      [
        "## Proposed Requirements",
        "### Requirement: SRC-R2 — MUST rank literal over param",
        "## Retired Requirements",
        "### Requirement: SRC-R3 — replaced by a whole-grant read",
        "> Retired 2026-09-04 by `af8b0690`.",
      ].join("\n"),
    );
    const byId = new Map(r.entries.map((e) => [e.id, e]));
    expect(byId.get("SRC-R2")?.proposed).toBe(true);
    expect(byId.get("SRC-R2")?.withdrawn).toBe(false);
    expect(byId.get("SRC-R3")?.withdrawn).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("demands a dated record on a retired entry, so the reason is never lost", () => {
    const r = spec(
      ["## Retired Requirements", "### Requirement: SRC-R3 — gone with no reason"].join("\n"),
    );
    expect(kinds(r)).toEqual(["retired-no-record"]);
  });

  it("flags a misspelt retired heading, which would otherwise gate every id beneath it", () => {
    const r = spec(
      ["## Retired requirement", "### Requirement: SRC-R3 — filed under a typo"].join("\n"),
    );
    expect(kinds(r)).toContain("retired-heading-spelling");
  });

  it("flags an entry outside any known section rather than counting it", () => {
    const r = spec(["## Notes", "### Requirement: SRC-R9 — orphaned"].join("\n"));
    expect(kinds(r)).toEqual(["orphan"]);
    expect(r.entries).toEqual([]);
  });
});

describe("the sdd format — kind must agree with its filing", () => {
  it("flags a requirement filed under User Stories", () => {
    const r = spec(["## User Stories", "### Requirement: SRC-R1 — misfiled"].join("\n"));
    expect(kinds(r)).toEqual(["kind-section-mismatch"]);
    expect(r.entries).toEqual([]);
  });

  it("flags a heading whose keyword and id disagree about kind", () => {
    const r = spec(["## User Stories", "### User Story: SRC-R4 — heading says story"].join("\n"));
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
        "### Requirement: SRC-R99 — an example in the docs",
        "```",
        "### Requirement: SRC-R1 — the real one",
      ].join("\n"),
    );
    expect(r.entries.map((e) => e.id)).toEqual(["SRC-R1"]);
  });

  it("closes a fence only on a run of the same character and at least the same length", () => {
    const r = spec(
      [
        "## Requirements",
        "````",
        "```",
        "### Requirement: SRC-R99 — still fenced",
        "````",
        "### Requirement: SRC-R1 — after the real close",
      ].join("\n"),
    );
    expect(r.entries.map((e) => e.id)).toEqual(["SRC-R1"]);
  });

  it("ignores a requirement commented out, including across lines", () => {
    const r = spec(
      [
        "## Requirements",
        "<!--",
        "### Requirement: SRC-R99 — the scaffold's worked example",
        "-->",
        "### Requirement: SRC-R1 — live",
      ].join("\n"),
    );
    expect(r.entries.map((e) => e.id)).toEqual(["SRC-R1"]);
  });

  it("reports an unresolved question in the live section but tolerates it in proposed", () => {
    const live = spec(
      [
        "## Requirements",
        "### Requirement: SRC-R1 — MUST accept [NEEDS CLARIFICATION: which encodings?]",
      ].join("\n"),
    );
    expect(kinds(live)).toEqual(["clarification"]);

    const proposed = spec(
      [
        "## Proposed Requirements",
        "### Requirement: SRC-R1 — MUST accept [NEEDS CLARIFICATION: which encodings?]",
      ].join("\n"),
    );
    expect(kinds(proposed)).toEqual([]);
  });
});

describe("the sdd format — scenarios", () => {
  const strict: RegisterConfig = { ...SRC, requireScenarios: true };

  it("demands WHEN and THEN when the register asks for scenarios", () => {
    const r = parseSpecRegister(
      [
        "## Requirements",
        "### Requirement: SRC-R1 — MUST match one segment",
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
        "### Requirement: SRC-R1 — no scenario at all",
        "## Retired Requirements",
        "### Requirement: SRC-R2 — retired, exempt",
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
        "### Requirement: SRC-R1 — serves two slices",
        "> Story: SRC-S1, SRC-S2",
      ].join("\n"),
    );
    expect(r.entries[0]?.stories).toEqual(["SRC-S1", "SRC-S2"]);
  });

  it("leaves stories empty when the line is absent, for the checker to judge", () => {
    const r = spec(["## Requirements", "### Requirement: SRC-R1 — orphan behaviour"].join("\n"));
    expect(r.entries[0]?.stories).toEqual([]);
  });
});

describe("format dispatch", () => {
  it("defaults to the table format", () => {
    const r = parseRegister(
      "| WHK-1 | — | Building | x |",
      { scope: "WHK", file: "f" },
      "catalyst",
    );
    expect(r.entries.map((e) => e.id)).toEqual(["WHK-1"]);
  });

  it("reports an unknown format rather than falling back to a parser that finds nothing", () => {
    const r = parseRegister(
      "anything",
      {
        scope: "WHK",
        file: "f",
        format: "openspec" as never,
      },
      "catalyst",
    );
    expect(r.unknownFormat).toBe("openspec");
    expect(r.entries).toEqual([]);
  });
});
