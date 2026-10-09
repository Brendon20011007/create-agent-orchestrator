#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UsageError } from "../src/args.js";

const BUMPS = ["patch", "minor", "major"];
const PLAIN_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const NOT_FOUND = /\bE404\b|404 Not Found/i;

function usage() {
  return `Usage:
  npm run release                  Release the version in package.json
  npm run release -- <bump>        Bump first: patch, minor, major, or an explicit x.y.z
  npm run release -- --dry-run     Run the checks and show the plan; change nothing
`;
}

function parseReleaseArgs(argv) {
  const options = { bump: "", dryRun: false, help: false };

  for (const argument of argv) {
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument.startsWith("-")) throw new UsageError(`Unknown option: ${argument}`);
    else if (options.bump) throw new UsageError("Only one version argument may be provided.");
    else options.bump = argument;
  }

  return options;
}

function versionParts(version) {
  return PLAIN_VERSION.exec(version)?.slice(1).map(Number);
}

function isHigher(next, current) {
  const index = next.findIndex((part, position) => part !== current[position]);
  return index !== -1 && next[index] > current[index];
}

export function resolveTarget(current, bump) {
  if (!bump) return current;

  const parts = versionParts(current);

  if (BUMPS.includes(bump)) {
    if (!parts) {
      throw new UsageError(`Cannot apply "${bump}" to version ${current}. Pass an explicit x.y.z version.`);
    }
    const [major, minor, patch] = parts;
    if (bump === "major") return `${major + 1}.0.0`;
    return bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  }

  const next = versionParts(bump);

  if (!next) {
    throw new UsageError(`Invalid release argument "${bump}". Use patch, minor, major, or an explicit x.y.z version.`);
  }
  if (parts && !isHigher(next, parts)) {
    throw new UsageError(
      bump === current
        ? `${bump} is already the current version. Run without an argument to release it.`
        : `${bump} is lower than the current version ${current}.`,
    );
  }

  return bump;
}

function text(result) {
  return String(result.stdout ?? "").trim();
}

function reason(result) {
  const lines = (String(result.stderr ?? "").trim() || text(result))
    .split(/\r?\n/)
    .map((line) => line.replace(/^npm (error|ERR!)\s*/i, "").trim())
    .filter(Boolean);
  const end = lines.findIndex((line) => line.startsWith("A complete log of this run"));

  return (end === -1 ? lines : lines.slice(0, end)).join("; ").slice(0, 200) || `exit code ${result.status}`;
}

function commits(count) {
  return `${count} commit${count === 1 ? "" : "s"}`;
}

function preconditions(run, { name, target, bump, branch }) {
  const checks = [];
  const check = (ok, passed, failed) => checks.push({ ok, message: ok ? passed : failed });
  const tag = `v${target}`;

  if (!PLAIN_VERSION.test(target)) {
    check(false, "", `${target} is not a plain x.y.z version. Publish a prerelease by hand with npm publish --tag <tag>`);
  }

  const current = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  check(
    current.status === 0 && text(current) === branch,
    `on the production branch (${branch})`,
    current.status === 0
      ? `the current branch is ${text(current)}, not the production branch ${branch}`
      : `could not read the current branch: ${reason(current)}`,
  );

  const status = run("git", ["status", "--porcelain"]);
  check(
    status.status === 0 && text(status) === "",
    "the working tree is clean",
    status.status === 0
      ? "the working tree has uncommitted changes"
      : `could not read the working tree status: ${reason(status)}`,
  );

  const fetched = run("git", ["fetch", "origin"]);

  if (fetched.status !== 0) {
    check(false, "", `git fetch origin failed: ${reason(fetched)}`);
  } else {
    const counted = run("git", ["rev-list", "--left-right", "--count", `HEAD...origin/${branch}`]);
    const [ahead, behind] = text(counted).split(/\s+/).map(Number);

    if (counted.status !== 0 || !Number.isInteger(ahead) || !Number.isInteger(behind)) {
      check(false, "", `could not compare HEAD with origin/${branch}: ${reason(counted)}`);
    } else if (ahead > 0 && behind > 0) {
      check(false, "", `HEAD has diverged from origin/${branch} (${ahead} ahead, ${behind} behind)`);
    } else {
      check(
        behind === 0,
        `not behind origin/${branch} (${commits(ahead)} to push)`,
        `HEAD is ${commits(behind)} behind origin/${branch}; pull first`,
      );
    }
  }

  const who = run("npm", ["whoami"]);
  check(who.status === 0, `logged in to npm as ${text(who)}`, `npm whoami failed; run npm login first (${reason(who)})`);

  const viewed = run("npm", ["view", `${name}@${target}`, "version", "--json"]);

  if (viewed.status === 0 ? text(viewed) === "" : NOT_FOUND.test(`${viewed.stdout}\n${viewed.stderr}`)) {
    check(true, `${name}@${target} is not on npm yet`);
  } else {
    check(
      false,
      "",
      viewed.status === 0
        ? `${name}@${target} is already on npm`
        : `could not check npm for ${name}@${target}: ${reason(viewed)}`,
    );
  }

  const head = text(run("git", ["rev-parse", "HEAD"]));
  const tagged = run("git", ["rev-parse", "-q", "--verify", `refs/tags/${tag}^{commit}`]);
  const tagExists = tagged.status === 0 && text(tagged) !== "";

  if (!tagExists) {
    check(true, `tag ${tag} does not exist yet`);
  } else if (bump) {
    check(false, "", `tag ${tag} already exists`);
  } else {
    check(
      text(tagged) === head,
      `tag ${tag} already points at HEAD`,
      `tag ${tag} exists but points at ${text(tagged).slice(0, 7)}, not HEAD (${head.slice(0, 7)})`,
    );
  }

  return { checks, tagExists };
}

function display({ command, args }) {
  return [command, ...args.map((argument) => (/\s/.test(argument) ? `"${argument}"` : argument))].join(" ");
}

export function runRelease(argv, { run, pkg, config = {}, env = {}, log = console.log }) {
  const options = parseReleaseArgs(argv);

  if (options.help) {
    log(usage());
    return { code: 0, failures: [] };
  }

  const dryRun = options.dryRun || env.npm_config_dry_run === "true";
  const version = resolveTarget(pkg.version, options.bump);
  const branch = config.branches?.production || "main";
  const tag = `v${version}`;
  const refused = (failures) => ({ code: 1, version, dryRun, failures });

  log(
    `Releasing ${pkg.name} ${version}${options.bump ? ` (currently ${pkg.version})` : ""}${dryRun ? " — dry run" : ""}`,
  );
  log("\nPreconditions:");

  const { checks, tagExists } = preconditions(run, { name: pkg.name, target: version, bump: options.bump, branch });
  const failures = checks.filter((entry) => !entry.ok).map((entry) => entry.message);

  for (const entry of checks) log(`  ${entry.ok ? "ok  " : "FAIL"}  ${entry.message}`);

  if (failures.length > 0) {
    log(`\nRelease refused: ${failures.length} of ${checks.length} preconditions failed. Nothing was changed.`);
    return refused(failures);
  }

  log("\nRunning npm run check");

  if (run("npm", ["run", "check"], { inherit: true }).status !== 0) {
    log("\nnpm run check failed. Nothing was committed, tagged, pushed, or published.");
    return refused(["npm run check failed"]);
  }

  const steps = [
    options.bump
      ? { command: "npm", args: ["version", version, "-m", "Release %s"], failed: "Nothing was pushed or published." }
      : tagExists
        ? null
        : { command: "git", args: ["tag", "-a", tag, "-m", `Release ${version}`], failed: "Nothing was pushed or published." },
    {
      command: "git",
      args: ["push", "--atomic", "origin", branch, `refs/tags/${tag}`],
      inherit: true,
      failed: `Nothing was published. Fix the cause, then run "npm run release" again with no argument.`,
    },
    {
      command: "npm",
      args: ["publish"],
      inherit: true,
      failed: `The commit and ${tag} are already on origin. Run "npm run release" again with no argument to finish publishing ${version}.`,
    },
  ].filter(Boolean);

  if (dryRun) {
    log("\nDry run: nothing was committed, tagged, pushed, or published. A real run would now run:");
    steps.forEach((step, index) => log(`  ${index + 1}. ${display(step)}`));
    if (!options.bump && tagExists) log(`  (${tag} already points at HEAD, so no tag would be created)`);
    return { code: 0, version, dryRun, failures: [] };
  }

  for (const step of steps) {
    log(`\n> ${display(step)}`);

    const result = run(step.command, step.args, { inherit: Boolean(step.inherit) });

    if (result.status !== 0) {
      const detail = step.inherit ? "" : ` (${reason(result)})`;
      log(`\n${display(step)} failed${detail}. ${step.failed}`);
      return refused([`${display(step)} failed`]);
    }
  }

  const commit = text(run("git", ["rev-parse", "HEAD"]));

  log(`\nReleased ${pkg.name} ${version}`);
  log(`  npm:    https://www.npmjs.com/package/${pkg.name}/v/${version}`);
  log(`  commit: ${commit} on origin/${branch}, tagged ${tag}`);

  return { code: 0, version, dryRun, failures: [], commit };
}

function spawnRunner(cwd) {
  const shell = process.platform === "win32";

  return (command, args, { inherit = false } = {}) => {
    const result = spawnSync(command, shell ? args.map((argument) => (/\s/.test(argument) ? `"${argument}"` : argument)) : args, {
      cwd,
      shell,
      encoding: "utf8",
      stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr || result.error?.message || "",
    };
  };
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    if (fallback !== undefined && error?.code === "ENOENT") return fallback;
    throw error;
  }
}

function main() {
  const root = fileURLToPath(new URL("..", import.meta.url));

  try {
    const result = runRelease(process.argv.slice(2), {
      run: spawnRunner(root),
      pkg: readJson(path.join(root, "package.json")),
      config: readJson(path.join(root, ".agent-orchestrator.json"), {}),
      env: process.env,
    });
    process.exitCode = result.code;
  } catch (error) {
    console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof UsageError) console.error(`\n${usage()}`);
    process.exitCode = 1;
  }
}

function isMain() {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) main();
