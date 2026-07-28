const VALUE_OPTIONS = new Map([
  ["--project-name", "projectName"],
  ["--project-type", "projectType"],
  ["--stack", "stack"],
  ["--source-dirs", "sourceDirs"],
  ["--agents", "agents"],
  ["--dev-command", "devCommand"],
  ["--test-command", "testCommand"],
  ["--staging-branch", "stagingBranch"],
  ["--production-branch", "productionBranch"],
]);

const BOOLEAN_OPTIONS = new Map([
  ["--yes", "yes"],
  ["-y", "yes"],
  ["--force", "force"],
  ["-f", "force"],
  ["--dry-run", "dryRun"],
  ["--no-github", "noGithub"],
  ["--help", "help"],
  ["-h", "help"],
  ["--version", "version"],
  ["-v", "version"],
]);

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "UsageError";
  }
}

export function parseArgs(argv) {
  const result = {
    targetDir: undefined,
    yes: false,
    force: false,
    dryRun: false,
    noGithub: false,
    help: false,
    version: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (BOOLEAN_OPTIONS.has(argument)) {
      result[BOOLEAN_OPTIONS.get(argument)] = true;
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
      if (inlineValue === undefined) index += 1;
      continue;
    }

    if (argument.startsWith("-")) {
      throw new UsageError(`Unknown option: ${argument}`);
    }

    if (result.targetDir !== undefined) {
      throw new UsageError("Only one target directory may be provided.");
    }

    result.targetDir = argument;
  }

  return result;
}
