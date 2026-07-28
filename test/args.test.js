import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs, UsageError } from "../src/args.js";

test("parseArgs reads a target and initializer options", () => {
  assert.deepEqual(
    parseArgs([
      "demo",
      "--yes",
      "--agents=frontend,qa",
      "--source-dirs",
      "src,tests",
      "--dry-run",
    ]),
    {
      targetDir: "demo",
      yes: true,
      force: false,
      dryRun: true,
      noGithub: false,
      help: false,
      version: false,
      agents: "frontend,qa",
      sourceDirs: "src,tests",
    },
  );
});

test("parseArgs rejects unknown flags", () => {
  assert.throws(() => parseArgs(["--unknown"]), UsageError);
});

test("parseArgs rejects missing option values", () => {
  assert.throws(() => parseArgs(["--stack"]), /requires a value/);
});
