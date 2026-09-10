# `sdd` — a portable spec-driven-development kit

> **Status:** Repository state. The checker, the skills and the templates exist and are tested.

Spec-driven development that answers *"does this even need a spec?"* first, keeps the functional
spec separate from the technical plan, and deletes the technical plan when the change ships.

## What it is

Plain Python, not an npm package: the whole checker is two files, vendored straight into the
consuming repo rather than resolved from a registry — no `node_modules`, no publish step, works the
same whether `cipher-sdd` is public, private, or reachable at all after the first install.

| Part | Ships as | Why |
| --- | --- | --- |
| `sdd.py` | **vendored** — copied verbatim, executable | the entry point; a syntax subset valid under Python 2.6+ *and* 3, so it parses (and fails cleanly) under whatever interpreter reaches it |
| `_sdd_core.py` | **vendored** alongside `sdd.py` | the actual checker/installer; only ever imported after `sdd.py` has confirmed Python 3.11+, so it's free to use modern syntax |
| `skills/` | **vendored** into each repo | an agent discovers skills from the filesystem, never by resolving a module |
| `templates/` | **vendored**, as `sdd-templates/` | unlike an npm dependency, a vendored Python script has no persistent package location to read these from later |
| `sdd.config.toml` | written once per repo | the only file a consumer edits |

Bootstrapping (the one operation that genuinely needs access to this repo — see below), from
inside the consuming repo:

```bash
sh -c 'd=$(mktemp -d) && git clone --depth 1 -q https://github.com/SolarCS/cipher-sdd "$d" && python3 "$d/sdd.py" install; rm -rf "$d"'
```

`cipher-sdd` is a **private** repo, which is why this is `git clone`, not `curl`: anyone who can
already reach it (the audience this one-liner is for) has that access through whatever credential
already lets them clone any other private repo here — an SSH key, a cached HTTPS credential — with
nothing extra to mint. `curl` to `raw.githubusercontent.com` doesn't get that for free; it would need
a token handed to every installer, which defeats the point of a one-liner.

[`install.sh`](install.sh) is the same three steps as a named, reviewable script instead of a
one-liner to paste — run it directly if you already have a clone (`./install.sh`, from inside this
repo, vendors here) or copy it somewhere and point it at one.

From then on, everything runs from the consumer's own copy, with zero access to this repo:

```bash
./sdd.py check          # or: python3 sdd.py check
./sdd.py check --json
```

Commit what `install` writes: a vendored file in git is what makes the next upgrade a reviewable
diff, and `sdd check` fails on one that's been hand-edited since.

## Only `install`, not `check`, needs this repo

That split is deliberate, not incidental. `sdd check` reads nothing but `sdd.config.toml` and the
consumer's own tracked files — after one `install`, it never needs to reach `cipher-sdd` again, even
if this repo becomes unreachable, private, or moves. `install`/upgrading is different: getting a
*newer* version inherently means going back to wherever that newer version lives, in this model or
any other. What moved with the Python port is which command needs ongoing access — `check`, the one
that actually runs on every `sdd-apply`/`sdd-archive` pass, now needs none.

## Python version

Needs **3.11+** (for `tomllib`, stdlib since that version — no PyYAML, no dependency at all).
`sdd.py` checks this itself and fails with a clear message rather than a raw traceback, however old
or absent the interpreter reaching it is:

- No Python 3 at all (an actual Python 2, or nothing on `PATH`) → `sdd.py` is deliberately written in
  a subset valid under both, so it still parses and prints "run it explicitly with python3" rather
  than crashing on a syntax error.
- A real but too-old Python 3 (3.9, common as macOS's default Xcode Command Line Tools Python) → a
  clean version-floor message with the install command for the platform.

The `sdd-apply`/`sdd-archive`/`sdd-patch` skills carry this as an explicit first step: confirm the
interpreter, and if it's missing or too old, propose the platform install command, get the user's
confirmation, then run it — never silently.

## The model

Two tiers of document, and only one of them is permanent:

```
specs/<capability>/spec.md        LIVING · functional · never deleted, never renumbered
specs/<capability>/contracts/     LIVING · technical but durable — survives archive
specs/<capability>/data-model.md  LIVING · technical but durable — survives archive

changes/<name>/spec.md            EPHEMERAL delta: ADDED / MODIFIED / REMOVED
changes/<name>/{proposal,plan,research,tasks}.md   EPHEMERAL — deleted at archive
```

A change's *behaviour* is merged into the living spec and kept forever. Its *plan* is deleted,
because a document describing how something was built in September is wrong by November, and a wrong
document that reads as current is worse than none — git history holds it with better provenance than
an archive folder. Contracts and the data model survive because they state what is true now.

## Three tiers of process

The sizing gate runs first and is allowed to answer "none":

- **Tier 0** — no artifacts. A bug fix, a refactor, a dependency bump. The gate still checks the
  change would not falsify an existing requirement.
- **Tier 1** — a patch: one requirement folded straight into the living spec, no change directory.
  The tier neither Spec Kit nor OpenSpec has, and the reason a small change is neither
  over-processed nor invisible.
- **Tier 2** — the full set of planning artifacts, then apply, then archive.

## Identifiers

`SCOPE-Kn`, where the kind letter is `S` for a user story and `R` for a requirement — `SRC-S1`,
`SRC-R7`. One scope per capability holding two number spaces that cannot collide. A kind letter is
legitimate inside an id precisely because kind is **immutable**; the rule an id standard exists to
enforce is that nothing *mutable* — severity, priority, status — goes in one.

Repos with an installed base run `idGrammar = "catalyst"`, which is the plain `SCOPE-n` form. Stories
are not representable under it, and the checker will not invent a spelling for one.

The checker proves an id is **named** by something outside the registers. It cannot prove the naming
test asserts anything — `it("… (SRC-R7)", () => {})` passes. That half needs a reader, which is why
a green run is evidence and not proof.

## Skills

Intent-fired: the `description` frontmatter is the entire mechanism by which an agent decides to use
one, so each enumerates the phrasings that should match it. `grill-me` is a human-only entry point
(`disable-model-invocation: true`) that delegates to `sdd-explore` rather than duplicating it.

| Skill | Fires on |
| --- | --- |
| `sdd-explore` | thinking a problem through before anything is written |
| `sdd-size` | *does this need a spec at all?* |
| `sdd-patch` | one small requirement on an existing capability |
| `sdd-propose` | the full planning set for a Tier 2 change |
| `sdd-apply` | implementing a proposed change |
| `sdd-archive` | folding a finished change into the living spec |

Vendored skills are **generated, never hand-edited**: `sdd check` fails on a modified copy, because
a hand-edited vendored file is an unupgradeable one. Customisation goes in `sdd.config.toml`; if the
config cannot express it, that is a gap in the kit worth filing rather than a patch worth applying.

`sdd-apply`, `sdd-archive` and `sdd-patch` — the three that actually invoke `sdd check`/`sdd
install` — each open with a Python-interpreter prerequisite step before anything else, per
[Python version](#python-version) above.

## Configuration

`sdd.config.toml` is the only file a consumer edits. The keys that most often need setting:

| Key | Default | What it decides |
| --- | --- | --- |
| `idGrammar` | `"sdd"` | `sdd` for `SCOPE-Kn`, `catalyst` for the plain `SCOPE-n` of a repo with an installed base |
| `specRoot` / `changesRoot` | `"specs"` / `"changes"` | where living specs and in-flight changes live |
| `searchRoots` | `[]` | path prefixes scanned for references to identifiers |
| `coverageExcludeRoots` | `[]` | prefixes that contribute references but never coverage — a document that cites requirements to explain them |
| `excludeFromScan` | `[]` | whole files whose example identifiers are documentation |
| `registers` | `[]` | scope → document, its format, and whether it is gated (`[[registers]]` array-of-tables) |
| `knownDebt` | `{}` | identifier → written reason; itself ratcheted, so a key suppressing nothing fails |
| `patchMaxRequirements` | `3` | above this, a Tier 1 patch is not a patch |
| `trunk` | `"origin/main"` | what permanence compares against, via a merge base |
| `skillsDir` | `".cursor/skills"` | where skills are vendored — the directory the agent actually reads |
| `skillPrefix` | `"sdd-"` | which vendored names the kit may speak about, so a consumer's own skills in the same directory are never claimed as the kit's litter |

`context`, `gate`, `sizing` and `rules` are **prompt-level**: advice injected into a workflow when an
agent runs it, never enforcement. `gate` in particular is prose describing how *this* repo proves
itself — e.g. `gate = "exe/test is the bar. Run it before reporting a change complete."` — that
`sdd-apply` reads and acts on. A repo's real gate is its own test command, and a kit that pretends
otherwise teaches people to trust a check that was never run; nothing here shells out to it
automatically.

## Development

```bash
python3 -m venv .venv && .venv/bin/pip install pytest
.venv/bin/python -m pytest tests/
```

Tests aren't vendored — they exist only in this repo, exercised against `_sdd_core.py` directly.
