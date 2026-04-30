---
name: friction
description: Capture a friction moment — when the operator is frustrated, repeatedly correcting the agent, or the agent is confidently wrong. Invoke with /friction to turn frustration into a harness improvement. This skill is user-invocable.
---

# Friction

Capture a friction moment so it doesn't happen again. This skill is for
those "no no no" moments — when you're repeatedly correcting the agent,
when the agent is confidently wrong, or when you don't understand why it's
doing what it's doing.

## When to invoke

The operator types `/friction` during or after a frustrating interaction.

## What to do

### Step 1: Ask what went wrong

Use AskUserQuestion to understand the friction:

1. **What happened?** — What did the agent keep doing wrong?
2. **What should it have known?** — What knowledge was missing that caused this?
3. **Where should the fix live?** — Is this a missing skill, a skill that needs updating, a convention gap, or a memory entry?

### Step 2: Diagnose the root cause

Classify the friction as one of:

| Root cause            | What it means                                             | Fix                                                                   |
| --------------------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| **Missing knowledge** | Agent didn't know a pattern, convention, or constraint    | Add to a skill or create a new one                                    |
| **Stale knowledge**   | Agent followed outdated guidance from a skill or memory   | Update the skill/memory                                               |
| **Ignored knowledge** | Skill exists but agent didn't follow it                   | Clarify the skill trigger description or make the rule more prominent |
| **Wrong approach**    | Agent picked a bad strategy (e.g. custom code vs library) | Add to design-principles anti-patterns                                |
| **Missing research**  | Agent guessed instead of searching docs/web               | Reinforce research-first in design-principles                         |

### Step 3: Write the fix

Based on the root cause:

- **If a skill needs updating:** Edit the skill directly (with operator approval).
- **If a new convention is needed:** Add it to `codebase-conventions` or create a new skill.
- **If it's a feedback pattern:** Write a memory file with type `feedback` and tag it:

```markdown
---
name: <descriptive name>
description: <one-line description>
type: feedback
tags: [friction]
---

<What the rule is>

**Why (friction context):** <What went wrong and why the operator was frustrated>

**How to apply:** <Specific guidance to prevent recurrence>
```

- **If a guard hook could prevent it:** Propose adding a check to
  `.claude/hooks/guard-destructive.sh` or a similar guard.

### Step 4: Confirm the fix

Read back the change to the operator. Ask: "Does this capture it? Anything to adjust?"

## Rules

- **Capture the pattern, not just the correction.** "Don't use X" is a correction. "Agents default to X because they don't know about Y — add Y to the local-dev skill" is a pattern.
- **Be specific about where the fix lives.** "Update a skill" is vague. "Add a section to design-principles about preferring keytar over disk-based token storage" is actionable.
- **Tag friction memories.** The harness review looks for `friction` tags to track whether friction patterns are decreasing over time.
- **Don't be defensive.** The agent made a mistake. Acknowledge it, fix the harness, move on.
