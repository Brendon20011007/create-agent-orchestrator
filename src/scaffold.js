import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { CONFIG_FILE } from "./config.js";
import { AGENTS_DIR, discoverAgents, resolveTeam } from "./team.js";
import {
  renderClaudeMd,
  renderConfig,
  renderHrManagerAgent,
  renderOrchestratorAgent,
  renderPullRequestTemplate,
  renderRoleAgent,
  renderTaskboardTemplate,
} from "./templates.js";

const WORKTREES_IGNORED = /^\/?worktrees\/?$/;

export function contentHash(contents) {
  return `sha256-${createHash("sha256").update(contents, "utf8").digest("hex")}`;
}

export function githubFiles(config) {
  if (!config.github.enabled) return [];

  return [
    [".github/ISSUE_TEMPLATE/taskboard.md", renderTaskboardTemplate(config)],
    [".github/PULL_REQUEST_TEMPLATE.md", renderPullRequestTemplate(config)],
  ];
}

export function agentFiles(config, team) {
  return team.create.map((name) => {
    const role = team.agents.find((agent) => agent.name === name);
    const contents = role
      ? renderRoleAgent(config, team, role)
      : name === team.hr
        ? renderHrManagerAgent(config)
        : renderOrchestratorAgent(config, team);

    return [`${AGENTS_DIR}/${name}.md`, contents];
  });
}

export async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function assertNotSymlink(filePath) {
  try {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${filePath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function planGitignore(targetDir) {
  const current = await readOptional(path.join(targetDir, ".gitignore"));

  if (current === null) return { action: "create", contents: "worktrees/\n" };
  if (current.split(/\r?\n/).some((line) => WORKTREES_IGNORED.test(line.trim()))) {
    return { action: "unchanged", contents: current };
  }

  const separator = current === "" || current.endsWith("\n") ? "" : "\n";
  return { action: "update", contents: `${current}${separator}worktrees/\n` };
}

export async function writeFiles(targetDir, files) {
  for (const [relativePath] of files) {
    await assertNotSymlink(path.join(targetDir, relativePath));
  }

  for (const [relativePath, contents] of files) {
    const destination = path.join(targetDir, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents, "utf8");
  }
}

function conflictCandidates(config) {
  return ["CLAUDE.md", CONFIG_FILE, ...githubFiles(config).map(([relativePath]) => relativePath)];
}

export async function listConflicts(targetDir, config) {
  const conflicts = [];

  for (const relativePath of conflictCandidates(config)) {
    if (await exists(path.join(targetDir, relativePath))) conflicts.push(relativePath);
  }

  return conflicts;
}

export async function writeScaffold(targetDir, config, { agents = [], force = false, dryRun = false } = {}) {
  const team = resolveTeam(agents, await discoverAgents(targetDir), { addFixed: true });
  const github = githubFiles(config);
  const finalConfig = {
    ...config,
    team: { hr: team.hr, subOrchestrator: team.subOrchestrator },
    generated: Object.fromEntries(github.map(([relativePath, contents]) => [relativePath, contentHash(contents)])),
  };
  const gitignore = await planGitignore(targetDir);
  const files = [
    ["CLAUDE.md", renderClaudeMd(finalConfig, team)],
    [CONFIG_FILE, renderConfig(finalConfig)],
    ...agentFiles(finalConfig, team),
    ...github,
    ...(gitignore.action === "unchanged" ? [] : [[".gitignore", gitignore.contents]]),
  ];
  const conflicts = await listConflicts(targetDir, config);

  if (conflicts.length > 0 && !force) {
    throw new Error(
      `Refusing to overwrite existing generated files: ${conflicts.join(", ")}. Use --force to replace them, or run "create-agent-orchestrator sync" to update a project that is already initialized.`,
    );
  }

  const result = {
    files: files.map(([relativePath]) => relativePath),
    kept: team.kept,
    needsPaths: team.needsPaths,
    conflicts,
    warnings: team.warnings,
    team,
    dryRun,
  };

  if (dryRun) return result;

  await mkdir(targetDir, { recursive: true });
  await writeFiles(targetDir, files);

  return result;
}
