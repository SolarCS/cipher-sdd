/**
 * The impure half: the filesystem and git.
 *
 * Kept apart from `check.ts` and `permanence.ts` so those stay pure and testable. Everything here
 * is best-effort by design — a checker that throws because git is unavailable would fail in a
 * shallow CI clone, a tarball, or a fresh worktree, none of which are the user's fault.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A NUL byte in the first 8 KB — the heuristic git itself uses to call a file binary.
 *
 * Skipping binaries is not a nicety. `git ls-files` lists a repository's images, and decoding a PNG
 * as UTF-8 produces byte sequences that match short identifier patterns: the reference
 * implementation's first run reported `F2` and `F3` "references" inside a brand mark. A phantom
 * reference is worse than a missing one, because it SATISFIES coverage — a requirement would look
 * proven by an image.
 */
const BINARY_SNIFF_BYTES = 8192;

/** Read a repo-relative file, or null when it does not exist. */
export function makeReader(root: string): (path: string) => string | null {
  const cache = new Map<string, string | null>();
  return (path: string) => {
    const hit = cache.get(path);
    if (hit !== undefined) return hit;
    let text: string | null;
    try {
      const buf = readFileSync(join(root, path));
      text = buf.subarray(0, BINARY_SNIFF_BYTES).includes(0) ? null : buf.toString("utf8");
    } catch {
      text = null;
    }
    cache.set(path, text);
    return text;
  };
}

function git(root: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/**
 * Every tracked file under the search roots.
 *
 * Tracked only, deliberately. An untracked build artefact can carry an id — a coverage report ships
 * whole source files — and letting one satisfy coverage means the gate passes on something no
 * reviewer ever saw and the next `clean` deletes.
 */
export function listTrackedFiles(root: string, searchRoots: readonly string[]): string[] {
  const out = git(root, [
    "ls-files",
    "-z",
    "--",
    ...(searchRoots.length > 0 ? searchRoots : ["."]),
  ]);
  if (out === null) return [];
  return out.split("\0").filter((p) => p !== "");
}

export interface Revisions {
  /** The point this branch left the trunk. */
  readonly base: string;
  /** The trunk's current tip. */
  readonly tip: string;
}

/**
 * Resolve the merge base with the trunk, or null when it cannot be known.
 *
 * Null rather than a guess: comparing against the wrong revision reports invented failures, and a
 * check that cries wolf is one somebody deletes.
 */
export function resolveRevisions(root: string, trunk: string): Revisions | null {
  const tip = git(root, ["rev-parse", "--verify", `${trunk}^{commit}`])?.trim();
  if (!tip) return null;
  const base = git(root, ["merge-base", "HEAD", trunk])?.trim();
  if (!base) return null;
  return { base, tip };
}

/** Read a file as of a revision, or null when it did not exist there. */
export function makeRevisionReader(root: string, rev: string): (path: string) => string | null {
  return (path: string) => git(root, ["show", `${rev}:${path}`]);
}
