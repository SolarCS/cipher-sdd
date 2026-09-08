# Tasks: <Change name>

> **Deleted at archive.** A worklist, not a record. Grouped by user story so each slice can be built
> and verified on its own.

## Phase 1 — Foundational

<!-- Only what every story below depends on. If nothing does, delete this phase. -->

- [ ] T001 <task> — `path/to/file.ts`

## Phase 2 — User Story <SCOPE>-S1 (P1)

**Goal**: <what works when this phase is done>
**Independent test**: <the story's own test line>

- [ ] T010 <task, naming the requirement it satisfies> — `path/to/file.ts` (<SCOPE>-R1)
- [ ] T011 <the test that names <SCOPE>-R1> — `path/to/file.test.ts`

<!--
Every task carries a file path AND the id it serves. A task with neither cannot be checked off
honestly, and a requirement with no task is a promise nobody scheduled.
-->

## Phase 3 — Close out

- [ ] T900 Promote this change's entries out of `## Proposed …` into the live sections
      <!-- After the tests exist: promotion is the moment coverage turns on. -->
- [ ] T901 Update the documentation this behaviour changes
- [ ] T910 `sdd check` passes
- [ ] T920 The repo's own gate passes — **the verification task; archive refuses without it**
