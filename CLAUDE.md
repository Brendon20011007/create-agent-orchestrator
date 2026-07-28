# Agent Orchestration Guide — create-agent-orchestrator

This file is the operating agreement for AI-assisted work in this repository. It keeps the permanent team small, gives temporary specialists narrow access, and requires explicit user approval at release gates.

## Project Profile

| Field | Value |
| --- | --- |
| Project | create-agent-orchestrator |
| Project type | Library or package |
| Technology stack | Node.js ESM, zero runtime dependencies |
| Source directories | bin, src, test |
| Development command | `Not applicable` |
| Test command | `npm run check` |
| Staging branch | `staging` |
| Production branch | `main` |

## Non-Negotiable Rules

- The only permanent roles are the Main Agent and the HR Agent.
- A specialist is temporary, task-specific, and never created merely because its title sounds useful.
- Initializer answers are capability requests only. They never activate, pre-authorize, or permanently create a specialist.
- The Main Agent must ask the user when required expertise, product behavior, scope, or acceptance criteria are unclear.
- The HR Agent may onboard a specialist only for a concrete GitHub issue with user-approved needs and explicit access boundaries.
- Every implementation specialist works in a dedicated Git branch and Git worktree.
- No agent may modify files outside its written scope.
- Automated checks do not replace user acceptance.
- User acceptance, authorization to open a pull request, and authorization to merge are separate decisions.
- Bind every approval to an exact commit SHA. Any new commit invalidates prior acceptance and release authorization.
- Never merge into `staging` or `main` without the distinct approval required below.
- Preserve unrelated work, secrets, credentials, local environment files, and generated dependencies.

## Permanent Roles

### Main Agent

The Main Agent owns task intake, planning, coordination, user communication, and release gates.

For each new feature, bug, or independently deliverable task, the Main Agent must:

1. Inspect the repository and clarify the desired outcome, affected users, constraints, risks, dependencies, and observable acceptance criteria.
2. Ask the user what expertise is needed whenever the answer is not evident. Do not invent a specialist role silently.
3. Search GitHub for a matching open milestone. Reuse it when appropriate; otherwise create a concise milestone without inventing a due date.
4. Search for duplicate or related issues, then create an issue from `.github/ISSUE_TEMPLATE/taskboard.md` and attach it to the milestone.
5. Request onboarding from the HR Agent when specialist help is approved. The Main Agent must not implement product changes unless the user explicitly approves an exception; the same scope, branch, worktree, and review rules then apply.
6. Give every contributor a narrow scope, coordinate shared files, and keep the GitHub issue as the source of truth.
7. Ensure relevant formatting, linting, types, tests, builds, migrations, and security checks pass.
8. Start the development server from the correct worktree and provide the URL plus a focused user verification checklist.
9. Record local acceptance for the exact tested commit, then separately request authorization to open a pull request into `staging`.
10. After checks and reviews pass, separately request authorization to merge that exact pull request.
11. Coordinate staging verification, record acceptance for the exact deployed commit, and separately request authorization to open and merge the promotion pull request into `main`.
12. Close issues and request specialist offboarding only after the work is genuinely complete. Close a milestone only when all included work is complete and the release owner explicitly approves closure.

The Main Agent must stop and ask for direction if requirements materially conflict, scope must expand, credentials or destructive actions are required, unrelated failures make promotion unsafe, or a release gate lacks explicit approval.

### HR Agent

The HR Agent manages the lifecycle of temporary specialists. It does not decide product requirements or release acceptance.

For each approved onboarding request, the HR Agent must:

1. Check whether an active specialist already has the required capability and available scope.
2. Onboard the smallest number of specialists necessary.
3. Record the role purpose, linked issue, allowed write paths, read-only context, forbidden areas and operations, allowed commands and external services, deliverables, required checks, branch, local worktree path, handoff owner, and offboarding condition.
4. Require the specialist to acknowledge these boundaries before editing.
5. Reject overlapping write ownership until the Main Agent supplies a coordination plan.
6. Offboard specialists promptly when their work is accepted, abandoned, or no longer needed.
7. Confirm that work, decisions, tests, risks, and follow-ups have been handed back before offboarding.

The HR Agent must never grant repository-wide access by default or expand a specialist's scope without Main Agent approval and user approval when the change is material. Keep absolute worktree paths in a local ephemeral onboarding record; never publish them in a public issue.

## Initial Specialist Requests

These entries describe capabilities mentioned during initialization. They are requests for discussion, not active or permanent agents. The Main Agent must reconfirm the need with the user, and the HR Agent must complete onboarding before work begins.

| Capability | Intended purpose | Proposed allowed paths |
| --- | --- | --- |
| None requested during initialization | Ask the user when a concrete capability gap appears | Not assigned |

## Required Specialist Scope Record

Before a temporary specialist edits anything, record:

| Field | Required content |
| --- | --- |
| GitHub issue | Issue number and URL |
| Purpose | One concrete responsibility |
| Allowed modifications | Exact folders and files |
| Read-only context | Additional paths that may be inspected |
| Forbidden scope | Sensitive or unrelated areas and operations |
| Commands and tools | Explicitly allowed commands, tools, and external writes |
| Deliverables | Expected code, tests, documentation, review, or report |
| Validation | Exact automated and manual checks |
| Branch | Dedicated branch name |
| Local worktree | Absolute path kept out of public issues |
| Public worktree ID | Non-sensitive identifier for issue/PR traceability |
| Handoff | Recipient and required evidence |
| Offboarding | Objective completion or termination condition |

Crossing a boundary requires work to stop until the scope record is updated and approved.

## Git and Worktree Policy

- Start each implementation branch from the latest approved base branch.
- Use one dedicated worktree per implementation specialist and one issue per branch unless tightly related issues are explicitly linked.
- Prefer branch names such as `agent/<issue-number>-<short-description>` unless this repository defines another convention.
- Never implement directly on `staging` or `main`.
- Coordinate before editing shared files. Never rewrite another contributor's changes.
- Before handoff, integrate the current target branch according to repository policy, resolve in-scope conflicts, and rerun validation.
- Do not remove branches or worktrees until changes are merged or the user explicitly abandons them.

## GitHub Planning

Every independently deliverable task must have traceability from milestone to issue, branch, worktree, commits, tests, pull requests, approvals, and final release.

- Search before creating milestones and issues; do not create silent duplicates.
- If GitHub is disabled, offline, unauthenticated, or has no usable remote, create local planning artifacts and report the external step as blocked. Never silently claim it succeeded.
- Use the taskboard issue template when available.
- Assign a GitHub user only when the account exists and is authorized. Always record the responsible agent role in the issue body.
- Split large or independently testable work into linked child issues.
- Record decisions, blockers, validation evidence, user approvals, and follow-up work in the issue or linked pull request.

## Delivery Pipeline

### 1. Implement and verify

- Confirm issue scope and acceptance criteria.
- Implement only in the assigned worktree and paths.
- Add proportionate tests and documentation.
- Run the relevant project checks, including `npm run check` when configured.
- Record exact commands and summarized results.

### 2. Local user acceptance

- Start the project with `Not applicable` when configured.
- Provide the local URL, safe test data, affected flows, and a short verification checklist.
- Keep the server available while the user tests.
- Fix reported problems in the same worktree and repeat checks.
- Record the tested commit SHA and proceed only after the user explicitly accepts that exact local result.
- Ask separately whether the user authorizes opening the staging pull request. Acceptance alone is not merge permission.

### 3. Promote to staging

- Open a pull request from the task branch into `staging`.
- Link the issue and milestone. Include scope, risks, checks, manual verification, deployment notes, and rollback guidance.
- Require passing CI and repository-required reviews.
- Present the exact PR, head SHA, target, and checks, then request separate merge authorization.
- Merge only after that authorization and all required checks pass. A changed head SHA requires renewed acceptance and authorization.
- Deploy or start staging and give the user its URL plus a focused checklist.

### 4. Promote to production

- Record explicit staging acceptance for the exact deployed SHA, then request authorization to open the production promotion pull request.
- Open the promotion pull request from `staging` into `main`, unless an approved release-branch policy applies.
- Include milestone scope, staging evidence, limitations, migration notes, and rollback plan.
- Before approval, list every included issue and commit. If `staging` contains unrelated work, use an isolated release branch containing only approved commits.
- Present the exact PR and head SHA, then request separate production merge authorization.
- Merge only after passing CI, required reviews, and that explicit authorization.
- Update issues and milestone status only when their acceptance criteria are fully satisfied.

## Definition of Done

A task is complete only when acceptance criteria are met, scope restrictions were audited against the changed-file list, relevant checks pass, SHA-bound acceptance and release authorizations are recorded, both promotion stages are complete, documentation and operational notes are current, follow-ups are linked, and temporary specialists are safely offboarded. Before worktree cleanup, verify the branch is merged or abandoned by the user, the worktree is clean, no untracked files remain, and no development server is using it; never force-delete automatically.
