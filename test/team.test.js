import test from "node:test";
import assert from "node:assert/strict";
import { UsageError } from "../src/args.js";
import {
  describeRole,
  mapFixedRoles,
  parseAgentFile,
  parseAgentsOption,
  parseRoster,
  resolveTeam,
} from "../src/team.js";

test("parseAgentsOption reads names and owned paths", () => {
  assert.deepEqual(parseAgentsOption("backend-engineer=src+./test, frontend-engineer=web ,auditor"), [
    { name: "backend-engineer", owns: ["src", "test"] },
    { name: "frontend-engineer", owns: ["web"] },
    { name: "auditor", owns: [] },
  ]);
  assert.deepEqual(parseAgentsOption(undefined), []);
});

test("parseAgentsOption rejects invalid, reserved, duplicate, and read-only-with-paths entries", () => {
  assert.throws(() => parseAgentsOption("Backend Engineer"), UsageError);
  assert.throws(() => parseAgentsOption("hr-manager"), /always generated/);
  assert.throws(() => parseAgentsOption("orchestrator=src"), /always generated/);
  assert.throws(() => parseAgentsOption("qa-engineer,qa-engineer"), /listed twice/);
  assert.throws(() => parseAgentsOption("auditor=src"), /read-only/);
});

test("describeRole knows starter roles and derives custom ones", () => {
  assert.equal(describeRole("devops-engineer").title, "DevOps Engineer");
  assert.equal(describeRole("auditor").readOnly, true);

  const custom = describeRole("qa-api-tester");
  assert.equal(custom.title, "QA API Tester");
  assert.equal(custom.readOnly, false);
});

test("parseAgentFile reads the name, description, and scope paths", () => {
  const agent = parseAgentFile(
    "frontend.md",
    [
      "---",
      'name: "frontend"',
      "description: >",
      "  Builds the UI.",
      "  Not for server code.",
      "tools: Read, Write",
      "---",
      "",
      "## Scope — files you own",
      "",
      "- `web/` — pages and components",
      "- `styles/`",
      "",
      "## Out of scope",
      "",
      "- `src/` — that belongs to someone else",
    ].join("\n"),
  );

  assert.deepEqual(agent, {
    file: "frontend.md",
    name: "frontend",
    description: "Builds the UI. Not for server code.",
    owns: ["web/", "styles/"],
  });
});

const READS_FREELY = [
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

const MODIFY_EXCEPT = [
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

test("parseAgentFile does not guess ownership from a plain Scope section", () => {
  assert.deepEqual(parseAgentFile("qa.md", READS_FREELY).owns, []);
  assert.deepEqual(parseAgentFile("backend.md", MODIFY_EXCEPT).owns, []);

  for (const heading of [
    "## Scope",
    "## Scope and boundaries",
    "## Out of scope — directories owned by other agents",
    "## Files you may read",
  ]) {
    assert.deepEqual(parseAgentFile("agent.md", `${heading}\n\n- \`src/\`\n`).owns, [], heading);
  }
});

test("parseAgentFile reads owned paths under any files-you-own heading", () => {
  for (const heading of [
    "## Scope — files you own",
    "## Scope – files you own",
    "## Scope - files you own",
    "## SCOPE — FILES YOU OWN",
    "## Files you own",
    "### Files you own",
  ]) {
    assert.deepEqual(parseAgentFile("agent.md", `${heading}\n\n- \`src/\` — code\n* \`test/\`\n`).owns, ["src/", "test/"], heading);
  }
});

test("parseAgentFile stops at the next heading and ignores nested bullets and prose", () => {
  const agent = parseAgentFile(
    "backend.md",
    [
      "## Scope — files you own",
      "",
      "Everything under `lib/` is shared, ask first.",
      "",
      "- `backend/` — except:",
      "  - `backend/migrations/`",
      "- Never edit `backend/.env`",
      "",
      "### Read-only context",
      "",
      "- `docs/`",
    ].join("\n"),
  );

  assert.deepEqual(agent.owns, ["backend/"]);
});

test("parseAgentFile falls back to the file name without frontmatter", () => {
  assert.deepEqual(parseAgentFile("main-agent.md", "Coordinates the work.\n"), {
    file: "main-agent.md",
    name: "main-agent",
    description: "",
    owns: [],
  });
});

test("mapFixedRoles prefers hr-manager, then hr-agent, hr, and any hr-* agent", () => {
  assert.deepEqual(mapFixedRoles(["hr-agent", "hr-manager", "orchestrator"]), {
    hr: "hr-manager",
    subOrchestrator: "orchestrator",
  });
  assert.equal(mapFixedRoles(["hr", "hr-agent"]).hr, "hr-agent");
  assert.equal(mapFixedRoles(["hr-lead", "hr"]).hr, "hr");
  assert.equal(mapFixedRoles(["frontend", "hr-lead", "hr-coach"]).hr, "hr-coach");
  assert.deepEqual(mapFixedRoles(["frontend", "main-agent"]), { hr: "", subOrchestrator: "" });
});

test("resolveTeam adopts existing agents and never plans to recreate them", () => {
  const existing = [
    { file: "frontend.md", name: "frontend", description: "Builds the UI.", owns: ["web/"] },
    { file: "hr-agent.md", name: "hr-agent", description: "Manages the team.", owns: [] },
  ];
  const team = resolveTeam([{ name: "backend-engineer", owns: ["src/"] }], existing, { addFixed: true });

  assert.equal(team.hr, "hr-agent");
  assert.equal(team.subOrchestrator, "orchestrator");
  assert.deepEqual(team.create, ["orchestrator", "backend-engineer"]);
  assert.deepEqual(
    team.agents.map((agent) => agent.name),
    ["backend-engineer", "frontend"],
  );
  assert.deepEqual(team.kept, [".claude/agents/frontend.md", ".claude/agents/hr-agent.md"]);
  assert.deepEqual(team.needsPaths, []);
});

test("resolveTeam lists adopted agents whose owned paths it could not read, without inventing clashes", () => {
  const existing = [parseAgentFile("backend.md", MODIFY_EXCEPT), parseAgentFile("qa.md", READS_FREELY)];
  const team = resolveTeam([{ name: "frontend-engineer", owns: [] }], existing, { addFixed: true });

  assert.deepEqual(team.needsPaths, ["backend", "qa"]);
  assert.deepEqual(team.warnings, []);
  assert.deepEqual(
    team.agents.map((agent) => [agent.name, agent.owns, agent.ownsText]),
    [
      ["frontend-engineer", [], ""],
      ["backend", [], "Defined in its agent file"],
      ["qa", [], "Defined in its agent file"],
    ],
  );
});

test("resolveTeam rejects a requested path that already has an owner and only warns about existing clashes", () => {
  const existing = [
    { file: "frontend.md", name: "frontend", description: "", owns: ["web/"] },
    { file: "design.md", name: "design", description: "", owns: ["web"] },
  ];

  assert.throws(
    () => resolveTeam([{ name: "backend-engineer", owns: ["web"] }], existing, { addFixed: true }),
    /No path may have two owners/,
  );
  assert.throws(
    () => resolveTeam([{ name: "a-role", owns: ["src"] }, { name: "b-role", owns: ["src/"] }], [], { addFixed: true }),
    UsageError,
  );

  const team = resolveTeam([], existing, { addFixed: false });
  assert.equal(team.warnings.length, 1);
  assert.match(team.warnings[0], /`web` is owned by frontend and design/);
  assert.deepEqual(team.create, []);
});

test("parseRoster reads the first table under Team Roster", () => {
  const rows = parseRoster(
    [
      "# Title",
      "",
      "## Team Roster",
      "",
      "| Role | Agent | Responsibility | Directories owned |",
      "|---|---|---|---|",
      "| Orchestrator | main session (you) | Plans work | none |",
      "| Backend Engineer | `backend-engineer` | Uses `pipes \\| safely` | `src/`, `test/` |",
      "",
      "| File | Blocks | Owner |",
      "|---|---|---|",
      "| `package.json` | `scripts` | `devops-engineer` |",
    ].join("\n"),
  );

  assert.deepEqual(
    rows.map((row) => row.agent),
    ["", "backend-engineer"],
  );
  assert.deepEqual(rows[1].owns, ["src/", "test/"]);
});
