/**
 * `sdd.config.yaml` — the one file a consuming repo edits, and the whole portability seam.
 *
 * Nothing in this package may hardcode a path, a scope, an id grammar or a house rule. Every one of
 * them arrives here, which is what lets the same checker gate a repo with 700 legacy ids and a repo
 * with none. The alternative — a kit that "supports" other repos through options scattered across
 * its code — is how a portable tool quietly becomes a single-repo tool.
 *
 * Two kinds of field live here and they must not be confused:
 *
 *   - **Enforced** — roots, registers, grammar, debt. The checker reads these and fails on them.
 *   - **Prompt-level** (`context`, `rules`, `sizing`) — advice injected into a workflow when an
 *     agent runs it. NONE of it is enforcement, and the config says so in its own comment. A repo's
 *     real gate is its test command; a kit that pretends otherwise teaches people to trust a check
 *     that was never run.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/** 2-5 uppercase letters, unique across the repo, owned by exactly one register. */
const scopeSchema = z.string().regex(/^[A-Z]{2,5}$/, "a scope is 2-5 uppercase letters");

export const registerSchema = z
  .object({
    scope: scopeSchema,
    file: z.string().min(1),
    format: z.enum(["table", "sdd"]).default("sdd"),
    /** Live entries must be named by something outside the registers. */
    gated: z.boolean().default(true),
    /**
     * Demand at least one scenario, with a WHEN and a THEN, on every live entry.
     *
     * Stories as well as requirements: a user story carries acceptance scenarios in this format,
     * so exempting them would leave the unit of user-visible value unproven while gating the rules
     * beneath it.
     */
    requireScenarios: z.boolean().default(false),
    /** Pattern for the pre-migration id scheme this register replaced. */
    legacy: z.string().optional(),
    legacyExclude: z.array(z.string()).default([]),
  })
  .strict();

export const configSchema = z
  .object({
    /**
     * `sdd` is `SCOPE-Kn` with a kind letter; `catalyst` is the plain `SCOPE-n` a repo with an
     * installed base already uses. Chosen once — a repo cannot run both, because an id must mean
     * exactly one thing.
     */
    idGrammar: z.enum(["sdd", "catalyst"]).default("sdd"),
    /** Where living capability specs live. */
    specRoot: z.string().default("specs"),
    /** Where in-flight change directories live. */
    changesRoot: z.string().default("changes"),
    /** Path prefixes scanned for references to ids. */
    searchRoots: z.array(z.string()).default([]),
    /**
     * Prefixes that contribute REFERENCES but never COVERAGE. A document that cites requirements to
     * explain them would otherwise cover every id it mentions — a backfill note citing fifteen
     * requirements once covered all fifteen.
     */
    coverageExcludeRoots: z.array(z.string()).default([]),
    /** Whole files whose example ids are documentation, not references. */
    excludeFromScan: z.array(z.string()).default([]),
    /** Prefixes that may never be a scope, because they already mean something else. */
    reservedScopes: z.array(z.string()).default([]),
    /** Above this many requirements, a Tier 1 patch is not a patch. */
    patchMaxRequirements: z.number().int().positive().default(3),
    /** The branch permanence compares against. A merge base, never the tip alone. */
    trunk: z.string().default("origin/main"),
    registers: z.array(registerSchema).default([]),
    /** id → written reason. Carried debt, and itself ratcheted: a key that suppresses nothing fails. */
    knownDebt: z.record(z.string(), z.string()).default({}),

    // ---- prompt-level below this line: injected as advice, never enforced ----
    /** Repo facts every workflow should read before planning. */
    context: z.string().default(""),
    /** The sizing criteria that decide whether a change needs a spec at all. */
    sizing: z
      .object({ criteria: z.array(z.string()).default([]) })
      .strict()
      .default({ criteria: [] }),
    /** Per-artifact house rules, keyed by artifact id. */
    rules: z.record(z.string(), z.array(z.string())).default({}),
  })
  .strict();

export type SddConfig = z.infer<typeof configSchema>;
export type NormalisedRegister = z.infer<typeof registerSchema>;

/**
 * Apply the schema's defaults to a register read from somewhere other than a validated config —
 * in practice, one recovered from an older revision by the permanence check.
 *
 * This exists because a default written in two places is a bug waiting to happen, and this one bit:
 * a baseline register with no explicit `format` was parsed as a table, found zero entries in a
 * heading-format spec, and the empty result was then read as "unreadable, so not evidence of loss".
 * A deleted requirement passed the gate. Defaults belong to the schema, and only the schema.
 *
 * Returns null when the register is unreadable even loosely, so the caller can skip it rather than
 * fabricate one — a baseline predating a field rename is a normal thing to meet, not a failure.
 */
export function normaliseRegister(raw: unknown): NormalisedRegister | null {
  const parsed = registerSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Loose fallback: a baseline may carry fields this version has since dropped, and losing the
  // whole register over an unknown key would silently forfeit every id it holds.
  const loose = raw as Partial<NormalisedRegister>;
  if (typeof loose?.scope !== "string" || typeof loose?.file !== "string") return null;
  return (
    registerSchema.safeParse({
      scope: loose.scope,
      file: loose.file,
      ...(loose.format === undefined ? {} : { format: loose.format }),
    }).data ?? null
  );
}

export interface LoadedConfig {
  readonly config: SddConfig;
  /** Absolute path of the directory holding the config — every relative path resolves from here. */
  readonly root: string;
  readonly configPath: string;
}

const CONFIG_NAMES = ["sdd.config.yaml", "sdd.config.yml"] as const;

/**
 * Find the config by walking up from a starting directory.
 *
 * Walking up rather than demanding `cwd` is the config's directory means the checker works from a
 * subdirectory, which is where people actually run it.
 */
export function findConfig(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const candidate = join(dir, name);
      try {
        readFileSync(candidate, "utf8");
        return candidate;
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Parse and validate a config's text. Separated from IO so a test can hold it still. */
export function parseConfig(text: string): SddConfig {
  const raw: unknown = parseYaml(text);
  return configSchema.parse(raw ?? {});
}

/**
 * Load the config, resolving every relative path against the config's own directory.
 *
 * Throws with the offending path in the message rather than returning null: a checker that silently
 * runs with no config is a checker that reports a clean pass over nothing.
 */
export function loadConfig(from: string = process.cwd()): LoadedConfig {
  const configPath = findConfig(from);
  if (configPath === null) {
    throw new Error(`no sdd.config.yaml found in ${resolve(from)} or any parent directory`);
  }
  const config = parseConfig(readFileSync(configPath, "utf8"));
  return { config, root: dirname(configPath), configPath };
}

/**
 * Every scope the config declares, in declaration order.
 *
 * A duplicate scope is a hard fault rather than a last-one-wins merge: two registers claiming one
 * scope means every reference to it is ambiguous, and the checker would gate the wrong document.
 */
export function scopesOf(config: SddConfig): string[] {
  const seen = new Map<string, string>();
  for (const reg of config.registers) {
    const existing = seen.get(reg.scope);
    if (existing !== undefined) {
      throw new Error(
        `scope ${reg.scope} is claimed by two registers (${existing} and ${reg.file}); a scope belongs to exactly one`,
      );
    }
    seen.set(reg.scope, reg.file);
  }
  return [...seen.keys()];
}
