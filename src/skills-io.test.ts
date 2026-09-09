import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { MANIFEST_NAME, planInstall } from "./install.js";
import { readManifest, readVendoredSkills, writeSkills } from "./skills-io.js";

/**
 * The vendoring IO, against a real directory.
 *
 * Every guard here decides what happens when a consuming repo is in a state the kit did not
 * create — a half-written skills directory, a manifest from a version that has moved on, a folder
 * that is not a skill at all. Each one returns something usable rather than throwing, because the
 * checker has to be able to REPORT a broken install rather than die inside it.
 */

const dirs: string[] = [];
const scratch = (): string => {
  const d = mkdtempSync(join(tmpdir(), "sdd-skills-"));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const SKILLS = [
  { name: "sdd-size", content: "---\nname: sdd-size\n---\nthe gate" },
  { name: "sdd-patch", content: "---\nname: sdd-patch\n---\nthe patch tier" },
];
const DIR = ".cursor/skills";

describe("writeSkills", () => {
  it("creates the directory tree and writes each skill plus a manifest", () => {
    const root = scratch();
    const { manifest } = planInstall(SKILLS, DIR, "1.2.3");
    const written = writeSkills(root, DIR, SKILLS, manifest);

    expect(written).toContain(`${DIR}/sdd-size/SKILL.md`);
    expect(written).toContain(`${DIR}/${MANIFEST_NAME}`);
    expect(readFileSync(join(root, DIR, "sdd-size", "SKILL.md"), "utf8")).toBe(SKILLS[0]?.content);
    expect(readManifest(root, DIR)?.version).toBe("1.2.3");
  });

  it("overwrites wholesale, because a vendored skill is generated and never merged", () => {
    const root = scratch();
    const { manifest } = planInstall(SKILLS, DIR, "1.0.0");
    writeSkills(root, DIR, SKILLS, manifest);
    writeFileSync(join(root, DIR, "sdd-size", "SKILL.md"), "hand-edited");

    writeSkills(root, DIR, SKILLS, manifest);
    expect(readFileSync(join(root, DIR, "sdd-size", "SKILL.md"), "utf8")).toBe(SKILLS[0]?.content);
  });
});

describe("readVendoredSkills", () => {
  it("returns an empty map when nothing has been installed, rather than throwing", () => {
    // The checker must be able to say "not installed" instead of dying on a fresh repo.
    expect(readVendoredSkills(scratch(), DIR).size).toBe(0);
  });

  it("skips a directory carrying no SKILL.md", () => {
    const root = scratch();
    const { manifest } = planInstall(SKILLS, DIR, "1.0.0");
    writeSkills(root, DIR, SKILLS, manifest);
    mkdirSync(join(root, DIR, "not-a-skill"), { recursive: true });

    const found = readVendoredSkills(root, DIR);
    expect([...found.keys()]).not.toContain(`${DIR}/not-a-skill/SKILL.md`);
    expect(found.size).toBe(SKILLS.length);
  });
});

describe("readManifest", () => {
  it("returns null when no manifest exists", () => {
    expect(readManifest(scratch(), DIR)).toBeNull();
  });

  it("returns null on a malformed manifest rather than a half-read one", () => {
    // A half-read manifest would make every vendored skill look hand-edited, which reads as the
    // user's fault rather than the file's.
    const root = scratch();
    mkdirSync(join(root, DIR), { recursive: true });
    writeFileSync(join(root, DIR, MANIFEST_NAME), "{ not json");
    expect(readManifest(root, DIR)).toBeNull();
  });

  it("returns null when the manifest is valid JSON but the wrong shape", () => {
    const root = scratch();
    mkdirSync(join(root, DIR), { recursive: true });
    writeFileSync(join(root, DIR, MANIFEST_NAME), JSON.stringify({ version: 3 }));
    expect(readManifest(root, DIR)).toBeNull();
  });
});
