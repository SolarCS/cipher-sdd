---
name: sdd-archive
description: Fold a finished change into the living capability spec and clear away its planning artifacts. Use when the user says a change is done or shipped, wants to close it out, asks to sync a delta into the main spec, wants to tidy up after implementation, or asks why a shipped change still has a change directory.
---

# Archive a change

The step that makes a change permanent: its behaviour joins the living spec forever, and everything
written to *get* there is deleted.

**Confirm the interpreter first.** `sdd check`/`sdd install` need Python 3.11+. Check
`python3 --version`; if it's missing or older, propose the platform install command to the user
(`brew install python@3.13` on macOS, `apt install python3.13` on Debian/Ubuntu,
`winget install Python.Python.3.13` on Windows), get their confirmation, then run it yourself before
continuing — the script cannot install its own interpreter.

## Order matters, and each stop is deliberate

**1. Refuse if the work is not finished.** The repo's own gate not green → stop outright, no
override — that is the proof itself, not a task on a list. Any unchecked task in `tasks.md`, of any
kind → warn, list them, and proceed only if the user confirms. Do not archive on a promise.

**2. Sync the delta into the living spec** at `specRoot/<capability>/spec.md`. Merge intelligently —
adding a scenario to an existing requirement means adding the scenario, not recopying the
requirement.

**The register's declared `format` decides the shape, not the delta's.** Every requirement lives
under a `[[registers]]` entry in `sdd.config.toml`, and that entry's `format` — `"sdd"` (the
default) or `"table"` — is what the checker parses. Look it up before writing anything:

- **`format = "sdd"` (or unset):** carry the delta's own shape over verbatim — `#### Scenario:`
  heading, `- **GIVEN** / **WHEN** / **THEN**` bullets, unchanged. Do not rewrite these into a
  table or prose, even if it reads more compactly; that would be reformatting into a shape this
  register never declared.
- **`format = "table"`:** fold the delta's requirement into a new row matching the sibling rows'
  own columns exactly — same columns, same conventions this register already uses. The delta's
  GIVEN/WHEN/THEN stays in the delta (deleted at step 6); it was never the living spec's format for
  this register.
- **Register does not exist yet in `sdd.config.toml`** (this delta's `ADDED` section seeds a scope
  no register names): this is a real decision, not a default to infer by copying whatever a
  neighboring register happens to use. Ask the user which format this new register should declare,
  unless the repo's own `context`/`rules` in `sdd.config.toml` already states a convention — then
  follow that and say so in the report.

Once a register declares a format, every later sync into it keeps that format — a MODIFIED entry
doesn't get to flip its own register's shape mid-flight. Apply the delta's own sections:

| Delta section | What happens in the living spec |
| --- | --- |
| `## ADDED` | new blocks, under `## Proposed Requirements` / `## Proposed User Stories` |
| `## MODIFIED` | edit in place, **keeping the id** |
| `## REMOVED` | move the block to `## Retired …` with `> Retired YYYY-MM-DD by <change>.` |

**Never delete a block and never delete a registered `spec.md`.** The number must never be handed out
again, and the record of what was promised is exactly what an audit asks for. Retirement is not
deletion.

**3. Promote.** Move this change's entries out of `## Proposed …` into `## Requirements` /
`## User Stories`. **Coverage turns on at this moment**, so run `sdd check` immediately afterwards —
a promoted requirement that no test names now fails, and that is the point of promoting last.

**4. Verify the sync landed before moving anything.** Re-read the living spec and confirm every
ADDED entry is present, every MODIFIED one carries its change with its other scenarios intact, and
every REMOVED one is retired — **including that each landed in the register's own declared
`format`**, not silently drifted into the other one. On any mismatch: stop. Move nothing. The
change directory is still intact, so the user can fix it and run the archive again — which is only
true if you have not already deleted it.

**5. Promote the durable technical artifacts.** Move `contracts/` and `data-model.md` into
`specRoot/<capability>/`. These describe current truth rather than a past decision, so they stay
testable and stay honest.

**6. Delete the rest.** `intent.md`, `plan.md`, `tasks.md`, the delta `spec.md`, and then the change
directory itself.

This is the deliberate divergence from every other kit, so it is worth stating plainly to the user
the first time: a `plan.md` describing how something was built in September is *wrong* by November,
and a wrong document that reads as current is worse than no document at all. Git history holds it
with better provenance than an archive folder ever could. What survives is what stays true — the
behaviour, and the interfaces.

**7. Run `sdd check` and the repo's gate.** In that order.

## Report

Say what was synced, what was promoted, what was retired, and what was deleted. If anything was
skipped, say which and why — an archive that quietly did four of its six steps is the one outcome
nobody can detect later.
