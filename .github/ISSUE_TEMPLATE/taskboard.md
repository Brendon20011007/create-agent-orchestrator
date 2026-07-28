---
name: Taskboard item
about: Plan and track a feature, bug, or independently deliverable task
title: "[Task]: "
labels: []
assignees: []
---

## Summary

<!-- Describe the requested outcome clearly. -->

## User Value

<!-- Who benefits, what problem is solved, and why does it matter? -->

## Requirements

- [ ] Requirement 1
- [ ] Requirement 2

## Acceptance Criteria

- [ ] Criterion 1 is observable and testable.
- [ ] Criterion 2 is observable and testable.

## Out of Scope

<!-- List related work this issue must not include. -->

## Dependencies and Risks

<!-- Link blockers and note migrations, security concerns, compatibility risks, or external dependencies. -->

## Milestone

<!-- Link the matching milestone. Search before creating a new one. -->

## Ownership and Agent Needs

- Main Agent:
- Expertise needed:
- User confirmed specialist need: [ ] Yes [ ] No [ ] Not required
- HR onboarding record:
- Temporary specialist role:

## Scope Restrictions

| Scope | Paths or details |
| --- | --- |
| Allowed modifications | <!-- exact folders/files --> |
| Read-only context | <!-- additional context paths --> |
| Forbidden modifications | <!-- sensitive or unrelated areas --> |
| Branch | <!-- dedicated branch --> |
| Worktree ID | <!-- non-sensitive identifier; keep absolute local paths out of public issues --> |
| Deliverables | <!-- code/tests/docs/review/report --> |
| Allowed commands/tools | <!-- include any permitted external writes --> |

## Implementation Plan

- [ ] Confirm requirements, scope, and acceptance criteria with the user.
- [ ] Find or create the milestone and link this issue.
- [ ] Request HR onboarding if specialist expertise is approved.
- [ ] Create a dedicated branch and worktree.
- [ ] Implement the scoped change.
- [ ] Add or update tests and documentation.
- [ ] Run relevant automated checks.

## Validation Evidence

### Automated checks

- Primary test command: `npm run check`
- Commands and results:

### Local user acceptance

- Development command: `Not applicable`
- Development URL:
- Tested commit SHA:
- Verification checklist:
- [ ] User explicitly approved the local result.
- Approval reference:
- [ ] User separately authorized opening the staging pull request.

### Staging acceptance

- Staging branch: `staging`
- Staging URL:
- Deployed commit SHA:
- Verification checklist:
- [ ] CI and required reviews passed.
- [ ] User explicitly approved the staging result.
- Approval reference:
- [ ] User separately authorized opening the production pull request.

## Pull Requests

- Task branch to `staging`:
- [ ] User authorized merging this exact staging PR and head SHA.
- `staging` to `main`:
- [ ] Included issues and commits were listed; unrelated staging work is excluded.
- [ ] User authorized merging this exact production PR and head SHA.

## Deployment and Rollback

<!-- Add migrations, configuration, monitoring, and rollback steps. Write "Not applicable" when appropriate. -->

## Completion Checklist

- [ ] Acceptance criteria are satisfied.
- [ ] Scope restrictions were respected.
- [ ] Automated checks passed.
- [ ] Local acceptance, staging PR authorization, and staging merge authorization were recorded separately and bound to the current SHA.
- [ ] Staging acceptance, production PR authorization, and production merge authorization were recorded separately and bound to the current SHA.
- [ ] Documentation and operational notes were updated.
- [ ] Follow-up work was opened as linked issues.
- [ ] Temporary specialists were offboarded.
- [ ] Worktrees were safely cleaned up after merge.
- [ ] Issue and milestone status were updated.
