# `sdd` — a portable spec-driven-development kit

> **Status:** Repository state. The checker, the skills and the templates exist and are tested;
> adoption in this repo is a separate change.

Spec-driven development that answers *"does this even need a spec?"* first, keeps the functional
spec separate from the technical plan, and deletes the technical plan when the change ships.

## What it is

| Part | Ships as | Why |
| --- | --- | --- |
| `sdd` CLI + checker | a dependency | ordinary code; never copied into a consumer |
| `templates/` | a dependency | read from the package, never copied |
| `skills/` | **vendored** into each repo | an agent discovers skills from the filesystem, not from `node_modules` |
| `sdd.config.yaml` | written once per repo | the only file a consumer edits |

```bash
npx sdd install     # vendor the skills into this repo; commit the result
npx sdd check       # gate: identifiers, coverage, ratchets, permanence, skill drift
```

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

Repos with an installed base run `idGrammar: catalyst`, which is the plain `SCOPE-n` form. Stories
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
a hand-edited vendored file is an unupgradeable one. Customisation goes in `sdd.config.yaml`; if the
config cannot express it, that is a gap in the kit worth filing rather than a patch worth applying.

## Configuration

`sdd.config.yaml` is the only file a consumer edits. The keys that most often need setting:

| Key | Default | What it decides |
| --- | --- | --- |
| `idGrammar` | `sdd` | `sdd` for `SCOPE-Kn`, `catalyst` for the plain `SCOPE-n` of a repo with an installed base |
| `specRoot` / `changesRoot` | `specs` / `changes` | where living specs and in-flight changes live |
| `searchRoots` | `[]` | path prefixes scanned for references to identifiers |
| `coverageExcludeRoots` | `[]` | prefixes that contribute references but never coverage — a document that cites requirements to explain them |
| `excludeFromScan` | `[]` | whole files whose example identifiers are documentation |
| `registers` | `[]` | scope → document, its format, and whether it is gated |
| `knownDebt` | `{}` | identifier → written reason; itself ratcheted, so a key suppressing nothing fails |
| `patchMaxRequirements` | `3` | above this, a Tier 1 patch is not a patch |
| `trunk` | `origin/main` | what permanence compares against, via a merge base |
| `skillsDir` | `.cursor/skills` | where skills are vendored — the directory the agent actually reads |
| `skillPrefix` | `sdd-` | which vendored names the kit may speak about, so a consumer's own skills in the same directory are never claimed as the kit's litter |

`context`, `sizing` and `rules` are **prompt-level**: advice injected into a workflow when an agent
runs it, never enforcement. A repo's real gate is its own test command, and a kit that pretends
otherwise teaches people to trust a check that was never run.
