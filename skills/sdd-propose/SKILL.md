---
name: sdd-propose
description: Write the planning artifacts for a change that needs a full spec — user stories, requirements, technical plan, research and tasks. Use when the user wants to spec a new feature or capability, turn an idea or an exploration into a spec, plan a change that crosses a service boundary or adds a public surface, write the requirements for something before building it, or asks what the plan is for a piece of work not yet started.
---

# Propose a change

**Planning boundary.** The request that **selected or triggered** this skill authorises planning
only, even if it asks you to build or fix the thing. Do not edit product code. When the artifacts are
complete, present them and **stop** — do not begin implementing in the same response, even if the
original request asked for it. Wait for a new instruction, then `sdd-apply`.

**Confirm the tier first.** If `sdd-size` has not ruled Tier 2, run it. Most changes need none of
this.

Read `sdd.config.yaml` first: `context` carries the repo's own facts and `rules` its per-artifact
house rules. Both are advice injected by the repo, not enforcement — but they are the repo's advice,
so follow them unless they conflict with something the user has just decided.

## The artifacts, in order

Create `changes/<change-name>/` (kebab-case, derived from the request), then:

### 1. `proposal.md` — what and why

Name **which** sizing criteria this meets, name the affected services **by path**, and state what
this change is not doing.

### 2. `spec.md` — the delta. Behaviour only

Sections are `## ADDED Requirements`, `## MODIFIED Requirements`, `## REMOVED Requirements`, and the
same three for user stories. This is a *delta* against the living capability spec, not a copy of it.

**User stories** carry a priority, an independent test, and numbered acceptance scenarios:

```markdown
### User Story: SRC-S1 — Register a path pattern instead of one path per resource (P1)

**Why this priority**: without it the feature does not exist — every other story depends on it.

**Independent Test**: register a pattern containing a parameter segment and confirm it is accepted,
stored, and listed exactly as a literal path is today.

#### Scenario: a pattern with one parameter
- **GIVEN** a Source with no registered paths
- **WHEN** its owner registers `/api/users/{id}` with read access
- **THEN** the path is accepted and appears in the exposed-paths list
```

**Requirements** are one falsifiable MUST sentence each, with a `> Story:` line:

```markdown
### Requirement: SRC-R1 — MUST accept a whole-segment parameter
> Story: SRC-S1
```

Three rules decide what belongs here rather than in `plan.md`:

- **If a sentence cannot fail, it is design.** That is the whole test, and it is the thing authors
  most often get wrong.
- **Architecture belongs in `plan.md`.** A delta spec may only contain behaviour.
- **No implementation detail** — no language, framework, API or schema. Success criteria are
  measurable *and* technology-agnostic: "users see results instantly", never "the endpoint responds
  in under 200 ms".

Allocate ids by **reading** the living spec, never by counting headings — a retired entry still holds
its number. New requirements go under `## ADDED`, and reach the living spec's
`## Proposed Requirements` at sync: declared so tests may name them, not gated until the work lands.

### 3. Self-grade, up to three times

Check the delta against the quality checklist (`checklists/requirements.md` from the templates): no
implementation detail, testable and unambiguous requirements, measurable and technology-agnostic
success criteria, no unresolved markers, every requirement serving a story. Fix what fails and
re-grade. After three rounds, stop and report what still fails rather than looping.

### 4. Clarify what is genuinely ambiguous

At most five questions, **one at a time**, each with your recommended answer. Only ask where the
answer would change scope, observable behaviour, compatibility or acceptance criteria; assume the
rest and record the assumption. Write each answer into the spec **body** *and* append it to a
`## Clarifications` session log. If a clarification invalidates an earlier sentence, replace that
sentence — never leave the contradiction sitting beside its correction.

### 5. `plan.md`, `research.md`, `data-model.md`, `contracts/`

`plan.md` carries the technical context (language, dependencies, storage, testing, platform) and the
**constitution check — run it twice**: once before research, and again after the design is settled. A
violation means revising the plan, never reinterpreting the constitution; a violation that is
genuinely justified is recorded with its rejected alternative.

`research.md` resolves every unknown as **Decision / Rationale / Alternatives rejected**. If
`sdd-explore` ran, its settled decisions are the seed of this file.

`contracts/` only when the change exposes an external interface — an API, a CLI surface, a wire
format, a grammar. Skip it for purely internal work. Along with `data-model.md`, this is the one
technical artifact that **survives archive**, so write it as a statement of current truth rather than
a record of this change.

### 6. `tasks.md`

Grouped by user story in priority order, each task naming the requirement id it satisfies **and** a
file path. Include the task that promotes the proposed requirements once the tests exist, and the
task that runs the repo's own gate.

### 7. Analyse, read-only

Before presenting: every requirement covered by at least one task, every task mapped to a
requirement, no terminology drift between artifacts, no constitution conflict. Report findings —
do not silently fix them.

Then **stop**.
