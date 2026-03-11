# Skill Template

Template for creating skills extracted from learnings. Copy and customize.

---

## SKILL.md Template

```markdown
---
name: skill-name-here
displayName: Skill Display Name
description: "Concise description of when and why to use this skill. Include trigger conditions."
---

# Skill Name

Brief introduction explaining the problem this skill solves and its origin.

## Quick Reference

| Situation | Action |
|-----------|--------|
| [Trigger 1] | [Action 1] |
| [Trigger 2] | [Action 2] |

## Background

Why this knowledge matters. What problems it prevents.

## Solution

### Step-by-Step

1. First step with code or command
2. Second step
3. Verification step

### Code Example

\`\`\`language
// Example code demonstrating the solution
\`\`\`

## Gotchas

- Warning or common mistake #1
- Warning or common mistake #2

## Source

Extracted from learning entry.
- **Learning ID**: LRN-YYYYMMDD-XXX
- **Original Category**: correction | insight | knowledge_gap | best_practice
- **Extraction Date**: YYYY-MM-DD
```

---

## Minimal Template

For simple skills that don't need all sections:

```markdown
---
name: skill-name-here
displayName: Display Name
description: "What this skill does and when to use it."
---

# Skill Name

[Problem statement in one sentence]

## Solution

[Direct solution with code/commands]

## Source

- Learning ID: LRN-YYYYMMDD-XXX
```

---

## Naming Conventions

- **Skill name**: lowercase, hyphens for spaces (must match directory name)
  - Good: `docker-m1-fixes`, `api-timeout-patterns`
  - Bad: `Docker_M1_Fixes`, `APITimeoutPatterns`

- **displayName**: Human-readable name for UI display (Chinese recommended for Genvis)

- **Description**: Start with action verb, mention trigger
  - Good: "Handles Docker build failures on Apple Silicon. Use when builds fail with platform mismatch."
  - Bad: "Docker stuff"

---

## Extraction Checklist

Before creating a skill from a learning:

- [ ] Solution is tested and working
- [ ] Description is clear without original context
- [ ] Code examples are self-contained
- [ ] No project-specific hardcoded values
- [ ] Follows skill naming conventions (lowercase, hyphens)
- [ ] `name` field matches directory name

After creating:

- [ ] Update original learning with `promoted_to_skill` status
- [ ] Add `Skill-Path: skills/skill-name` to learning metadata
- [ ] Verify skill loads correctly in Genvis
