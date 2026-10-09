import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, UsageError } from "../src/args.js";

test("parseArgs reads a target and initializer options", () => {
  assert.deepEqual(
    parseArgs(["demo", "--yes", "--agents=backend-engineer=src+test,auditor", "--build-command", "npm run build", "--dry-run"]),
    {
      command: "init",
      targetDir: "demo",
      yes: true,
      force: false,
      dryRun: true,
      migrate: false,
      noGithub: false,
      help: false,
      version: false,
      agents: "backend-engineer=src+test,auditor",
      buildCommand: "npm run build",
    },
  );
});

test("parseArgs rejects unknown flags, including options removed in 0.2", () => {
  assert.throws(() => parseArgs(["--unknown"]), UsageError);
  assert.throws(() => parseArgs(["--source-dirs", "src"]), /Unknown option/);
  assert.throws(() => parseArgs(["--project-type", "API"]), /Unknown option/);
});

test("parseArgs rejects missing option values", () => {
  assert.throws(() => parseArgs(["--stack"]), /requires a value/);
});

test("parseArgs treats sync as a command only as the first positional argument", () => {
  const synced = parseArgs(["sync", "demo", "--dry-run", "--migrate", "--force"]);
  assert.equal(synced.command, "sync");
  assert.equal(synced.targetDir, "demo");
  assert.equal(synced.dryRun, true);
  assert.equal(synced.migrate, true);
  assert.equal(synced.force, true);

  assert.equal(parseArgs(["sync"]).targetDir, undefined);
  assert.equal(parseArgs(["--dry-run", "sync"]).command, "sync");

  const directory = parseArgs(["./sync", "--yes"]);
  assert.equal(directory.command, "init");
  assert.equal(directory.targetDir, "./sync");

  assert.throws(() => parseArgs(["demo", "sync"]), /Only one target directory/);
});

test("parseArgs keeps init and sync options apart", () => {
  assert.throws(() => parseArgs(["sync", "--stack", "Node.js"]), /--stack is not a sync option/);
  assert.throws(() => parseArgs(["sync", "--yes"]), /--yes is not a sync option/);
  assert.throws(() => parseArgs(["demo", "--migrate"]), /only valid with the sync command/);
});
