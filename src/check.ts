/**
 * The checker. Every rule the kit enforces, in one pure function.
 *
 * Two properties are deliberate and worth keeping:
 *
 *   - **It is a ratchet in both directions.** A carried debt entry, a scan exclusion or a coverage
 *     exclusion that matches NOTHING is itself a failure. A dead exemption reads as a debt someone
 *     owes and quietly stops meaning anything, which is how a gate rots while still passing.
 *
 *   - **It is honest about its limit.** Coverage proves an id is *named* by something outside the
 *     registers. It cannot prove the naming test *asserts* anything — `it("… (SRC-R7)", () => {})`
 *     with an empty body passes every check here. That half needs a reader, and it is the reason a
 *     green run is evidence rather than proof.
 */

import { referencePattern, scopeOf, type IdGrammar } from "./ids.js";
import { parseRegister, type Entry } from "./registers.js";
import type { SddConfig } from "./config.js";

export interface CheckDeps {
  /** Read a repo-relative file, or null when it does not exist. */
  readFile(path: string): string | null;
  /** Every tracked file under the search roots, repo-relative. */
  listFiles(): readonly string[];
}

export interface Finding {
  readonly check: string;
  readonly message: string;
  readonly detail: readonly string[];
}

/** An entry plus the register document that declared it. */
export interface DeclaredEntry extends Entry {
  readonly file: string;
  readonly gated: boolean;
}

export interface CheckReport {
  readonly findings: readonly Finding[];
  readonly entries: readonly DeclaredEntry[];
  readonly stats: {
    readonly registers: number;
    readonly stories: number;
    readonly requirements: number;
    readonly gated: number;
    readonly covered: number;
  };
}

const PROBLEM_MESSAGES: Readonly<Record<string, string>> = {
  orphan: "an entry sits outside any section this format understands",
  unidentified: "an entry heading carries no identifier",
  "retired-no-record": "a retired entry has no dated `> Retired YYYY-MM-DD by …` record",
  "retired-heading-spelling":
    "a section heading nearly says Retired — every entry under it would be gated",
  "kind-section-mismatch": "an entry is filed under a section for the other kind",
  "kind-id-mismatch": "an entry's heading and its identifier disagree about kind",
  clarification: "a live entry still carries an unresolved [NEEDS CLARIFICATION:] marker",
  "no-scenario": "a live requirement has no scenario, and this register requires one",
  "scenario-no-when": "a scenario has no **WHEN** step",
  "scenario-no-then": "a scenario has no **THEN** step",
};

/**
 * Run every check.
 *
 * Findings accumulate rather than throwing, because a run that stops at the first fault makes the
 * second one invisible and turns fixing a spec into a guessing game one round-trip at a time.
 */
export function check(config: SddConfig, deps: CheckDeps): CheckReport {
  const findings: Finding[] = [];
  const grammar: IdGrammar = config.idGrammar;
  const add = (check: string, message: string, detail: readonly string[] = []): void => {
    if (detail.length === 0 && message === "") return;
    findings.push({ check, message, detail });
  };

  // ---- read and parse every register -------------------------------------------------------

  const allEntries: DeclaredEntry[] = [];
  const registerFiles = new Set<string>();
  const declaredBy = new Map<string, string>(); // id → file that declares it
  const reserved = new Set(config.reservedScopes);

  for (const reg of config.registers) {
    if (reserved.has(reg.scope)) {
      add("reserved-scope", `scope ${reg.scope} is reserved and cannot name a register`, [
        reg.file,
      ]);
    }
    const source = deps.readFile(reg.file);
    if (source === null) {
      add("missing-register", `a register declares a file that does not exist`, [
        `${reg.scope} → ${reg.file}`,
      ]);
      continue;
    }
    registerFiles.add(reg.file);
    const parsed = parseRegister(source, reg, grammar);

    if (parsed.unknownFormat !== undefined) {
      add("unknown-format", `a register declares a format this checker cannot read`, [
        `${reg.scope}: ${parsed.unknownFormat}`,
      ]);
      continue;
    }
    if (parsed.malformed.length > 0) {
      add(
        "malformed-id",
        `entries open with a register's scope but are not identifiers — nothing gates them`,
        parsed.malformed.map((m) => `${reg.file}: ${m}`),
      );
    }
    for (const p of parsed.problems) {
      add(`spec.${p.kind}`, PROBLEM_MESSAGES[p.kind] ?? `a structural problem: ${p.kind}`, [
        `${reg.file}:${p.lineNo}: ${p.text}`,
      ]);
    }
    // A register nothing was read out of passes every later check trivially, which is the one
    // failure this checker cannot survive silently.
    if (parsed.entries.length === 0) {
      add("empty-register", `a register parsed to zero entries`, [`${reg.scope} → ${reg.file}`]);
    }

    for (const entry of parsed.entries) {
      if (scopeOf(entry.id) !== reg.scope) {
        add("foreign-id", `an identifier sits in a register that does not own its scope`, [
          `${reg.file}: ${entry.id}`,
        ]);
        continue;
      }
      const already = declaredBy.get(entry.id);
      if (already !== undefined) {
        add("duplicate-id", `an identifier is declared twice`, [
          `${entry.id}: ${already}, ${reg.file}`,
        ]);
        continue;
      }
      declaredBy.set(entry.id, reg.file);
      allEntries.push({ ...entry, file: reg.file, gated: reg.gated });
    }
  }

  // ---- scan for references -----------------------------------------------------------------

  const scopes = [...new Set(config.registers.map((r) => r.scope))];
  const pattern = referencePattern(scopes, grammar);
  const excluded = new Set(config.excludeFromScan);
  const usedExclusions = new Set<string>();
  const usedCoverageRoots = new Set<string>();
  const referencedIn = new Map<string, Set<string>>();
  const coveredIn = new Map<string, Set<string>>();

  const remember = (map: Map<string, Set<string>>, id: string, file: string): void => {
    const at = map.get(id) ?? new Set<string>();
    at.add(file);
    map.set(id, at);
  };

  if (pattern !== null) {
    for (const file of deps.listFiles()) {
      if (excluded.has(file)) {
        usedExclusions.add(file);
        continue;
      }
      const text = deps.readFile(file);
      if (text === null) continue;
      const coverageExcluded = config.coverageExcludeRoots.some((root) => {
        const hit = file.startsWith(root);
        if (hit) usedCoverageRoots.add(root);
        return hit;
      });
      for (const match of text.matchAll(pattern)) {
        const id = match[0];
        remember(referencedIn, id, file);
        // A register declaring its own id is not a reference to it, and a document whose whole job
        // is citing requirements must not cover them.
        if (!registerFiles.has(file) && !coverageExcluded) remember(coveredIn, id, file);
      }
    }
  }

  // ---- coverage ----------------------------------------------------------------------------

  const knownDebt = new Map(Object.entries(config.knownDebt));
  const live = allEntries.filter((e) => !e.withdrawn && !e.proposed);
  const gated = live.filter((e) => e.gated);

  const uncovered = gated.filter((e) => !coveredIn.has(e.id) && !knownDebt.has(e.id));
  if (uncovered.length > 0) {
    add(
      "uncovered",
      `live identifiers that nothing outside the registers names — a promise no test keeps`,
      uncovered.map((e) => `${e.id} (${e.file}:${e.lineNo}) ${e.title}`),
    );
  }

  // ---- ratchets, in the reverse direction --------------------------------------------------

  const declaredIds = new Set(allEntries.map((e) => e.id));
  const withdrawnIds = new Set(allEntries.filter((e) => e.withdrawn).map((e) => e.id));
  const staleDebt: string[] = [];
  for (const [id, reason] of knownDebt) {
    if (typeof reason !== "string" || reason.trim() === "") {
      add("debt-no-reason", `a carried debt entry has no written reason`, [id]);
      continue;
    }
    if (!declaredIds.has(id)) staleDebt.push(`${id} — no register declares it`);
    else if (withdrawnIds.has(id)) staleDebt.push(`${id} — the entry is retired`);
    else if (coveredIn.has(id)) staleDebt.push(`${id} — it is covered now`);
  }
  if (staleDebt.length > 0) {
    add(
      "debt-stale",
      `carried debt that suppresses nothing — a dead exemption reads as a real one`,
      staleDebt,
    );
  }

  const deadExclusions = config.excludeFromScan.filter((f) => !usedExclusions.has(f));
  if (deadExclusions.length > 0) {
    add("dead-scan-exclusion", `a scan exclusion matches no tracked file`, deadExclusions);
  }
  const deadCoverageRoots = config.coverageExcludeRoots.filter((r) => !usedCoverageRoots.has(r));
  if (deadCoverageRoots.length > 0) {
    add(
      "dead-coverage-root",
      `a coverage exclusion matches no tracked file (a missing trailing slash is the usual cause)`,
      deadCoverageRoots,
    );
  }

  // ---- stories and requirements must account for each other --------------------------------
  // Only under a grammar that can express a story. `catalyst` cannot, so demanding one would fail
  // every register in a repo that adopted the kit in compat mode.

  const stories = allEntries.filter((e) => e.kind === "story");
  const requirements = allEntries.filter((e) => e.kind === "requirement");

  if (grammar === "sdd") {
    const storyIds = new Set(stories.map((e) => e.id));
    const servedStories = new Set<string>();
    const orphanRequirements: string[] = [];
    const danglingLinks: string[] = [];

    for (const req of requirements) {
      if (req.withdrawn) continue;
      if (req.stories.length === 0) {
        orphanRequirements.push(`${req.id} (${req.file}:${req.lineNo}) ${req.title}`);
        continue;
      }
      for (const id of req.stories) {
        if (!storyIds.has(id)) danglingLinks.push(`${req.id} → ${id}`);
        else servedStories.add(id);
      }
    }
    if (orphanRequirements.length > 0) {
      add(
        "requirement-no-story",
        `a live requirement serves no user story — behaviour nobody asked for`,
        orphanRequirements,
      );
    }
    if (danglingLinks.length > 0) {
      add("dangling-story-link", `a requirement names a story that does not exist`, danglingLinks);
    }
    const emptyStories = stories
      .filter((s) => !s.withdrawn && !servedStories.has(s.id))
      .map((s) => `${s.id} (${s.file}:${s.lineNo}) ${s.title}`);
    if (emptyStories.length > 0) {
      add(
        "story-no-requirement",
        `a live user story has no requirement beneath it — a promise with no behaviour`,
        emptyStories,
      );
    }
  } else if (stories.length > 0) {
    add(
      "story-under-compat-grammar",
      `stories are not representable under the catalyst grammar, yet some were parsed`,
      stories.map((s) => s.id),
    );
  }

  // A reference to an id no register declares. Catches the typo in a test title (`SRC-R7` for
  // `SRC-R1`) and the citation left behind when an entry was deleted rather than retired — both of
  // which otherwise read as coverage of something that does not exist.
  const dangling: string[] = [];
  for (const [id, files] of referencedIn) {
    if (declaredIds.has(id)) continue;
    dangling.push(`${id} — named by ${[...files].sort().slice(0, 3).join(", ")}`);
  }
  if (dangling.length > 0) {
    add("unknown-id", `something names an identifier no register declares`, dangling.sort());
  }

  // A config with registers but no scopes cannot scan for anything, so every coverage result above
  // is vacuous. Reported rather than passed silently, for the same reason an empty register is.
  if (pattern === null && config.registers.length > 0) {
    add("no-scopes", `registers are declared but no scope could be read from them`, []);
  }

  return {
    findings,
    entries: allEntries,
    stats: {
      registers: config.registers.length,
      stories: stories.length,
      requirements: requirements.length,
      gated: gated.length,
      covered: gated.filter((e) => coveredIn.has(e.id)).length,
    },
  };
}
