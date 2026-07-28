# create-agent-orchestrator

An interactive npm initializer that adds a user-controlled, GitHub-first agent orchestration workflow to a new or existing project.

Only **Main Agent** and **HR Agent** are permanent. During setup, the initializer asks what specialist capabilities the project may need. Those answers are recorded as requests—not active agents—so the Main Agent can reconfirm the need and HR can onboard narrowly scoped temporary specialists for concrete GitHub issues.

## Quick start

```bash
npm create agent-orchestrator@latest my-project
```

To add it to the current project:

```bash
npm create agent-orchestrator@latest .
```

The interactive setup asks about:

- project type and technology stack;
- source folders;
- development and test commands;
- staging and production branches;
- temporary specialist capabilities the first task may need;
- proposed writable paths for each requested specialist;
- GitHub issue and pull request templates.

## Generated files

| File | Purpose |
| --- | --- |
| `CLAUDE.md` | Customized orchestration contract for Main, HR, temporary specialists, GitHub planning, worktrees, testing, and approval gates |
| `.agent-orchestrator.json` | Machine-readable answers from initialization |
| `.github/ISSUE_TEMPLATE/taskboard.md` | Task intake, scope, ownership, validation, and release checklist |
| `.github/PULL_REQUEST_TEMPLATE.md` | Traceability, tests, user approvals, risk, and rollback checklist |

Existing generated files are not overwritten unless you confirm interactively or pass `--force`.

## Non-interactive usage

```bash
npx create-agent-orchestrator@latest ./my-project \
  --yes \
  --project-name "Customer Portal" \
  --project-type "Web application" \
  --stack "Next.js, TypeScript, PostgreSQL" \
  --source-dirs "app,components,lib,tests" \
  --agents "frontend accessibility,backend API,QA" \
  --dev-command "npm run dev" \
  --test-command "npm test" \
  --staging-branch staging \
  --production-branch main
```

Use `--dry-run` to preview file names without writing. Use `--no-github` when only `CLAUDE.md` and `.agent-orchestrator.json` are wanted.

Run `npx create-agent-orchestrator@latest --help` for every option.

## Workflow encoded by the template

1. Main Agent clarifies the task and searches for a matching milestone and issue.
2. Main asks the user about missing capability requirements.
3. HR onboards the minimum temporary specialists with explicit folder restrictions.
4. Each implementation specialist uses a dedicated branch and Git worktree.
5. Automated checks run before the development server is presented for user testing.
6. Local acceptance is bound to the exact tested commit; opening and merging the `staging` pull request require separate authorization.
7. Staging acceptance is bound to the exact deployed commit; opening and merging the `main` promotion pull request require separate authorization.
8. HR offboards temporary specialists after a complete handoff.

## 中文说明

运行以下命令即可在新项目或现有项目中初始化：

```bash
npm create agent-orchestrator@latest .
```

初始化程序会询问项目类型、技术栈、目录、测试与开发命令，以及当前项目可能需要哪些临时专业能力。固定角色只有 Main Agent 和 HR Agent；其他 Agent 不会被默认创建，必须由 Main Agent 与用户确认后，再由 HR 为具体 GitHub Issue 进行 onboarding，并限制可修改目录。

## Development

```bash
npm test
npm run check
```

Requires Node.js 20 or newer. The initializer has no runtime dependencies.

## License

MIT
