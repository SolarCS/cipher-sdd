---
name: sdd-apply
description: Implement the tasks of a proposed change, keeping the tests tied to the identifiers they prove. Use when the user wants to start or continue implementing a change that already has planning artifacts, work through its task list, pick up where the last session stopped, or asks what is left to do on a change in flight.
---

# Apply a change

Turn `changes/<change-name>/tasks.md` into code. The planning artifacts are the instruction; this
skill does not renegotiate them.

## Steps

**1. Read the change.** `tasks.md` for the work, `spec.md` for what is being promised, `plan.md` for
how it was decided to build it. If a task is ambiguous, read the artifact it cites rather than
guessing.

**2. Work in dependency order.** Mark each task done as it completes, not in a batch at the end — a
task list that is accurate only at the end is a task list nobody can resume from.

**3. Name the id in the test that proves it.** Put it in the test's title:

```ts
it("accepts a whole-segment parameter (SRC-R1)", async () => { … });
describe("SRC-S1 — registering a path pattern", () => { … });
```

A story is proved by an **acceptance or integration** test — the one its `Independent Test` line
describes. A requirement may be proved by any test. Use a `describe` when the whole block belongs to
the id and an `it` when one case does.

**4. Verify the work, not just the code.** Two checks, both required, in this order. Code written is
not a task done.

1. `sdd check` — proves every id you named resolves and nothing you touched broke coverage.
   Necessary, not sufficient: it proves an id is *named*, never that the naming test asserts
   anything.
2. Read `sdd.config.yaml`'s `gate` field for how this repo proves itself, and run it. Get it green
   before reporting the change complete.

## When the plan turns out to be wrong

It happens, and the honest move is not to quietly diverge:

- **A requirement is unimplementable as written** → stop, say so, and amend the delta spec. The
  artifacts are meant to be revised while the work is in flight; a spec that gets silently overtaken
  by its own implementation is worse than none.
- **The work needs a requirement nobody wrote** → add it to the delta under `## ADDED`, allocate its
  id by reading, and give it a `> Story:` line. Do not smuggle behaviour in with no promise attached.
- **The change turns out to be much larger** → say so before building it, not after.

## What this skill will not do

- **Lower a coverage floor, weaken an assertion, or add a suppression to make a run pass.** If a gate
  is red, either the code or the promise is wrong. Both are fixable; hiding the signal is not.
- **Archive.** Finishing the tasks is not the end of the change — `sdd-archive` folds the delta into
  the living spec and turns coverage on. Route there once the gate is green.
