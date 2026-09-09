/**
 * Vendoring the skills into a consuming repo, and detecting when a vendored copy has drifted.
 *
 * Skills cannot be a dependency the way the checker is. An agent discovers them from the filesystem
 * — `.cursor/skills`, `.claude/skills` — never by resolving a module, so a copy has to exist in
 * every consumer. That copy being in git is a feature: an upgrade arrives as a reviewable diff
 * rather than as behaviour that silently changed under the team.
 *
 * The rule that makes upgrades survivable is **regenerate, never merge**. `install` overwrites
 * wholesale and `check` fails on a hand-edited copy, because a hand-edited vendored file is an
 * unupgradeable one: the next install either destroys the edit or has to be taught to reconcile it,
 * and nobody writes that reconciler. Customisation belongs in `sdd.config.yaml`, which is the one
 * file a consumer owns. If the config cannot express what a repo needs, that is a gap in the kit
 * worth filing — not a patch worth applying locally.
 */

import { createHash } from "node:crypto";

/** One vendored file: where it came from, where it goes, and what it contained when installed. */
export interface ManifestEntry {
  readonly path: string;
  readonly sha256: string;
}

export interface Manifest {
  /** The kit version that wrote these files. */
  readonly version: string;
  readonly entries: readonly ManifestEntry[];
}

export const MANIFEST_NAME = ".sdd-manifest.json";

/**
 * Whether the kit may speak about a vendored path: it ships the skill today, or the name carries
 * the kit's prefix so it plausibly shipped it yesterday. Everything else in the directory belongs
 * to the consuming repo and is none of the kit's business.
 */
export function managedBy(
  skillsDir: string,
  shipped: readonly string[],
  prefix: string,
): (path: string) => boolean {
  const shippedPaths = new Set(shipped.map((name) => `${skillsDir}/${name}/SKILL.md`));
  return (path: string) => {
    if (shippedPaths.has(path)) return true;
    const rest = path.startsWith(`${skillsDir}/`) ? path.slice(skillsDir.length + 1) : "";
    return rest.startsWith(prefix);
  };
}

export function hash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** A skill as the package ships it. */
export interface SourceSkill {
  /** Directory name, which is also the skill's name. */
  readonly name: string;
  readonly content: string;
}

/** What an install would write, given the skills the package ships. */
export function planInstall(
  skills: readonly SourceSkill[],
  skillsDir: string,
  version: string,
): { readonly files: readonly ManifestEntry[]; readonly manifest: Manifest } {
  const files = skills
    .map((s) => ({ path: `${skillsDir}/${s.name}/SKILL.md`, sha256: hash(s.content) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  return { files, manifest: { version, entries: files } };
}

export type DriftKind = "edited" | "missing" | "stale" | "unmanaged";

export interface Drift {
  readonly kind: DriftKind;
  readonly path: string;
}

/**
 * Compare what is on disk against both the manifest and the package.
 *
 * Four distinct faults, because they need four different fixes and collapsing them into "drift"
 * would leave the user guessing which:
 *
 *   - `edited`    — the vendored file differs from what was installed. Move it to the config.
 *   - `missing`   — the manifest lists it and it is gone. Re-run install.
 *   - `stale`     — the package ships a newer version of it. Re-run install; read the diff.
 *   - `unmanaged` — a skill the kit could have installed that no manifest claims. Usually a rename
 *     left behind, and it will keep competing for intent until it is removed.
 *
 * `isManaged` decides which paths the kit may speak about at all. A consuming repo's skills live in
 * the SAME directory as the vendored ones — that is the normal case, not an edge case — so claiming
 * every file in the folder would report a repo's own long-standing skills as the kit's litter.
 */
export function detectDrift(
  manifest: Manifest | null,
  onDisk: ReadonlyMap<string, string>,
  expected: readonly ManifestEntry[],
  isManaged: (path: string) => boolean,
): Drift[] {
  const drift: Drift[] = [];
  if (manifest === null) {
    // Nothing was ever installed here. Not drift — the caller reports "not installed" instead.
    return drift;
  }

  const installed = new Map(manifest.entries.map((e) => [e.path, e.sha256]));
  const expectedByPath = new Map(expected.map((e) => [e.path, e.sha256]));

  for (const [path, sha] of installed) {
    const current = onDisk.get(path);
    if (current === undefined) {
      drift.push({ kind: "missing", path });
      continue;
    }
    if (hash(current) !== sha) {
      drift.push({ kind: "edited", path });
      continue;
    }
    if (expectedByPath.get(path) !== sha) drift.push({ kind: "stale", path });
  }

  for (const path of expectedByPath.keys()) {
    if (!installed.has(path)) drift.push({ kind: "stale", path });
  }

  for (const path of onDisk.keys()) {
    if (!isManaged(path)) continue;
    if (!installed.has(path) && !expectedByPath.has(path)) {
      drift.push({ kind: "unmanaged", path });
    }
  }

  return drift.sort((a, b) => a.path.localeCompare(b.path));
}

/** Human-readable remedy for each fault, so the message says what to do rather than only what broke. */
export const DRIFT_REMEDY: Readonly<Record<DriftKind, string>> = {
  edited:
    "a vendored skill was hand-edited — move the change into sdd.config.yaml, then re-install",
  missing: "a vendored skill is gone — re-run install",
  stale: "the kit ships a newer version of this skill — re-run install and review the diff",
  unmanaged: "a skill here belongs to no manifest — usually a rename left behind; delete it",
};
