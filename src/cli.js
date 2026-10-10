import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile, realpath, stat } from "node:fs/promises";
import { parseArgs, UsageError } from "./args.js";
import { CONFIG_FILE, normalizeConfig, splitList } from "./config.js";
import { createPrompter } from "./prompts.js";
import { exists, writeScaffold } from "./scaffold.js";
import { SYNC_NO_DIRECTORY, SYNC_NOT_INITIALIZED, syncProject } from "./sync.js";
import { AGENTS_DIR, STARTER_ROLES, UNKNOWN_OWNERSHIP, describeRole, parseAgentsOption, pathKey } from "./team.js";
import { CLAUDE_MD_FILL_NOTES, ROLE_FILL_NOTES } from "./templates.js";

function validateProjectName(name) {
  if (!name.trim()) throw new UsageError("Project name cannot be empty.");
  if (/\r|\n/.test(name)) throw new UsageError("Project name must be a single line.");
  return name.trim();
}

async function packageVersion() {
  const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  return packageJson.version;
}

function configFromAnswers(answers) {
  return normalizeConfig({
    project: { name: answers.projectName, oneLiner: answers.oneLiner, stack: answers.stack },
    commands: {
      dev: answers.devCommand,
      test: answers.testCommand,
      testSingle: answers.testSingleCommand,
      build: answers.buildCommand,
      worktreeSetup: splitList(answers.setupCommands),
    },
    branches: { staging: answers.stagingBranch, production: answers.productionBranch },
    paths: { buildOutput: splitList(answers.buildOutput) },
    deploy: { target: answers.deployTarget },
    github: { enabled: answers.githubEnabled },
  });
}

function defaultAnswers(options, targetDir) {
  return {
    projectName: validateProjectName(options.projectName || path.basename(targetDir) || "my-project"),
    oneLiner: options.oneLiner ?? "",
    stack: options.stack ?? "",
    devCommand: options.devCommand ?? "npm run dev",
    testCommand: options.testCommand ?? "npm test",
    testSingleCommand: options.testSingleCommand ?? "",
    buildCommand: options.buildCommand ?? "",
    buildOutput: options.buildOutput ?? "",
    setupCommands: options.setupCommands ?? "",
    stagingBranch: options.stagingBranch || "staging",
    productionBranch: options.productionBranch || "main",
    deployTarget: options.deployTarget ?? "",
    agents: parseAgentsOption(options.agents),
    githubEnabled: !options.noGithub,
  };
}

function starterRoleNames(answer) {
  return splitList(answer).map((item) => {
    if (!/^\d+$/.test(item)) return item;
    const role = STARTER_ROLES[Number(item) - 1];
    if (!role) throw new UsageError(`There is no starter role numbered ${item}.`);
    return role.name;
  });
}

async function askRoster(prompter, output) {
  output.write(
    "\nThe Orchestrator (the main session), a sub-orchestrator, and the HR Manager are always on the team.\nStarter roles:\n",
  );
  STARTER_ROLES.forEach((role, index) => {
    output.write(`  ${index + 1}. ${role.name} — ${role.responsibility}\n`);
  });

  let names;

  while (names === undefined) {
    const answer = await prompter.text(
      "Roles this project needs (numbers or names, comma-separated; blank for none)",
      "",
    );

    try {
      names = parseAgentsOption(starterRoleNames(answer).join(",")).map((agent) => agent.name);
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      output.write(`${error.message}\n`);
    }
  }

  const agents = [];

  for (const name of names) {
    let owns = [];

    while (!describeRole(name).readOnly) {
      owns = splitList(await prompter.text(`Paths owned by ${name} (comma-separated)`, "")).map((owned) =>
        owned.replace(/^\.\//, ""),
      );
      const taken = owns.filter((owned) =>
        agents.some((agent) => agent.owns.some((other) => pathKey(other) === pathKey(owned))),
      );
      if (taken.length === 0) break;
      output.write(`Already owned by another role: ${taken.join(", ")}. No path may have two owners.\n`);
    }

    agents.push({ name, owns });
  }

  return agents;
}

export async function collectInteractiveAnswers(options, targetDir, prompter, output = process.stdout) {
  const projectName = validateProjectName(
    options.projectName || (await prompter.text("Project name", path.basename(targetDir) || "my-project")),
  );
  const oneLiner =
    options.oneLiner ?? (await prompter.text("What it is, in a few words, such as: a ticketing system (blank to skip)", ""));
  const stack =
    options.stack ??
    (await prompter.text("Languages, frameworks, database, and test runner, with versions (blank to skip)", ""));
  const devCommand =
    options.devCommand ?? (await prompter.text('Command that starts the app locally ("none" if there is none)', "npm run dev"));
  const testCommand =
    options.testCommand ?? (await prompter.text('Command that runs the whole test suite ("none" if there is none)', "npm test"));
  const testSingleCommand =
    options.testSingleCommand ?? (await prompter.text("Command that runs a single test (blank to skip)", ""));
  const buildCommand = options.buildCommand ?? (await prompter.text("Build command (blank to skip)", ""));
  const buildOutput =
    options.buildOutput ??
    (await prompter.text("Build output paths nobody edits by hand (comma-separated; blank to skip)", ""));
  const setupCommands =
    options.setupCommands ??
    (await prompter.text("Commands that make a fresh worktree runnable (comma-separated; blank to skip)", ""));
  const stagingBranch = options.stagingBranch || (await prompter.text("Staging branch", "staging"));
  const productionBranch = options.productionBranch || (await prompter.text("Production branch", "main"));
  const deployTarget =
    options.deployTarget ?? (await prompter.text("Where and how the project deploys (blank to skip)", ""));
  const agents = options.agents ? parseAgentsOption(options.agents) : await askRoster(prompter, output);
  const githubEnabled = options.noGithub
    ? false
    : await prompter.confirm("Generate GitHub issue and pull request templates?", true);

  return {
    projectName,
    oneLiner,
    stack,
    devCommand,
    testCommand,
    testSingleCommand,
    buildCommand,
    buildOutput,
    setupCommands,
    stagingBranch,
    productionBranch,
    deployTarget,
    agents,
    githubEnabled,
  };
}

async function withDirectorySlashes(targetDir, agents) {
  const slashed = async (owned) => {
    if (owned.endsWith("/")) return owned;
    try {
      return (await stat(path.join(targetDir, owned))).isDirectory() ? `${owned}/` : owned;
    } catch {
      return owned;
    }
  };

  return Promise.all(agents.map(async (agent) => ({ ...agent, owns: await Promise.all(agent.owns.map(slashed)) })));
}

function bullets(items) {
  return items.map((item) => `  - ${item}\n`).join("");
}

function numbered(steps) {
  return steps.map((step, index) => `  ${index + 1}. ${step}\n`).join("");
}

function needsPathsStep(result) {
  const names = result.needsPaths.map((name) => `\`${name}\``).join(", ");
  const who = result.team.hr
    ? `The team's HR agent (\`${result.team.hr}\`) can fill them in, or edit the table by hand.`
    : "Edit the table by hand.";

  return `Fill in the "Directories owned" cells for ${names} in the CLAUDE.md roster. They read "${UNKNOWN_OWNERSHIP}" because owned paths are read only from a "Scope — files you own" section, and those agent files list none there. ${who} Sync keeps roster edits.`;
}

function needsPathsPreview(result) {
  if (!result.dryRun || result.needsPaths.length === 0) return "";
  return `\nRoster rows that would read "${UNKNOWN_OWNERSHIP}" until their paths are filled in:\n${bullets(result.needsPaths)}`;
}

function initReport(targetDir, result) {
  const roleFiles = result.team.create.filter((name) => result.team.agents.some((agent) => agent.name === name));
  const steps = [
    `Fill the project-knowledge notes marked "<!-- FILL: ... -->": ${CLAUDE_MD_FILL_NOTES.join(", ")} in CLAUDE.md${
      roleFiles.length > 0 ? `, plus ${ROLE_FILL_NOTES.join(" and ")} in each new role file` : ""
    }. Claude Code can fill them from the repository.`,
  ];

  if (result.needsPaths.length > 0) steps.push(needsPathsStep(result));
  if (result.team.agents.length === 0) {
    steps.push(
      "Ask the HR Manager to hire the first engineers. No role owns a directory yet, so the Orchestrator has nobody to delegate implementation to.",
    );
  }
  steps.push(
    "Restart Claude Code in the project. Agent files are read at session start; /agents lists the ones that loaded.",
  );

  let report = `\n${result.dryRun ? "Would create" : "Created"} the agent team in ${targetDir}:\n${bullets(result.files)}`;

  if (result.kept.length > 0) {
    report += `\nKept existing agent files (never overwritten):\n${bullets(result.kept)}`;
  }
  if (result.warnings.length > 0) report += `\nWarnings:\n${bullets(result.warnings)}`;
  report += needsPathsPreview(result);
  if (!result.dryRun) {
    report += `\nNext:\n${numbered(steps)}`;
    report +=
      '\nLater, "create-agent-orchestrator sync" refreshes the workflow rules without changing the agent team.\n';
  }

  return report;
}

function syncReport(result) {
  const heading = result.dryRun
    ? `Dry run for ${result.targetDir} (nothing was written):`
    : result.changed
      ? `${result.mode === "migrate" ? "Migrated" : "Synced"} ${result.targetDir}:`
      : `Nothing to change in ${result.targetDir}:`;
  const width = Math.max(...result.actions.map((entry) => entry.action.length));
  const rows = result.actions.map(
    (entry) => `  ${entry.action.padEnd(width)}  ${entry.path}${entry.detail ? ` (${entry.detail})` : ""}\n`,
  );
  let report = `\n${heading}\n${rows.join("")}`;

  if (result.warnings.length > 0) report += `\nWarnings:\n${bullets(result.warnings)}`;
  report += needsPathsPreview(result);
  if (result.mode === "migrate" && !result.dryRun) {
    report += `\nNext:\n${numbered([
      "Move any project-specific rules from CLAUDE.md.bak into Engineering Conventions.",
      ...(result.needsPaths.length > 0 ? [needsPathsStep(result)] : []),
      "Fill the FILL notes in CLAUDE.md, then restart Claude Code.",
    ])}`;
  }

  return report;
}

const SYNC_FLAGS = [
  ["dryRun", "--dry-run"],
  ["migrate", "--migrate"],
  ["force", "--force"],
];

function syncCommand(options) {
  const flags = SYNC_FLAGS.filter(([key]) => options[key]).map(([, flag]) => flag);
  return ["create-agent-orchestrator sync", ...flags].join(" ");
}

async function sameDirectory(a, b) {
  if (a === b) return true;

  try {
    return (await realpath(a)) === (await realpath(b));
  } catch {
    return false;
  }
}

async function syncErrorAdvice(error, targetDir, cwd, options) {
  if (!(error instanceof UsageError) || ![SYNC_NO_DIRECTORY, SYNC_NOT_INITIALIZED].includes(error.code)) return "";

  const elsewhere = options.targetDir !== undefined && !(await sameDirectory(targetDir, cwd));

  if (elsewhere && (await exists(path.join(cwd, CONFIG_FILE)))) {
    return `\n\nThe current folder is an initialized project. To sync it, leave the folder out:\n  ${syncCommand(options)}`;
  }

  return error.code === SYNC_NO_DIRECTORY
    ? " Pass the folder of a project that create-agent-orchestrator has initialized, or run sync inside that project with no folder."
    : "";
}

async function runSync(targetDir, cwd, options) {
  let result;

  try {
    result = await syncProject(targetDir, options);
  } catch (error) {
    const advice = await syncErrorAdvice(error, targetDir, cwd, options);
    if (advice) error.message += advice;
    throw error;
  }

  process.stdout.write(syncReport(result));
}

function helpText() {
  return `create-agent-orchestrator

Set up a Claude Code agent team in a new or existing project: the main session is the
Orchestrator, every other agent owns its own directories, and only the user merges.

Usage:
  npm create agent-orchestrator@latest [target-directory]
  npx create-agent-orchestrator@latest [target-directory] [options]
  npx create-agent-orchestrator@latest sync [target-directory] [sync options]

  For sync, [target-directory] defaults to the current folder: run it inside an
  initialized project and leave the folder out.

Init options:
  -y, --yes                         Use defaults without interactive questions
  -f, --force                       Replace generated files that already exist
                                    (existing agent files are never replaced)
      --dry-run                     Show files without writing them
      --no-github                   Do not create GitHub templates
      --project-name <name>         Project display name
      --one-liner <text>            What the project is, in a few words
      --stack <technologies>        Main stack or technologies
      --agents <roster>             Comma-separated roster agents, each "name" or
                                    "name=path+path", for example
                                    "backend-engineer=src+test,auditor"
      --dev-command <command>       Command that starts the app (default: npm run dev)
      --test-command <command>      Command that runs all tests (default: npm test)
      --test-single-command <cmd>   Command that runs a single test
      --build-command <command>     Build command
      --build-output <paths>        Comma-separated build output paths nobody owns
      --setup-commands <commands>   Comma-separated commands that prepare a worktree
      --deploy-target <text>        Where and how the project deploys
      --staging-branch <name>       Staging branch (default: staging)
      --production-branch <name>    Production branch (default: main)

  Pass "none" to a command option to leave it out.
  Starter roles for --agents:
    ${STARTER_ROLES.map((role) => role.name).join(", ")}

Sync refreshes the managed sections of CLAUDE.md and unmodified GitHub templates in a
project that is already initialized. It never changes an existing agent team: files in
${AGENTS_DIR}/ and the roster rows in CLAUDE.md are left as they are.

Sync options:
      --dry-run                     Show what would change without writing
      --migrate                     Convert a project created by 0.1.x; the previous
                                    CLAUDE.md and config are kept as .bak files
  -f, --force                       Also replace GitHub templates that were edited locally

  -h, --help                        Show help
  -v, --version                     Show version
`;
}

async function runInit(targetDir, options) {
  const interactive = !options.yes && process.stdin.isTTY && process.stdout.isTTY;

  if (!options.yes && !interactive) {
    throw new UsageError("Interactive input requires a TTY. Re-run with --yes and explicit options.");
  }

  const prompter = interactive ? createPrompter() : undefined;

  try {
    const answers = interactive
      ? await collectInteractiveAnswers(options, targetDir, prompter)
      : defaultAnswers(options, targetDir);
    const config = configFromAnswers(answers);
    const agents = await withDirectorySlashes(targetDir, answers.agents);
    const preview = await writeScaffold(targetDir, config, { agents, force: true, dryRun: true });
    let force = options.force;

    if (interactive) {
      process.stdout.write(`\nPlanned files:\n${bullets(preview.files)}`);
      if (preview.kept.length > 0) {
        process.stdout.write(`\nExisting agent files that stay as they are:\n${bullets(preview.kept)}`);
      }
    }

    if (preview.conflicts.length > 0 && !force && interactive) {
      process.stdout.write(`\nExisting generated files:\n${bullets(preview.conflicts)}`);
      force = await prompter.confirm("Replace these files?", false);
    }

    if (interactive && !(await prompter.confirm("Write the planned files?", true))) {
      process.stdout.write("\nInitialization cancelled; no files were written.\n");
      return;
    }

    process.stdout.write(initReport(targetDir, await writeScaffold(targetDir, config, { agents, force, dryRun: options.dryRun })));
  } finally {
    prompter?.close();
  }
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  if (options.version) {
    process.stdout.write(`${await packageVersion()}\n`);
    return;
  }

  const cwd = process.cwd();
  const targetDir = path.resolve(cwd, options.targetDir || ".");

  if (options.command === "sync") {
    await runSync(targetDir, cwd, options);
    return;
  }

  await runInit(targetDir, options);
}
