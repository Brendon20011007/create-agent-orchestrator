import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { parseArgs, UsageError } from "./args.js";
import { createPrompter } from "./prompts.js";
import { listConflicts, writeScaffold } from "./scaffold.js";

const PROJECT_TYPES = [
  "Web application",
  "API or backend service",
  "Library or package",
  "Mobile application",
  "Data or analytics project",
  "Infrastructure or platform",
  "Other",
];

function splitList(value) {
  if (!value) return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function validateProjectName(name) {
  if (!name.trim()) throw new UsageError("Project name cannot be empty.");
  if (/\r|\n/.test(name)) throw new UsageError("Project name must be a single line.");
  return name.trim();
}

function validateBranch(name, label) {
  if (!name || /\s/.test(name) || name.startsWith("-") || name.includes("..")) {
    throw new UsageError(`${label} must be a valid branch-like name without spaces.`);
  }
  return name;
}

async function packageVersion() {
  const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  return packageJson.version;
}

function defaultConfig(options, targetDir) {
  const sourceDirectories = splitList(options.sourceDirs || "src");
  const capabilities = splitList(options.agents);

  return {
    schemaVersion: 1,
    project: {
      name: validateProjectName(options.projectName || path.basename(targetDir) || "my-project"),
      type: options.projectType || "Other",
      stack: options.stack || "To be confirmed",
      sourceDirectories,
    },
    commands: {
      dev: options.devCommand || "npm run dev",
      test: options.testCommand || "npm test",
    },
    branches: {
      staging: validateBranch(options.stagingBranch || "staging", "Staging branch"),
      production: validateBranch(options.productionBranch || "main", "Production branch"),
    },
    github: {
      enabled: !options.noGithub,
      milestonePolicy: "create-if-missing",
    },
    orchestration: {
      onboardingApproval: "per-task",
      mainMayImplement: false,
      maxConcurrentSpecialists: 3,
    },
    approvals: {
      bindToCommit: true,
      invalidateOnNewCommit: true,
      requirePrOpenAuthorization: true,
      requireMergeAuthorization: true,
    },
    permanentRoles: ["Main Agent", "HR Agent"],
    specialists: capabilities.map((capability) => ({
      capability,
      purpose: `Provide ${capability} expertise for an approved task`,
      allowedPaths: sourceDirectories,
      status: "requested",
    })),
  };
}

async function collectInteractiveConfig(options, targetDir, prompter) {
  const projectName = validateProjectName(
    options.projectName || (await prompter.text("Project name", path.basename(targetDir) || "my-project")),
  );
  const projectType =
    options.projectType || (await prompter.select("What kind of project is this?", PROJECT_TYPES));
  const stack = options.stack || (await prompter.text("Main technologies or stack", "To be confirmed"));
  const sourceDirectories = splitList(
    options.sourceDirs || (await prompter.text("Source folders (comma-separated)", "src")),
  );
  const devCommand = options.devCommand || (await prompter.text("Development server command", "npm run dev"));
  const testCommand = options.testCommand || (await prompter.text("Primary test command", "npm test"));
  const stagingBranch = validateBranch(
    options.stagingBranch || (await prompter.text("Staging branch", "staging")),
    "Staging branch",
  );
  const productionBranch = validateBranch(
    options.productionBranch || (await prompter.text("Production branch", "main")),
    "Production branch",
  );

  process.stdout.write(
    "\nOnly Main Agent and HR Agent are permanent. Any names below are temporary capability requests that HR must scope and onboard after user approval.\n",
  );
  const capabilities = splitList(
    options.agents ||
      (await prompter.text(
        "What specialist capabilities might the first task need? (comma-separated; blank for none)",
        "",
      )),
  );
  const specialists = [];

  for (const capability of capabilities) {
    const purpose = await prompter.text(
      `Purpose of the temporary ${capability} specialist`,
      `Provide ${capability} expertise for an approved task`,
    );
    const allowedPaths = splitList(
      await prompter.text(
        `Proposed writable paths for ${capability} (comma-separated; HR will verify)`,
        sourceDirectories.join(","),
      ),
    );
    specialists.push({ capability, purpose, allowedPaths, status: "requested" });
  }

  const githubEnabled = options.noGithub
    ? false
    : await prompter.confirm("Generate GitHub issue and pull request templates?", true);

  return {
    schemaVersion: 1,
    project: { name: projectName, type: projectType, stack, sourceDirectories },
    commands: { dev: devCommand, test: testCommand },
    branches: { staging: stagingBranch, production: productionBranch },
    github: { enabled: githubEnabled, milestonePolicy: "create-if-missing" },
    orchestration: {
      onboardingApproval: "per-task",
      mainMayImplement: false,
      maxConcurrentSpecialists: 3,
    },
    approvals: {
      bindToCommit: true,
      invalidateOnNewCommit: true,
      requirePrOpenAuthorization: true,
      requireMergeAuthorization: true,
    },
    permanentRoles: ["Main Agent", "HR Agent"],
    specialists,
  };
}

function helpText() {
  return `create-agent-orchestrator

Create a user-approved agent orchestration policy for a new or existing project.

Usage:
  npm create agent-orchestrator@latest [target-directory]
  npx create-agent-orchestrator@latest [target-directory] [options]

Options:
  -y, --yes                      Use defaults without interactive questions
  -f, --force                    Replace generated files that already exist
      --dry-run                  Show files without writing them
      --no-github                Do not create GitHub templates
      --project-name <name>      Project display name
      --project-type <type>      Project type
      --stack <technologies>     Main stack or technologies
      --source-dirs <paths>      Comma-separated source directories
      --agents <capabilities>    Comma-separated temporary specialist requests
      --dev-command <command>    Development server command
      --test-command <command>   Primary test command
      --staging-branch <name>    Staging branch (default: staging)
      --production-branch <name> Production branch (default: main)
  -h, --help                     Show help
  -v, --version                  Show version
`;
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

  const targetDir = path.resolve(process.cwd(), options.targetDir || ".");
  const interactive = !options.yes && process.stdin.isTTY && process.stdout.isTTY;

  if (!options.yes && !interactive) {
    throw new UsageError("Interactive input requires a TTY. Re-run with --yes and explicit options.");
  }

  const prompter = interactive ? createPrompter() : undefined;

  try {
    const config = interactive
      ? await collectInteractiveConfig(options, targetDir, prompter)
      : defaultConfig(options, targetDir);

    const conflicts = await listConflicts(targetDir, config);
    let force = options.force;

    const preview = await writeScaffold(targetDir, config, { force: true, dryRun: true });

    if (interactive) {
      process.stdout.write(`\nPlanned files:\n${preview.files.map((file) => `  - ${file}`).join("\n")}\n`);
    }

    if (conflicts.length > 0 && !force && interactive) {
      process.stdout.write(`\nExisting generated files:\n${conflicts.map((file) => `  - ${file}`).join("\n")}\n`);
      force = await prompter.confirm("Replace these files?", false);
    }

    if (interactive && !(await prompter.confirm("Write the planned files?", true))) {
      process.stdout.write("\nInitialization cancelled; no files were written.\n");
      return;
    }

    const result = await writeScaffold(targetDir, config, { force, dryRun: options.dryRun });
    const action = result.dryRun ? "Would create" : "Created";

    process.stdout.write(`\n${action} agent orchestration template in ${targetDir}:\n`);
    result.files.forEach((file) => process.stdout.write(`  - ${file}\n`));

    if (!result.dryRun) {
      process.stdout.write(
        "\nNext: review CLAUDE.md, confirm any requested specialist capabilities, and let HR onboard only the agents required for a concrete GitHub issue.\n",
      );
    }
  } finally {
    prompter?.close();
  }
}
