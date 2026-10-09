export { parseArgs, UsageError } from "./args.js";
export { CONFIG_FILE, SCHEMA_VERSION, convertConfig, normalizeConfig } from "./config.js";
export { writeScaffold, listConflicts } from "./scaffold.js";
export { applyManagedSections, hasManagedSections, syncProject } from "./sync.js";
export { STARTER_ROLES, discoverAgents, parseAgentsOption, parseRoster } from "./team.js";
export {
  MANAGED_SECTION_IDS,
  renderClaudeMd,
  renderConfig,
  renderHrManagerAgent,
  renderManagedSections,
  renderOrchestratorAgent,
  renderPullRequestTemplate,
  renderRoleAgent,
  renderTaskboardTemplate,
} from "./templates.js";
