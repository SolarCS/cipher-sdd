/**
 * Register parsing: what a document declares, decided from the document's text alone.
 *
 * Everything here is pure — it takes a document and the register that declares it, and returns the
 * entries, the malformed near-misses, and the structural problems. The IO (existence, reading,
 * git) lives at the call site, so this file is the part a test can hold still.
 *
 * Ported from the reference implementation in `scripts/lib/registers.mjs`, whose comments record
 * real failures this parser has already survived; those comments are kept where they explain a bug
 * rather than restate the code. The extension over the reference is the `sdd` format, which reads
 * BOTH `### User Story:` and `### Requirement:` blocks out of one capability spec — the kind letter
 * inside each id is what lets one register hold two kinds unambiguously.
 */

import { isId, kindOf, nearMissPattern, type EntryKind, type IdGrammar } from "./ids.js";

/** How a register's document is written. `table` is the legacy row format; `sdd` is this kit's. */
export type RegisterFormat = "table" | "sdd";

/**
 * Optionals are spelled `?: T | undefined` rather than `?: T` on purpose. These values arrive from
 * a Zod schema, which produces the `| undefined` form, and under `exactOptionalPropertyTypes` the
 * two are not assignable. Widening here keeps the flag on everywhere else, which is where it earns
 * its keep.
 */
export interface RegisterConfig {
  readonly scope: string;
  readonly file: string;
  readonly format?: RegisterFormat | undefined;
  /** Whether every live entry must be named by something outside the registers. */
  readonly gated?: boolean | undefined;
  /** Demand at least one scenario, with a WHEN and a THEN, on every live entry — stories too. */
  readonly requireScenarios?: boolean | undefined;
  /** Pattern for the pre-migration id scheme this register replaced. */
  readonly legacy?: string | undefined;
  /** Path prefixes the legacy sweep ignores. */
  readonly legacyExclude?: readonly string[] | undefined;
}

export interface Entry {
  readonly id: string;
  readonly kind: EntryKind;
  readonly legacy: string;
  /** Retired. Keeps its number for life; never gated. */
  readonly withdrawn: boolean;
  /** Declared but not yet gated — tests may name it before the work lands. */
  readonly proposed: boolean;
  /** For a requirement: the stories it serves, from its `> Story:` line. */
  readonly stories: readonly string[];
  readonly lineNo: number;
  readonly title: string;
}

/** A structural fault in the document. Never a missing reference — that is the checker's job. */
export interface Problem {
  readonly kind: string;
  readonly lineNo: number;
  readonly text: string;
}

export interface ParseResult {
  readonly entries: Entry[];
  readonly malformed: string[];
  readonly problems: Problem[];
  readonly unknownFormat?: string;
}

/**
 * Pull `| ID | Legacy | … |` rows out of a legacy register document.
 *
 * A first cell that opens with the register's own scope but is not a well-formed id is returned
 * separately rather than dropped. Silently skipping it is how a `whk-1` or a `WHK-1a` row becomes a
 * requirement nothing gates, with no message anywhere.
 */
export function parseTableRegister(
  source: string,
  reg: RegisterConfig,
  grammar: IdGrammar,
): ParseResult {
  const entries: Entry[] = [];
  const malformed: string[] = [];
  const scopeNearMiss = nearMissPattern(reg.scope);

  source.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) return;
    const cells = trimmed
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    const id = cells[0] ?? "";
    if (!isId(id, grammar)) {
      if (scopeNearMiss.test(id)) malformed.push(id);
      return;
    }
    entries.push({
      id,
      kind: kindOf(id, grammar) ?? "requirement",
      legacy: cells[1] ?? "",
      // A WHOLE cell equal to "Withdrawn", never the word appearing in prose. Registers lay their
      // columns out differently, so this looks for the status value rather than a fixed position —
      // matching the word anywhere in the row is what once silently retired a requirement whose own
      // text read "…whose grant has been withdrawn".
      withdrawn: cells.slice(1).some((c) => /^withdrawn$/i.test(c)),
      proposed: false,
      stories: [],
      lineNo: index + 1,
      title: cells.at(-1) ?? "",
    });
  });

  return { entries, malformed, problems: [] };
}

/** `## <text>` and no deeper. */
const H2 = /^##(?!#)\s+(.*?)\s*$/;
const REQUIREMENT = /^###(?!#)\s+Requirement:\s*(.*?)\s*$/;
const STORY = /^###(?!#)\s+User Story:\s*(.*?)\s*$/;
const SCENARIO = /^####(?!#)\s+Scenario:\s*(.*?)\s*$/;
/** A fenced block's opening or closing run. Length matters: a closing fence is never shorter. */
const FENCE = /^\s*(`{3,}|~{3,})/;
/** The dated line a retired entry carries, so the section keeps its reasons. */
const RETIRED_RECORD = /^>\s*Retired\s+\d{4}-\d{2}-\d{2}\s+by\s+\S.*$/;
/** The line linking a requirement to the stories it serves. */
const STORY_LINK = /^>\s*Story:\s*(.+)$/;
/** A scenario's steps. WHEN and THEN are required; GIVEN and AND are free. */
const WHEN = /^\s*[-*]\s*\*\*WHEN\*\*/;
const THEN = /^\s*[-*]\s*\*\*THEN\*\*/;
/** An unresolved question. Legitimate while an entry is proposed, never once it is current. */
const CLARIFICATION = /\[NEEDS CLARIFICATION:/;

type SectionState = "active" | "proposed" | "retired" | "other" | "none";

/** Which `## …` sections this parser understands: what state, and which kind belongs under it. */
const SECTIONS = new Map<string, { state: SectionState; kind: EntryKind }>([
  ["user stories", { state: "active", kind: "story" }],
  ["proposed user stories", { state: "proposed", kind: "story" }],
  ["retired user stories", { state: "retired", kind: "story" }],
  ["requirements", { state: "active", kind: "requirement" }],
  ["proposed requirements", { state: "proposed", kind: "requirement" }],
  ["retired requirements", { state: "retired", kind: "requirement" }],
]);

interface OpenBlock {
  lineNo: number;
  heading: string;
  kind: EntryKind;
  retired: boolean;
  hasRecord: boolean;
  scenarios: number;
  stories: string[];
  entryIndex: number;
}

/**
 * Read a capability spec: `### User Story: <id> — <title>` and `### Requirement: <id> — <title>`.
 *
 * A state machine, and the state is the point. Four things can only be decided from where a line
 * sits rather than from the line itself:
 *
 *   - **Which `## …` section encloses it.** `## Requirements` is current behaviour and is gated.
 *     `## Proposed Requirements` is declared but not yet gated — the middle state that lets a
 *     change allocate its ids when proposed, write tests naming them while building, and promote
 *     them only when the work lands. Without it every id would be either undeclared while its tests
 *     exist, or gated before they do. `## Retired …` is declared and withdrawn, so the number can
 *     never be handed out again.
 *
 *   - **Whether it is inside a fenced block.** Any document explaining this format quotes a
 *     `### Requirement:` line, and a capability spec may carry fenced examples of its own. An
 *     example silently becoming a real, gated, uncovered requirement is the nastiest bug available
 *     here, and a few lines of fence tracking removes the whole class.
 *
 *   - **Whether a retired block carries its dated record.** The table format gets the reason for
 *     free, because a Withdrawn row's requirement cell IS the reason. A section has to be told.
 *
 *   - **Whether the heading kind matches its section.** A `### Requirement:` under `## User
 *     Stories` would otherwise be counted as a live requirement filed where no reader will look for
 *     it.
 *
 * The id is the FIRST whitespace-delimited token after the heading keyword, and everything after it
 * is the title. Deliberately not a separator match: requiring ` — ` exactly would add a failure mode
 * (an en dash typed for an em dash is invisible on the page) without buying any parsing certainty,
 * since a first token either is an id or is not.
 */
export function parseSpecRegister(
  source: string,
  reg: RegisterConfig,
  grammar: IdGrammar,
): ParseResult {
  const entries: Entry[] = [];
  const malformed: string[] = [];
  const problems: Problem[] = [];
  const scopeNearMiss = nearMissPattern(reg.scope);
  const flag = (kind: string, lineNo: number, text: string): void => {
    problems.push({ kind, lineNo, text });
  };

  let state: SectionState = "none";
  let sectionKind: EntryKind = "requirement";
  let fence: string | null = null;
  let inComment = false;
  let current: OpenBlock | null = null;

  const closeBlock = (): void => {
    if (!current) return;
    if (current.retired && !current.hasRecord) {
      flag("retired-no-record", current.lineNo, current.heading);
    }
    if (reg.requireScenarios && !current.retired && current.scenarios === 0) {
      flag("no-scenario", current.lineNo, current.heading);
    }
    const entry = entries[current.entryIndex];
    if (entry) {
      entries[current.entryIndex] = { ...entry, stories: [...current.stories] };
    }
    current = null;
  };

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    const lineNo = i + 1;

    // A fenced block hides everything, including something that looks like an HTML comment, so it
    // is resolved first.
    if (fence !== null) {
      const closing = FENCE.exec(raw);
      const run = closing?.[1];
      // Only a run of the same character and at least the same length closes the block.
      if (run && run[0] === fence[0] && run.length >= fence.length) fence = null;
      continue;
    }

    // Then strip commented spans, carrying the state across lines. A requirement commented out —
    // which is how a scaffold ships its worked example — must not read as a live, gated one, for
    // the same reason a fenced example must not.
    let line = "";
    let rest = raw;
    for (;;) {
      if (inComment) {
        const close = rest.indexOf("-->");
        if (close === -1) break;
        rest = rest.slice(close + 3);
        inComment = false;
        continue;
      }
      const open = rest.indexOf("<!--");
      if (open === -1) {
        line += rest;
        break;
      }
      line += rest.slice(0, open);
      rest = rest.slice(open + 4);
      inComment = true;
    }
    if (line.trim() === "") continue;

    const fenceMatch = FENCE.exec(line);
    if (fenceMatch?.[1]) {
      fence = fenceMatch[1];
      continue;
    }

    const h2 = H2.exec(line);
    if (h2?.[1] !== undefined) {
      closeBlock();
      const name = h2[1].trim().toLowerCase();
      const section = SECTIONS.get(name);
      state = section?.state ?? "other";
      sectionKind = section?.kind ?? "requirement";
      // A near-miss on the retired heading would quietly make every block under it live and gated,
      // producing a wall of coverage failures on ids that were just retired.
      if (!section && name.includes("retired")) {
        flag("retired-heading-spelling", lineNo, h2[1].trim());
      }
      continue;
    }

    const requirement = REQUIREMENT.exec(line);
    const story = STORY.exec(line);
    const heading = requirement?.[1] ?? story?.[1];
    if (heading !== undefined) {
      closeBlock();
      const headingKind: EntryKind = story ? "story" : "requirement";
      const text = heading.trim();
      const token = text.split(/\s+/, 1)[0] ?? "";
      const title = text.slice(token.length).replace(/^\s*[—–-]?\s*/, "");

      if (state === "none" || state === "other") {
        flag("orphan", lineNo, text);
        continue;
      }
      if (headingKind !== sectionKind) {
        flag("kind-section-mismatch", lineNo, text);
        continue;
      }
      if (!isId(token, grammar)) {
        if (scopeNearMiss.test(token)) malformed.push(token);
        else flag("unidentified", lineNo, text);
        continue;
      }
      // Under `sdd` the id carries its own kind, so a `### User Story: SRC-R4` is a filing error
      // the reader would never catch — the heading says story, the id says requirement, and every
      // test naming it would be gated as the wrong thing.
      const declared = kindOf(token, grammar);
      if (grammar === "sdd" && declared !== headingKind) {
        flag("kind-id-mismatch", lineNo, text);
        continue;
      }

      // A marker in the TITLE, checked here rather than only in the body below. The reference
      // implementation checks body lines alone, so a live requirement whose own heading still says
      // `[NEEDS CLARIFICATION: …]` passes it — and the heading is the likeliest place for one.
      if (state === "active" && CLARIFICATION.test(text)) {
        flag("clarification", lineNo, text.slice(0, 90));
      }

      current = {
        lineNo,
        heading: text,
        kind: headingKind,
        retired: state === "retired",
        hasRecord: false,
        scenarios: 0,
        stories: [],
        entryIndex: entries.length,
      };
      entries.push({
        id: token,
        kind: headingKind,
        legacy: "",
        withdrawn: state === "retired",
        proposed: state === "proposed",
        stories: [],
        lineNo,
        title,
      });
      continue;
    }

    // A question is a fine thing to record while an entry is still proposed. Surviving into the
    // live section means the shipped record of current behaviour has a hole in it.
    if (state === "active" && CLARIFICATION.test(line)) {
      flag("clarification", lineNo, line.trim().slice(0, 90));
    }

    if (!current) continue;

    const scenario = SCENARIO.exec(line);
    if (scenario?.[1] !== undefined) {
      current.scenarios += 1;
      if (reg.requireScenarios) {
        const steps: string[] = [];
        for (let j = i + 1; j < lines.length; j += 1) {
          const next = lines[j] ?? "";
          if (/^#{2,4}(?!#)\s/.test(next)) break;
          steps.push(next);
        }
        const name = scenario[1].trim();
        if (!steps.some((s) => WHEN.test(s))) flag("scenario-no-when", lineNo, name);
        if (!steps.some((s) => THEN.test(s))) flag("scenario-no-then", lineNo, name);
      }
      continue;
    }

    const link = STORY_LINK.exec(line);
    if (link?.[1] !== undefined) {
      for (const token of link[1].split(/[,\s]+/)) {
        const id = token.trim();
        if (id !== "") current.stories.push(id);
      }
      continue;
    }

    if (current.retired && RETIRED_RECORD.test(line)) current.hasRecord = true;
  }
  closeBlock();

  return { entries, malformed, problems };
}

/**
 * Dispatch on the register's declared format, defaulting to the table every register used before a
 * second format existed.
 *
 * An unrecognised format returns `unknownFormat` rather than falling back. A silent fallback would
 * find zero rows in a document that is not a table and report a clean pass — a register nothing
 * inspected, which is worse than one that fails.
 */
export function parseRegister(
  source: string,
  reg: RegisterConfig,
  grammar: IdGrammar,
): ParseResult {
  const format = reg.format ?? "table";
  if (format === "table") return parseTableRegister(source, reg, grammar);
  if (format === "sdd") return parseSpecRegister(source, reg, grammar);
  return { entries: [], malformed: [], problems: [], unknownFormat: format };
}
