# <Change name>

> **Deleted at archive.** What and why, for the reviewer of *this* change — and the reasoning that
> got here. The decisions live on in the code and the spec; this file is the trail, and it stops
> being true as soon as someone revisits one of them.

## What

<One paragraph. The change, in the user's terms.>

## Why

<The problem. If the honest answer is "someone asked for it", say so and name the constraint that
makes it worth doing now.>

## Which sizing criteria this meets

<!-- Name them from sdd.config.toml's `sizing.criteria`. "None of them" is a valid answer — and it
     means this change should not have a change directory at all. Say so and stop. -->

## Affected services

<!-- By path, never by informal name: two people mean two different things by "the auth service". -->

## Out of scope

<What this change deliberately does not do, so a reviewer stops looking for it.>

## Decisions

<!--
Filled in during the technical design pass (plan.md / data-model.md / contracts/), not up front —
resolve every unknown as Decision / Rationale / Alternatives rejected. If `sdd-explore` ran, its
settled decisions are the seed of this section — copy them in rather than re-deriving them.
-->

### Decision: <the thing that was decided>

**Rationale**: <why this one, in terms of the constraints that actually applied>

**Alternatives considered**:

- **<the other option>** — <why it was rejected, specifically. "It was worse" is not a reason.>

<!--
Record the alternatives even when the choice was obvious. The next person to ask "why not X?" is the
reason this section exists, and an unrecorded rejection gets re-litigated every six months.
-->
