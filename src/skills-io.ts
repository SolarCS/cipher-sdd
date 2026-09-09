/**
 * Reading the skills the package ships, and the copies a consumer has vendored.
 *
 * Split from `install.ts` so the comparison logic there stays pure. Everything in this file touches
 * the filesystem and nothing in it decides anything.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { MANIFEST_NAME, type Manifest, type SourceSkill } from "./install.js";

/** The package's own root, from this module's location: `src/` → the package directory. */
export function packageRoot(): string {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

/** The version the package declares, used to stamp the manifest. */
export function packageVersion(): string {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8"));
    const version = (raw as { version?: unknown }).version;
    return typeof version === "string" ? version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Every skill the package ships, read from its `skills/<name>/SKILL.md` layout. */
export function readPackagedSkills(): SourceSkill[] {
  const dir = join(packageRoot(), "skills");
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  const skills: SourceSkill[] = [];
  for (const name of names.sort()) {
    try {
      skills.push({ name, content: readFileSync(join(dir, name, "SKILL.md"), "utf8") });
    } catch {
      // A directory with no SKILL.md is not a skill. Skipped rather than reported: the packaging
      // test is what catches a malformed package, not every consumer's checker run.
    }
  }
  return skills;
}

/** Every `SKILL.md` currently vendored under the consumer's skills directory. */
export function readVendoredSkills(root: string, skillsDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const base = join(root, skillsDir);
  let names: string[];
  try {
    names = readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return out;
  }
  for (const name of names) {
    const rel = `${skillsDir}/${name}/SKILL.md`;
    try {
      out.set(rel, readFileSync(join(root, rel), "utf8"));
    } catch {
      // Not a skill directory; the drift check only speaks about files it can read.
    }
  }
  return out;
}

/**
 * The manifest is a durable record written by one version of the kit and read by another, so it is
 * validated rather than cast.
 *
 * Checking only `Array.isArray(entries)` let a file with `entries: ["not an object"]` through, and
 * the failure then surfaced far away — every vendored skill reported as hand-edited, which reads as
 * the user's fault rather than the file's. A boundary that decides whether someone is accused of
 * editing a generated file is worth validating properly.
 */
const manifestSchema = z
  .object({
    version: z.string(),
    entries: z.array(z.object({ path: z.string(), sha256: z.string() }).strict()),
  })
  .strict();

export function readManifest(root: string, skillsDir: string): Manifest | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(root, skillsDir, MANIFEST_NAME), "utf8"));
    return manifestSchema.safeParse(raw).data ?? null;
  } catch {
    return null;
  }
}

/** Write the vendored copies and the manifest that records what was written. */
export function writeSkills(
  root: string,
  skillsDir: string,
  skills: readonly SourceSkill[],
  manifest: Manifest,
): string[] {
  const written: string[] = [];
  for (const skill of skills) {
    const rel = `${skillsDir}/${skill.name}/SKILL.md`;
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, skill.content, "utf8");
    written.push(rel);
  }
  const manifestPath = join(root, skillsDir, MANIFEST_NAME);
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  written.push(`${skillsDir}/${MANIFEST_NAME}`);
  return written;
}
