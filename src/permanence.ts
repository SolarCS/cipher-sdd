/**
 * Comparing today's identifiers against the ones the baseline already declared.
 *
 * The rest of the checker reads one revision — the working tree — so it can see that an id resolves
 * and is referenced, and cannot see that an id *used to exist*. Two failures live in that blind
 * spot, and both matter more when requirements are edited by an agent merging a delta into a
 * long-lived capability spec:
 *
 *   - **An entry quietly disappears.** Deleting one frees its number to be handed out again and
 *     erases what was promised. The format forbids it — retirement moves the block to
 *     `## Retired Requirements` — but a format cannot enforce itself, and the cheapest way to turn
 *     a red gate green is to delete the row that is red. Deleting the register from the config is
 *     cheaper still, so a vanished scope is a failure in its own right.
 *
 *   - **Two branches allocate the same number.** The scope is per-register, so `SRC-R7` and
 *     `WHK-R7` never collide and only two changes editing the SAME register in one window can. Git
 *     merges them as two blocks in one file and the duplicate check reports it — but on the trunk,
 *     after the fact, where renumbering is exactly what the id standard forbids because tests
 *     already name the id. Caught against the merge base instead, it is reported on the branch that
 *     has not landed yet, where the id and the tests naming it still move together.
 *
 * Everything here compares **id sets, never text**. A heading is reworded and a requirement is
 * rewritten all the time; that is what the id exists to survive. Comparing anything else produces
 * false failures on ordinary edits, which is how a check like this gets deleted.
 */

import { parse as parseYaml } from "yaml";

import { normaliseRegister } from "./config.js";
import type { RegisterConfig, ParseResult } from "./registers.js";

/** Read a file at some revision, or null when it does not exist there. */
export type RevisionReader = (path: string) => string | null;

/** Parse a document the way the revision that wrote it declared. */
export type Parser = (source: string, reg: RegisterConfig) => ParseResult;

export type IdsByScope = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * The ids a revision declared, keyed by scope.
 *
 * Keyed by SCOPE and not by file path, because a spec legitimately moves: converting one from the
 * table format to a capability spec changes `file` while every id stays the same. A path-keyed
 * comparison would look for the old path in today's config, not find it, and silently report
 * nothing — losing exactly the ids it was meant to protect.
 */
export function idsByScope(
  configText: string,
  readFile: RevisionReader,
  parse: Parser,
): IdsByScope | null {
  const out = new Map<string, Set<string>>();
  let parsed: unknown;
  try {
    // YAML 1.2 is a superset of JSON, so one parser reads the baseline whichever spelling it used —
    // which matters precisely at a migration, when the baseline predates the format change.
    parsed = parseYaml(configText);
  } catch {
    return null; // an unreadable baseline config tells us nothing; the caller skips
  }
  const registers = (parsed as { registers?: unknown }).registers;
  if (!Array.isArray(registers)) return out;

  for (const raw of registers) {
    // Through the schema, so the baseline gets the same defaults a live config does. Reading it
    // raw meant a register with no explicit `format` was parsed as a table, found nothing in a
    // heading-format spec, and its empty result was then excused as unreadable — which let a
    // deleted requirement through the one check that exists to catch exactly that.
    const reg = normaliseRegister(raw);
    if (reg === null) continue;
    const source = readFile(reg.file);
    if (source === null) continue;
    // Parse with the format the BASELINE recorded, not today's. A register that changed format in
    // this very change would otherwise read as having lost every id it has.
    const { entries } = parse(source, reg);
    out.set(reg.scope, new Set(entries.map((e) => e.id)));
  }
  return out;
}

export interface Dropped {
  readonly droppedIds: string[];
  readonly droppedScopes: string[];
}

/**
 * What this change dropped relative to the baseline.
 *
 * A scope that has disappeared from the config entirely is reported separately, because it is the
 * one move that would otherwise defeat every other check here at once.
 */
export function droppedSince(baseline: IdsByScope, current: IdsByScope): Dropped {
  const droppedIds: string[] = [];
  const droppedScopes: string[] = [];
  for (const [scope, ids] of baseline) {
    const now = current.get(scope);
    if (now === undefined) {
      droppedScopes.push(scope);
      continue;
    }
    // A baseline that parsed to nothing is far more likely to be a format the parser could not read
    // than a register that genuinely held no ids, so it is not evidence that anything was dropped.
    if (ids.size === 0) continue;
    for (const id of ids) if (!now.has(id)) droppedIds.push(id);
  }
  return { droppedIds: droppedIds.sort(), droppedScopes: droppedScopes.sort() };
}

/**
 * Identifiers this branch and the trunk each allocated independently since they diverged.
 *
 * An id absent at the merge base and present on BOTH sides was handed out twice. Nothing else
 * counts: an id the trunk added that this branch lacks is simply the trunk moving on, and an id
 * this branch added that the trunk lacks is the ordinary case.
 */
export function collidingSince(
  base: IdsByScope,
  trunkTip: IdsByScope,
  current: IdsByScope,
): string[] {
  const collisions: string[] = [];
  for (const [scope, ids] of current) {
    const atBase = base.get(scope) ?? new Set<string>();
    const onTrunk = trunkTip.get(scope) ?? new Set<string>();
    for (const id of ids) {
      if (atBase.has(id)) continue; // existed before either side started
      if (onTrunk.has(id)) collisions.push(id);
    }
  }
  return collisions.sort();
}
