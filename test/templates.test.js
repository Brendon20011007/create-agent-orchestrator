import test from "node:test";
import assert from "node:assert/strict";
import { renderClaudeMd, renderTaskboardTemplate } from "../src/templates.js";

const config = {
  schemaVersion: 1,
  project: {
    name: "Payments | Portal",
    type: "Web application",
    stack: "Node.js",
    sourceDirectories: ["frontend", "backend"],
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
  specialists: [],
};

test("renderClaudeMd customizes project fields and keeps specialists dynamic", () => {
  const output = renderClaudeMd(config);
  assert.match(output, /Payments \\| Portal/);
  assert.match(output, /None requested during initialization/);
  assert.match(output, /temporary, task-specific/);
  assert.doesNotMatch(output, /### Frontend Agent/);
});

test("renderTaskboardTemplate includes both user approval gates", () => {
  const output = renderTaskboardTemplate(config);
  assert.match(output, /User explicitly approved the local result/);
  assert.match(output, /User explicitly approved the staging result/);
  assert.match(output, /staging.*main/s);
  assert.match(output, /Tested commit SHA/);
  assert.match(output, /authorized merging this exact production PR/);
});
