/**
 * The kit's programmatic surface, for a consuming repo that wants to call the checker rather than
 * shell out to it — a custom lane in its own gate, an editor integration, a migration script.
 */

export {
  check,
  type CheckDeps,
  type CheckReport,
  type DeclaredEntry,
  type Finding,
} from "./check.js";
export {
  configSchema,
  findConfig,
  loadConfig,
  parseConfig,
  scopesOf,
  type LoadedConfig,
  type SddConfig,
} from "./config.js";
export {
  formatId,
  idPattern,
  isId,
  kindOf,
  nearMissPattern,
  nextNumber,
  referencePattern,
  scopeOf,
  type EntryKind,
  type IdGrammar,
} from "./ids.js";
export {
  collidingSince,
  droppedSince,
  idsByScope,
  type Dropped,
  type IdsByScope,
  type Parser,
  type RevisionReader,
} from "./permanence.js";
export {
  parseRegister,
  parseSpecRegister,
  parseTableRegister,
  type Entry,
  type ParseResult,
  type Problem,
  type RegisterConfig,
  type RegisterFormat,
} from "./registers.js";
