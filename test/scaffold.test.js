import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { UsageError } from "../src/args.js";
import { normalizeConfig } from "../src/config.js";
import { contentHash, listConflicts, writeScaffold } from "../src/scaffold.js";

const AGENTS = [
  { name: "backend-engineer", owns: ["src/", "test/"] },
  { name: "frontend-engineer", owns: ["web/"] },
  { name: "auditor", owns: [] },
];

function config(overrides = {}) {
  return normalizeConfig({
    project: { name: "Example", oneLiner: "a ticketing system", stack: "TypeScript" },
    commands: { dev: "npm run dev", test: "npm test" },
    branches: { staging: "staging", production: "main" },
    ...overrides,
  });
}

async function withDirectory(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-orchestrator-"));

  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("writeScaffold creates the roster structure, agent files, and GitHub templates", async () => {
  await withDirectory(async (directory) => {
    const result = await writeScaffold(directory, config(), { agents: AGENTS });

    assert.deepEqual(result.files, [
      "CLAUDE.md",
      ".agent-orchestrator.json",
      ".claude/agents/orchestrator.md",
      ".claude/agents/hr-manager.md",
      ".claude/agents/backend-engineer.md",
      ".claude/agents/frontend-engineer.md",
      ".claude/agents/auditor.md",
      ".github/ISSUE_TEMPLATE/taskboard.md",
      ".github/PULL_REQUEST_TEMPLATE.md",
      ".gitignore",
    ]);
    assert.deepEqual(result.kept, []);
    assert.deepEqual(result.needsPaths, []);

    for (const relativePath of result.files) {
      const contents = await readFile(path.join(directory, relativePath), "utf8");
      assert.doesNotMatch(contents, /\{\{[A-Z][A-Z0-9_]*\}\}/, relativePath);
    }

    for (const file of await readdir(path.join(directory, ".claude/agents"))) {
      const contents = await readFile(path.join(directory, ".claude/agents", file), "utf8");
      assert.ok(contents.startsWith(`---\nname: ${file.replace(/\.md$/, "")}\n`), file);
    }

    const claudeMd = await readFile(path.join(directory, "CLAUDE.md"), "utf8");
    assert.match(claudeMd, /It never writes code itself/);
    assert.match(claudeMd, /^\| Frontend Engineer \| `frontend-engineer` \|.*\| `web\/` \|$/m);

    const saved = JSON.parse(await readFile(path.join(directory, ".agent-orchestrator.json"), "utf8"));
    const taskboard = await readFile(path.join(directory, ".github/ISSUE_TEMPLATE/taskboard.md"), "utf8");
    assert.equal(saved.schemaVersion, 2);
    assert.deepEqual(saved.team, { hr: "hr-manager", subOrchestrator: "orchestrator" });
    assert.equal(saved.generated[".github/ISSUE_TEMPLATE/taskboard.md"], contentHash(taskboard));
    assert.equal(saved.roster, undefined);
    assert.equal(await readFile(path.join(directory, ".gitignore"), "utf8"), "worktrees/\n");
  });
});

test("writeScaffold skips GitHub files when GitHub planning is off", async () => {
  await withDirectory(async (directory) => {
    const result = await writeScaffold(directory, config({ github: { enabled: false } }));

    assert.deepEqual(result.files, [
      "CLAUDE.md",
      ".agent-orchestrator.json",
      ".claude/agents/orchestrator.md",
      ".claude/agents/hr-manager.md",
      ".gitignore",
    ]);
    assert.deepEqual(await listConflicts(directory, config({ github: { enabled: false } })), [
      "CLAUDE.md",
      ".agent-orchestrator.json",
    ]);
  });
});

test("writeScaffold rejects a path with two owners and writes nothing", async () => {
  await withDirectory(async (directory) => {
    await assert.rejects(
      () =>
        writeScaffold(directory, config(), {
          agents: [
            { name: "backend-engineer", owns: ["src/"] },
            { name: "frontend-engineer", owns: ["src"] },
          ],
        }),
      (error) => error instanceof UsageError && /`src` is owned by backend-engineer and frontend-engineer/.test(error.message),
    );
    assert.deepEqual(await readdir(directory), []);
  });
});

test("writeScaffold never overwrites an existing agent file, even with force", async () => {
  await withDirectory(async (directory) => {
    const agents = path.join(directory, ".claude/agents");
    await mkdir(agents, { recursive: true });
    await writeFile(path.join(agents, "backend-engineer.md"), "---\nname: backend-engineer\n---\nmine\n", "utf8");
    await writeFile(
      path.join(agents, "designer.md"),
      "---\nname: designer\ndescription: Draws the screens.\n---\n\n## Scope — files you own\n\n- `design/`\n",
      "utf8",
    );
    await writeFile(
      path.join(agents, "researcher.md"),
      "---\nname: researcher\ndescription: Reads the code and reports.\n---\n\n## Scope\n\nYou may read freely from:\n\n- `src/`\n- `web/`\n\nYou modify nothing.\n",
      "utf8",
    );
    await writeFile(path.join(directory, "CLAUDE.md"), "old", "utf8");

    const result = await writeScaffold(directory, config(), { agents: AGENTS, force: true });

    assert.equal(await readFile(path.join(agents, "backend-engineer.md"), "utf8"), "---\nname: backend-engineer\n---\nmine\n");
    assert.deepEqual(result.kept, [
      ".claude/agents/backend-engineer.md",
      ".claude/agents/designer.md",
      ".claude/agents/researcher.md",
    ]);
    assert.deepEqual(result.needsPaths, ["researcher"]);
    assert.deepEqual(result.warnings, []);
    assert.ok(!result.files.includes(".claude/agents/backend-engineer.md"));
    assert.ok(result.files.includes(".claude/agents/frontend-engineer.md"));

    const claudeMd = await readFile(path.join(directory, "CLAUDE.md"), "utf8");
    assert.match(claudeMd, /^\| Designer \| `designer` \| Draws the screens\. \| `design\/` \|$/m);
    assert.match(
      claudeMd,
      /^\| Researcher \| `researcher` \| Reads the code and reports\. \| Defined in its agent file \|$/m,
    );
  });
});

test("writeScaffold reuses an existing HR agent instead of adding a second one", async () => {
  await withDirectory(async (directory) => {
    const agents = path.join(directory, ".claude/agents");
    await mkdir(agents, { recursive: true });
    await writeFile(path.join(agents, "hr-agent.md"), "---\nname: hr-agent\n---\n", "utf8");

    const result = await writeScaffold(directory, config());

    assert.deepEqual((await readdir(agents)).sort(), ["hr-agent.md", "orchestrator.md"]);
    assert.equal(result.team.hr, "hr-agent");
    assert.match(await readFile(path.join(directory, "CLAUDE.md"), "utf8"), /^\| HR Manager \| `hr-agent` \|/m);
  });
});

test("writeScaffold adds worktrees/ to .gitignore once and keeps existing lines", async () => {
  await withDirectory(async (directory) => {
    await writeFile(path.join(directory, ".gitignore"), "node_modules/\n.env", "utf8");

    const first = await writeScaffold(directory, config());
    assert.ok(first.files.includes(".gitignore"));
    assert.equal(await readFile(path.join(directory, ".gitignore"), "utf8"), "node_modules/\n.env\nworktrees/\n");

    const second = await writeScaffold(directory, config(), { force: true });
    assert.ok(!second.files.includes(".gitignore"));
    assert.equal(await readFile(path.join(directory, ".gitignore"), "utf8"), "node_modules/\n.env\nworktrees/\n");
  });
});

test("writeScaffold refuses generated file conflicts without force", async () => {
  await withDirectory(async (directory) => {
    await writeFile(path.join(directory, "CLAUDE.md"), "keep me", "utf8");
    assert.deepEqual(await listConflicts(directory, config()), ["CLAUDE.md"]);
    await assert.rejects(() => writeScaffold(directory, config()), /Refusing to overwrite/);
    assert.equal(await readFile(path.join(directory, "CLAUDE.md"), "utf8"), "keep me");
    assert.deepEqual(await readdir(directory), ["CLAUDE.md"]);
  });
});

test("dry run reports files without creating them", async () => {
  await withDirectory(async (directory) => {
    const result = await writeScaffold(directory, config(), { agents: AGENTS, dryRun: true });
    assert.equal(result.dryRun, true);
    assert.ok(result.files.includes(".claude/agents/auditor.md"));
    assert.deepEqual(await readdir(directory), []);
  });
});

test("writeScaffold refuses to write through a generated-file symlink", async () => {
  await withDirectory(async (directory) => {
    const external = path.join(directory, "external.md");
    await writeFile(external, "do not replace", "utf8");
    await symlink(external, path.join(directory, "CLAUDE.md"));

    await assert.rejects(() => writeScaffold(directory, config(), { force: true }), /symbolic link/);
    assert.equal(await readFile(external, "utf8"), "do not replace");
    assert.deepEqual((await readdir(directory)).sort(), ["CLAUDE.md", "external.md"]);
  });
});
