import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { UsageError } from "./args.js";

export const AGENTS_DIR = ".claude/agents";
export const FIXED_HR = "hr-manager";
export const FIXED_SUB_ORCHESTRATOR = "orchestrator";

export const UNKNOWN_OWNERSHIP = "Defined in its agent file";

const AGENT_NAME = /^[a-z0-9][a-z0-9-]*$/;
const HEADING = /^#{1,6}\s/;
const OWNED_HEADING = /^#{1,6}\s.*\bfiles\s+you\s+own\b/i;
const HR_OWNED_PATH = `${AGENTS_DIR}/`;

export const STARTER_ROLES = [
  {
    name: "software-architect",
    title: "Software Architect",
    kind: "docs",
    responsibility:
      "Implementation strategy, trade-off analysis, architecture decision records. Markdown documentation only — no code.",
    useFor: "implementation strategy, trade-off analysis, and architecture decision records in markdown",
    notFor: "writing or changing code — that goes to the agent that owns the files",
  },
  {
    name: "data-engineer",
    title: "Data Engineer",
    kind: "engineer",
    responsibility: "Schema design, migrations, seeds and fixtures, backfills. Hands the schema contract to backend.",
    useFor: "schema design, migrations, seeds and fixtures, and backfills",
    notFor: "application logic or UI work",
  },
  {
    name: "backend-engineer",
    title: "Backend Engineer",
    kind: "engineer",
    responsibility:
      "Server-side logic, API endpoints, background jobs, and the tests that accompany them. Consumes the schema.",
    useFor: "server-side logic, API endpoints, background jobs, and their tests",
    notFor: "schema migrations or UI work",
  },
  {
    name: "frontend-engineer",
    title: "Frontend Engineer",
    kind: "engineer",
    responsibility: "UI, client-side code, styles, translations, and the asset-pipeline config",
    useFor: "UI, client-side code, styles, translations, and the asset-pipeline config",
    notFor: "server-side logic or schema changes",
  },
  {
    name: "devops-engineer",
    title: "DevOps Engineer",
    kind: "ops",
    responsibility:
      "Build, deploy, and local dev-environment plumbing. Verifies builds by inspecting output artifacts. Writes no application code, migrations, or tests.",
    useFor: "build, deploy, and local dev-environment plumbing",
    notFor: "application code, migrations, or tests",
  },
  {
    name: "qa-engineer",
    title: "QA Engineer",
    kind: "qa",
    responsibility:
      "Independent verification against the running app, with evidence. Regression tests for filed bugs. Does not rewrite an engineer's own tests.",
    useFor: "independent verification against the running app and regression tests for filed bugs",
    notFor: "implementing features or rewriting an engineer's own tests",
  },
  {
    name: "auditor",
    title: "Auditor",
    kind: "readonly",
    responsibility:
      "Read-only security, code-quality, and convention-compliance review. Reports findings with `file:line` and severity; fixes nothing.",
    useFor: "read-only security, code-quality, and convention-compliance review",
    notFor: "fixing what it finds — fixes go to the agent that owns the files",
  },
];

const ACRONYMS = new Map([
  ["hr", "HR"],
  ["qa", "QA"],
  ["ui", "UI"],
  ["ux", "UX"],
  ["api", "API"],
  ["pr", "PR"],
  ["devops", "DevOps"],
]);

export function titleFromName(name) {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => ACRONYMS.get(word.toLowerCase()) ?? word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

export function describeRole(name) {
  const starter = STARTER_ROLES.find((role) => role.name === name);
  if (starter) return { ...starter, readOnly: starter.kind === "readonly" };

  return {
    name,
    title: titleFromName(name),
    kind: "engineer",
    readOnly: false,
    responsibility: "Implements work in the paths this row lists. Refine the scope in its agent file.",
    useFor: "work in the paths it owns",
    notFor: "work in paths another agent owns — see the roster in `CLAUDE.md`",
  };
}

export function pathKey(value) {
  return value.replace(/^\.\//, "").replace(/\/+$/, "");
}

export function parseAgentsOption(value) {
  const agents = [];

  for (const item of String(value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean)) {
    const equalsIndex = item.indexOf("=");
    const name = (equalsIndex === -1 ? item : item.slice(0, equalsIndex)).trim();
    const owns = (equalsIndex === -1 ? "" : item.slice(equalsIndex + 1))
      .split("+")
      .map((owned) => owned.trim().replace(/^\.\//, ""))
      .filter(Boolean);

    if (!AGENT_NAME.test(name)) {
      throw new UsageError(`Invalid agent name "${name}". Use lowercase letters, digits, and hyphens.`);
    }
    if (name === FIXED_HR || name === FIXED_SUB_ORCHESTRATOR) {
      throw new UsageError(`"${name}" is always generated and cannot be listed in --agents.`);
    }
    if (agents.some((agent) => agent.name === name)) {
      throw new UsageError(`Agent "${name}" is listed twice.`);
    }
    if (describeRole(name).readOnly && owns.length > 0) {
      throw new UsageError(`"${name}" is a read-only role and cannot own paths.`);
    }

    agents.push({ name, owns: [...new Set(owns)] });
  }

  return agents;
}

function unquote(value) {
  const text = value.trim();
  const quoted = /^(["'])(.*)\1$/.exec(text);
  return quoted ? quoted[2] : text;
}

function frontmatterValue(lines, key) {
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index === -1) return "";

  const inline = lines[index].slice(key.length + 1).trim();
  if (inline && !/^[>|][+-]?$/.test(inline)) return unquote(inline);

  const continuation = [];
  for (const line of lines.slice(index + 1)) {
    if (!/^\s+\S/.test(line)) break;
    continuation.push(line.trim());
  }
  return continuation.join(" ");
}

export function parseAgentFile(file, contents) {
  const lines = contents.split(/\r?\n/);
  const end = lines[0]?.trim() === "---" ? lines.indexOf("---", 1) : -1;
  const frontmatter = end === -1 ? [] : lines.slice(1, end);
  const owns = [];
  let inOwned = false;

  for (const line of lines.slice(end + 1)) {
    if (HEADING.test(line)) {
      inOwned = OWNED_HEADING.test(line);
      continue;
    }
    const bullet = inOwned ? /^[-*]\s+`([^`]+)`/.exec(line) : null;
    if (bullet && !owns.includes(bullet[1])) owns.push(bullet[1]);
  }

  return {
    file,
    name: frontmatterValue(frontmatter, "name") || file.replace(/\.md$/, ""),
    description: frontmatterValue(frontmatter, "description"),
    owns,
  };
}

async function readAgent(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

export async function discoverAgents(targetDir) {
  const directory = path.join(targetDir, AGENTS_DIR);
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }

  const agents = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isDirectory() || !entry.name.endsWith(".md") || entry.name.startsWith("_")) continue;
    agents.push(parseAgentFile(entry.name, await readAgent(path.join(directory, entry.name))));
  }

  return agents;
}

export function mapFixedRoles(names) {
  const hr =
    [FIXED_HR, "hr-agent", "hr"].find((name) => names.includes(name)) ??
    names.filter((name) => name.startsWith("hr-")).sort()[0] ??
    "";

  return { hr, subOrchestrator: names.includes(FIXED_SUB_ORCHESTRATOR) ? FIXED_SUB_ORCHESTRATOR : "" };
}

function adoptAgent(agent) {
  const role = describeRole(agent.name);

  return {
    ...role,
    responsibility: agent.description || "See its agent file",
    owns: agent.owns,
    ownsText: agent.owns.length > 0 ? "" : UNKNOWN_OWNERSHIP,
  };
}

export function ownershipClashes(agents) {
  const owners = new Map();

  for (const agent of agents) {
    for (const owned of agent.owns) {
      const key = pathKey(owned);
      owners.set(key, [...(owners.get(key) ?? []), agent.name]);
    }
  }

  return [...owners]
    .filter(([, names]) => names.length > 1)
    .map(([owned, names]) => ({ path: owned, owners: names }));
}

export function resolveTeam(requested, existing, { addFixed }) {
  const existingNames = existing.map((agent) => agent.name);
  const existingFiles = new Set(existing.map((agent) => agent.file));
  const mapped = mapFixedRoles(existingNames);
  const hr = mapped.hr || (addFixed ? FIXED_HR : "");
  const subOrchestrator = mapped.subOrchestrator || (addFixed ? FIXED_SUB_ORCHESTRATOR : "");
  const fixed = [subOrchestrator, hr].filter(Boolean);
  const requestedNames = requested.map((agent) => agent.name);

  for (const name of requestedNames) {
    if (fixed.includes(name)) {
      throw new UsageError(`"${name}" already fills a fixed role on this team and cannot be listed in --agents.`);
    }
  }

  const agents = requested.map((entry) => {
    const known = existing.find((agent) => agent.name === entry.name);
    return { ...describeRole(entry.name), owns: entry.owns.length > 0 ? entry.owns : (known?.owns ?? []), ownsText: "" };
  });

  for (const agent of existing) {
    if (!fixed.includes(agent.name) && !requestedNames.includes(agent.name)) agents.push(adoptAgent(agent));
  }

  const warnings = [];
  const claims = hr ? [...agents, { name: hr, owns: [HR_OWNED_PATH] }] : agents;

  for (const clash of ownershipClashes(claims)) {
    const message = `\`${clash.path}\` is owned by ${clash.owners.join(" and ")}`;
    if (clash.owners.some((name) => requestedNames.includes(name))) {
      throw new UsageError(`${message}. No path may have two owners.`);
    }
    warnings.push(`${message}. Existing agents were left unchanged; re-cut their scopes so each path has one owner.`);
  }

  return {
    hr,
    subOrchestrator,
    agents,
    create: [...fixed, ...requestedNames].filter(
      (name) => !existingNames.includes(name) && !existingFiles.has(`${name}.md`),
    ),
    kept: existing.map((agent) => `${AGENTS_DIR}/${agent.file}`),
    needsPaths: agents.filter((agent) => agent.ownsText === UNKNOWN_OWNERSHIP).map((agent) => agent.name),
    warnings,
  };
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

export function parseRoster(claudeMd) {
  const rows = [];
  let inSection = false;
  let inTable = false;

  for (const line of claudeMd.split(/\r?\n/)) {
    if (/^## Team Roster/.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;

    if (line.startsWith("|")) {
      inTable = true;
      const cells = splitRow(line);
      if (cells.length < 4 || /^:?-+:?$/.test(cells[0]) || cells[1] === "Agent") continue;

      rows.push({
        role: cells[0],
        agent: /`([^`]+)`/.exec(cells[1])?.[1] ?? "",
        responsibility: cells[2],
        owns: [...cells.at(-1).matchAll(/`([^`]+)`/g)].map((match) => match[1]),
      });
      continue;
    }

    if (inTable || /^## /.test(line)) break;
  }

  return rows;
}
