---
name: plan
description: Plan a spec end to end in one session — read the context, refine the request with the user, ask once whether to write the spec, write it into the prepared folder and validate it. Normally started by `specrun plan -n <name>` as `/specrun:plan <spec>`. Use when the user asks to "plan a spec", "plan this feature as a spec", "naplánuj spec", "připrav spec".
---

# Plan

The fixed planning sequence: context → refine → gate → write → validate. The user no longer
types refine and write-spec one after another. Normally `specrun plan -n <name>` starts this
session with the context file in the system prompt (spec name and folder, `new` or its existing
files, `specsDir`, the request in `<request>` tags or "ask the user").

**Started by hand** (no spec context in the system prompt): tell the user that this session isn't
logged — no planning tokens in `specrun stats` — and that `specrun plan -n <name>` does it
properly. Continue only if they still want it.

Never commit unless the user asks. The phases refer to the other skills; follow them, don't
restate their rules.

## 1. Context

Read the specrun context from the system prompt. `CLAUDE.md` is already loaded. Read only the
code and docs the request touches. If the folder has files, they are the state to continue from.
If the context names a **Feature map**, read its README first, then only the docs of the
features the request touches (format: **feature-map** skill). "No feature map" → skip this.
Without a `<request>`, ask the user what to plan.

## 2. Refine

Follow the **refine** skill. Before the questions, walk this checklist and mark each item
**resolved**, **defaulted** (list it in the summary) or **not applicable**:

- scope and roles
- data model and migration
- permissions and security
- edge cases and legacy data
- UI states and user-visible texts
- tests and verify
- docs to update
- feature map impact (features touched, new features) — only with a map
- out of scope

## 3. Gate

Ask one `AskUserQuestion`: **"Write the spec now?"** with the options **Write the spec
(Recommended)** and **More questions**. More questions → back to phase 2, then ask again.

## 4. Write

Follow the **write-spec** skill into the folder from the context, exactly as given: write the
spec into that folder, don't compute a new number or rename it.

## 5. Validate

Run `specrun status <spec>` until the spec loads cleanly; fix the files it reports.

## Final message

As in write-spec §8: the folder, the task list, how the work was cut, defaults and open
decisions, and `specrun run <spec>`. Remind the user that the spec is not committed yet.
