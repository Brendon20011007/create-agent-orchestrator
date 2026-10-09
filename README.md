# create-agent-orchestrator

An npm initializer that sets up a Claude Code agent team in a new or existing project, and a `sync` command that keeps the team's workflow rules current.

In a project set up with it, the main session is the **Orchestrator**. It writes no code: it gives each job to the sub-agent that owns the files involved and approves what comes back. Only the user merges.

## Quick start

```bash
npm create agent-orchestrator@latest my-project
```

To add it to the current project:

```bash
npm create agent-orchestrator@latest .
```

The interactive setup asks for the project name, what it is, the stack, the run, test, and build commands, the staging and production branches, which roles the project needs, and which paths each role owns.

Then restart Claude Code in the project. Agent files are read at session start; `/agents` lists the ones that loaded.

## Generated files

| File | Purpose |
| --- | --- |
| `CLAUDE.md` | The operating rules: team roster, directory ownership, delegation, approval loop, task workflow, and the rule that only the user merges |
| `.claude/agents/hr-manager.md` | The agent that creates and removes the other agents and keeps the roster |
| `.claude/agents/orchestrator.md` | A sub-orchestrator the main session can hand a whole feature to |
| `.claude/agents/<name>.md` | One file per role on the roster, with the paths it owns and the paths it must leave alone |
| `.agent-orchestrator.json` | The answers from setup; `sync` reads it |
| `.github/ISSUE_TEMPLATE/taskboard.md` | Task intake, ownership split, validation evidence, and user checkpoints |
| `.github/PULL_REQUEST_TEMPLATE.md` | Traceability, scope per agent, tests, and the user checkpoint |
| `.gitignore` | Gains a `worktrees/` line, because every task runs in `worktrees/<task-slug>` |

Existing `CLAUDE.md`, config, and GitHub templates are not overwritten unless you confirm interactively or pass `--force`. An existing file in `.claude/agents/` is never overwritten, with or without `--force`; agents that are already there are added to the roster as they are.

The generated `CLAUDE.md` and role files contain a few `<!-- FILL: ... -->` notes for knowledge the tool cannot infer: stack traps, local-run traps, project conventions, and per-role facts. Fill them in (Claude Code can do it from the repository) and delete the comments.

## Why delegation works

Three things have to agree. If one is missing, the main session ends up doing the work itself.

1. **`CLAUDE.md` says the main session is the Orchestrator** and never writes code.
2. **The roster names one agent for each kind of work**, each with paths no other agent owns. Ownership is how the Orchestrator decides who gets a task.
3. **Every roster name has a `.claude/agents/<name>.md` file** whose frontmatter `name` equals the file name. The Agent tool can only spawn an agent that has a definition.

## Roles

The Orchestrator (the main session), the sub-orchestrator, and the HR Manager are always on the team. Pick the rest with `--agents`, each as `name` or `name=path+path`:

```bash
--agents "backend-engineer=src+test,frontend-engineer=web,qa-engineer=e2e,auditor"
```

Starter roles: `software-architect`, `data-engineer`, `backend-engineer`, `frontend-engineer`, `devops-engineer`, `qa-engineer`, and `auditor` (read-only, owns nothing). Any other lowercase, hyphenated name creates a custom role. Giving the same path to two agents is an error, because no path may have two owners.

With no `--agents`, the roster has only the three fixed roles. Ask the HR Manager to hire the first engineers.

## Non-interactive usage

```bash
npx create-agent-orchestrator@latest ./my-project \
  --yes \
  --project-name "Customer Portal" \
  --one-liner "a self-service portal for customers" \
  --stack "Next.js 15, TypeScript, PostgreSQL 16" \
  --agents "data-engineer=db,backend-engineer=app/api+lib,frontend-engineer=app/ui+components,qa-engineer=e2e,auditor" \
  --dev-command "npm run dev" \
  --test-command "npm test" \
  --build-command "npm run build" \
  --build-output ".next" \
  --setup-commands "npm install" \
  --deploy-target "the hosting platform" \
  --staging-branch staging \
  --production-branch main
```

Pass `none` to a command option when the project has no such command; the text that depends on it is left out. Use `--dry-run` to preview file names without writing, and `--no-github` to skip the GitHub templates and the GitHub Planning section.

Run `npx create-agent-orchestrator@latest --help` for every option.

## Keeping a project current: `sync`

```bash
npx create-agent-orchestrator@latest sync            # the current directory
npx create-agent-orchestrator@latest sync ./my-project --dry-run
```

`sync` brings the workflow rules of an initialized project up to the installed version:

- In `CLAUDE.md` it rewrites only the sections wrapped in `<!-- agent-orchestrator:start <id> -->` and `<!-- agent-orchestrator:end <id> -->` markers: the Orchestrator rules, the task workflow, the merging rule, GitHub planning, and the HR Manager rules. Values such as branch names and commands come from `.agent-orchestrator.json`, so edit that file and run `sync` to change them.
- Everything outside the markers stays byte-for-byte as it is: the roster, engineering conventions, common commands, and anything you added.
- A GitHub template is replaced only if it is unchanged since the tool wrote it. One you edited is left alone and reported; `--force` replaces it.

**`sync` never changes an existing agent team.** It writes nothing inside `.claude/agents/` and never adds, removes, reorders, or rewrites a roster row. Its output states how many agent files it left untouched. A second run with nothing new to apply writes nothing.

| Option | Effect |
| --- | --- |
| `--dry-run` | Print what would change and write nothing |
| `--migrate` | Convert a project created by 0.1.x (see below) |
| `--force` | Also replace GitHub templates that were edited locally. It never extends to agent files or to your text in `CLAUDE.md` |

### Migrating from 0.1.x

A project created by 0.1.x has a `CLAUDE.md` with no managed sections, so plain `sync` stops and writes nothing. Convert it once:

```bash
npx create-agent-orchestrator@latest sync --migrate --dry-run   # preview
npx create-agent-orchestrator@latest sync --migrate
```

- The previous `CLAUDE.md` and `.agent-orchestrator.json` are kept as `CLAUDE.md.bak` and `.agent-orchestrator.json.bak`. If a backup already exists, the command stops.
- The new roster lists the agents already in `.claude/agents/` under their existing names, with the responsibility from each file's description.
- If the team already has an HR agent (`hr-manager`, `hr-agent`, `hr`, or another `hr-*`), it fills the HR Manager row. An `orchestrator` agent fills the sub-orchestrator row. A fixed role nobody fills is left out, with a warning.
- No existing agent file is created, edited, renamed, or deleted. `hr-manager.md` and `orchestrator.md` are created only when `.claude/agents/` holds no agent definition at all.
- Owned paths are read only from a `Scope — files you own` section of an agent file. An existing agent whose file has no such section appears on the roster with `Defined in its agent file` in place of paths. The command names those agents; fill in their "Directories owned" cells afterwards. The team's HR agent can do it, or you can edit the table by hand, and `sync` keeps roster edits. The same applies when init adopts agents that are already in `.claude/agents/`.
- GitHub templates written by 0.1.x are kept, because the tool has no record of them and cannot tell whether they were edited. They may still describe the 0.1.x workflow. `sync --migrate --force`, or a later `sync --force`, replaces them.

Afterwards, move any project-specific rules from `CLAUDE.md.bak` into Engineering Conventions and restart Claude Code.

## Workflow encoded by the template

1. The Orchestrator splits a task by ownership and delegates each part to the agent that owns the files, with a complete brief.
2. Every task runs in its own git worktree and branch under `worktrees/`.
3. Each deliverable goes through the approval loop: at most three rejected rounds, then the Orchestrator escalates instead of doing the work itself.
4. Agents run the change locally; a green test suite alone is not enough.
5. The user gives the OK before the staging pull request is opened.
6. The agent stops at the pull request. The user reviews and merges it.
7. After staging verification and the user's confirmation, the same applies to the production pull request.
8. The HR Manager is the only agent that hires or fires, and it confirms with the user before removing an agent.

## Changed since 0.1

- The generated structure is a roster of agents with exclusive directory ownership. The Main Agent, HR Agent, and temporary-specialist model is gone.
- Agent definition files are generated in `.claude/agents/`.
- Agents never merge. Per-merge authorization is replaced by "merging is the user's, always".
- New `sync` command, with `--migrate` for 0.1.x projects.
- `.agent-orchestrator.json` is now `schemaVersion` 2.
- `--agents` now lists roster agents (`name=path+path`) instead of temporary capability requests.
- `--source-dirs` and `--project-type` are removed; the roster replaces them.
- New options: `--one-liner`, `--build-command`, `--test-single-command`, `--setup-commands`, `--build-output`, `--deploy-target`.

## 中文说明

在新项目或现有项目中初始化：

```bash
npm create agent-orchestrator@latest .
```

初始化后，主会话就是 **Orchestrator**：它不写代码，只把任务分派给拥有对应目录的子 Agent，并审核交回的结果。合并 PR 永远由用户自己完成。

生成的内容包括：`CLAUDE.md`（团队名单、目录归属、分派规则、审核循环、任务流程），`.claude/agents/` 下的 `hr-manager.md`、`orchestrator.md` 以及名单中每个角色各一个文件，`.agent-orchestrator.json`，以及可选的 GitHub Issue 和 PR 模板。用 `--agents "backend-engineer=src+test,frontend-engineer=web,auditor"` 指定角色及其拥有的路径；同一路径不能分给两个 Agent。

分派能生效，需要三件事一致：`CLAUDE.md` 写明主会话是 Orchestrator 且不写代码；名单为每类工作指定一个 Agent，且各自的目录互不重叠；名单上的每个名字都有对应的 `.claude/agents/<name>.md`，其 frontmatter 的 `name` 与文件名相同。

初始化完成后请重启 Claude Code，因为 Agent 文件只在会话启动时加载。

把最新的流程规则同步到已初始化的项目：

```bash
npx create-agent-orchestrator@latest sync
```

`sync` 只重写 `CLAUDE.md` 中由 `agent-orchestrator:start` 和 `agent-orchestrator:end` 标记包住的部分，以及未被手动修改过的 GitHub 模板。**它不会改动已有的子 Agent 团队**：不会在 `.claude/agents/` 中新建、修改、重命名或删除任何文件，也不会改动名单表格中的任何一行。标记之外的内容保持原样。加 `--dry-run` 可以只预览不写入。

由 0.1.x 创建的项目需要先迁移一次：

```bash
npx create-agent-orchestrator@latest sync --migrate
```

迁移会把原来的 `CLAUDE.md` 和 `.agent-orchestrator.json` 保留为 `.bak` 备份，并按 `.claude/agents/` 中已有的 Agent 及其原有名称生成新的名单；已有的 Agent 文件一律不动。只有当该目录中没有任何 Agent 定义时，才会创建 `hr-manager.md` 和 `orchestrator.md`。

迁移时还有两点需要留意：

- 拥有的路径只从 Agent 文件的 `Scope — files you own` 小节读取。没有这个小节的已有 Agent，在名单的 "Directories owned" 一栏会显示 `Defined in its agent file`。命令会列出这些 Agent，之后请让团队的 HR Agent 补上路径，或者直接手动修改表格；`sync` 会保留对名单的修改。
- 由 0.1.x 生成的 GitHub 模板在迁移时会保留，因为工具无法判断它们是否被修改过。用 `sync --migrate --force`，或之后运行 `sync --force`，可以替换为新模板。

## Development

```bash
npm test
npm run check
```

Requires Node.js 20 or newer. The initializer has no runtime dependencies.

## License

MIT
