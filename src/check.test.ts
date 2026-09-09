import { describe, expect, it } from "vitest";

import { check, type CheckDeps } from "./check.js";
import { configSchema, type SddConfig } from "./config.js";

const SPEC = "specs/sources/spec.md";

/** A config with one `sdd` register, plus whatever the case overrides. */
const cfg = (over: Partial<SddConfig> = {}): SddConfig =>
  configSchema.parse({
    registers: [{ scope: "ZQS", file: SPEC }],
    ...over,
  });

/** Files the checker can see. Keys are repo-relative paths. */
const deps = (files: Record<string, string>): CheckDeps => ({
  readFile: (path) => files[path] ?? null,
  listFiles: () => Object.keys(files),
});

const spec = (...blocks: string[]) => blocks.join("\n");
const story = (id: string, title = "a slice of value") => `### User Story: ${id} — ${title}`;
const requirement = (id: string, storyId: string, title = "MUST do the thing") =>
  [`### Requirement: ${id} — ${title}`, `> Story: ${storyId}`].join("\n");

const names = (r: ReturnType<typeof check>) => r.findings.map((f) => f.check);

const HEALTHY = spec(
  "## User Stories",
  story("ZQS-S1"),
  "## Requirements",
  requirement("ZQS-R1", "ZQS-S1"),
);

describe("a healthy repo", () => {
  it("passes when every gated id is named outside the registers", () => {
    const r = check(
      cfg(),
      deps({
        [SPEC]: HEALTHY,
        "src/sources.test.ts": 'it("accepts a param segment (ZQS-R1)", …); describe("ZQS-S1", …)',
      }),
    );
    expect(names(r)).toEqual([]);
    expect(r.stats).toMatchObject({ stories: 1, requirements: 1, gated: 2, covered: 2 });
  });
});

describe("coverage", () => {
  it("fails a live identifier that nothing outside the registers names", () => {
    const r = check(cfg(), deps({ [SPEC]: HEALTHY }));
    expect(names(r)).toContain("uncovered");
    expect(r.findings.find((f) => f.check === "uncovered")?.detail.join()).toContain("ZQS-R1");
  });

  it("does not count the register declaring its own id as coverage", () => {
    const r = check(cfg(), deps({ [SPEC]: HEALTHY }));
    expect(r.stats.covered).toBe(0);
  });

  it("never gates a proposed or a retired entry", () => {
    const source = spec(
      "## User Stories",
      story("ZQS-S1"),
      "## Requirements",
      requirement("ZQS-R1", "ZQS-S1"),
      "## Proposed Requirements",
      requirement("ZQS-R2", "ZQS-S1"),
      "## Retired Requirements",
      "### Requirement: ZQS-R3 — gone",
      "> Retired 2026-09-04 by `abc1234`.",
    );
    const r = check(cfg(), deps({ [SPEC]: source, "t.test.ts": "ZQS-R1 ZQS-S1" }));
    expect(names(r)).toEqual([]);
  });

  it("lets a document cite requirements without covering them", () => {
    const r = check(
      cfg({ coverageExcludeRoots: ["docs/"] }),
      deps({ [SPEC]: HEALTHY, "docs/backfill.md": "ZQS-R1 and ZQS-S1 are explained here" }),
    );
    expect(names(r)).toContain("uncovered");
  });

  it("skips a whole file whose example ids are documentation", () => {
    const r = check(
      cfg({ excludeFromScan: ["README.md"] }),
      deps({ [SPEC]: HEALTHY, "README.md": "for example ZQS-R1", "t.test.ts": "ZQS-R1 ZQS-S1" }),
    );
    expect(names(r)).toEqual([]);
  });
});

describe("the ratchet runs in both directions", () => {
  it("accepts carried debt with a written reason", () => {
    const r = check(
      cfg({ knownDebt: { "ZQS-R1": "covered by a manual runbook step, tracked in AIO-120" } }),
      deps({ [SPEC]: HEALTHY, "t.test.ts": "ZQS-S1" }),
    );
    expect(names(r)).toEqual([]);
  });

  it("fails debt with no reason", () => {
    const r = check(
      cfg({ knownDebt: { "ZQS-R1": "  " } }),
      deps({ [SPEC]: HEALTHY, "t.test.ts": "ZQS-S1" }),
    );
    expect(names(r)).toContain("debt-no-reason");
  });

  it("fails debt that suppresses nothing, because a dead exemption reads as a real one", () => {
    const r = check(
      cfg({ knownDebt: { "ZQS-R1": "stale — it is covered now" } }),
      deps({ [SPEC]: HEALTHY, "t.test.ts": "ZQS-R1 ZQS-S1" }),
    );
    expect(names(r)).toContain("debt-stale");
  });

  it("fails a scan exclusion that matches no tracked file", () => {
    const r = check(
      cfg({ excludeFromScan: ["docs/deleted.md"] }),
      deps({ [SPEC]: HEALTHY, "t.test.ts": "ZQS-R1 ZQS-S1" }),
    );
    expect(names(r)).toContain("dead-scan-exclusion");
  });

  it("fails a coverage exclusion that matches nothing — usually a missing trailing slash", () => {
    const r = check(
      cfg({ coverageExcludeRoots: ["docs"] }),
      deps({ [SPEC]: HEALTHY, "t.test.ts": "ZQS-R1 ZQS-S1" }),
    );
    expect(names(r)).toContain("dead-coverage-root");
  });
});

describe("stories and requirements account for each other", () => {
  it("fails a live requirement that serves no story", () => {
    const source = spec("## Requirements", "### Requirement: ZQS-R1 — behaviour nobody asked for");
    const r = check(cfg(), deps({ [SPEC]: source, "t.test.ts": "ZQS-R1" }));
    expect(names(r)).toContain("requirement-no-story");
  });

  it("fails a live story with no requirement beneath it", () => {
    const source = spec(
      "## User Stories",
      story("ZQS-S1"),
      story("ZQS-S2"),
      "## Requirements",
      requirement("ZQS-R1", "ZQS-S1"),
    );
    const r = check(cfg(), deps({ [SPEC]: source, "t.test.ts": "ZQS-R1 ZQS-S1 ZQS-S2" }));
    expect(names(r)).toContain("story-no-requirement");
  });

  it("fails a requirement naming a story that does not exist", () => {
    const source = spec(
      "## User Stories",
      story("ZQS-S1"),
      "## Requirements",
      requirement("ZQS-R1", "ZQS-S9"),
    );
    const r = check(cfg(), deps({ [SPEC]: source, "t.test.ts": "ZQS-R1 ZQS-S1" }));
    expect(names(r)).toContain("dangling-story-link");
  });

  it("does not demand stories under the catalyst compat grammar", () => {
    const table = ["| ZQA-1 | — | Building | MUST refuse an unsigned record. |"].join("\n");
    const r = check(
      configSchema.parse({
        idGrammar: "catalyst",
        registers: [{ scope: "ZQA", file: SPEC, format: "table" }],
      }),
      deps({ [SPEC]: table, "t.test.ts": "ZQA-1" }),
    );
    expect(names(r)).toEqual([]);
  });
});

describe("proposed entries are declared, not yet live", () => {
  it("does not demand a story link from a proposed requirement", () => {
    // The middle state exists so a change can allocate ids and write tests before the work lands.
    // Demanding the finished shape there would make it unusable.
    const source = spec(
      "## User Stories",
      story("ZQS-S1"),
      "## Requirements",
      requirement("ZQS-R1", "ZQS-S1"),
      "## Proposed Requirements",
      "### Requirement: ZQS-R2 — MUST do a thing nobody has linked yet",
    );
    const r = check(cfg(), deps({ [SPEC]: source, "t.test.ts": "ZQS-R1 ZQS-S1" }));
    expect(names(r)).toEqual([]);
  });

  it("does not demand a requirement beneath a proposed story", () => {
    const source = spec(
      "## User Stories",
      story("ZQS-S1"),
      "## Proposed User Stories",
      story("ZQS-S2", "a slice still being shaped"),
      "## Requirements",
      requirement("ZQS-R1", "ZQS-S1"),
    );
    const r = check(cfg(), deps({ [SPEC]: source, "t.test.ts": "ZQS-R1 ZQS-S1" }));
    expect(names(r)).toEqual([]);
  });
});

describe("structural faults", () => {
  it("fails a register that parsed to zero entries", () => {
    const r = check(cfg(), deps({ [SPEC]: "# Sources\n\nprose only" }));
    expect(names(r)).toContain("empty-register");
  });

  it("fails a register whose file does not exist", () => {
    const r = check(cfg(), deps({}));
    expect(names(r)).toContain("missing-register");
  });

  it("fails a reserved scope", () => {
    const r = check(
      cfg({ reservedScopes: ["ZQS"] }),
      deps({ [SPEC]: HEALTHY, "t.test.ts": "ZQS-R1 ZQS-S1" }),
    );
    expect(names(r)).toContain("reserved-scope");
  });

  it("surfaces a parser problem with its file and line", () => {
    const source = spec("## Retired Requirements", "### Requirement: ZQS-R3 — no dated record");
    const r = check(cfg(), deps({ [SPEC]: source }));
    expect(names(r)).toContain("spec.retired-no-record");
    expect(r.findings[0]?.detail[0]).toContain(`${SPEC}:2`);
  });

  it("fails a reference to an identifier no register declares", () => {
    const r = check(
      cfg(),
      deps({ [SPEC]: HEALTHY, "t.test.ts": "ZQS-R1 ZQS-S1 and a typo ZQS-R7" }),
    );
    expect(names(r)).toContain("unknown-id");
  });
});
