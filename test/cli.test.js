import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { collectInteractiveAnswers } from "../src/cli.js";

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

async function withDirectory(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-orchestrator-cli-"));

  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("CLI initializes a project non-interactively, then syncs it", async () => {
  await withDirectory(async (directory) => {
    const target = path.join(directory, "demo");
    await mkdir(path.join(target, "src"), { recursive: true });

    const created = await execute(
      [target, "--yes", "--project-name", "Demo", "--stack", "Node.js", "--agents", "backend-engineer=src+test,auditor", "--dev-command", "none"],
      directory,
    );

    assert.equal(created.code, 0, created.stderr);
    assert.match(created.stdout, /Created the agent team/);
    assert.match(created.stdout, /\.claude\/agents\/backend-engineer\.md/);
    assert.match(created.stdout, /Restart Claude Code/);
    assert.doesNotMatch(created.stdout, /hire the first engineers/);

    const parsed = JSON.parse(await readFile(path.join(target, ".agent-orchestrator.json"), "utf8"));
    assert.equal(parsed.project.name, "Demo");
    assert.equal(parsed.commands.dev, "");
    assert.equal(parsed.commands.test, "npm test");

    const claudeMd = await readFile(path.join(target, "CLAUDE.md"), "utf8");
    assert.match(claudeMd, /^\| Backend Engineer \| `backend-engineer` \|.*\| `src\/`, `test` \|$/m);
    assert.deepEqual((await readdir(path.join(target, ".claude/agents"))).sort(), [
      "auditor.md",
      "backend-engineer.md",
      "hr-manager.md",
      "orchestrator.md",
    ]);

    const synced = await execute(["sync", target], directory);
    assert.equal(synced.code, 0, synced.stderr);
    assert.match(synced.stdout, /Nothing to change/);
    assert.match(synced.stdout, /4 existing agent files left untouched/);

    await writeFile(path.join(target, "CLAUDE.md"), claudeMd.replace("Delegate, don't do", "Do it yourself"), "utf8");

    const preview = await execute(["sync", "--dry-run"], target);
    assert.equal(preview.code, 0, preview.stderr);
    assert.match(preview.stdout, /Dry run/);
    assert.match(preview.stdout, /update\s+CLAUDE\.md \(1 managed section: orchestrator-rules\)/);

    const repaired = await execute(["sync"], target);
    assert.equal(repaired.code, 0, repaired.stderr);
    assert.match(repaired.stdout, /Synced/);
    assert.equal(await readFile(path.join(target, "CLAUDE.md"), "utf8"), claudeMd);
  });
});

test("CLI tells an empty roster to hire through the HR Manager", async () => {
  await withDirectory(async (directory) => {
    const result = await execute(["demo", "--yes", "--no-github"], directory);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Ask the HR Manager to hire the first engineers/);
    assert.deepEqual((await readdir(path.join(directory, "demo"))).sort(), [
      ".agent-orchestrator.json",
      ".claude",
      ".gitignore",
      "CLAUDE.md",
    ]);
  });
});

test("CLI rejects a path with two owners and writes nothing", async () => {
  await withDirectory(async (directory) => {
    const result = await execute(["demo", "--yes", "--agents", "backend-engineer=src,frontend-engineer=src"], directory);

    assert.equal(result.code, 1);
    assert.match(result.stderr, /No path may have two owners/);
    assert.deepEqual(await readdir(directory), []);
  });
});

test("CLI supports a no-write dry run", async () => {
  await withDirectory(async (directory) => {
    const target = path.join(directory, "demo");
    const result = await execute([target, "--yes", "--dry-run"], directory);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Would create/);
    await assert.rejects(() => readFile(path.join(target, "CLAUDE.md"), "utf8"));
  });
});

test("CLI sync refuses a 0.1 project until --migrate is passed", async () => {
  await withDirectory(async (directory) => {
    await mkdir(path.join(directory, ".claude/agents"), { recursive: true });
    await writeFile(path.join(directory, "CLAUDE.md"), "# Agent Orchestration Guide — Demo\n", "utf8");
    await writeFile(
      path.join(directory, ".agent-orchestrator.json"),
      JSON.stringify({ schemaVersion: 1, project: { name: "Demo" }, commands: { dev: "npm run dev", test: "npm test" } }),
      "utf8",
    );
    await writeFile(path.join(directory, ".claude/agents/hr-agent.md"), "---\nname: hr-agent\n---\n", "utf8");
    await writeFile(
      path.join(directory, ".claude/agents/frontend.md"),
      "---\nname: frontend\n---\n\n## Scope\n\nYou may modify only `web/**`, except:\n\n- `web/vendor/`\n",
      "utf8",
    );

    const refused = await execute(["sync"], directory);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /sync --migrate/);
    assert.deepEqual((await readdir(directory)).sort(), [".agent-orchestrator.json", ".claude", "CLAUDE.md"]);

    const migrated = await execute(["sync", ".", "--migrate"], directory);
    assert.equal(migrated.code, 0, migrated.stderr);
    assert.match(migrated.stdout, /Migrated/);
    assert.match(migrated.stdout, /backup\s+CLAUDE\.md\.bak/);
    assert.match(migrated.stdout, /2 existing agent files left untouched/);
    assert.match(migrated.stdout, /existing team was left unchanged/);
    assert.deepEqual((await readdir(path.join(directory, ".claude/agents"))).sort(), ["frontend.md", "hr-agent.md"]);

    const [beforeNext, next] = migrated.stdout.split("\nNext:\n");
    assert.doesNotMatch(beforeNext, /Directories owned/);
    assert.match(next, /Fill in the "Directories owned" cells for `frontend` in the CLAUDE\.md roster\./);
    assert.match(next, /The team's HR agent \(`hr-agent`\) can fill them in, or edit the table by hand\./);
    assert.match(next, /Sync keeps roster edits\./);
    assert.match(
      await readFile(path.join(directory, "CLAUDE.md"), "utf8"),
      /^\| Frontend \| `frontend` \| See its agent file \| Defined in its agent file \|$/m,
    );
  });
});

test("CLI init names adopted agents whose roster cells still need paths", async () => {
  await withDirectory(async (directory) => {
    await mkdir(path.join(directory, ".claude/agents"), { recursive: true });
    await writeFile(
      path.join(directory, ".claude/agents/designer.md"),
      "---\nname: designer\ndescription: Draws the screens.\n---\n\n## Scope\n\nYou may read freely from:\n\n- `web/`\n",
      "utf8",
    );

    const preview = await execute([".", "--yes", "--no-github", "--dry-run"], directory);
    assert.equal(preview.code, 0, preview.stderr);
    assert.match(preview.stdout, /Roster rows that would read "Defined in its agent file"[^\n]*\n  - designer\n/);

    const created = await execute([".", "--yes", "--no-github"], directory);
    assert.equal(created.code, 0, created.stderr);
    assert.doesNotMatch(created.stdout, /Warnings:/);
    assert.match(created.stdout, /Fill in the "Directories owned" cells for `designer` in the CLAUDE\.md roster\./);
    assert.match(created.stdout, /The team's HR agent \(`hr-manager`\) can fill them in/);
    assert.match(
      await readFile(path.join(directory, "CLAUDE.md"), "utf8"),
      /^\| Designer \| `designer` \| Draws the screens\. \| Defined in its agent file \|$/m,
    );
  });
});

test("CLI help documents both commands", async () => {
  const result = await execute(["--help"], tmpdir());

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /create-agent-orchestrator@latest sync \[target-directory\]/);
  assert.match(result.stdout, /--migrate/);
  assert.match(result.stdout, /--agents <roster>/);
  assert.doesNotMatch(result.stdout, /--source-dirs|--project-type/);
});

test("interactive answers cover the roster and re-ask on an ownership clash", async () => {
  const answers = [
    "Demo",
    "a booking tool",
    "Node.js",
    "none",
    "",
    "",
    "",
    "",
    "npm install, npm run build",
    "develop",
    "",
    "",
    "9",
    "3, auditor, copywriter",
    "src, test",
    "src",
    "content",
  ];
  const asked = [];
  const written = [];
  const prompter = {
    async text(message, defaultValue = "") {
      asked.push(message);
      return answers.shift() || defaultValue;
    },
    async confirm() {
      return false;
    },
  };

  const result = await collectInteractiveAnswers({}, "/projects/demo", prompter, { write: (text) => written.push(text) });

  assert.deepEqual(answers, []);
  assert.equal(result.projectName, "Demo");
  assert.equal(result.devCommand, "none");
  assert.equal(result.testCommand, "npm test");
  assert.equal(result.stagingBranch, "develop");
  assert.equal(result.productionBranch, "main");
  assert.equal(result.githubEnabled, false);
  assert.deepEqual(result.agents, [
    { name: "backend-engineer", owns: ["src", "test"] },
    { name: "auditor", owns: [] },
    { name: "copywriter", owns: ["content"] },
  ]);
  assert.ok(written.some((text) => /no starter role numbered 9/.test(text)));
  assert.ok(written.some((text) => /Already owned by another role: src/.test(text)));
  assert.ok(!asked.some((message) => /Paths owned by auditor/.test(message)));
});
