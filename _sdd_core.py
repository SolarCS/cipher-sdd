"""sdd -- the core implementation. Ported 1:1 from the TypeScript reference (check.ts, config.ts,
ids.ts, install.ts, io.ts, main.ts, permanence.ts, registers.ts, skills-io.ts) so the two stay
behaviourally identical. Only ever imported by sdd.py, after that file has already confirmed a
Python 3.11+ interpreter -- so f-strings, type hints and tomllib are all safe to use here.

sdd.config.yaml became sdd.config.toml: tomllib is stdlib-only from 3.11, avoiding a PyYAML
dependency, and the config is read-only (a consumer hand-writes it; nothing here ever writes it
back), which is the one thing tomllib actually supports.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import tomllib
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Callable, Iterable, Literal, Mapping, Sequence

# =============================================================================================
# ids.py
# =============================================================================================

IdGrammar = Literal["sdd", "catalyst"]
EntryKind = Literal["story", "requirement"]

_ID_PATTERNS: dict[str, re.Pattern[str]] = {
    "sdd": re.compile(r"^[A-Z]{2,5}-[SR][0-9]+$"),
    "catalyst": re.compile(r"^[A-Z]{2,5}-[0-9]+$"),
}


def id_pattern(grammar: IdGrammar) -> re.Pattern[str]:
    return _ID_PATTERNS[grammar]


def is_id(token: str, grammar: IdGrammar) -> bool:
    return _ID_PATTERNS[grammar].match(token) is not None


def kind_of(id_: str, grammar: IdGrammar) -> EntryKind | None:
    if not is_id(id_, grammar):
        return None
    if grammar == "catalyst":
        return "requirement"
    return "story" if "-S" in id_ else "requirement"


def near_miss_pattern(scope: str) -> re.Pattern[str]:
    return re.compile(rf"^{re.escape(scope)}-[0-9A-Za-z._-]*$", re.IGNORECASE)


def reference_pattern(scopes: Sequence[str], grammar: IdGrammar) -> re.Pattern[str] | None:
    if len(scopes) == 0:
        return None
    alternation = "|".join(re.escape(s) for s in scopes)
    tail = "[SR][0-9]+" if grammar == "sdd" else "[0-9]+"
    return re.compile(rf"\b(?:{alternation})-{tail}\b")


def scope_of(id_: str) -> str:
    cut = id_.find("-")
    return id_ if cut == -1 else id_[:cut]


def next_number(existing: Iterable[str], kind: EntryKind, grammar: IdGrammar) -> int:
    highest = 0
    for id_ in existing:
        if kind_of(id_, grammar) != kind:
            continue
        m = re.search(r"[0-9]+$", id_)
        if not m:
            continue
        highest = max(highest, int(m.group(0)))
    return highest + 1


def format_id(scope: str, kind: EntryKind, n: int, grammar: IdGrammar) -> str | None:
    if grammar == "catalyst":
        if kind == "story":
            return None
        return f"{scope}-{n}"
    return f"{scope}-{'S' if kind == 'story' else 'R'}{n}"


# =============================================================================================
# config.py
# =============================================================================================


@dataclass(frozen=True)
class RegisterEntryConfig:
    scope: str
    file: str
    format: Literal["table", "sdd"] | None = None
    gated: bool = True
    requireScenarios: bool = False
    legacy: str | None = None
    legacyExclude: tuple[str, ...] = ()


@dataclass(frozen=True)
class SizingConfig:
    criteria: tuple[str, ...] = ()


@dataclass(frozen=True)
class SddConfig:
    idGrammar: IdGrammar = "sdd"
    specRoot: str = "specs"
    changesRoot: str = "changes"
    searchRoots: tuple[str, ...] = ()
    coverageExcludeRoots: tuple[str, ...] = ()
    excludeFromScan: tuple[str, ...] = ()
    reservedScopes: tuple[str, ...] = ()
    patchMaxRequirements: int = 3
    trunk: str = "origin/main"
    skillsDir: str = ".cursor/skills"
    skillPrefix: str = "sdd-"
    # Where sdd.py/_sdd_core.py are vendored. "." (repo root) by default; a consumer that wants
    # nothing at its top level can set this to e.g. ".cursor/sdd".
    coreDir: str = "."
    # Where templates/*.md are vendored, independent of coreDir -- a consumer nesting the core
    # files under .cursor/sdd can still keep templates wherever it already keeps generated docs.
    templatesDir: str = "sdd-templates"
    registers: tuple[RegisterEntryConfig, ...] = ()
    knownDebt: Mapping[str, str] = field(default_factory=dict)
    context: str = ""
    gate: str = ""
    sizing: SizingConfig = field(default_factory=SizingConfig)
    rules: Mapping[str, tuple[str, ...]] = field(default_factory=dict)


class ConfigError(ValueError):
    """A malformed sdd.config.toml. Mirrors Zod's .strict()/enum/regex rejections."""


_SCOPE_RE = re.compile(r"^[A-Z]{2,5}$")
_ALLOWED_REGISTER_KEYS = {
    "scope",
    "file",
    "format",
    "gated",
    "requireScenarios",
    "legacy",
    "legacyExclude",
}
_ALLOWED_CONFIG_KEYS = {
    "idGrammar",
    "specRoot",
    "changesRoot",
    "searchRoots",
    "coverageExcludeRoots",
    "excludeFromScan",
    "reservedScopes",
    "patchMaxRequirements",
    "trunk",
    "skillsDir",
    "skillPrefix",
    "coreDir",
    "templatesDir",
    "registers",
    "knownDebt",
    "context",
    "gate",
    "sizing",
    "rules",
}


def _parse_register(raw: Mapping[str, object]) -> RegisterEntryConfig:
    unknown = set(raw.keys()) - _ALLOWED_REGISTER_KEYS
    if unknown:
        raise ConfigError(f"register has unrecognised key(s): {', '.join(sorted(unknown))}")
    scope = raw.get("scope")
    if not isinstance(scope, str) or not _SCOPE_RE.match(scope):
        raise ConfigError(f"a scope is 2-5 uppercase letters, got {scope!r}")
    file_ = raw.get("file")
    if not isinstance(file_, str) or file_ == "":
        raise ConfigError(f"register {scope} has no file")
    fmt = raw.get("format", "sdd")
    if fmt not in ("table", "sdd"):
        raise ConfigError(f"register {scope} has an unrecognised format {fmt!r}")
    return RegisterEntryConfig(
        scope=scope,
        file=file_,
        format=fmt,  # type: ignore[arg-type]
        gated=bool(raw.get("gated", True)),
        requireScenarios=bool(raw.get("requireScenarios", False)),
        legacy=raw.get("legacy"),  # type: ignore[arg-type]
        legacyExclude=tuple(raw.get("legacyExclude", ())),
    )


def normalise_register(raw: object) -> RegisterEntryConfig | None:
    """Loosest possible recovery of a register read from a baseline (older) config revision --
    a baseline may carry fields this version has since dropped, and losing the whole register
    over an unknown key would silently forfeit every id it holds."""
    if not isinstance(raw, dict):
        return None
    try:
        return _parse_register(raw)
    except ConfigError:
        pass
    scope = raw.get("scope")
    file_ = raw.get("file")
    if not isinstance(scope, str) or not isinstance(file_, str):
        return None
    fmt = raw.get("format")
    try:
        return _parse_register({"scope": scope, "file": file_, **({"format": fmt} if fmt is not None else {})})
    except ConfigError:
        return None


def parse_config(raw: Mapping[str, object]) -> SddConfig:
    unknown = set(raw.keys()) - _ALLOWED_CONFIG_KEYS
    if unknown:
        raise ConfigError(f"sdd.config.toml has unrecognised key(s): {', '.join(sorted(unknown))}")

    id_grammar = raw.get("idGrammar", "sdd")
    if id_grammar not in ("sdd", "catalyst"):
        raise ConfigError(f"idGrammar must be 'sdd' or 'catalyst', got {id_grammar!r}")

    patch_max = raw.get("patchMaxRequirements", 3)
    if not isinstance(patch_max, int) or isinstance(patch_max, bool) or patch_max <= 0:
        raise ConfigError("patchMaxRequirements must be a positive integer")

    registers = tuple(_parse_register(r) for r in raw.get("registers", []))

    sizing_raw = raw.get("sizing", {})
    if not isinstance(sizing_raw, dict) or (set(sizing_raw.keys()) - {"criteria"}):
        raise ConfigError("sizing accepts only a 'criteria' key")
    sizing = SizingConfig(criteria=tuple(sizing_raw.get("criteria", ())))

    rules_raw = raw.get("rules", {})
    rules = {k: tuple(v) for k, v in rules_raw.items()}

    return SddConfig(
        idGrammar=id_grammar,  # type: ignore[arg-type]
        specRoot=raw.get("specRoot", "specs"),
        changesRoot=raw.get("changesRoot", "changes"),
        searchRoots=tuple(raw.get("searchRoots", ())),
        coverageExcludeRoots=tuple(raw.get("coverageExcludeRoots", ())),
        excludeFromScan=tuple(raw.get("excludeFromScan", ())),
        reservedScopes=tuple(raw.get("reservedScopes", ())),
        patchMaxRequirements=patch_max,
        trunk=raw.get("trunk", "origin/main"),
        skillsDir=raw.get("skillsDir", ".cursor/skills"),
        skillPrefix=raw.get("skillPrefix", "sdd-"),
        coreDir=raw.get("coreDir", "."),
        templatesDir=raw.get("templatesDir", "sdd-templates"),
        registers=registers,
        knownDebt=dict(raw.get("knownDebt", {})),
        context=raw.get("context", ""),
        gate=raw.get("gate", ""),
        sizing=sizing,
        rules=rules,
    )


_CONFIG_NAMES = ("sdd.config.toml",)


def find_config(start: Path) -> Path | None:
    """Walk up from `start` looking for sdd.config.toml -- so the checker works from a
    subdirectory, which is where people actually run it."""
    directory = start.resolve()
    while True:
        for name in _CONFIG_NAMES:
            candidate = directory / name
            if candidate.is_file():
                return candidate
        parent = directory.parent
        if parent == directory:
            return None
        directory = parent


@dataclass(frozen=True)
class LoadedConfig:
    config: SddConfig
    root: Path
    config_path: Path


def load_config(start: Path | None = None) -> LoadedConfig:
    start = start if start is not None else Path.cwd()
    config_path = find_config(start)
    if config_path is None:
        raise ConfigError(f"no sdd.config.toml found in {start.resolve()} or any parent directory")
    with config_path.open("rb") as f:
        raw = tomllib.load(f)
    config = parse_config(raw)
    return LoadedConfig(config=config, root=config_path.parent, config_path=config_path)


def scopes_of(config: SddConfig) -> list[str]:
    """Every scope the config declares, in declaration order. A duplicate scope is a hard fault:
    two registers claiming one scope means every reference to it is ambiguous."""
    seen: dict[str, str] = {}
    for reg in config.registers:
        existing = seen.get(reg.scope)
        if existing is not None:
            raise ConfigError(
                f"scope {reg.scope} is claimed by two registers ({existing} and {reg.file}); "
                "a scope belongs to exactly one"
            )
        seen[reg.scope] = reg.file
    return list(seen.keys())


# =============================================================================================
# registers.py
# =============================================================================================


@dataclass(frozen=True)
class Entry:
    id: str
    kind: EntryKind
    legacy: str
    withdrawn: bool
    proposed: bool
    stories: tuple[str, ...]
    lineNo: int
    title: str


@dataclass(frozen=True)
class Problem:
    kind: str
    lineNo: int
    text: str


@dataclass(frozen=True)
class ParseResult:
    entries: tuple[Entry, ...]
    malformed: tuple[str, ...]
    problems: tuple[Problem, ...]
    unknownFormat: str | None = None
    status: Literal["Draft", "Building", "Shipped"] | None = None


_STATUS_RE = re.compile(r"^>\s*\*\*Status:\*\*\s*Spec\s*[—-]\s*(Draft|Building|Shipped)", re.MULTILINE | re.IGNORECASE)


def parse_table_register(source: str, reg: RegisterEntryConfig, grammar: IdGrammar) -> ParseResult:
    entries: list[Entry] = []
    malformed: list[str] = []
    scope_near_miss = near_miss_pattern(reg.scope)

    for index, line in enumerate(source.split("\n")):
        trimmed = line.strip()
        if not trimmed.startswith("|"):
            continue
        body = trimmed
        if body.startswith("|"):
            body = body[1:]
        if body.endswith("|"):
            body = body[:-1]
        cells = [c.strip() for c in body.split("|")]
        id_ = cells[0] if cells else ""
        if not is_id(id_, grammar):
            if scope_near_miss.match(id_):
                malformed.append(id_)
            continue
        entries.append(
            Entry(
                id=id_,
                kind=kind_of(id_, grammar) or "requirement",
                legacy=cells[1] if len(cells) > 1 else "",
                withdrawn=any(re.match(r"^withdrawn$", c, re.IGNORECASE) for c in cells[1:]),
                proposed=False,
                stories=(),
                lineNo=index + 1,
                title=cells[-1] if cells else "",
            )
        )

    m = _STATUS_RE.search(source)
    status = m.group(1) if m else None  # type: ignore[assignment]
    return ParseResult(entries=tuple(entries), malformed=tuple(malformed), problems=(), status=status)


_H2 = re.compile(r"^##(?!#)\s+(.*?)\s*$")
_REQUIREMENT = re.compile(r"^###(?!#)\s+Requirement:\s*(.*?)\s*$")
_STORY = re.compile(r"^###(?!#)\s+User Story:\s*(.*?)\s*$")
_SCENARIO = re.compile(r"^####(?!#)\s+Scenario:\s*(.*?)\s*$")
_FENCE = re.compile(r"^\s*(`{3,}|~{3,})")
_RETIRED_RECORD = re.compile(r"^>\s*Retired\s+\d{4}-\d{2}-\d{2}\s+by\s+\S.*$")
_STORY_LINK = re.compile(r"^>\s*Story:\s*(.+)$")
_WHEN = re.compile(r"^\s*[-*]\s*\*\*WHEN\*\*")
_THEN = re.compile(r"^\s*[-*]\s*\*\*THEN\*\*")
_CLARIFICATION = re.compile(r"\[NEEDS CLARIFICATION:")
_HEADING_DEPTH = re.compile(r"^#{2,4}(?!#)\s")
_LEADING_DASH = re.compile(r"^\s*[—–-]?\s*")

SectionState = Literal["active", "proposed", "retired", "other", "none"]

_SECTIONS: dict[str, tuple[SectionState, EntryKind]] = {
    "user stories": ("active", "story"),
    "proposed user stories": ("proposed", "story"),
    "retired user stories": ("retired", "story"),
    "requirements": ("active", "requirement"),
    "proposed requirements": ("proposed", "requirement"),
    "retired requirements": ("retired", "requirement"),
}


@dataclass
class _OpenBlock:
    lineNo: int
    heading: str
    kind: EntryKind
    retired: bool
    hasRecord: bool = False
    scenarios: int = 0
    stories: list[str] = field(default_factory=list)
    entryIndex: int = 0


def parse_spec_register(source: str, reg: RegisterEntryConfig, grammar: IdGrammar) -> ParseResult:
    entries: list[Entry] = []
    malformed: list[str] = []
    problems: list[Problem] = []
    scope_near_miss = near_miss_pattern(reg.scope)

    def flag(kind: str, line_no: int, text: str) -> None:
        problems.append(Problem(kind=kind, lineNo=line_no, text=text))

    state: SectionState = "none"
    section_kind: EntryKind = "requirement"
    fence: str | None = None
    in_comment = False
    current: _OpenBlock | None = None

    def close_block() -> None:
        nonlocal current
        if current is None:
            return
        if current.retired and not current.hasRecord:
            flag("retired-no-record", current.lineNo, current.heading)
        if reg.requireScenarios and not current.retired and current.scenarios == 0:
            flag("no-scenario", current.lineNo, current.heading)
        entry = entries[current.entryIndex]
        entries[current.entryIndex] = replace(entry, stories=tuple(current.stories))
        current = None

    lines = source.split("\n")
    i = 0
    while i < len(lines):
        raw = lines[i]
        line_no = i + 1

        if fence is not None:
            closing = _FENCE.match(raw)
            run = closing.group(1) if closing else None
            if run and run[0] == fence[0] and len(run) >= len(fence):
                fence = None
            i += 1
            continue

        line = ""
        rest = raw
        while True:
            if in_comment:
                close = rest.find("-->")
                if close == -1:
                    break
                rest = rest[close + 3 :]
                in_comment = False
                continue
            open_ = rest.find("<!--")
            if open_ == -1:
                line += rest
                break
            line += rest[:open_]
            rest = rest[open_ + 4 :]
            in_comment = True
        if line.strip() == "":
            i += 1
            continue

        fence_match = _FENCE.match(line)
        if fence_match:
            fence = fence_match.group(1)
            i += 1
            continue

        h2 = _H2.match(line)
        if h2:
            close_block()
            name = h2.group(1).strip().lower()
            section = _SECTIONS.get(name)
            state = section[0] if section else "other"
            section_kind = section[1] if section else "requirement"
            if section is None and "retired" in name:
                flag("retired-heading-spelling", line_no, h2.group(1).strip())
            i += 1
            continue

        requirement = _REQUIREMENT.match(line)
        story = _STORY.match(line)
        heading = requirement.group(1) if requirement else (story.group(1) if story else None)
        if heading is not None:
            close_block()
            heading_kind: EntryKind = "story" if story else "requirement"
            text = heading.strip()
            parts = text.split(None, 1)
            token = parts[0] if parts else ""
            title = _LEADING_DASH.sub("", text[len(token) :])

            if state in ("none", "other"):
                flag("orphan", line_no, text)
                i += 1
                continue
            if heading_kind != section_kind:
                flag("kind-section-mismatch", line_no, text)
                i += 1
                continue
            if not is_id(token, grammar):
                if scope_near_miss.match(token):
                    malformed.append(token)
                else:
                    flag("unidentified", line_no, text)
                i += 1
                continue
            declared = kind_of(token, grammar)
            if grammar == "sdd" and declared != heading_kind:
                flag("kind-id-mismatch", line_no, text)
                i += 1
                continue

            if state == "active" and _CLARIFICATION.search(text):
                flag("clarification", line_no, text[:90])

            current = _OpenBlock(
                lineNo=line_no,
                heading=text,
                kind=heading_kind,
                retired=(state == "retired"),
                entryIndex=len(entries),
            )
            entries.append(
                Entry(
                    id=token,
                    kind=heading_kind,
                    legacy="",
                    withdrawn=(state == "retired"),
                    proposed=(state == "proposed"),
                    stories=(),
                    lineNo=line_no,
                    title=title,
                )
            )
            i += 1
            continue

        if state == "active" and _CLARIFICATION.search(line):
            flag("clarification", line_no, line.strip()[:90])

        if current is None:
            i += 1
            continue

        scenario = _SCENARIO.match(line)
        if scenario:
            current.scenarios += 1
            if reg.requireScenarios:
                steps: list[str] = []
                j = i + 1
                while j < len(lines):
                    nxt = lines[j]
                    if _HEADING_DEPTH.match(nxt):
                        break
                    steps.append(nxt)
                    j += 1
                name = scenario.group(1).strip()
                if not any(_WHEN.match(s) for s in steps):
                    flag("scenario-no-when", line_no, name)
                if not any(_THEN.match(s) for s in steps):
                    flag("scenario-no-then", line_no, name)
            i += 1
            continue

        link = _STORY_LINK.match(line)
        if link:
            for token in re.split(r"[,\s]+", link.group(1)):
                sid = token.strip()
                if sid != "":
                    current.stories.append(sid)
            i += 1
            continue

        if current.retired and _RETIRED_RECORD.match(line):
            current.hasRecord = True
        i += 1

    close_block()
    return ParseResult(entries=tuple(entries), malformed=tuple(malformed), problems=tuple(problems))


def parse_register(source: str, reg: RegisterEntryConfig, grammar: IdGrammar) -> ParseResult:
    fmt = reg.format or "table"
    if fmt == "table":
        return parse_table_register(source, reg, grammar)
    if fmt == "sdd":
        return parse_spec_register(source, reg, grammar)
    return ParseResult(entries=(), malformed=(), problems=(), unknownFormat=fmt)


# =============================================================================================
# io.py
# =============================================================================================

_BINARY_SNIFF_BYTES = 8192


def make_reader(root: Path) -> Callable[[str], str | None]:
    cache: dict[str, str | None] = {}

    def read(path: str) -> str | None:
        if path in cache:
            return cache[path]
        text: str | None
        try:
            buf = (root / path).read_bytes()
            text = None if b"\x00" in buf[:_BINARY_SNIFF_BYTES] else buf.decode("utf-8", errors="replace")
        except OSError:
            text = None
        cache[path] = text
        return text

    return read


def _git(root: Path, args: Sequence[str]) -> str | None:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=root,
            capture_output=True,
            text=True,
        )
    except OSError:
        return None
    if result.returncode != 0:
        return None
    return result.stdout


def list_tracked_files(root: Path, search_roots: Sequence[str]) -> list[str]:
    out = _git(root, ["ls-files", "-z", "--", *(search_roots if search_roots else ["."])])
    if out is None:
        return []
    return [p for p in out.split("\0") if p != ""]


@dataclass(frozen=True)
class Revisions:
    base: str
    tip: str


def resolve_revisions(root: Path, trunk: str) -> Revisions | None:
    tip = _git(root, ["rev-parse", "--verify", f"{trunk}^{{commit}}"])
    tip = tip.strip() if tip else None
    if not tip:
        return None
    base = _git(root, ["merge-base", "HEAD", trunk])
    base = base.strip() if base else None
    if not base:
        return None
    return Revisions(base=base, tip=tip)


def make_revision_reader(root: Path, rev: str) -> Callable[[str], str | None]:
    def read(path: str) -> str | None:
        return _git(root, ["show", f"{rev}:{path}"])

    return read


# =============================================================================================
# permanence.py
# =============================================================================================

RevisionReader = Callable[[str], str | None]
Parser = Callable[[str, RegisterEntryConfig], ParseResult]
IdsByScope = Mapping[str, frozenset[str]]


def ids_by_scope(config_text: str, read_file: RevisionReader, parse: Parser) -> IdsByScope | None:
    out: dict[str, frozenset[str]] = {}
    try:
        parsed = tomllib.loads(config_text)
    except tomllib.TOMLDecodeError:
        return None
    registers = parsed.get("registers")
    if not isinstance(registers, list):
        return out
    for raw in registers:
        reg = normalise_register(raw)
        if reg is None:
            continue
        source = read_file(reg.file)
        if source is None:
            continue
        result = parse(source, reg)
        out[reg.scope] = frozenset(e.id for e in result.entries)
    return out


@dataclass(frozen=True)
class Dropped:
    droppedIds: tuple[str, ...]
    droppedScopes: tuple[str, ...]


def dropped_since(baseline: IdsByScope, current: IdsByScope) -> Dropped:
    dropped_ids: list[str] = []
    dropped_scopes: list[str] = []
    for scope, ids in baseline.items():
        now = current.get(scope)
        if now is None:
            dropped_scopes.append(scope)
            continue
        if len(ids) == 0:
            continue
        for id_ in ids:
            if id_ not in now:
                dropped_ids.append(id_)
    return Dropped(droppedIds=tuple(sorted(dropped_ids)), droppedScopes=tuple(sorted(dropped_scopes)))


def colliding_since(base: IdsByScope, trunk_tip: IdsByScope, current: IdsByScope) -> list[str]:
    collisions: list[str] = []
    for scope, ids in current.items():
        at_base = base.get(scope, frozenset())
        on_trunk = trunk_tip.get(scope, frozenset())
        for id_ in ids:
            if id_ in at_base:
                continue
            if id_ in on_trunk:
                collisions.append(id_)
    return sorted(collisions)


# =============================================================================================
# check.py
# =============================================================================================


@dataclass(frozen=True)
class Finding:
    check: str
    message: str
    detail: tuple[str, ...] = ()


@dataclass(frozen=True)
class DeclaredEntry(Entry):
    file: str = ""
    gated: bool = True


@dataclass(frozen=True)
class CheckStats:
    registers: int
    stories: int
    requirements: int
    gated: int
    covered: int


@dataclass(frozen=True)
class CheckReport:
    findings: tuple[Finding, ...]
    entries: tuple[DeclaredEntry, ...]
    stats: CheckStats


_PROBLEM_MESSAGES: dict[str, str] = {
    "orphan": "an entry sits outside any section this format understands",
    "unidentified": "an entry heading carries no identifier",
    "retired-no-record": "a retired entry has no dated `> Retired YYYY-MM-DD by …` record",
    "retired-heading-spelling": "a section heading nearly says Retired — every entry under it would be gated",
    "kind-section-mismatch": "an entry is filed under a section for the other kind",
    "kind-id-mismatch": "an entry's heading and its identifier disagree about kind",
    "clarification": "a live entry still carries an unresolved [NEEDS CLARIFICATION:] marker",
    "no-scenario": "a live requirement has no scenario, and this register requires one",
    "scenario-no-when": "a scenario has no **WHEN** step",
    "scenario-no-then": "a scenario has no **THEN** step",
}


class CheckDeps:
    def read_file(self, path: str) -> str | None:  # pragma: no cover - interface
        raise NotImplementedError

    def list_files(self) -> Sequence[str]:  # pragma: no cover - interface
        raise NotImplementedError


def check(config: SddConfig, deps: CheckDeps) -> CheckReport:
    findings: list[Finding] = []
    grammar = config.idGrammar

    def add(check_name: str, message: str, detail: Sequence[str] = ()) -> None:
        if len(detail) == 0 and message == "":
            return
        findings.append(Finding(check=check_name, message=message, detail=tuple(detail)))

    all_entries: list[DeclaredEntry] = []
    register_files: set[str] = set()
    owner_of_scope = {r.scope: r.file for r in config.registers}
    draft_scopes: set[str] = set()
    declared_by: dict[str, str] = {}
    reserved = set(config.reservedScopes)

    for reg in config.registers:
        if reg.scope in reserved:
            add("reserved-scope", f"scope {reg.scope} is reserved and cannot name a register", [reg.file])
        source = deps.read_file(reg.file)
        if source is None:
            add("missing-register", "a register declares a file that does not exist", [f"{reg.scope} → {reg.file}"])
            continue
        register_files.add(reg.file)
        parsed = parse_register(source, reg, grammar)

        if parsed.unknownFormat is not None:
            add("unknown-format", "a register declares a format this checker cannot read", [f"{reg.scope}: {parsed.unknownFormat}"])
            continue
        if len(parsed.malformed) > 0:
            add(
                "malformed-id",
                "entries open with a register's scope but are not identifiers — nothing gates them",
                [f"{reg.file}: {m}" for m in parsed.malformed],
            )
        for p in parsed.problems:
            add(f"spec.{p.kind}", _PROBLEM_MESSAGES.get(p.kind, f"a structural problem: {p.kind}"), [f"{reg.file}:{p.lineNo}: {p.text}"])
        if len(parsed.entries) == 0:
            add("empty-register", "a register parsed to zero entries", [f"{reg.scope} → {reg.file}"])

        if parsed.status == "Draft":
            draft_scopes.add(reg.scope)

        for entry in parsed.entries:
            if scope_of(entry.id) != reg.scope:
                add("foreign-id", "an identifier sits in a register that does not own its scope", [f"{reg.file}: {entry.id}"])
                continue
            already = declared_by.get(entry.id)
            if already is not None:
                add("duplicate-id", "an identifier is declared twice", [f"{entry.id}: {already}, {reg.file}"])
                continue
            declared_by[entry.id] = reg.file
            all_entries.append(DeclaredEntry(**{**entry.__dict__}, file=reg.file, gated=reg.gated))

    scopes = list(dict.fromkeys(r.scope for r in config.registers))
    pattern = reference_pattern(scopes, grammar)
    excluded = set(config.excludeFromScan)
    used_exclusions: set[str] = set()
    used_coverage_roots: set[str] = set()
    referenced_in: dict[str, set[str]] = {}
    covered_in: dict[str, set[str]] = {}

    def remember(m: dict[str, set[str]], id_: str, f: str) -> None:
        m.setdefault(id_, set()).add(f)

    if pattern is not None:
        for f in deps.list_files():
            if f in excluded:
                used_exclusions.add(f)
                continue
            text = deps.read_file(f)
            if text is None:
                continue
            coverage_excluded = False
            for root in config.coverageExcludeRoots:
                if f.startswith(root):
                    used_coverage_roots.add(root)
                    coverage_excluded = True
            for match in pattern.finditer(text):
                id_ = match.group(0)
                if owner_of_scope.get(scope_of(id_)) == f:
                    continue
                remember(referenced_in, id_, f)
                if f not in register_files and not coverage_excluded:
                    remember(covered_in, id_, f)

    known_debt = dict(config.knownDebt)
    live = [e for e in all_entries if not e.withdrawn and not e.proposed]
    gated = [e for e in live if e.gated and scope_of(e.id) not in draft_scopes]

    uncovered = [e for e in gated if e.id not in covered_in and e.id not in known_debt]
    if len(uncovered) > 0:
        add(
            "uncovered",
            "live identifiers that nothing outside the registers names — a promise no test keeps",
            [f"{e.id} ({e.file}:{e.lineNo}) {e.title}" for e in uncovered],
        )

    declared_ids = {e.id for e in all_entries}
    withdrawn_ids = {e.id for e in all_entries if e.withdrawn}
    stale_debt: list[str] = []
    for id_, reason in known_debt.items():
        if not isinstance(reason, str) or reason.strip() == "":
            add("debt-no-reason", "a carried debt entry has no written reason", [id_])
            continue
        if id_ not in declared_ids:
            stale_debt.append(f"{id_} — no register declares it")
        elif id_ in withdrawn_ids:
            stale_debt.append(f"{id_} — the entry is retired")
        elif id_ in covered_in:
            stale_debt.append(f"{id_} — it is covered now")
    if len(stale_debt) > 0:
        add("debt-stale", "carried debt that suppresses nothing — a dead exemption reads as a real one", stale_debt)

    dead_exclusions = [f for f in config.excludeFromScan if f not in used_exclusions]
    if len(dead_exclusions) > 0:
        add("dead-scan-exclusion", "a scan exclusion matches no tracked file", dead_exclusions)
    dead_coverage_roots = [r for r in config.coverageExcludeRoots if r not in used_coverage_roots]
    if len(dead_coverage_roots) > 0:
        add(
            "dead-coverage-root",
            "a coverage exclusion matches no tracked file (a missing trailing slash is the usual cause)",
            dead_coverage_roots,
        )

    stories = [e for e in all_entries if e.kind == "story"]
    requirements = [e for e in all_entries if e.kind == "requirement"]

    if grammar == "sdd":
        story_ids = {e.id for e in stories}
        served_stories: set[str] = set()
        orphan_requirements: list[str] = []
        dangling_links: list[str] = []

        for req in requirements:
            if req.withdrawn or req.proposed:
                continue
            if len(req.stories) == 0:
                orphan_requirements.append(f"{req.id} ({req.file}:{req.lineNo}) {req.title}")
                continue
            for id_ in req.stories:
                if id_ not in story_ids:
                    dangling_links.append(f"{req.id} → {id_}")
                else:
                    served_stories.add(id_)
        if len(orphan_requirements) > 0:
            add("requirement-no-story", "a live requirement serves no user story — behaviour nobody asked for", orphan_requirements)
        if len(dangling_links) > 0:
            add("dangling-story-link", "a requirement names a story that does not exist", dangling_links)
        empty_stories = [
            f"{s.id} ({s.file}:{s.lineNo}) {s.title}" for s in stories if not s.withdrawn and not s.proposed and s.id not in served_stories
        ]
        if len(empty_stories) > 0:
            add("story-no-requirement", "a live user story has no requirement beneath it — a promise with no behaviour", empty_stories)
    elif len(stories) > 0:
        add("story-under-compat-grammar", "stories are not representable under the catalyst grammar, yet some were parsed", [s.id for s in stories])

    dangling: list[str] = []
    for id_, files in referenced_in.items():
        if id_ in declared_ids:
            continue
        dangling.append(f"{id_} — named by {', '.join(sorted(files)[:3])}")
    if len(dangling) > 0:
        add("unknown-id", "something names an identifier no register declares", sorted(dangling))

    if pattern is None and len(config.registers) > 0:
        add("no-scopes", "registers are declared but no scope could be read from them", [])

    return CheckReport(
        findings=tuple(findings),
        entries=tuple(all_entries),
        stats=CheckStats(
            registers=len(config.registers),
            stories=len(stories),
            requirements=len(requirements),
            gated=len(gated),
            covered=len([e for e in gated if e.id in covered_in]),
        ),
    )


# =============================================================================================
# install.py + skills-io.py
# =============================================================================================

MANIFEST_NAME = ".sdd-manifest.json"


def managed_by(skills_dir: str, shipped: Sequence[str], prefix: str) -> Callable[[str], bool]:
    shipped_paths = {f"{skills_dir}/{name}/SKILL.md" for name in shipped}

    def is_managed(path: str) -> bool:
        if path in shipped_paths:
            return True
        rest = path[len(skills_dir) + 1 :] if path.startswith(f"{skills_dir}/") else ""
        return rest.startswith(prefix)

    return is_managed


def sha256_hex(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class SourceSkill:
    name: str
    content: str


@dataclass(frozen=True)
class ManifestEntry:
    path: str
    sha256: str


@dataclass(frozen=True)
class Manifest:
    version: str
    entries: tuple[ManifestEntry, ...]

    def to_json(self) -> str:
        return json.dumps(
            {"version": self.version, "entries": [{"path": e.path, "sha256": e.sha256} for e in self.entries]},
            indent=2,
        ) + "\n"


def plan_install(skills: Sequence[SourceSkill], skills_dir: str, version: str) -> tuple[tuple[ManifestEntry, ...], Manifest]:
    files = tuple(
        sorted(
            (ManifestEntry(path=f"{skills_dir}/{s.name}/SKILL.md", sha256=sha256_hex(s.content)) for s in skills),
            key=lambda e: e.path,
        )
    )
    return files, Manifest(version=version, entries=files)


DriftKind = Literal["edited", "missing", "stale", "unmanaged"]


@dataclass(frozen=True)
class Drift:
    kind: DriftKind
    path: str


def detect_drift(
    manifest: Manifest | None,
    on_disk: Mapping[str, str],
    expected: Sequence[ManifestEntry],
    is_managed: Callable[[str], bool],
) -> list[Drift]:
    drift: list[Drift] = []
    if manifest is None:
        return drift

    installed = {e.path: e.sha256 for e in manifest.entries}
    expected_by_path = {e.path: e.sha256 for e in expected}

    for path, sha in installed.items():
        current = on_disk.get(path)
        if current is None:
            drift.append(Drift(kind="missing", path=path))
            continue
        if sha256_hex(current) != sha:
            drift.append(Drift(kind="edited", path=path))
            continue
        if expected_by_path.get(path) != sha:
            drift.append(Drift(kind="stale", path=path))

    for path in expected_by_path:
        if path not in installed:
            drift.append(Drift(kind="stale", path=path))

    for path in on_disk:
        if not is_managed(path):
            continue
        if path not in installed and path not in expected_by_path:
            drift.append(Drift(kind="unmanaged", path=path))

    return sorted(drift, key=lambda d: d.path)


DRIFT_REMEDY: dict[DriftKind, str] = {
    "edited": "a vendored skill was hand-edited — move the change into sdd.config.toml, then re-install",
    "missing": "a vendored skill is gone — re-run install",
    "stale": "the kit ships a newer version of this skill — re-run install and review the diff",
    "unmanaged": "a skill here belongs to no manifest — usually a rename left behind; delete it",
}


def package_root() -> Path:
    """The directory this file lives in -- when running from a full cipher-sdd checkout, that
    directory also holds skills/ and templates/. Once vendored standalone into a consumer with
    no such siblings, read_packaged_skills() below returns an empty list, exactly like the TS
    reference does for the same situation."""
    return Path(__file__).resolve().parent


def package_version() -> str:
    try:
        return (package_root() / "VERSION").read_text(encoding="utf-8").strip() or "0.0.0"
    except OSError:
        return "0.0.0"


def read_packaged_skills() -> list[SourceSkill]:
    directory = package_root() / "skills"
    if not directory.is_dir():
        return []
    skills: list[SourceSkill] = []
    for name in sorted(p.name for p in directory.iterdir() if p.is_dir()):
        skill_file = directory / name / "SKILL.md"
        try:
            skills.append(SourceSkill(name=name, content=skill_file.read_text(encoding="utf-8")))
        except OSError:
            continue
    return skills


def read_packaged_templates() -> dict[str, str]:
    """Templates ship alongside the skills. Unlike the TS reference (which reads them live from
    node_modules, since npx always resolves the full package), a vendored Python consumer has no
    persistent package location -- so install copies these too, under templatesDir."""
    directory = package_root() / "templates"
    if not directory.is_dir():
        return {}
    out: dict[str, str] = {}
    for path in sorted(directory.rglob("*.md")):
        rel = path.relative_to(directory).as_posix()
        try:
            out[rel] = path.read_text(encoding="utf-8")
        except OSError:
            continue
    return out


def read_vendored_skills(root: Path, skills_dir: str) -> dict[str, str]:
    out: dict[str, str] = {}
    base = root / skills_dir
    if not base.is_dir():
        return out
    for name in (p.name for p in base.iterdir() if p.is_dir()):
        rel = f"{skills_dir}/{name}/SKILL.md"
        try:
            out[rel] = (root / rel).read_text(encoding="utf-8")
        except OSError:
            continue
    return out


def read_manifest(root: Path, skills_dir: str) -> Manifest | None:
    """Validated, not merely cast -- a manifest is a durable record written by one version of the
    kit and read by another. Checking only "is entries a list" let a list of bare strings through
    once, and the failure surfaced far away: every vendored skill reported as hand-edited, which
    reads as the user's fault rather than the file's."""
    try:
        raw = json.loads((root / skills_dir / MANIFEST_NAME).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    version = raw.get("version")
    entries_raw = raw.get("entries")
    if not isinstance(version, str) or not isinstance(entries_raw, list):
        return None
    entries: list[ManifestEntry] = []
    for e in entries_raw:
        if not isinstance(e, dict):
            return None
        path, sha = e.get("path"), e.get("sha256")
        if not isinstance(path, str) or not isinstance(sha, str):
            return None
        entries.append(ManifestEntry(path=path, sha256=sha))
    return Manifest(version=version, entries=tuple(entries))


def write_skills(root: Path, skills_dir: str, skills: Sequence[SourceSkill], manifest: Manifest) -> list[str]:
    written: list[str] = []
    for skill in skills:
        rel = f"{skills_dir}/{skill.name}/SKILL.md"
        abs_path = root / rel
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_text(skill.content, encoding="utf-8")
        written.append(rel)
    manifest_path = root / skills_dir / MANIFEST_NAME
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(manifest.to_json(), encoding="utf-8")
    written.append(f"{skills_dir}/{MANIFEST_NAME}")
    return written


def write_templates(root: Path, templates_dir: str, templates: Mapping[str, str]) -> list[str]:
    written: list[str] = []
    for rel_name, content in sorted(templates.items()):
        rel = f"{templates_dir}/{rel_name}"
        abs_path = root / rel
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_text(content, encoding="utf-8")
        written.append(rel)
    return written


# =============================================================================================
# main.py
# =============================================================================================

USAGE = """Usage: sdd <command>

  check [--json]   Verify every register: identifiers well formed, live ones named by
                   something outside the registers, ratchets alive, nothing dropped since
                   the trunk, and no vendored skill hand-edited.
  install          Vendor the kit's skills (and, this file, this core module, and the
                   templates) into this repo. Overwrites wholesale -- a vendored file is
                   generated, never hand-edited; customise the config.
"""


class _RealDeps(CheckDeps):
    def __init__(self, read_file: RevisionReader, files: Sequence[str]) -> None:
        self._read_file = read_file
        self._files = files

    def read_file(self, path: str) -> str | None:
        return self._read_file(path)

    def list_files(self) -> Sequence[str]:
        return self._files


def main(argv: Sequence[str]) -> int:
    command = argv[0] if len(argv) > 0 else None
    if command is None or command in ("--help", "-h"):
        sys.stdout.write(USAGE)
        return 1 if command is None else 0
    if command not in ("check", "install"):
        sys.stderr.write(f'sdd: unknown command "{command}"\n\n{USAGE}')
        return 2

    json_output = "--json" in argv

    try:
        loaded = load_config()
    except ConfigError as err:
        sys.stderr.write(f"sdd: {err}\n")
        return 2
    config, root, config_path = loaded.config, loaded.root, loaded.config_path

    if command == "install":
        skills = read_packaged_skills()
        if len(skills) == 0:
            sys.stderr.write("sdd: the package ships no skills to install\n")
            return 2
        _, manifest = plan_install(skills, config.skillsDir, package_version())
        written = write_skills(root, config.skillsDir, skills, manifest)

        this_dir = package_root()
        bootstrap = this_dir / "sdd.py"
        core = this_dir / "_sdd_core.py"
        core_dest_dir = root / config.coreDir
        for src in (bootstrap, core):
            if src.is_file():
                dest = core_dest_dir / src.name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
                if src.name == "sdd.py":
                    dest.chmod(0o755)
                written.append(str((Path(config.coreDir) / src.name).as_posix()))

        templates = read_packaged_templates()
        if templates:
            written.extend(write_templates(root, config.templatesDir, templates))

        sys.stdout.write(
            f"installed {len(skills)} skill(s) at v{manifest.version}\n"
            + "\n".join(f"  {w}" for w in written)
            + "\n\nCommit these: a vendored file in git is what makes the next upgrade a reviewable diff.\n"
        )
        return 0

    try:
        scopes_of(config)  # throws on a scope claimed twice, before anything is reported
    except ConfigError as err:
        sys.stderr.write(f"sdd: {err}\n")
        return 2

    read_file = make_reader(root)
    report = check(config, _RealDeps(read_file, list_tracked_files(root, config.searchRoots)))

    findings = list(report.findings)

    packaged = read_packaged_skills()
    if len(packaged) > 0:
        manifest = read_manifest(root, config.skillsDir)
        files, _ = plan_install(packaged, config.skillsDir, package_version())
        on_disk = read_vendored_skills(root, config.skillsDir)
        is_managed = managed_by(config.skillsDir, [s.name for s in packaged], config.skillPrefix)
        for d in detect_drift(manifest, on_disk, files, is_managed):
            findings.append(Finding(check=f"skill-{d.kind}", message=DRIFT_REMEDY[d.kind], detail=(d.path,)))

    revisions = resolve_revisions(root, config.trunk)
    if revisions is None:
        permanence_status = f"SKIPPED — could not resolve a merge base with {config.trunk}"
    else:
        config_relative = str(config_path.relative_to(root))

        def parse(source: str, reg: RegisterEntryConfig) -> ParseResult:
            return parse_register(source, reg, config.idGrammar)

        def at(rev: str) -> IdsByScope | None:
            read_at = make_revision_reader(root, rev)
            text = read_at(config_relative)
            return None if text is None else ids_by_scope(text, read_at, parse)

        base = at(revisions.base)
        tip = at(revisions.tip)
        current = ids_by_scope(read_file(config_relative) or "", read_file, parse)

        if base is None or current is None:
            permanence_status = "SKIPPED — a config revision could not be read"
        else:
            permanence_status = f"checked against {revisions.base[:8]}"
            dropped = dropped_since(base, current)
            if len(dropped.droppedScopes) > 0:
                findings.append(
                    Finding(
                        check="dropped-scope",
                        message="a register vanished since the trunk — the cheapest way to turn a red gate green",
                        detail=dropped.droppedScopes,
                    )
                )
            if len(dropped.droppedIds) > 0:
                findings.append(
                    Finding(
                        check="dropped-id",
                        message="identifiers vanished since the trunk; retire an entry, never delete it",
                        detail=dropped.droppedIds,
                    )
                )
            if tip is not None:
                collisions = colliding_since(base, tip, current)
                if len(collisions) > 0:
                    findings.append(
                        Finding(
                            check="colliding-id",
                            message="this branch and the trunk each allocated the same identifier",
                            detail=tuple(collisions),
                        )
                    )

    if json_output:
        payload = {
            "ok": len(findings) == 0,
            "findings": [{"check": f.check, "message": f.message, "detail": list(f.detail)} for f in findings],
            "stats": report.stats.__dict__,
            "permanence": permanence_status,
        }
        sys.stdout.write(json.dumps(payload, indent=2) + "\n")
        return 0 if len(findings) == 0 else 1

    for finding in findings:
        sys.stderr.write(f"\n✗ {finding.check}: {finding.message}\n")
        for line in finding.detail:
            sys.stderr.write(f"    {line}\n")

    stats = report.stats
    sys.stdout.write(
        f"\n{stats.registers} register(s) · {stats.stories} stor(ies) · {stats.requirements} requirement(s) · "
        f"{stats.covered}/{stats.gated} gated identifiers covered\npermanence: {permanence_status}\n"
    )

    if len(findings) > 0:
        sys.stderr.write(f"\n{len(findings)} check(s) failed.\n")
        return 1
    sys.stdout.write("all checks passed\n")
    return 0
