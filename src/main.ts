#!/usr/bin/env -S npx tsx
/**
 * `sdd` — the command line.
 *
 * One command so far: `check`. The workflow operations the design calls for (`new`, `sync`,
 * `archive`) are agent-driven and arrive with the skills; shipping empty stubs for them now would
 * put commands in the help text that do nothing, which is worse than their absence.
 */

import { relative } from "node:path";

import { check } from "./check.js";
import { loadConfig, scopesOf } from "./config.js";
import { listTrackedFiles, makeReader, makeRevisionReader, resolveRevisions } from "./io.js";
import { detectDrift, DRIFT_REMEDY, managedBy, planInstall } from "./install.js";
import { collidingSince, droppedSince, idsByScope } from "./permanence.js";
import { parseRegister, type RegisterConfig } from "./registers.js";
import {
  packageVersion,
  readManifest,
  readPackagedSkills,
  readVendoredSkills,
  writeSkills,
} from "./skills-io.js";

const USAGE = `Usage: sdd <command>

  check [--json]   Verify every register: identifiers well formed, live ones named by
                   something outside the registers, ratchets alive, nothing dropped since
                   the trunk, and no vendored skill hand-edited.
  install          Vendor the kit's skills into this repo. Overwrites wholesale — a
                   vendored skill is generated, never hand-edited; customise the config.
`;

function run(argv: readonly string[]): number {
  const command = argv[0];
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(USAGE);
    return command === undefined ? 1 : 0;
  }
  if (command !== "check" && command !== "install") {
    process.stderr.write(`sdd: unknown command "${command}"\n\n${USAGE}`);
    return 2;
  }

  const json = argv.includes("--json");
  const { config, root, configPath } = loadConfig();

  if (command === "install") {
    const skills = readPackagedSkills();
    if (skills.length === 0) {
      process.stderr.write("sdd: the package ships no skills to install\n");
      return 2;
    }
    const { manifest } = planInstall(skills, config.skillsDir, packageVersion());
    const written = writeSkills(root, config.skillsDir, skills, manifest);
    process.stdout.write(
      `installed ${skills.length} skill(s) at v${manifest.version}\n${written.map((w) => `  ${w}`).join("\n")}\n\n` +
        "Commit these: a vendored skill in git is what makes the next upgrade a reviewable diff.\n",
    );
    return 0;
  }

  scopesOf(config); // throws on a scope claimed twice, before anything is reported

  const readFile = makeReader(root);
  const report = check(config, {
    readFile,
    listFiles: () => listTrackedFiles(root, config.searchRoots),
  });

  const findings = [...report.findings];

  // ---- vendored skills: generated, never hand-edited ---------------------------------------

  const packaged = readPackagedSkills();
  if (packaged.length > 0) {
    const manifest = readManifest(root, config.skillsDir);
    const { files } = planInstall(packaged, config.skillsDir, packageVersion());
    const onDisk = readVendoredSkills(root, config.skillsDir);
    const isManaged = managedBy(
      config.skillsDir,
      packaged.map((s) => s.name),
      config.skillPrefix,
    );
    for (const d of detectDrift(manifest, onDisk, files, isManaged)) {
      findings.push({ check: `skill-${d.kind}`, message: DRIFT_REMEDY[d.kind], detail: [d.path] });
    }
  }

  // ---- permanence, which needs git and is skipped honestly when it is unavailable ----------

  const revisions = resolveRevisions(root, config.trunk);
  let permanenceStatus: string;
  if (revisions === null) {
    // Printed rather than silent: a ratchet that quietly stops running is the same defect as a
    // debt entry that suppresses nothing.
    permanenceStatus = `SKIPPED — could not resolve a merge base with ${config.trunk}`;
  } else {
    const configRelative = relative(root, configPath);
    const parse = (source: string, reg: RegisterConfig) =>
      parseRegister(source, reg, config.idGrammar);
    const at = (rev: string) => {
      const readAt = makeRevisionReader(root, rev);
      const text = readAt(configRelative);
      return text === null ? null : idsByScope(text, readAt, parse);
    };

    const base = at(revisions.base);
    const tip = at(revisions.tip);
    const current = idsByScope(readFile(configRelative) ?? "", readFile, parse);

    if (base === null || current === null) {
      permanenceStatus = "SKIPPED — a config revision could not be read";
    } else {
      permanenceStatus = `checked against ${revisions.base.slice(0, 8)}`;
      const { droppedIds, droppedScopes } = droppedSince(base, current);
      if (droppedScopes.length > 0) {
        findings.push({
          check: "dropped-scope",
          message:
            "a register vanished since the trunk — the cheapest way to turn a red gate green",
          detail: droppedScopes,
        });
      }
      if (droppedIds.length > 0) {
        findings.push({
          check: "dropped-id",
          message: "identifiers vanished since the trunk; retire an entry, never delete it",
          detail: droppedIds,
        });
      }
      if (tip !== null) {
        const collisions = collidingSince(base, tip, current);
        if (collisions.length > 0) {
          findings.push({
            check: "colliding-id",
            message: "this branch and the trunk each allocated the same identifier",
            detail: collisions,
          });
        }
      }
    }
  }

  // ---- report -------------------------------------------------------------------------------

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ok: findings.length === 0, findings, stats: report.stats, permanence: permanenceStatus }, null, 2)}\n`,
    );
    return findings.length === 0 ? 0 : 1;
  }

  for (const finding of findings) {
    process.stderr.write(`\n✗ ${finding.check}: ${finding.message}\n`);
    for (const line of finding.detail) process.stderr.write(`    ${line}\n`);
  }

  const { stats } = report;
  process.stdout.write(
    `\n${stats.registers} register(s) · ${stats.stories} stor(ies) · ${stats.requirements} requirement(s) · ` +
      `${stats.covered}/${stats.gated} gated identifiers covered\npermanence: ${permanenceStatus}\n`,
  );

  if (findings.length > 0) {
    process.stderr.write(`\n${findings.length} check(s) failed.\n`);
    return 1;
  }
  process.stdout.write("all checks passed\n");
  return 0;
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`sdd: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 2;
}
