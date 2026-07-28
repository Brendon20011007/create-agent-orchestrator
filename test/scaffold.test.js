import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { listConflicts, writeScaffold } from "../src/scaffold.js";

function config() {
  return {
    schemaVersion: 1,
    project: {
      name: "Example",
      type: "Web application",
      stack: "TypeScript",
      sourceDirectories: ["src", "test"],
    },
    commands: { dev: "npm run dev", test: "npm test" },
    branches: { staging: "staging", production: "main" },
    github: { enabled: true, milestonePolicy: "create-if-missing" },
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
    specialists: [
      {
        capability: "Frontend",
        purpose: "Build approved UI tasks",
        allowedPaths: ["src/ui"],
        status: "requested",
      },
    ],
  };
}

test("writeScaffold creates customized policy and GitHub templates", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-orchestrator-"));

  try {
    const result = await writeScaffold(directory, config());
    assert.deepEqual(result.files, [
      "CLAUDE.md",
      ".agent-orchestrator.json",
      ".github/ISSUE_TEMPLATE/taskboard.md",
      ".github/PULL_REQUEST_TEMPLATE.md",
    ]);

    const claudeMd = await readFile(path.join(directory, "CLAUDE.md"), "utf8");
    assert.match(claudeMd, /only permanent roles are the Main Agent and the HR Agent/i);
    assert.match(claudeMd, /Frontend/);
    assert.match(claudeMd, /src\/ui/);

    const savedConfig = JSON.parse(
      await readFile(path.join(directory, ".agent-orchestrator.json"), "utf8"),
    );
    assert.deepEqual(savedConfig.permanentRoles, ["Main Agent", "HR Agent"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writeScaffold refuses generated file conflicts without force", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-orchestrator-"));

  try {
    await writeFile(path.join(directory, "CLAUDE.md"), "keep me", "utf8");
    assert.deepEqual(await listConflicts(directory, config()), ["CLAUDE.md"]);
    await assert.rejects(() => writeScaffold(directory, config()), /Refusing to overwrite/);
    assert.equal(await readFile(path.join(directory, "CLAUDE.md"), "utf8"), "keep me");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("dry run reports files without creating them", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-orchestrator-"));

  try {
    const result = await writeScaffold(directory, config(), { dryRun: true });
    assert.equal(result.dryRun, true);
    assert.deepEqual(await listConflicts(directory, config()), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("writeScaffold refuses to write through a generated-file symlink", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-orchestrator-"));
  const external = path.join(directory, "external.md");

  try {
    await writeFile(external, "do not replace", "utf8");
    const { symlink } = await import("node:fs/promises");
    await symlink(external, path.join(directory, "CLAUDE.md"));
    await assert.rejects(
      () => writeScaffold(directory, config(), { force: true }),
      /symbolic link/,
    );
    assert.equal(await readFile(external, "utf8"), "do not replace");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
