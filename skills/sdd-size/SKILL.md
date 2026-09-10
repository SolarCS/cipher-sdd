---
name: sdd-size
description: Decide whether a change needs a spec at all, and route it to the right amount of process. Use when the user asks whether something needs a spec, whether to write one, how much process a change deserves, wants to start a new feature or capability, is about to change behaviour an existing spec describes, or when you are about to reach for sdd-propose or sdd-patch and have not yet asked this question.
---

# The sizing gate

**This is the first question, and the answer is often no.** An unnecessary spec is pure review cost.
It is also the most common complaint about working this way, so the gate exists to answer *no*
quickly and without ceremony.

Read `sdd.config.toml` for this repo's `sizing.criteria` and `context`. The criteria are the repo's,
not yours — never substitute a remembered list for the one the config declares.

## Ask, in order

**1. Does the change meet any of the repo's sizing criteria?** State which, by name. *"None of them"*
is a valid and common answer.

**2. Would it make any existing requirement untrue?** Search the living specs under `specRoot` for
the capability being touched. This is the step a "no spec needed" ruling most often gets wrong:
shipping a change that quietly falsifies a shipped requirement is the one failure the coverage gate
cannot catch, because it proves an id is *named*, never that the claim is still true.

**3. How many requirements would it add or change, and does it need a new user story?** The threshold
is `patchMaxRequirements` in the config. A change that needs a new **story** is never a patch,
whatever its size — a story is the unit of user-visible value.

## Route

| Answer | Tier | What happens |
| --- | --- | --- |
| No criteria, nothing falsified | **0** | No artifacts. Say "no spec needed", stop deliberating, and go and write the code. |
| No criteria, but an existing requirement changes | **1** | `sdd-patch` — edit the living spec directly, no change directory. |
| One or more criteria met | **2** | `sdd-propose` — the full set of planning artifacts. |
| The shape is still too vague to answer | — | `sdd-explore` first. Come back to this gate afterwards. |

## Rules of engagement

- **The engineer may overrule you, and that ends it.** If they say skip the spec, skip it and get on
  with the change. Do not argue, and do not quietly write one anyway.
- **Ask once.** If a large change arrives with no spec, raise it a single time, take the answer, move
  on.
- **Nothing here blocks a commit.** The gate is a default, not a gate in the CI sense; `sdd check`
  only ever checks the specs that exist. Say so if the user seems to think otherwise.
- **Answering "no" is a result.** Report it as a decision with its reason, not as a failure to help.
