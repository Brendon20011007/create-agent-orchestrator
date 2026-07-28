import { access, lstat, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import {
  renderClaudeMd,
  renderConfig,
  renderPullRequestTemplate,
  renderTaskboardTemplate,
} from "./templates.js";

function outputFiles(config) {
  const files = [
    ["CLAUDE.md", renderClaudeMd(config)],
    [".agent-orchestrator.json", renderConfig(config)],
  ];

  if (config.github.enabled) {
    files.push(
      [".github/ISSUE_TEMPLATE/taskboard.md", renderTaskboardTemplate(config)],
      [".github/PULL_REQUEST_TEMPLATE.md", renderPullRequestTemplate(config)],
    );
  }

  return files;
}

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function assertNotSymlink(filePath) {
  try {
    const stats = await lstat(filePath);
    if (stats.isSymbolicLink()) {
      throw new Error(`Refusing to write through symbolic link: ${filePath}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function listConflicts(targetDir, config) {
  const conflicts = [];

  for (const [relativePath] of outputFiles(config)) {
    if (await exists(path.join(targetDir, relativePath))) conflicts.push(relativePath);
  }

  return conflicts;
}

export async function writeScaffold(targetDir, config, { force = false, dryRun = false } = {}) {
  const files = outputFiles(config);
  const conflicts = await listConflicts(targetDir, config);

  if (conflicts.length > 0 && !force) {
    throw new Error(
      `Refusing to overwrite existing generated files: ${conflicts.join(", ")}. Use --force to replace them.`,
    );
  }

  if (dryRun) {
    return { files: files.map(([relativePath]) => relativePath), conflicts, dryRun: true };
  }

  await mkdir(targetDir, { recursive: true });

  for (const [relativePath, contents] of files) {
    const destination = path.join(targetDir, relativePath);
    await assertNotSymlink(destination);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, contents, "utf8");
  }

  return { files: files.map(([relativePath]) => relativePath), conflicts, dryRun: false };
}
