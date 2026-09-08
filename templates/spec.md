# <Capability> Specification

> **Status:** Living. This document is never deleted and its identifiers are never renumbered.

<One paragraph: what this capability is for, and who it serves.>

## User Stories

<!--
One block per story. The id's `S` is what makes it a story; the section it sits under is what makes
it live. Priority drives implementation order and the MVP slice.
-->

### User Story: <SCOPE>-S1 — <what someone can now do> (P1)

**Why this priority**: <what does not work at all without this>

**Independent Test**: <how someone confirms this story alone works, end to end>

#### Scenario: <the ordinary case>

- **GIVEN** <starting state>
- **WHEN** <the action>
- **THEN** <the observable outcome>

## Requirements

<!--
One falsifiable MUST sentence per block. If a sentence cannot fail, it is design — move it to the
change's plan.md, which is deleted at archive precisely because design ages and behaviour does not.

Every requirement names the story it serves. A requirement serving none is behaviour nobody asked
for, and the checker says so.
-->

### Requirement: <SCOPE>-R1 — <subject> MUST <observable behaviour>

> Story: <SCOPE>-S1

#### Scenario: <the case that would fail if this were broken>

- **GIVEN** <…>
- **WHEN** <…>
- **THEN** <…>

## Key Entities

<!-- Terms this capability's behaviour depends on. Only the ones a reader would otherwise guess at. -->

## Success Criteria

<!--
Measurable AND technology-agnostic. "Users see results instantly", never "the endpoint responds in
under 200 ms" — the second one is a plan, and it will be wrong before the behaviour is.
-->

## Assumptions

## Clarifications

<!-- Append-only. Each session's questions and the answers that were folded into the body above. -->

## Retired Requirements

<!--
Never delete a block; move it here with a dated record. The number is retired with it and is never
handed out again, because reusing one silently redirects every reference that already exists.

### Requirement: <SCOPE>-R0 — <what it used to promise>
> Retired YYYY-MM-DD by <change-name>.
-->
