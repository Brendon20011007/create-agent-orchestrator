import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const binPath = fileURLToPath(new URL("../bin/create-agent-orchestrator.js", import.meta.url));

function execute(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], { cwd });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("CLI initializes a project non-interactively", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-orchestrator-cli-"));
  const target = path.join(directory, "demo");

  try {
    const result = await execute(
      [
        target,
        "--yes",
        "--project-name",
        "Demo",
        "--project-type",
        "API",
        "--agents",
        "backend,qa",
        "--source-dirs",
        "src,test",
      ],
      directory,
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Created agent orchestration template/);

    const parsed = JSON.parse(await readFile(path.join(target, ".agent-orchestrator.json"), "utf8"));
    assert.equal(parsed.project.name, "Demo");
    assert.deepEqual(
      parsed.specialists.map(({ capability }) => capability),
      ["backend", "qa"],
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CLI supports a no-write dry run", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-orchestrator-cli-"));
  const target = path.join(directory, "demo");

  try {
    const result = await execute([target, "--yes", "--dry-run"], directory);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Would create/);
    await assert.rejects(() => readFile(path.join(target, "CLAUDE.md"), "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
