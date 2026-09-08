/**
 * The identifier grammar, and the one place that decides what an id means.
 *
 * Two grammars ship, because a kit that only understands its own format cannot be adopted by a repo
 * that already has an installed base:
 *
 *   - **`sdd`** — `SCOPE-Kn`, where `K` is a KIND letter: `S` for a user story, `R` for a
 *     requirement. One scope per capability, two disjoint number spaces inside it that cannot
 *     collide. The kind letter is legitimate precisely because kind is IMMUTABLE — the rule an id
 *     standard exists to enforce is that nothing *mutable* (severity, priority, status, owner) goes
 *     inside an identifier, because a re-rated finding must keep its name for life. A requirement
 *     never becomes a story.
 *
 *   - **`catalyst`** — `SCOPE-n`, no kind letter, requirements only. The grammar a repo with
 *     hundreds of existing gated ids already uses. Under this grammar stories are simply not
 *     representable, and a consuming repo allocates them only for capabilities it has converted.
 *
 * Both are anchored, and neither tolerates a suffix. That is deliberate: `SGE-US1` under the
 * `catalyst` grammar is not a story id, it is a MALFORMED requirement id, and it is reported as one
 * rather than silently skipped. An entry the checker cannot read is a promise nothing gates.
 */

/** Which id grammar a repo writes. Selected once, in `sdd.config.yaml`. */
export type IdGrammar = "sdd" | "catalyst";

/** What an entry in a register is. `catalyst` can only ever produce `requirement`. */
export type EntryKind = "story" | "requirement";

const PATTERNS: Readonly<Record<IdGrammar, RegExp>> = {
  sdd: /^[A-Z]{2,5}-[SR][0-9]+$/,
  catalyst: /^[A-Z]{2,5}-[0-9]+$/,
};

/** The anchored id pattern for a grammar. */
export function idPattern(grammar: IdGrammar): RegExp {
  return PATTERNS[grammar];
}

/** Whether a token is a well-formed id under this grammar. */
export function isId(token: string, grammar: IdGrammar): boolean {
  return PATTERNS[grammar].test(token);
}

/**
 * The kind an id declares.
 *
 * Under `sdd` the id says so itself, which is the whole point of the kind letter — a reader, a test
 * title and a cross-reference in a comment all carry the kind with them. Under `catalyst` there is
 * no letter to read, so every id is a requirement and stories live outside the grammar.
 */
export function kindOf(id: string, grammar: IdGrammar): EntryKind | null {
  if (!isId(id, grammar)) return null;
  if (grammar === "catalyst") return "requirement";
  return id.includes("-S") ? "story" : "requirement";
}

/**
 * A token that opens with this register's scope but is not a well-formed id.
 *
 * Deliberately NOT "any string starting with the scope": registers carry prose and tables whose
 * first cell reads `SEC-29 rec-4 assertion shape`, and reporting prose as a broken id is worse than
 * not looking. A single bare token only — `whk-1`, `WHK-1a`, `SGE-US1`, `SRC-R`.
 */
export function nearMissPattern(scope: string): RegExp {
  return new RegExp(`^${scope}-[0-9A-Za-z._-]*$`, "i");
}

/**
 * Every id of a given scope appearing in a body of text, for the coverage scan.
 *
 * Word-bounded so `SRC-R7` in prose, in a test title, or in a trailing-parens citation all count,
 * while `SRC-R70` is never matched by a search for `SRC-R7`.
 */
export function referencePattern(scopes: readonly string[], grammar: IdGrammar): RegExp | null {
  if (scopes.length === 0) return null;
  const alternation = scopes.join("|");
  const tail = grammar === "sdd" ? "[SR][0-9]+" : "[0-9]+";
  return new RegExp(`\\b(?:${alternation})-${tail}\\b`, "g");
}

/**
 * The scope an id belongs to. `SRC-R7` → `SRC`.
 *
 * Split on the FIRST hyphen only: a scope is 2-5 uppercase letters and can never contain one, so
 * everything after it is the kind letter and number.
 */
export function scopeOf(id: string): string {
  const cut = id.indexOf("-");
  return cut === -1 ? id : id.slice(0, cut);
}

/**
 * The next unused number for a kind, given every id already allocated in that scope.
 *
 * Allocation reads the MAXIMUM rather than the count, because a retired entry still holds its
 * number and a count would hand it out a second time. That is the single most expensive mistake an
 * id standard can make: reusing a number silently redirects every existing reference to it.
 */
export function nextNumber(
  existing: Iterable<string>,
  kind: EntryKind,
  grammar: IdGrammar,
): number {
  let highest = 0;
  for (const id of existing) {
    if (kindOf(id, grammar) !== kind) continue;
    const digits = /[0-9]+$/.exec(id);
    if (!digits) continue;
    highest = Math.max(highest, Number(digits[0]));
  }
  return highest + 1;
}

/** Format an id. The inverse of `kindOf`, and the only place ids are constructed. */
export function formatId(
  scope: string,
  kind: EntryKind,
  n: number,
  grammar: IdGrammar,
): string | null {
  if (grammar === "catalyst") {
    // Stories are not representable under this grammar, and inventing a spelling for one here is
    // how two id schemes end up in one repo.
    if (kind === "story") return null;
    return `${scope}-${n}`;
  }
  return `${scope}-${kind === "story" ? "S" : "R"}${n}`;
}
