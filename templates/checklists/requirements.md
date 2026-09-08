# Specification Quality Checklist: <Change name>

> Unit tests for the spec's English. Self-graded up to three times, then reported as-is rather than
> looped on. Leave every unchecked item unchecked — an unchecked box is the finding.

## Content quality

- [ ] No implementation detail — no language, framework, API, schema or library
- [ ] Written so someone who will not build it can still say whether it is right
- [ ] Every mandatory section present, and sections that do not apply removed rather than left empty

## Requirement completeness

- [ ] Every requirement is one MUST sentence that could fail — nothing that cannot be falsified
- [ ] Every requirement names the story it serves
- [ ] Every story has at least one requirement beneath it
- [ ] No `[NEEDS CLARIFICATION: …]` marker survives into a live section
- [ ] Acceptance scenarios have a WHEN and a THEN, and describe observable outcomes

## Success criteria

- [ ] Measurable
- [ ] Technology-agnostic — "users see results instantly", not "responds in under 200 ms"

## Identifiers

- [ ] Allocated by reading the living spec, not by counting its headings
- [ ] No existing id renumbered, reused, or changed to match a reworded heading
- [ ] Anything removed is retired with a dated record, never deleted

## Notes

<!-- What failed, and what was decided about it. An item left unchecked with no note is unfinished
     work, not a judgement call. -->
