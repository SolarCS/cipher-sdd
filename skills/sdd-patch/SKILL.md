---
name: sdd-patch
description: Fold a small behaviour change straight into a living capability spec, with no change directory and no planning artifacts. Use when the user wants to add or amend one requirement on an existing capability, retire a requirement, record a small behaviour change in the spec, asks why a spec no longer matches the code, or needs to fix a failing `sdd check` run reporting an uncovered or dropped identifier.
---

# Patch a living spec

The tier that exists so a small change is neither over-processed nor invisible. No change directory,
no `plan.md`, no `tasks.md` — the requirement lands in the living spec and the same pull request
carries the test that names it.

**Confirm the interpreter first.** `sdd check`/`sdd install` need Python 3.11+. Check
`python3 --version`; if it's missing or older, propose the platform install command to the user
(`brew install python@3.13` on macOS, `apt install python3.13` on Debian/Ubuntu,
`winget install Python.Python.3.13` on Windows), get their confirmation, then run it yourself before
continuing — the script cannot install its own interpreter.

**Confirm the tier first.** This skill assumes `sdd-size` has ruled Tier 1. If it has not run, run
it: a change that meets a sizing criterion, exceeds `patchMaxRequirements`, or needs a new **user
story** is not a patch, and pretending otherwise is how the tier turns into a loophole.

## Steps

**1. Open the capability's `spec.md`** under `specRoot`. Read `## Requirements` *and*
`## Retired Requirements`.

**2. Allocate by reading, never by counting.** The next number is one past the highest that scope has
ever issued — a retired entry still holds its number. Counting the live headings hands out a number
that is already taken, and reusing a number silently redirects every existing reference to it. Run
`sdd check` if you want the allocation confirmed rather than assumed.

**3. Write the change.**

- **Adding** — a new `### Requirement: <ID> — <one MUST sentence>` under `## Requirements`, not
  `## Proposed Requirements`: it ships in this pull request, so it is current behaviour, not a plan.
  Give it a `> Story: <ID>` line naming the story it serves. Every requirement serves one; if none
  fits, that is the signal this is not a patch.
- **Amending** — edit the text, keep the id. Never renumber to match a reworded heading: the id is
  what a test names, and the heading is not.
- **Retiring** — move the whole block to `## Retired Requirements` and add
  `> Retired YYYY-MM-DD by <change>.` Never delete it. Deleting frees the number to be handed out
  again and erases what was promised.

**4. Write the test that names the id.** The checker goes red between step 3 and here, and that is
the intended rhythm — the requirement is a promise the moment it is written, and the red is what
makes the promise visible. The reverse order lets it be forgotten.

**5. Run `sdd check`, then the repo's own gate.** Both, in that order. `sdd check` proves the id is
named; only the repo's gate proves the code works.

## What this skill will not do

- **Add a user story.** Stop and route to `sdd-propose`.
- **Exceed the configured requirement budget.** Stop and route to `sdd-propose`. Say which limit was
  hit and why the change is larger than it looked.
- **Silence the checker.** A `knownDebt` entry is a written admission that a promise has no test, not
  a way to make a run green — and the checker fails a debt entry that suppresses nothing anyway.
