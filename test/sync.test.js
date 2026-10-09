import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { UsageError } from "../src/args.js";
import { normalizeConfig } from "../src/config.js";
import { contentHash, writeScaffold } from "../src/scaffold.js";
import { applyManagedSections, syncProject } from "../src/sync.js";
import { parseRoster } from "../src/team.js";
import { renderPullRequestTemplate, renderTaskboardTemplate } from "../src/templates.js";

const CONFIG = ".agent-orchestrator.json";
const TASKBOARD = ".github/ISSUE_TEMPLATE/taskboard.md";
const PULL_REQUEST = ".github/PULL_REQUEST_TEMPLATE.md";

const LEGACY_CLAUDE_MD = [
  "# Agent Orchestration Guide — Example",
  "",
  "## Non-Negotiable Rules",
  "",
  "- The only permanent roles are the Main Agent and the HR Agent.",
  "- A hand-written rule the team added.",
  "",
].join("\n");

const LEGACY_CONFIG = {
  schemaVersion: 1,
  project: { name: "Example", type: "Web application", stack: "To be confirmed", sourceDirectories: ["src"] },
  commands: { dev: "Not applicable", test: "npm run check" },
  branches: { staging: "develop", production: "main" },
  github: { enabled: true, milestonePolicy: "create-if-missing" },
  permanentRoles: ["Main Agent", "HR Agent"],
  specialists: [],
};

const LEGACY_AGENTS = {
  "hr-agent.md": "---\nname: hr-agent\ndescription: Onboards and offboards agents.\n---\n\nYou are HR.\n",
  "main-agent.md": "---\nname: main-agent\ndescription: Coordinates the work.\n---\n\nYou coordinate.\n",
  "frontend.md":
    "---\nname: frontend\ndescription: Builds the UI.\n---\n\n## Scope — files you own\n\n- `web/` — pages\n\n## Notes\n\n- `src/` is not yours\n",
};

const READS_FREELY_AGENT = [
  "---",
  "name: qa",
  "description: Verifies changes against the running app.",
  "---",
  "",
  "## Scope",
  "",
  "You may read freely from:",
  "",
  "- `backend/`",
  "- `frontend/`",
  "- `infra/`",
  "- `scripts/`",
  "- `CLAUDE.md`",
  "",
  "You modify nothing.",
  "",
].join("\n");

const MODIFY_EXCEPT_AGENT = [
  "---",
  "name: backend",
  "description: Builds the API.",
  "---",
  "",
  "## Scope",
  "",
  "You may modify only `backend/**`, except:",
  "",
  "- `backend/migrations/` — never edit a shipped migration",
  "- `backend/.env` — local secrets",
  "- `infra/`",
  "",
].join("\n");

function config(overrides = {}) {
  return normalizeConfig({
    project: { name: "Example", oneLiner: "a ticketing system", stack: "TypeScript" },
    commands: { dev: "npm run dev", test: "npm test" },
    branches: { staging: "staging", production: "main" },
    ...overrides,
  });
}

async function withDirectory(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "agent-orchestrator-sync-"));

  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function snapshot(directory, base = directory) {
  const files = {};

  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(files, await snapshot(full, base));
    else files[path.relative(base, full)] = createHash("sha256").update(await readFile(full)).digest("hex");
  }

  return files;
}

async function read(directory, relativePath) {
  return readFile(path.join(directory, relativePath), "utf8");
}

async function write(directory, relativePath, contents) {
  await mkdir(path.dirname(path.join(directory, relativePath)), { recursive: true });
  await writeFile(path.join(directory, relativePath), contents, "utf8");
}

async function initialized(directory, overrides) {
  await writeScaffold(directory, config(overrides), {
    agents: [
      { name: "backend-engineer", owns: ["src/", "test/"] },
      { name: "qa-engineer", owns: ["e2e/"] },
    ],
  });
}

async function legacy(directory, agents = LEGACY_AGENTS) {
  await write(directory, "CLAUDE.md", LEGACY_CLAUDE_MD);
  await write(directory, CONFIG, `${JSON.stringify(LEGACY_CONFIG, null, 2)}\n`);
  for (const [file, contents] of Object.entries(agents)) await write(directory, `.claude/agents/${file}`, contents);
}

function action(result, relativePath) {
  return result.actions.find((entry) => entry.path === relativePath)?.action;
}

test("sync on a fresh project changes nothing, and neither does a second run", async () => {
  await withDirectory(async (directory) => {
    await initialized(directory);
    const before = await snapshot(directory);

    for (const run of [1, 2]) {
      const result = await syncProject(directory);
      assert.equal(result.changed, false, `run ${run}`);
      assert.equal(result.mode, "refresh");
      assert.equal(result.agentsUntouched, 4);
      assert.deepEqual(result.warnings, []);
      assert.deepEqual(await snapshot(directory), before, `run ${run}`);
    }
  });
});

test("sync restores a managed section and leaves everything outside the markers byte-for-byte", async () => {
  await withDirectory(async (directory) => {
    await initialized(directory);
    const pristine = await read(directory, "CLAUDE.md");
    const edited = pristine
      .replace("# Example — Agent Team Orchestration", "# Example — Agent Team Orchestration\n\nA note the user added.\r\n")
      .replace("| Backend Engineer | `backend-engineer` |", "| Backend Engineer (API) | `backend-engineer` |")
      .replace("| `e2e/` |", "| `e2e/`, `fixtures/` |")
      .replace("## Common Commands", "- **House rule.** Tabs, because the linter says so.\n\n## Common Commands");
    const tampered = edited
      .replace(
        "**No agent — Orchestrator, sub-orchestrator, or engineer — ever merges a pull request.**",
        "Agents may merge when CI is green.",
      )
      .replace("1. **Delegate, don't do.**", "1. **Do it yourself.**");

    assert.notEqual(edited, pristine);
    assert.notEqual(tampered, edited);
    await write(directory, "CLAUDE.md", tampered);

    const result = await syncProject(directory);

    assert.equal(await read(directory, "CLAUDE.md"), edited);
    assert.equal(action(result, "CLAUDE.md"), "update");
    assert.match(result.actions[0].detail, /2 managed sections: orchestrator-rules, merging/);
    assert.equal((await syncProject(directory)).changed, false);
  });
});

test("sync leaves an existing agent team identical, with and without --force", async () => {
  await withDirectory(async (directory) => {
    await initialized(directory);
    await write(directory, ".claude/agents/backend-engineer.md", "---\nname: backend-engineer\n---\nrewritten by the team\n");
    await write(directory, ".claude/agents/copywriter.md", "---\nname: copywriter\n---\nhired later\n");
    await write(directory, ".claude/agents/_draft.md", "notes\n");
    await write(directory, "CLAUDE.md", (await read(directory, "CLAUDE.md")).replace("Delegate, don't do", "Do it yourself"));
    const before = await snapshot(path.join(directory, ".claude"));

    for (const options of [{}, { force: true }, { dryRun: true }]) {
      const result = await syncProject(directory, options);
      assert.deepEqual(await snapshot(path.join(directory, ".claude")), before);
      assert.equal(result.agentsUntouched, 5);
      assert.equal(action(result, ".claude/agents/"), "kept");
    }

    assert.match(await read(directory, "CLAUDE.md"), /Delegate, don't do/);
  });
});

test("sync refuses a 0.1 project without --migrate and writes nothing", async () => {
  await withDirectory(async (directory) => {
    await legacy(directory);
    const before = await snapshot(directory);

    await assert.rejects(
      () => syncProject(directory),
      (error) => error instanceof UsageError && /--migrate/.test(error.message) && /Nothing was written/.test(error.message),
    );
    await assert.rejects(() => syncProject(directory, { force: true }), UsageError);
    assert.deepEqual(await snapshot(directory), before);
  });
});

test("sync --migrate converts a 0.1 project and keeps the existing team as it is", async () => {
  await withDirectory(async (directory) => {
    await legacy(directory);
    const agentsBefore = await snapshot(path.join(directory, ".claude"));

    const result = await syncProject(directory, { migrate: true });

    assert.equal(result.mode, "migrate");
    assert.equal(result.agentsUntouched, 3);
    assert.deepEqual(result.needsPaths, ["main-agent"]);
    assert.deepEqual(result.team, { hr: "hr-agent", subOrchestrator: "" });
    assert.deepEqual(await snapshot(path.join(directory, ".claude")), agentsBefore);
    assert.deepEqual((await readdir(path.join(directory, ".claude/agents"))).sort(), [
      "frontend.md",
      "hr-agent.md",
      "main-agent.md",
    ]);
    assert.equal(await read(directory, "CLAUDE.md.bak"), LEGACY_CLAUDE_MD);
    assert.deepEqual(JSON.parse(await read(directory, `${CONFIG}.bak`)), LEGACY_CONFIG);

    const claudeMd = await read(directory, "CLAUDE.md");
    assert.match(claudeMd, /^\| Orchestrator \| main session \(you\) \|/m);
    assert.match(claudeMd, /^\| HR Manager \| `hr-agent` \|/m);
    assert.match(claudeMd, /^\| Frontend \| `frontend` \| Builds the UI\. \| `web\/` \|$/m);
    assert.match(claudeMd, /^\| Main Agent \| `main-agent` \| Coordinates the work\. \| Defined in its agent file \|$/m);
    assert.doesNotMatch(claudeMd, /hr-manager|Sub-Orchestrator \||`orchestrator`|Not applicable|To be confirmed/);
    assert.match(claudeMd, /Branch map: `develop` = staging/);
    assert.match(claudeMd, /Do tests pass \(`npm run check`\)\?/);
    assert.match(claudeMd, /It never writes code itself/);

    const saved = JSON.parse(await read(directory, CONFIG));
    assert.equal(saved.schemaVersion, 2);
    assert.deepEqual(saved.team, { hr: "hr-agent", subOrchestrator: "" });
    assert.deepEqual(saved.commands, { dev: "", test: "npm run check", testSingle: "", build: "", worktreeSetup: [] });
    assert.equal(saved.project.stack, "");

    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /No `orchestrator` agent exists.*existing team was left unchanged/);
    assert.equal(await read(directory, ".gitignore"), "worktrees/\n");

    const again = await syncProject(directory);
    assert.equal(again.changed, false);
    assert.deepEqual(again.needsPaths, []);
    assert.deepEqual(await snapshot(path.join(directory, ".claude")), agentsBefore);
  });
});

test("sync --migrate does not read ownership out of a plain Scope section", async () => {
  await withDirectory(async (directory) => {
    await legacy(directory, {
      "backend.md": MODIFY_EXCEPT_AGENT,
      "frontend.md": LEGACY_AGENTS["frontend.md"],
      "hr-agent.md": LEGACY_AGENTS["hr-agent.md"],
      "qa.md": READS_FREELY_AGENT,
    });
    const agentsBefore = await snapshot(path.join(directory, ".claude"));

    const result = await syncProject(directory, { migrate: true });
    const claudeMd = await read(directory, "CLAUDE.md");

    assert.match(claudeMd, /^\| Backend \| `backend` \| Builds the API\. \| Defined in its agent file \|$/m);
    assert.match(
      claudeMd,
      /^\| QA \| `qa` \| Verifies changes against the running app\. \| Defined in its agent file \|$/m,
    );
    assert.match(claudeMd, /^\| Frontend \| `frontend` \| Builds the UI\. \| `web\/` \|$/m);

    const rows = Object.fromEntries(parseRoster(claudeMd).map((row) => [row.agent, row.owns]));
    assert.deepEqual(rows.backend, []);
    assert.deepEqual(rows.qa, []);
    assert.deepEqual(rows.frontend, ["web/"]);

    assert.deepEqual(result.needsPaths, ["backend", "qa"]);
    assert.equal(result.team.hr, "hr-agent");
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /No `orchestrator` agent exists/);
    assert.ok(!result.warnings.some((warning) => /is owned by|Directories owned/.test(warning)));
    assert.deepEqual(await snapshot(path.join(directory, ".claude")), agentsBefore);

    const filled = claudeMd
      .replace("| Builds the API. | Defined in its agent file |", "| Builds the API. | `backend/` |")
      .replace("running app. | Defined in its agent file |", "running app. | none (read-only) |");
    assert.doesNotMatch(filled, /Defined in its agent file/);
    await write(directory, "CLAUDE.md", filled);

    const again = await syncProject(directory);
    assert.equal(again.changed, false);
    assert.deepEqual(again.needsPaths, []);
    assert.equal(await read(directory, "CLAUDE.md"), filled);
  });
});

test("sync --migrate creates the two fixed agents only when there is no team at all", async () => {
  await withDirectory(async (directory) => {
    await legacy(directory, {});

    const result = await syncProject(directory, { migrate: true });

    assert.deepEqual((await readdir(path.join(directory, ".claude/agents"))).sort(), ["hr-manager.md", "orchestrator.md"]);
    assert.equal(action(result, ".claude/agents/hr-manager.md"), "create");
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(JSON.parse(await read(directory, CONFIG)).team, { hr: "hr-manager", subOrchestrator: "orchestrator" });
    assert.equal((await syncProject(directory)).changed, false);
  });

  await withDirectory(async (directory) => {
    await legacy(directory, { "writer.md": "---\nname: writer\n---\n" });

    const result = await syncProject(directory, { migrate: true });

    assert.deepEqual(await readdir(path.join(directory, ".claude/agents")), ["writer.md"]);
    assert.equal(result.warnings.length, 2);
    assert.match(await read(directory, "CLAUDE.md"), /No HR Manager is on this team yet\./);
  });
});

test("sync --migrate keeps 0.1 GitHub templates unless forced, and never touches the team either way", async () => {
  await withDirectory(async (directory) => {
    await legacy(directory);
    await write(directory, TASKBOARD, "0.1 taskboard\n");
    const agentsBefore = await snapshot(path.join(directory, ".claude"));

    const result = await syncProject(directory, { migrate: true });

    assert.equal(action(result, TASKBOARD), "skip");
    assert.equal(action(result, PULL_REQUEST), "create");
    assert.equal(await read(directory, TASKBOARD), "0.1 taskboard\n");
    assert.ok(result.warnings.some((warning) => /sync --force/.test(warning)));

    const forced = await syncProject(directory, { force: true });
    assert.equal(action(forced, TASKBOARD), "update");
    assert.match(await read(directory, TASKBOARD), /merged by the user/);
    assert.deepEqual(await snapshot(path.join(directory, ".claude")), agentsBefore);
  });

  await withDirectory(async (directory) => {
    await legacy(directory);
    await write(directory, TASKBOARD, "0.1 taskboard\n");
    const agentsBefore = await snapshot(path.join(directory, ".claude"));

    const result = await syncProject(directory, { migrate: true, force: true });

    assert.equal(action(result, TASKBOARD), "update");
    assert.match(await read(directory, TASKBOARD), /merged by the user/);
    assert.equal(result.agentsUntouched, 3);
    assert.deepEqual(await snapshot(path.join(directory, ".claude")), agentsBefore);
  });
});

test("sync --migrate stops when a backup already exists and writes nothing", async () => {
  await withDirectory(async (directory) => {
    await legacy(directory);
    await write(directory, "CLAUDE.md.bak", "an earlier backup");
    const before = await snapshot(directory);

    await assert.rejects(() => syncProject(directory, { migrate: true }), /CLAUDE\.md\.bak already exists/);
    assert.deepEqual(await snapshot(directory), before);
  });
});

test("sync --migrate warns when existing agents claim the same path", async () => {
  await withDirectory(async (directory) => {
    await legacy(directory, {
      "frontend.md": LEGACY_AGENTS["frontend.md"],
      "design.md": "---\nname: design\n---\n\n## Scope - files you own\n\n- `web/`\n",
    });
    const agentsBefore = await snapshot(path.join(directory, ".claude"));

    const result = await syncProject(directory, { migrate: true });

    assert.ok(result.warnings.some((warning) => /`web` is owned by design and frontend/.test(warning)));
    assert.deepEqual(await snapshot(path.join(directory, ".claude")), agentsBefore);
  });
});

test("sync carries a config change into the managed sections without touching the roster", async () => {
  await withDirectory(async (directory) => {
    await initialized(directory);
    const before = await read(directory, "CLAUDE.md");
    const saved = JSON.parse(await read(directory, CONFIG));
    saved.branches.staging = "develop";
    saved.commands.build = "npm run build";
    await write(directory, CONFIG, JSON.stringify(saved));

    const result = await syncProject(directory);
    const after = await read(directory, "CLAUDE.md");

    assert.equal(action(result, "CLAUDE.md"), "update");
    assert.match(after, /git worktree add worktrees\/<task-slug> -b feature\/<task-slug> origin\/develop/);
    assert.match(after, /gh pr create --base develop/);
    assert.match(after, /does the build covering the change compile \(`npm run build`\)\?/);
    assert.doesNotMatch(after, /`staging`/);
    assert.equal(after.split("## Team Roster")[1].split("<!--")[0], before.split("## Team Roster")[1].split("<!--")[0]);
    assert.equal(after.split("## Engineering Conventions")[1], before.split("## Engineering Conventions")[1]);

    assert.equal(action(result, TASKBOARD), "update");
    assert.match(await read(directory, TASKBOARD), /Pull request into `develop`/);
    assert.equal(JSON.parse(await read(directory, CONFIG)).branches.staging, "develop");
    assert.equal((await syncProject(directory)).changed, false);
  });
});

test("sync does not rewrite a config that only differs in formatting", async () => {
  await withDirectory(async (directory) => {
    await initialized(directory);
    const compacted = JSON.stringify({ ...JSON.parse(await read(directory, CONFIG)), note: "kept" });
    await write(directory, CONFIG, compacted);

    const result = await syncProject(directory);

    assert.equal(result.changed, false);
    assert.equal(await read(directory, CONFIG), compacted);
  });
});

test("sync follows the roster when the team has changed since init", async () => {
  await withDirectory(async (directory) => {
    await initialized(directory);
    const claudeMd = await read(directory, "CLAUDE.md");
    assert.match(claudeMd, /in order: backend-engineer \(logic, endpoints, tests\) → qa-engineer for independent verification\./);

    await write(directory, "CLAUDE.md", claudeMd.replace(/^\| QA Engineer \|.*\n/m, ""));
    const result = await syncProject(directory);

    assert.match(result.actions[0].detail, /1 managed section: orchestrator-rules/);
    assert.doesNotMatch((await read(directory, "CLAUDE.md")).split("## Engineering Conventions")[0], /qa-engineer/);
  });
});

test("sync rejects malformed markers and leaves the file unchanged", async () => {
  await withDirectory(async (directory) => {
    await initialized(directory);
    const pristine = await read(directory, "CLAUDE.md");
    const broken = {
      "no end marker": pristine.replace("<!-- agent-orchestrator:end hr-rules -->\n", ""),
      "no matching start marker": pristine.replace("<!-- agent-orchestrator:start merging -->\n", ""),
      "appears twice": pristine.replace(
        "<!-- agent-orchestrator:start hr-rules -->",
        "<!-- agent-orchestrator:start intro -->\n<!-- agent-orchestrator:end intro -->\n<!-- agent-orchestrator:start hr-rules -->",
      ),
      "starts before": pristine.replace(
        "<!-- agent-orchestrator:end merging -->",
        "<!-- agent-orchestrator:start extra -->\n<!-- agent-orchestrator:end merging -->",
      ),
      "malformed managed-section marker": pristine.replace(
        "<!-- agent-orchestrator:start merging -->",
        "<!-- agent-orchestrator:start -->",
      ),
    };

    for (const [message, contents] of Object.entries(broken)) {
      assert.notEqual(contents, pristine, message);
      await write(directory, "CLAUDE.md", contents);
      const before = await snapshot(directory);

      await assert.rejects(() => syncProject(directory), new RegExp(message));
      assert.deepEqual(await snapshot(directory), before, message);
    }
  });
});

test("sync reports sections it does not know and sections that are missing", async () => {
  await withDirectory(async (directory) => {
    await initialized(directory);
    const claudeMd = (await read(directory, "CLAUDE.md"))
      .replace(/<!-- agent-orchestrator:start github-planning -->[\s\S]*<!-- agent-orchestrator:end github-planning -->\n\n/, "")
      .concat("\n<!-- agent-orchestrator:start future -->\nkept as written\n<!-- agent-orchestrator:end future -->\n");
    await write(directory, "CLAUDE.md", claudeMd);

    const result = await syncProject(directory);

    assert.equal(result.changed, false);
    assert.equal(await read(directory, "CLAUDE.md"), claudeMd);
    assert.deepEqual(result.warnings, [
      'Managed section "github-planning" is not in CLAUDE.md and was not added.',
      'Section "future" in CLAUDE.md is not managed by this version and was left alone.',
    ]);
  });
});

test("sync refreshes an unmodified GitHub template and skips a locally edited one unless forced", async () => {
  await withDirectory(async (directory) => {
    await initialized(directory);
    const saved = JSON.parse(await read(directory, CONFIG));
    const current = { taskboard: await read(directory, TASKBOARD), pullRequest: await read(directory, PULL_REQUEST) };

    assert.equal(current.taskboard, renderTaskboardTemplate(config()));
    assert.equal(current.pullRequest, renderPullRequestTemplate(config()));

    saved.generated[TASKBOARD] = contentHash("template from an older version\n");
    await write(directory, CONFIG, `${JSON.stringify(saved, null, 2)}\n`);
    await write(directory, TASKBOARD, "template from an older version\n");
    await write(directory, PULL_REQUEST, `${current.pullRequest}\n## Team checklist\n`);

    const result = await syncProject(directory);

    assert.equal(action(result, TASKBOARD), "update");
    assert.equal(action(result, PULL_REQUEST), "skip");
    assert.equal(action(result, CONFIG), "update");
    assert.equal(await read(directory, TASKBOARD), current.taskboard);
    assert.equal(await read(directory, PULL_REQUEST), `${current.pullRequest}\n## Team checklist\n`);
    assert.equal(JSON.parse(await read(directory, CONFIG)).generated[TASKBOARD], contentHash(current.taskboard));

    const unforced = await syncProject(directory);
    assert.equal(unforced.changed, false);
    assert.equal(action(unforced, PULL_REQUEST), "skip");

    const forced = await syncProject(directory, { force: true });
    assert.equal(action(forced, PULL_REQUEST), "update");
    assert.equal(await read(directory, PULL_REQUEST), current.pullRequest);
    assert.equal((await syncProject(directory)).changed, false);
  });
});

test("sync recreates a missing GitHub template and leaves GitHub alone when it is disabled", async () => {
  await withDirectory(async (directory) => {
    await initialized(directory);
    await rm(path.join(directory, TASKBOARD));

    assert.equal(action(await syncProject(directory), TASKBOARD), "create");
    assert.equal(await read(directory, TASKBOARD), renderTaskboardTemplate(config()));
  });

  await withDirectory(async (directory) => {
    await initialized(directory, { github: { enabled: false } });

    const result = await syncProject(directory);

    assert.equal(result.changed, false);
    assert.equal(action(result, TASKBOARD), undefined);
    assert.ok(!(await readdir(directory)).includes(".github"));
  });
});

test("sync --dry-run writes nothing", async () => {
  await withDirectory(async (directory) => {
    await initialized(directory);
    await write(directory, "CLAUDE.md", (await read(directory, "CLAUDE.md")).replace("Delegate, don't do", "Do it yourself"));
    await rm(path.join(directory, ".gitignore"));
    const before = await snapshot(directory);

    const result = await syncProject(directory, { dryRun: true });

    assert.equal(result.dryRun, true);
    assert.equal(action(result, "CLAUDE.md"), "update");
    assert.equal(action(result, ".gitignore"), "create");
    assert.deepEqual(await snapshot(directory), before);
  });

  await withDirectory(async (directory) => {
    await legacy(directory);
    const before = await snapshot(directory);

    const result = await syncProject(directory, { migrate: true, dryRun: true });

    assert.equal(action(result, "CLAUDE.md.bak"), "backup");
    assert.deepEqual(result.needsPaths, ["main-agent"]);
    assert.deepEqual(await snapshot(directory), before);
  });
});

test("sync needs an initialized project", async () => {
  await withDirectory(async (directory) => {
    await assert.rejects(() => syncProject(directory), /\.agent-orchestrator\.json was not found/);

    await write(directory, CONFIG, "{}");
    await assert.rejects(() => syncProject(directory), /CLAUDE\.md was not found/);

    await write(directory, "CLAUDE.md", "# Notes\n");
    await write(directory, CONFIG, "{ not json");
    await assert.rejects(() => syncProject(directory), /not valid JSON/);

    await write(directory, CONFIG, JSON.stringify({ schemaVersion: 3 }));
    await assert.rejects(() => syncProject(directory), /newer create-agent-orchestrator/);
  });
});

test("applyManagedSections preserves CRLF line endings outside the markers", () => {
  const text = "intro\r\n<!-- agent-orchestrator:start merging -->\r\nold\r\n<!-- agent-orchestrator:end merging -->\r\ntail\r\n";
  const applied = applyManagedSections(text, { merging: "new" });

  assert.equal(
    applied.text,
    "intro\r\n<!-- agent-orchestrator:start merging -->\r\nnew\n<!-- agent-orchestrator:end merging -->\r\ntail\r\n",
  );
  assert.deepEqual(applied.updated, ["merging"]);
  assert.deepEqual(applyManagedSections(applied.text, { merging: "new" }).updated, []);
});
