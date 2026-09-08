# <Change name> — spec delta

> A **delta** against `specs/<capability>/spec.md`, not a copy of it. Only what this change alters.
> Behaviour only: if a sentence cannot fail, it belongs in `plan.md`.

## ADDED User Stories

### User Story: <SCOPE>-S<n> — <what someone can now do> (P1)

**Why this priority**: <…>

**Independent Test**: <…>

#### Scenario: <…>

- **GIVEN** <…>
- **WHEN** <…>
- **THEN** <…>

## ADDED Requirements

<!-- Allocate by READING the living spec, never by counting its headings: a retired entry still
     holds its number. These land under `## Proposed Requirements` at sync, and are gated only once
     promoted at archive — which is what lets tests name them before the work lands. -->

### Requirement: <SCOPE>-R<n> — <subject> MUST <observable behaviour>

> Story: <SCOPE>-S<n>

#### Scenario: <…>

- **GIVEN** <…>
- **WHEN** <…>
- **THEN** <…>

## MODIFIED Requirements

<!-- Keep the id. Never renumber to match a reworded heading — the id is what a test names. State
     the whole requirement as it should now read, so the merge is unambiguous. -->

## REMOVED Requirements

<!-- Retired, not deleted. At archive each block moves to `## Retired Requirements` in the living
     spec with a dated record. Name the id and say what replaces it, if anything. -->
