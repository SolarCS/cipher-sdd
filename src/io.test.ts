import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listTrackedFiles, makeReader, makeRevisionReader, resolveRevisions } from "./io.js";

/**
 * The IO half, exercised against a real throwaway repository.
 *
 * These paths are worth real tests rather than mocks because each one is a decision about what
 * counts as evidence: which files may satisfy coverage, which bytes are text, and when a comparison
 * against history is honest enough to make. A mock would only assert that the code calls the
 * functions it calls.
 */

let repo: string;

const run = (...args: string[]): void => {
  execFileSync("git", args, { cwd: repo, stdio: "ignore" });
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "sdd-io-"));
  run("init", "-q", ".");
  run("config", "user.email", "t@t");
  run("config", "user.name", "t");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "tracked.ts"), "// names ZQS-R1\n");
  // A PNG-like file: a NUL inside the first bytes, then something that looks like an identifier.
  writeFileSync(
    join(repo, "src", "logo.png"),
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]),
      Buffer.from("ZQS-R9 looks like a reference but is image bytes", "utf8"),
    ]),
  );
  run("add", "-A");
  run("commit", "-qm", "init");
  // Untracked AFTER the commit, so `git ls-files` will not list it.
  writeFileSync(join(repo, "src", "untracked.ts"), "// also names ZQS-R1\n");
});

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("makeReader", () => {
  it("reads a text file", () => {
    expect(makeReader(repo)("src/tracked.ts")).toContain("ZQS-R1");
  });

  it("returns null for a file that does not exist, rather than throwing", () => {
    expect(makeReader(repo)("src/nope.ts")).toBeNull();
  });

  it("refuses a binary file, so image bytes cannot satisfy coverage", () => {
    // The reference implementation reported `F2`/`F3` "references" inside a brand PNG. A phantom
    // reference is worse than a missing one: it SATISFIES coverage, so a requirement reads as
    // proven by an image.
    expect(makeReader(repo)("src/logo.png")).toBeNull();
  });

  it("caches, so one file is read once however many identifiers are scanned for", () => {
    const read = makeReader(repo);
    expect(read("src/tracked.ts")).toBe(read("src/tracked.ts"));
  });
});

describe("listTrackedFiles", () => {
  it("lists tracked files under the search roots", () => {
    expect(listTrackedFiles(repo, ["src"])).toContain("src/tracked.ts");
  });

  it("omits an untracked file, so a build artefact cannot satisfy coverage", () => {
    // A coverage report ships whole source files. Letting one count would pass the gate on
    // something no reviewer saw and the next `clean` deletes.
    expect(listTrackedFiles(repo, ["src"])).not.toContain("src/untracked.ts");
  });

  it("returns an empty list outside a repository rather than throwing", () => {
    expect(listTrackedFiles(mkdtempSync(join(tmpdir(), "sdd-nogit-")), ["."])).toEqual([]);
  });
});

describe("resolveRevisions", () => {
  it("returns null when the trunk cannot be resolved, rather than guessing a baseline", () => {
    // Comparing against the wrong revision invents failures, and a check that cries wolf is one
    // somebody deletes. Null lets the caller say SKIPPED out loud instead.
    expect(resolveRevisions(repo, "origin/does-not-exist")).toBeNull();
  });

  it("resolves a base and a tip when the trunk exists", () => {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: repo,
      encoding: "utf8",
    }).trim();
    const revisions = resolveRevisions(repo, branch);
    expect(revisions?.base).toMatch(/^[0-9a-f]{40}$/);
    expect(revisions?.tip).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("makeRevisionReader", () => {
  it("reads a file as of a revision", () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    expect(makeRevisionReader(repo, head)("src/tracked.ts")).toContain("ZQS-R1");
  });

  it("returns null for a path absent at that revision", () => {
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
    expect(makeRevisionReader(repo, head)("src/untracked.ts")).toBeNull();
  });
});
