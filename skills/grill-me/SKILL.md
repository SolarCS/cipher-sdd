---
name: grill-me
description: A relentless interview to sharpen a plan or a design.
disable-model-invocation: true
---

Call the Skill tool with "sdd-explore".

<!--
A human entry point only, which is why model invocation is off. It exists so `/grill-me` occupies
the slash menu without competing with `sdd-explore` for the same intent — two skills matching one
request is non-deterministic, and the loser is silent.

The method lives in `sdd-explore` and must never be duplicated here. The cost of the alternative is
visible in the trial corpus: one workflow shipped as both a command and a skill, 145 lines each,
differing in three, kept in sync by hand.
-->
