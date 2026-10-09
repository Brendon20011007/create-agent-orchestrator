const VALUE_OPTIONS = new Map([
  ["--project-name", "projectName"],
  ["--one-liner", "oneLiner"],
  ["--stack", "stack"],
  ["--agents", "agents"],
  ["--dev-command", "devCommand"],
  ["--test-command", "testCommand"],
  ["--test-single-command", "testSingleCommand"],
  ["--build-command", "buildCommand"],
  ["--setup-commands", "setupCommands"],
  ["--build-output", "buildOutput"],
  ["--deploy-target", "deployTarget"],
  ["--staging-branch", "stagingBranch"],
  ["--production-branch", "productionBranch"],
]);

const BOOLEAN_OPTIONS = new Map([
  ["--yes", "yes"],
  ["-y", "yes"],
  ["--force", "force"],
  ["-f", "force"],
  ["--dry-run", "dryRun"],
  ["--migrate", "migrate"],
  ["--no-github", "noGithub"],
  ["--help", "help"],
  ["-h", "help"],
  ["--version", "version"],
  ["-v", "version"],
]);

const SYNC_OPTIONS = new Set(["dryRun", "migrate", "force", "help", "version"]);

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseArgs(argv) {
  const result = {
    command: "init",
    targetDir: undefined,
    yes: false,
    force: false,
    dryRun: false,
    migrate: false,
    noGithub: false,
    help: false,
    version: false,
  };
  const used = [];
  let positionals = 0;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (BOOLEAN_OPTIONS.has(argument)) {
      result[BOOLEAN_OPTIONS.get(argument)] = true;
      used.push([argument, BOOLEAN_OPTIONS.get(argument)]);
      continue;
    }

    const equalsIndex = argument.indexOf("=");
    const optionName = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);

    if (VALUE_OPTIONS.has(optionName)) {
      const inlineValue = equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);
      const value = inlineValue ?? argv[index + 1];

      if (!value || (inlineValue === undefined && value.startsWith("-"))) {
        throw new UsageError(`${optionName} requires a value.`);
      }

      result[VALUE_OPTIONS.get(optionName)] = value;
      used.push([optionName, VALUE_OPTIONS.get(optionName)]);
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (argument.startsWith("-")) {
      throw new UsageError(`Unknown option: ${argument}`);
    }

    positionals += 1;

    if (positionals === 1 && argument === "sync") {
      result.command = "sync";
      continue;
    }

    if (result.targetDir !== undefined) {
      throw new UsageError("Only one target directory may be provided.");
    }

    result.targetDir = argument;
  }

  for (const [flag, key] of used) {
    if (result.command === "sync" && !SYNC_OPTIONS.has(key)) {
      throw new UsageError(`${flag} is not a sync option. Sync reads its values from .agent-orchestrator.json.`);
    }
    if (result.command === "init" && key === "migrate") {
      throw new UsageError("--migrate is only valid with the sync command.");
    }
  }

  return result;
}
