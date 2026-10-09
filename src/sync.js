import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { UsageError } from "./args.js";
import { CONFIG_FILE, convertConfig, normalizeConfig, SCHEMA_VERSION } from "./config.js";
import {
  agentFiles,
  assertNotSymlink,
  contentHash,
  exists,
  githubFiles,
  planGitignore,
  readOptional,
  writeFiles,
} from "./scaffold.js";
import { AGENTS_DIR, discoverAgents, parseRoster, resolveTeam } from "./team.js";
import { renderClaudeMd, renderConfig, renderManagedSections } from "./templates.js";

const MARKER_LINE = /^<!-- agent-orchestrator:(start|end) ([a-z0-9][a-z0-9-]*) -->\s*$/;
const MARKER_HINT = /<!--\s*agent-orchestrator:/;
const BACKUPS = [
  ["CLAUDE.md", "CLAUDE.md.bak"],
  [CONFIG_FILE, `${CONFIG_FILE}.bak`],
];

export function hasManagedSections(text) {
  return MARKER_HINT.test(text);
}

function managedBlocks(lines) {
  const blocks = [];
  const seen = new Set();
  let open = null;

  lines.forEach((line, index) => {
    if (!MARKER_HINT.test(line)) return;

    const match = MARKER_LINE.exec(line);
    if (!match) throw new UsageError(`CLAUDE.md line ${index + 1}: malformed managed-section marker.`);

    const [, kind, id] = match;

    if (kind === "start") {
      if (open) {
        throw new UsageError(`CLAUDE.md line ${index + 1}: section "${id}" starts before "${open.id}" ends.`);
      }
      if (seen.has(id)) throw new UsageError(`CLAUDE.md line ${index + 1}: section "${id}" appears twice.`);
      seen.add(id);
      open = { id, start: index };
      return;
    }

    if (!open || open.id !== id) {
      throw new UsageError(`CLAUDE.md line ${index + 1}: end marker for "${id}" has no matching start marker.`);
    }
    blocks.push({ ...open, end: index });
    open = null;
  });

  if (open) throw new UsageError(`CLAUDE.md line ${open.start + 1}: section "${open.id}" has no end marker.`);

  return blocks;
}

export function applyManagedSections(text, sections) {
  const lines = text.split("\n");
  const blocks = managedBlocks(lines);
  const output = [];
  const updated = [];
  const unknown = [];
  let cursor = 0;

  for (const block of blocks) {
    output.push(...lines.slice(cursor, block.start + 1));
    const current = lines.slice(block.start + 1, block.end);

    if (!(block.id in sections)) {
      unknown.push(block.id);
      output.push(...current);
    } else if (current.join("\n") === sections[block.id]) {
      output.push(...current);
    } else {
      updated.push(block.id);
      output.push(sections[block.id]);
    }

    output.push(lines[block.end]);
    cursor = block.end + 1;
  }

  output.push(...lines.slice(cursor));

  const present = blocks.map((block) => block.id);

  return {
    text: output.join("\n"),
    updated,
    unknown,
    missing: Object.keys(sections).filter((id) => !present.includes(id)),
  };
}

async function planGithub(targetDir, config, force) {
  const actions = [];
  const writes = [];
  const generated = { ...config.generated };

  for (const [relativePath, contents] of githubFiles(config)) {
    const current = await readOptional(path.join(targetDir, relativePath));
    const hash = contentHash(contents);

    if (current === contents) {
      actions.push({ path: relativePath, action: "unchanged" });
    } else if (current === null) {
      actions.push({ path: relativePath, action: "create" });
      writes.push([relativePath, contents]);
    } else if (contentHash(current) === config.generated[relativePath]) {
      actions.push({ path: relativePath, action: "update" });
      writes.push([relativePath, contents]);
    } else if (force) {
      actions.push({ path: relativePath, action: "update", detail: "locally modified, replaced by --force" });
      writes.push([relativePath, contents]);
    } else {
      const reason = config.generated[relativePath] ? "locally modified" : "not written by this version";
      actions.push({ path: relativePath, action: "skip", detail: `${reason}; --force replaces it` });
      continue;
    }

    generated[relativePath] = hash;
  }

  return { actions, writes, generated };
}

function sameEntries(a, b) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function finish(targetDir, mode, dryRun, actions, warnings, existing, team, needsPaths = []) {
  actions.push({
    path: `${AGENTS_DIR}/`,
    action: "kept",
    detail: `${plural(existing.length, "existing agent file")} left untouched`,
  });

  return {
    targetDir,
    mode,
    dryRun,
    changed: actions.some((entry) => ["backup", "create", "update"].includes(entry.action)),
    actions,
    warnings,
    agentsUntouched: existing.length,
    team,
    needsPaths,
  };
}

async function refresh(targetDir, rawConfig, claudeMd, existing, { force, dryRun }) {
  const config = normalizeConfig(rawConfig, path.basename(targetDir));
  const names = parseRoster(claudeMd)
    .map((row) => row.agent)
    .filter(Boolean);
  const applied = applyManagedSections(
    claudeMd,
    renderManagedSections(config, { agents: names, hr: config.team.hr, subOrchestrator: config.team.subOrchestrator }),
  );
  const github = await planGithub(targetDir, config, force);
  const gitignore = await planGitignore(targetDir);
  const configChanged = !sameEntries(config.generated, github.generated);
  const warnings = [];
  const writes = [...github.writes];

  for (const [role, name] of [
    ["HR Manager", config.team.hr],
    ["Sub-Orchestrator", config.team.subOrchestrator],
  ]) {
    if (name && !names.includes(name)) {
      warnings.push(
        `${CONFIG_FILE} names \`${name}\` as the ${role}, but the roster in CLAUDE.md does not list it. The roster was left unchanged.`,
      );
    }
  }
  for (const id of applied.missing) {
    warnings.push(`Managed section "${id}" is not in CLAUDE.md and was not added.`);
  }
  for (const id of applied.unknown) {
    warnings.push(`Section "${id}" in CLAUDE.md is not managed by this version and was left alone.`);
  }

  const actions = [
    applied.updated.length > 0
      ? {
          path: "CLAUDE.md",
          action: "update",
          detail: `${plural(applied.updated.length, "managed section")}: ${applied.updated.join(", ")}`,
        }
      : { path: "CLAUDE.md", action: "unchanged" },
    ...github.actions,
    { path: ".gitignore", action: gitignore.action },
    { path: CONFIG_FILE, action: configChanged ? "update" : "unchanged" },
  ];

  if (applied.updated.length > 0) writes.push(["CLAUDE.md", applied.text]);
  if (gitignore.action !== "unchanged") writes.push([".gitignore", gitignore.contents]);
  if (configChanged) writes.push([CONFIG_FILE, renderConfig({ ...rawConfig, generated: github.generated })]);
  if (!dryRun) await writeFiles(targetDir, writes);

  return finish(targetDir, "refresh", dryRun, actions, warnings, existing, config.team);
}

async function migrateProject(targetDir, rawConfig, existing, { force, dryRun }) {
  for (const [, backup] of BACKUPS) {
    if (await exists(path.join(targetDir, backup))) {
      throw new UsageError(`${backup} already exists. Move or delete it, then run sync --migrate again. Nothing was written.`);
    }
  }

  const team = resolveTeam([], existing, { addFixed: existing.length === 0 });
  const config = {
    ...convertConfig(rawConfig, path.basename(targetDir)),
    team: { hr: team.hr, subOrchestrator: team.subOrchestrator },
  };
  const github = await planGithub(targetDir, config, force);
  const finalConfig = { ...config, generated: github.generated };
  const gitignore = await planGitignore(targetDir);
  const created = agentFiles(finalConfig, team);
  const warnings = [...team.warnings];

  if (!team.hr) {
    warnings.push(
      "No HR agent was found among the existing agents, so the roster has no HR Manager row. The existing team was left unchanged.",
    );
  }
  if (!team.subOrchestrator) {
    warnings.push(
      "No `orchestrator` agent exists, so the roster has no Sub-Orchestrator row. The existing team was left unchanged.",
    );
  }

  if (github.actions.some((entry) => entry.action === "skip")) {
    warnings.push(
      "The existing GitHub templates were kept. They may still describe the 0.1.x workflow; run sync --force to replace them.",
    );
  }

  const writes = [
    ["CLAUDE.md", renderClaudeMd(finalConfig, team)],
    [CONFIG_FILE, renderConfig(finalConfig)],
    ...created,
    ...github.writes,
    ...(gitignore.action === "unchanged" ? [] : [[".gitignore", gitignore.contents]]),
  ];
  const actions = [
    ...BACKUPS.map(([source, backup]) => ({ path: backup, action: "backup", detail: `copy of ${source}` })),
    { path: "CLAUDE.md", action: "update", detail: "rewritten in the roster structure" },
    { path: CONFIG_FILE, action: "update", detail: `schemaVersion ${SCHEMA_VERSION}` },
    ...created.map(([relativePath]) => ({ path: relativePath, action: "create" })),
    ...github.actions,
    { path: ".gitignore", action: gitignore.action },
  ];

  if (!dryRun) {
    for (const [relativePath] of [...writes, ...BACKUPS.map(([, backup]) => [backup])]) {
      await assertNotSymlink(path.join(targetDir, relativePath));
    }
    for (const [source, backup] of BACKUPS) {
      await copyFile(path.join(targetDir, source), path.join(targetDir, backup), constants.COPYFILE_EXCL);
    }
    await writeFiles(targetDir, writes);
  }

  return finish(targetDir, "migrate", dryRun, actions, warnings, existing, finalConfig.team, team.needsPaths);
}

export async function syncProject(targetDir, { migrate = false, force = false, dryRun = false } = {}) {
  const configText = await readOptional(path.join(targetDir, CONFIG_FILE));
  const claudeMd = await readOptional(path.join(targetDir, "CLAUDE.md"));

  if (configText === null || claudeMd === null) {
    throw new UsageError(
      `${configText === null ? CONFIG_FILE : "CLAUDE.md"} was not found in ${targetDir}. Initialize the project first: create-agent-orchestrator <target-directory>.`,
    );
  }

  let rawConfig;
  try {
    rawConfig = JSON.parse(configText);
  } catch {
    throw new UsageError(`${CONFIG_FILE} is not valid JSON. Nothing was written.`);
  }

  if (rawConfig.schemaVersion > SCHEMA_VERSION) {
    throw new UsageError(
      `${CONFIG_FILE} has schemaVersion ${rawConfig.schemaVersion}, written by a newer create-agent-orchestrator. Update the package and run sync again.`,
    );
  }

  const existing = await discoverAgents(targetDir);

  if (rawConfig.schemaVersion === SCHEMA_VERSION && hasManagedSections(claudeMd)) {
    const result = await refresh(targetDir, rawConfig, claudeMd, existing, { force, dryRun });
    if (migrate) result.warnings.push("This project already uses managed sections, so --migrate had nothing to convert.");
    return result;
  }

  if (!migrate) {
    const reason =
      rawConfig.schemaVersion === SCHEMA_VERSION
        ? "CLAUDE.md has no managed sections (it was written by hand or its markers were removed)"
        : `${CONFIG_FILE} is schemaVersion ${rawConfig.schemaVersion ?? "unknown"} (created by 0.1.x), and its CLAUDE.md has no managed sections to refresh`;

    throw new UsageError(
      `${reason}. Nothing was written. Run sync --migrate to convert the project: the current CLAUDE.md and ${CONFIG_FILE} are kept as .bak files, and no existing agent file is changed.`,
    );
  }

  return migrateProject(targetDir, rawConfig, existing, { force, dryRun });
}
