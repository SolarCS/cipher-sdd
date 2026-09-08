# Data Model: <Capability>

> **Survives archive.** Unlike the rest of a change's technical set, this describes what is true now
> rather than how a past change was reasoned about — so it is promoted into the capability's own
> directory and maintained there.

## <Entity>

| Field | Type | Rules |
| --- | --- | --- |
| <name> | <type> | <validation, and which requirement demands it> |

**Relationships**: <what it points at, and what points at it>

**State transitions**: <if it has any — the states, and what moves it between them>

<!--
Only entities whose shape the behaviour depends on. A model that documents every field of every
record becomes a second, worse copy of the schema, and it will be wrong within a month.
-->
