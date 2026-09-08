import { describe, expect, it } from "vitest";

import { detectDrift, hash, planInstall } from "./install.js";

const SKILLS = [
  { name: "sdd-size", content: "---\nname: sdd-size\n---\ngate" },
  { name: "sdd-patch", content: "---\nname: sdd-patch\n---\npatch" },
];
const DIR = ".cursor/skills";
const kinds = (d: ReturnType<typeof detectDrift>) => d.map((x) => `${x.kind}:${x.path}`);

describe("planInstall", () => {
  it("maps each skill to its vendored path and records what it contained", () => {
    const { files, manifest } = planInstall(SKILLS, DIR, "1.0.0");
    expect(files.map((f) => f.path)).toEqual([
      `${DIR}/sdd-patch/SKILL.md`,
      `${DIR}/sdd-size/SKILL.md`,
    ]);
    expect(manifest.version).toBe("1.0.0");
    expect(files[0]?.sha256).toBe(hash(SKILLS[1]!.content));
  });
});

describe("detectDrift", () => {
  const { files, manifest } = planInstall(SKILLS, DIR, "1.0.0");
  const clean = new Map(SKILLS.map((s) => [`${DIR}/${s.name}/SKILL.md`, s.content]));

  it("is silent when disk, manifest and package all agree", () => {
    expect(detectDrift(manifest, clean, files, DIR)).toEqual([]);
  });

  it("reports nothing when the kit was never installed, so the caller can say so instead", () => {
    expect(detectDrift(null, clean, files, DIR)).toEqual([]);
  });

  it("catches a hand-edited vendored skill — the unupgradeable case", () => {
    const edited = new Map(clean).set(`${DIR}/sdd-size/SKILL.md`, "locally tweaked");
    expect(kinds(detectDrift(manifest, edited, files, DIR))).toEqual([
      `edited:${DIR}/sdd-size/SKILL.md`,
    ]);
  });

  it("catches a vendored skill that was deleted", () => {
    const gone = new Map(clean);
    gone.delete(`${DIR}/sdd-patch/SKILL.md`);
    expect(kinds(detectDrift(manifest, gone, files, DIR))).toEqual([
      `missing:${DIR}/sdd-patch/SKILL.md`,
    ]);
  });

  it("catches a skill the kit has since changed", () => {
    const newer = planInstall(
      [SKILLS[0]!, { name: "sdd-patch", content: "---\nname: sdd-patch\n---\npatch, revised" }],
      DIR,
      "1.1.0",
    );
    expect(kinds(detectDrift(manifest, clean, newer.files, DIR))).toEqual([
      `stale:${DIR}/sdd-patch/SKILL.md`,
    ]);
  });

  it("catches a skill the kit has added since this install", () => {
    const grown = planInstall([...SKILLS, { name: "sdd-archive", content: "new" }], DIR, "1.1.0");
    expect(kinds(detectDrift(manifest, clean, grown.files, DIR))).toEqual([
      `stale:${DIR}/sdd-archive/SKILL.md`,
    ]);
  });

  it("catches a leftover skill no manifest claims — a rename that kept competing for intent", () => {
    const leftover = new Map(clean).set(`${DIR}/sdd-sizing/SKILL.md`, "the old name");
    expect(kinds(detectDrift(manifest, leftover, files, DIR))).toEqual([
      `unmanaged:${DIR}/sdd-sizing/SKILL.md`,
    ]);
  });

  it("ignores files outside the managed directory", () => {
    const other = new Map(clean).set("docs/notes.md", "unrelated");
    expect(detectDrift(manifest, other, files, DIR)).toEqual([]);
  });
});
