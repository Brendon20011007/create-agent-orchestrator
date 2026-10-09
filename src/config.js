import { UsageError } from "./args.js";

export const CONFIG_FILE = ".agent-orchestrator.json";
export const SCHEMA_VERSION = 2;

const UNSET = /^(none|n\/a|not applicable)$/i;
const LEGACY_UNSET = /^to be confirmed$/i;

export function clean(value) {
  const text = String(value ?? "").trim();
  return UNSET.test(text) ? "" : text;
}

export function splitList(value) {
  if (!value) return [];
  return [...new Set(String(value).split(",").map(clean).filter(Boolean))];
}

function list(value) {
  return Array.isArray(value) ? [...new Set(value.map(clean).filter(Boolean))] : splitList(value);
}

export function validateBranch(name, label) {
  if (!name || /\s/.test(name) || name.startsWith("-") || name.includes("..")) {
    throw new UsageError(`${label} must be a valid branch-like name without spaces.`);
  }
  return name;
}

export function normalizeConfig(raw, fallbackName = "my-project") {
  return {
    schemaVersion: SCHEMA_VERSION,
    project: {
      name: String(raw.project?.name ?? "").trim() || fallbackName,
      oneLiner: clean(raw.project?.oneLiner),
      stack: clean(raw.project?.stack),
    },
    commands: {
      dev: clean(raw.commands?.dev),
      test: clean(raw.commands?.test),
      testSingle: clean(raw.commands?.testSingle),
      build: clean(raw.commands?.build),
      worktreeSetup: list(raw.commands?.worktreeSetup),
    },
    branches: {
      staging: validateBranch(raw.branches?.staging || "staging", "Staging branch"),
      production: validateBranch(raw.branches?.production || "main", "Production branch"),
    },
    paths: { buildOutput: list(raw.paths?.buildOutput) },
    deploy: { target: clean(raw.deploy?.target) },
    github: { enabled: raw.github?.enabled !== false },
    team: {
      hr: raw.team ? clean(raw.team.hr) : "hr-manager",
      subOrchestrator: raw.team ? clean(raw.team.subOrchestrator) : "orchestrator",
    },
    generated: { ...(raw.generated ?? {}) },
  };
}

export function convertConfig(raw, fallbackName) {
  if (raw.schemaVersion === SCHEMA_VERSION) return normalizeConfig(raw, fallbackName);

  const stack = clean(raw.project?.stack);

  return normalizeConfig(
    {
      project: { name: raw.project?.name, stack: LEGACY_UNSET.test(stack) ? "" : stack },
      commands: { dev: raw.commands?.dev, test: raw.commands?.test },
      branches: { staging: raw.branches?.staging, production: raw.branches?.production },
      github: { enabled: raw.github?.enabled !== false },
    },
    fallbackName,
  );
}
