// src/lib/dispatch/route-action.ts
import { appendFileSync } from "node:fs";

// src/lib/envelope/validate.ts
import { createRequire } from "module";

// src/lib/errors/index.ts
var FerryError = class extends Error {
  constructor(code, context) {
    super(`[ferry:${code}]${context ? ` ${JSON.stringify(context)}` : ""}`);
    this.code = code;
    this.context = context;
    this.name = "FerryError";
  }
  code;
  context;
};

// src/lib/envelope/validate.ts
var _require = createRequire(import.meta.url);
var eventSchema = _require("./schemas/event.v1.schema.json");
var ajvModule = _require("ajv/dist/2020");
var ajvInstance = new ajvModule.Ajv2020({ strict: true });
_require("ajv-formats").default(ajvInstance);
var validateFn = ajvInstance.compile(eventSchema);
function validateEnvelope(raw) {
  if (!validateFn(raw)) {
    const safePaths = (validateFn.errors ?? []).map((e) => `${e.instancePath} ${e.keyword}`);
    throw new FerryError("state-invariant", { paths: safePaths });
  }
  const envelope = raw;
  if (envelope.instructions !== void 0) {
    const cap = parseInt(process.env.FERRY_ENVELOPE_INSTRUCTIONS_CHARS ?? "", 10) || 2e3;
    envelope.instructions = envelope.instructions.slice(0, cap);
  }
  return envelope;
}

// src/lib/io/spend-cap.ts
function classifyHttpStatus(status) {
  if (status === 429 || status === 402) return "spend-cap";
  if (status >= 500) return "transient";
  if (status >= 200 && status < 300) return "ok";
  if (status >= 400) return "spend-cap";
  return "transient";
}

// src/lib/io/jira-rest.ts
var JiraRestClient = class {
  constructor(baseUrl, email, apiToken) {
    this.baseUrl = baseUrl;
    this.authHeader = `Basic ${Buffer.from(`${email}:${apiToken}`).toString("base64")}`;
  }
  baseUrl;
  authHeader;
  subtaskTypeCache = /* @__PURE__ */ new Map();
  get baseHeaders() {
    return { Authorization: this.authHeader, Accept: "application/json" };
  }
  throwForStatus(status) {
    const cls = classifyHttpStatus(status);
    if (cls === "spend-cap") throw new FerryError("spend-cap", { status });
    if (cls === "transient") throw new FerryError("transient", { status });
  }
  async getIssue(key) {
    const response = await fetch(
      `${this.baseUrl}/rest/api/3/issue/${key}?fields=summary,description,comment,labels,issuetype`,
      { method: "GET", headers: this.baseHeaders }
    );
    this.throwForStatus(response.status);
    return response.json();
  }
  async postComment(key, adfBody) {
    const response = await fetch(`${this.baseUrl}/rest/api/3/issue/${key}/comment`, {
      method: "POST",
      headers: { ...this.baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ body: adfBody })
    });
    this.throwForStatus(response.status);
    return response.json();
  }
  async putComment(key, commentId, adfBody) {
    const response = await fetch(`${this.baseUrl}/rest/api/3/issue/${key}/comment/${commentId}`, {
      method: "PUT",
      headers: { ...this.baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ body: adfBody })
    });
    this.throwForStatus(response.status);
    return response.json();
  }
  async resolveSubtaskTypeName(projectKey) {
    const cached = this.subtaskTypeCache.get(projectKey);
    if (cached !== void 0) return cached;
    const response = await fetch(
      `${this.baseUrl}/rest/api/3/issue/createmeta/${projectKey}/issuetypes`,
      { method: "GET", headers: this.baseHeaders }
    );
    this.throwForStatus(response.status);
    const data = await response.json();
    const subtaskType = data.issueTypes.find((t) => t.subtask);
    if (!subtaskType) {
      throw new FerryError("state-invariant", { reason: "no-subtask-issuetype", projectKey });
    }
    this.subtaskTypeCache.set(projectKey, subtaskType.name);
    return subtaskType.name;
  }
  async createSubtask(parentKey, summary, adfDescription) {
    const projectKey = parentKey.split("-")[0];
    const issuetypeName = await this.resolveSubtaskTypeName(projectKey);
    const response = await fetch(`${this.baseUrl}/rest/api/3/issue`, {
      method: "POST",
      headers: { ...this.baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          project: { key: projectKey },
          parent: { key: parentKey },
          summary,
          issuetype: { name: issuetypeName },
          description: adfDescription
        }
      })
    });
    this.throwForStatus(response.status);
    return response.json();
  }
  async addLabel(key, label) {
    const response = await fetch(`${this.baseUrl}/rest/api/3/issue/${key}`, {
      method: "PUT",
      headers: { ...this.baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ update: { labels: [{ add: label }] } })
    });
    this.throwForStatus(response.status);
  }
  async getTransitions(key) {
    const response = await fetch(`${this.baseUrl}/rest/api/3/issue/${key}/transitions`, {
      method: "GET",
      headers: this.baseHeaders
    });
    this.throwForStatus(response.status);
    return response.json();
  }
  async postTransition(key, transitionId) {
    const response = await fetch(`${this.baseUrl}/rest/api/3/issue/${key}/transitions`, {
      method: "POST",
      headers: { ...this.baseHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ transition: { id: transitionId } })
    });
    this.throwForStatus(response.status);
  }
  async getSubtasks(parentKey) {
    const jql = encodeURIComponent(`parent=${parentKey} ORDER BY created ASC`);
    const response = await fetch(
      `${this.baseUrl}/rest/api/3/search?jql=${jql}&fields=summary&maxResults=50`,
      { method: "GET", headers: this.baseHeaders }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return (data.issues ?? []).map((i) => `- [${i.key}] ${i.fields.summary}`);
  }
  async getSubtaskDetails(parentKey) {
    const jql = encodeURIComponent(`parent=${parentKey} ORDER BY created ASC`);
    const response = await fetch(
      `${this.baseUrl}/rest/api/3/search?jql=${jql}&fields=summary,description,status&maxResults=50`,
      { method: "GET", headers: this.baseHeaders }
    );
    if (!response.ok) return [];
    const data = await response.json();
    return (data.issues ?? []).map((i) => ({
      key: i.key,
      title: i.fields.summary,
      descriptionAdf: i.fields.description,
      status: i.fields.status.name
    }));
  }
};

// src/lib/config.ts
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { createRequire as createRequire2 } from "node:module";
var _require2 = createRequire2(import.meta.url);
var DEFAULT_FERRY_CONFIG = {
  models: {
    refiner: { provider: "anthropic", model: "claude-sonnet-4-6" },
    dev: { provider: "anthropic", model: "claude-opus-4-5" },
    review: { provider: "anthropic", model: "claude-sonnet-4-6" },
    iterate: { provider: "anthropic", model: "claude-sonnet-4-6" }
  },
  limits: {
    max_iterations: 3,
    max_agent_iterations: 200,
    max_tokens_per_run: 5e5,
    max_tokens_per_message: 16384,
    max_cost_eur_per_run: 10,
    bash_timeout_ms: 6e4,
    bash_timeout_max_ms: 3e5,
    grep_timeout_ms: 3e4,
    anthropic_verify_timeout_ms: 1e4,
    jira_retry_base_delay_ms: 2e3,
    jira_retry_max_attempts: 3,
    envelope_instructions_chars: 2e3,
    project_snippet_bytes: 2048,
    agent_extension_bytes: 4096,
    tldr_total_chars: 500,
    tldr_verdict_chars: 40,
    file_display_chars: 4e4,
    refiner_subtask_cap: 12,
    refiner_touch_paths_cap: 20,
    reviewer_max_iterations: 40,
    reviewer_max_tokens: 16384,
    reconciler_stale_window_minutes: 20
  },
  ticket_types: {
    refine_allowlist: ["Story", "Bug", "Spike"],
    dev_allowlist: ["Story", "Bug", "Spike"]
  },
  git: {
    base_branch: null,
    target_branch: null,
    working_branch_prefix: "ferry/"
  },
  workflow: {
    agents: {
      refiner: { trigger_column: "Refinement", auto_transition: null },
      developer: { trigger_column: "In Development", auto_transition: "In Review" },
      reviewer: {
        trigger_column: "In Review",
        auto_transition_approve: null,
        auto_transition_changes: "Changes Requested"
      },
      iterator: { trigger_column: "Changes Requested", auto_transition: "In Review" },
      merger: { auto_transition_done: null }
    }
  },
  routing: {
    claude_code_round_trip_threshold: 2
  }
};
function validateProvider(val, fieldPath) {
  if (val !== "anthropic" && val !== "openai" && val !== "google") {
    return [`${fieldPath}: must be "anthropic", "openai", or "google"`];
  }
  return [];
}
function validateLlmRoute(val, fieldPath) {
  if (!val || typeof val !== "object") return [`${fieldPath}: must be an object`];
  const r = val;
  return [
    ...validateProvider(r.provider, `${fieldPath}.provider`),
    ...typeof r.model !== "string" || r.model.length === 0 ? [`${fieldPath}.model: must be a non-empty string`] : []
  ];
}
function validatePosInt(val, fieldPath) {
  if (typeof val !== "number" || !Number.isInteger(val) || val <= 0) {
    return [`${fieldPath}: must be a positive integer`];
  }
  return [];
}
function validatePosNumber(val, fieldPath) {
  if (typeof val !== "number" || val <= 0) {
    return [`${fieldPath}: must be a positive number`];
  }
  return [];
}
function validateStringArray(val, fieldPath) {
  if (!Array.isArray(val) || val.some((v) => typeof v !== "string")) {
    return [`${fieldPath}: must be an array of strings`];
  }
  return [];
}
function validateStringOrNull(val, fieldPath) {
  if (val !== null && typeof val !== "string") {
    return [`${fieldPath}: must be a string or null`];
  }
  return [];
}
function validateWorkflowAgentBase(val, fieldPath) {
  if (!val || typeof val !== "object") return [`${fieldPath}: must be an object`];
  const v = val;
  if (v.trigger_column !== void 0 && typeof v.trigger_column !== "string") {
    return [`${fieldPath}.trigger_column: must be a string`];
  }
  return [];
}
function validateWorkflow(val) {
  if (!val || typeof val !== "object") return ["workflow: must be an object"];
  const w = val;
  const errs = [];
  if (w.agents === void 0) return errs;
  if (!w.agents || typeof w.agents !== "object") {
    errs.push("workflow.agents: must be an object");
    return errs;
  }
  const agents = w.agents;
  if (agents.refiner !== void 0) {
    errs.push(...validateWorkflowAgentBase(agents.refiner, "workflow.agents.refiner"));
  }
  if (agents.developer !== void 0) {
    errs.push(...validateWorkflowAgentBase(agents.developer, "workflow.agents.developer"));
    const dev = agents.developer;
    if ("auto_transition" in dev && dev.auto_transition !== void 0) {
      errs.push(
        ...validateStringOrNull(dev.auto_transition, "workflow.agents.developer.auto_transition")
      );
    }
  }
  if (agents.reviewer !== void 0) {
    errs.push(...validateWorkflowAgentBase(agents.reviewer, "workflow.agents.reviewer"));
    const rev = agents.reviewer;
    if ("auto_transition_approve" in rev && rev.auto_transition_approve !== void 0) {
      errs.push(
        ...validateStringOrNull(
          rev.auto_transition_approve,
          "workflow.agents.reviewer.auto_transition_approve"
        )
      );
    }
    if ("auto_transition_changes" in rev && rev.auto_transition_changes !== void 0) {
      errs.push(
        ...validateStringOrNull(
          rev.auto_transition_changes,
          "workflow.agents.reviewer.auto_transition_changes"
        )
      );
    }
  }
  if (agents.iterator !== void 0) {
    errs.push(...validateWorkflowAgentBase(agents.iterator, "workflow.agents.iterator"));
    const iter = agents.iterator;
    if ("auto_transition" in iter && iter.auto_transition !== void 0) {
      errs.push(
        ...validateStringOrNull(iter.auto_transition, "workflow.agents.iterator.auto_transition")
      );
    }
  }
  if (agents.merger !== void 0) {
    if (!agents.merger || typeof agents.merger !== "object") {
      errs.push("workflow.agents.merger: must be an object");
    } else {
      const merger = agents.merger;
      if ("auto_transition_done" in merger && merger.auto_transition_done !== void 0) {
        errs.push(
          ...validateStringOrNull(
            merger.auto_transition_done,
            "workflow.agents.merger.auto_transition_done"
          )
        );
      }
    }
  }
  return errs;
}
function validateConfigShape(raw) {
  if (!raw || typeof raw !== "object") return ["config: must be an object"];
  const c = raw;
  const errs = [];
  if (c.models !== void 0) {
    if (!c.models || typeof c.models !== "object") {
      errs.push("models: must be an object");
    } else {
      const m = c.models;
      for (const key of ["refiner", "dev", "review", "iterate"]) {
        if (m[key] !== void 0) {
          errs.push(...validateLlmRoute(m[key], `models.${String(key)}`));
        }
      }
    }
  }
  if (c.limits !== void 0) {
    if (!c.limits || typeof c.limits !== "object") {
      errs.push("limits: must be an object");
    } else {
      const l = c.limits;
      if (l.max_iterations !== void 0)
        errs.push(...validatePosInt(l.max_iterations, "limits.max_iterations"));
      if (l.max_agent_iterations !== void 0)
        errs.push(...validatePosInt(l.max_agent_iterations, "limits.max_agent_iterations"));
      if (l.max_tokens_per_run !== void 0)
        errs.push(...validatePosInt(l.max_tokens_per_run, "limits.max_tokens_per_run"));
      if (l.max_tokens_per_message !== void 0)
        errs.push(...validatePosInt(l.max_tokens_per_message, "limits.max_tokens_per_message"));
      if (l.max_cost_eur_per_run !== void 0)
        errs.push(...validatePosNumber(l.max_cost_eur_per_run, "limits.max_cost_eur_per_run"));
      if (l.bash_timeout_ms !== void 0)
        errs.push(...validatePosInt(l.bash_timeout_ms, "limits.bash_timeout_ms"));
      if (l.bash_timeout_max_ms !== void 0)
        errs.push(...validatePosInt(l.bash_timeout_max_ms, "limits.bash_timeout_max_ms"));
      if (l.grep_timeout_ms !== void 0)
        errs.push(...validatePosInt(l.grep_timeout_ms, "limits.grep_timeout_ms"));
      if (l.anthropic_verify_timeout_ms !== void 0)
        errs.push(
          ...validatePosInt(l.anthropic_verify_timeout_ms, "limits.anthropic_verify_timeout_ms")
        );
      if (l.jira_retry_base_delay_ms !== void 0)
        errs.push(...validatePosInt(l.jira_retry_base_delay_ms, "limits.jira_retry_base_delay_ms"));
      if (l.jira_retry_max_attempts !== void 0)
        errs.push(...validatePosInt(l.jira_retry_max_attempts, "limits.jira_retry_max_attempts"));
      if (l.envelope_instructions_chars !== void 0)
        errs.push(
          ...validatePosInt(l.envelope_instructions_chars, "limits.envelope_instructions_chars")
        );
      if (l.project_snippet_bytes !== void 0)
        errs.push(...validatePosInt(l.project_snippet_bytes, "limits.project_snippet_bytes"));
      if (l.agent_extension_bytes !== void 0)
        errs.push(...validatePosInt(l.agent_extension_bytes, "limits.agent_extension_bytes"));
      if (l.tldr_total_chars !== void 0)
        errs.push(...validatePosInt(l.tldr_total_chars, "limits.tldr_total_chars"));
      if (l.tldr_verdict_chars !== void 0)
        errs.push(...validatePosInt(l.tldr_verdict_chars, "limits.tldr_verdict_chars"));
      if (l.file_display_chars !== void 0)
        errs.push(...validatePosInt(l.file_display_chars, "limits.file_display_chars"));
      if (l.refiner_subtask_cap !== void 0)
        errs.push(...validatePosInt(l.refiner_subtask_cap, "limits.refiner_subtask_cap"));
      if (l.refiner_touch_paths_cap !== void 0)
        errs.push(...validatePosInt(l.refiner_touch_paths_cap, "limits.refiner_touch_paths_cap"));
      if (l.reviewer_max_iterations !== void 0)
        errs.push(...validatePosInt(l.reviewer_max_iterations, "limits.reviewer_max_iterations"));
      if (l.reviewer_max_tokens !== void 0)
        errs.push(...validatePosInt(l.reviewer_max_tokens, "limits.reviewer_max_tokens"));
      if (l.reconciler_stale_window_minutes !== void 0)
        errs.push(
          ...validatePosInt(
            l.reconciler_stale_window_minutes,
            "limits.reconciler_stale_window_minutes"
          )
        );
    }
  }
  if (c.ticket_types !== void 0) {
    if (!c.ticket_types || typeof c.ticket_types !== "object") {
      errs.push("ticket_types: must be an object");
    } else {
      const t = c.ticket_types;
      if (t.refine_allowlist !== void 0)
        errs.push(...validateStringArray(t.refine_allowlist, "ticket_types.refine_allowlist"));
      if (t.dev_allowlist !== void 0)
        errs.push(...validateStringArray(t.dev_allowlist, "ticket_types.dev_allowlist"));
    }
  }
  if (c.git !== void 0) {
    if (!c.git || typeof c.git !== "object" || Array.isArray(c.git)) {
      errs.push("git: must be an object");
    } else {
      const g = c.git;
      if (g.base_branch !== void 0 && g.base_branch !== null && typeof g.base_branch !== "string") {
        errs.push("git.base_branch: must be a string or null");
      }
      if (g.base_branch !== void 0 && typeof g.base_branch === "string" && g.base_branch.trim() === "") {
        errs.push("git.base_branch: must be a non-empty string or null");
      }
      if (g.target_branch !== void 0 && g.target_branch !== null && typeof g.target_branch !== "string") {
        errs.push("git.target_branch: must be a string or null");
      }
      if (g.target_branch !== void 0 && typeof g.target_branch === "string" && g.target_branch.trim() === "") {
        errs.push("git.target_branch: must be a non-empty string or null");
      }
      if (g.working_branch_prefix !== void 0) {
        if (typeof g.working_branch_prefix === "string") {
          if (g.working_branch_prefix.length === 0) {
            errs.push("git.working_branch_prefix: must be a non-empty string");
          }
        } else if (g.working_branch_prefix !== null && typeof g.working_branch_prefix === "object" && !Array.isArray(g.working_branch_prefix)) {
          const mapping = g.working_branch_prefix;
          if (!("default" in mapping)) {
            errs.push('git.working_branch_prefix: mapping must include a "default" key');
          }
          for (const [k, v] of Object.entries(mapping)) {
            if (typeof v !== "string" || v.length === 0) {
              errs.push(`git.working_branch_prefix.${k}: must be a non-empty string`);
            }
          }
        } else {
          errs.push(
            'git.working_branch_prefix: must be a non-empty string or a mapping object with a "default" key'
          );
        }
      }
    }
  }
  if (c.labels !== void 0) {
    if (!c.labels || typeof c.labels !== "object" || Array.isArray(c.labels)) {
      errs.push("labels: must be an object mapping label names to capability entries");
    } else {
      for (const [labelName, entry] of Object.entries(c.labels)) {
        const fieldPath = `labels.${labelName}`;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          errs.push(`${fieldPath}: must be an object`);
          continue;
        }
        const e = entry;
        if (e.mcp_servers !== void 0)
          errs.push(...validateStringArray(e.mcp_servers, `${fieldPath}.mcp_servers`));
        if (e.tools !== void 0) errs.push(...validateStringArray(e.tools, `${fieldPath}.tools`));
      }
    }
  }
  if (c.workflow !== void 0) {
    errs.push(...validateWorkflow(c.workflow));
  }
  if (c.safety !== void 0) {
    if (!c.safety || typeof c.safety !== "object" || Array.isArray(c.safety)) {
      errs.push("safety: must be an object");
    } else {
      const s = c.safety;
      if (s.allow_skip_review !== void 0 && typeof s.allow_skip_review !== "boolean") {
        errs.push("safety.allow_skip_review: must be a boolean");
      }
    }
  }
  if (c.execution_path !== void 0 && c.execution_path !== "script" && c.execution_path !== "claude-code" && c.execution_path !== "codex-cli") {
    errs.push('execution_path: must be "script", "claude-code", or "codex-cli"');
  }
  if (c.routing !== void 0) {
    if (!c.routing || typeof c.routing !== "object" || Array.isArray(c.routing)) {
      errs.push("routing: must be an object");
    } else {
      const r = c.routing;
      if (r.claude_code_round_trip_threshold !== void 0) {
        errs.push(
          ...validatePosInt(
            r.claude_code_round_trip_threshold,
            "routing.claude_code_round_trip_threshold"
          )
        );
      }
    }
  }
  return errs;
}
function readJsonConfig(filePath) {
  const raw = readFileSync(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new FerryError("state-invariant", {
      reason: "invalid-ferry-config",
      file: path.basename(filePath),
      error: e.message
    });
  }
}
function readYamlConfig(filePath) {
  let parseYaml;
  try {
    const mod = _require2("yaml");
    parseYaml = mod.parse;
  } catch {
    throw new FerryError("state-invariant", {
      reason: "invalid-ferry-config",
      file: path.basename(filePath),
      error: 'YAML config requires the "yaml" package: npm install yaml'
    });
  }
  const raw = readFileSync(filePath, "utf8");
  try {
    return parseYaml(raw);
  } catch (e) {
    throw new FerryError("state-invariant", {
      reason: "invalid-ferry-config",
      file: path.basename(filePath),
      error: e.message
    });
  }
}
function findAndReadConfigFile(repoRoot) {
  const candidates = [
    { file: "ferry.config.json", reader: readJsonConfig },
    { file: "ferry.config.yaml", reader: readYamlConfig },
    { file: "ferry.config.yml", reader: readYamlConfig }
  ];
  for (const { file, reader } of candidates) {
    const filePath = path.join(repoRoot, file);
    if (!existsSync(filePath)) continue;
    return reader(filePath);
  }
  return null;
}
function mergeWithDefaults(raw) {
  const m = raw.models ?? {};
  const l = raw.limits ?? {};
  const t = raw.ticket_types ?? {};
  const g = raw.git ?? {};
  const route = (val, def) => {
    if (!val || typeof val !== "object") return def;
    const r = val;
    return {
      provider: r.provider ?? def.provider,
      model: r.model ?? def.model
    };
  };
  const num = (val, def) => typeof val === "number" ? val : def;
  const strArr = (val, def) => Array.isArray(val) ? val : def;
  const nullableStr = (val, def) => {
    if (val === null) return null;
    if (typeof val === "string") return val;
    return def;
  };
  const labelsRaw = raw.labels;
  let labels;
  if (labelsRaw && typeof labelsRaw === "object" && !Array.isArray(labelsRaw)) {
    labels = {};
    for (const [name, entry] of Object.entries(labelsRaw)) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)) {
        const e = entry;
        labels[name] = {
          ...Array.isArray(e.mcp_servers) ? { mcp_servers: e.mcp_servers } : {},
          ...Array.isArray(e.tools) ? { tools: e.tools } : {}
        };
      }
    }
  }
  return {
    models: {
      refiner: route(m.refiner, DEFAULT_FERRY_CONFIG.models.refiner),
      dev: route(m.dev, DEFAULT_FERRY_CONFIG.models.dev),
      review: route(m.review, DEFAULT_FERRY_CONFIG.models.review),
      iterate: route(m.iterate, DEFAULT_FERRY_CONFIG.models.iterate)
    },
    limits: {
      max_iterations: num(l.max_iterations, DEFAULT_FERRY_CONFIG.limits.max_iterations),
      max_agent_iterations: num(
        l.max_agent_iterations,
        DEFAULT_FERRY_CONFIG.limits.max_agent_iterations
      ),
      max_tokens_per_run: num(l.max_tokens_per_run, DEFAULT_FERRY_CONFIG.limits.max_tokens_per_run),
      max_tokens_per_message: num(
        l.max_tokens_per_message,
        DEFAULT_FERRY_CONFIG.limits.max_tokens_per_message
      ),
      max_cost_eur_per_run: num(
        l.max_cost_eur_per_run,
        DEFAULT_FERRY_CONFIG.limits.max_cost_eur_per_run
      ),
      bash_timeout_ms: num(l.bash_timeout_ms, DEFAULT_FERRY_CONFIG.limits.bash_timeout_ms),
      bash_timeout_max_ms: num(
        l.bash_timeout_max_ms,
        DEFAULT_FERRY_CONFIG.limits.bash_timeout_max_ms
      ),
      grep_timeout_ms: num(l.grep_timeout_ms, DEFAULT_FERRY_CONFIG.limits.grep_timeout_ms),
      anthropic_verify_timeout_ms: num(
        l.anthropic_verify_timeout_ms,
        DEFAULT_FERRY_CONFIG.limits.anthropic_verify_timeout_ms
      ),
      jira_retry_base_delay_ms: num(
        l.jira_retry_base_delay_ms,
        DEFAULT_FERRY_CONFIG.limits.jira_retry_base_delay_ms
      ),
      jira_retry_max_attempts: num(
        l.jira_retry_max_attempts,
        DEFAULT_FERRY_CONFIG.limits.jira_retry_max_attempts
      ),
      envelope_instructions_chars: num(
        l.envelope_instructions_chars,
        DEFAULT_FERRY_CONFIG.limits.envelope_instructions_chars
      ),
      project_snippet_bytes: num(
        l.project_snippet_bytes,
        DEFAULT_FERRY_CONFIG.limits.project_snippet_bytes
      ),
      agent_extension_bytes: num(
        l.agent_extension_bytes,
        DEFAULT_FERRY_CONFIG.limits.agent_extension_bytes
      ),
      tldr_total_chars: num(l.tldr_total_chars, DEFAULT_FERRY_CONFIG.limits.tldr_total_chars),
      tldr_verdict_chars: num(l.tldr_verdict_chars, DEFAULT_FERRY_CONFIG.limits.tldr_verdict_chars),
      file_display_chars: num(l.file_display_chars, DEFAULT_FERRY_CONFIG.limits.file_display_chars),
      refiner_subtask_cap: num(
        l.refiner_subtask_cap,
        DEFAULT_FERRY_CONFIG.limits.refiner_subtask_cap
      ),
      refiner_touch_paths_cap: num(
        l.refiner_touch_paths_cap,
        DEFAULT_FERRY_CONFIG.limits.refiner_touch_paths_cap
      ),
      reviewer_max_iterations: num(
        l.reviewer_max_iterations,
        DEFAULT_FERRY_CONFIG.limits.reviewer_max_iterations
      ),
      reviewer_max_tokens: num(
        l.reviewer_max_tokens,
        DEFAULT_FERRY_CONFIG.limits.reviewer_max_tokens
      ),
      reconciler_stale_window_minutes: num(
        l.reconciler_stale_window_minutes,
        DEFAULT_FERRY_CONFIG.limits.reconciler_stale_window_minutes
      )
    },
    ticket_types: {
      refine_allowlist: strArr(
        t.refine_allowlist,
        DEFAULT_FERRY_CONFIG.ticket_types.refine_allowlist
      ),
      dev_allowlist: strArr(t.dev_allowlist, DEFAULT_FERRY_CONFIG.ticket_types.dev_allowlist)
    },
    git: {
      base_branch: "base_branch" in g ? nullableStr(g.base_branch, null) : DEFAULT_FERRY_CONFIG.git.base_branch,
      target_branch: "target_branch" in g ? nullableStr(g.target_branch, null) : DEFAULT_FERRY_CONFIG.git.target_branch,
      working_branch_prefix: typeof g.working_branch_prefix === "string" ? g.working_branch_prefix : g.working_branch_prefix !== null && typeof g.working_branch_prefix === "object" && !Array.isArray(g.working_branch_prefix) ? g.working_branch_prefix : DEFAULT_FERRY_CONFIG.git.working_branch_prefix
    },
    ...labels !== void 0 ? { labels } : {},
    workflow: mergeWorkflow(raw.workflow),
    ...["script", "claude-code", "codex-cli"].includes(raw.execution_path) ? { execution_path: raw.execution_path } : {},
    routing: {
      claude_code_round_trip_threshold: num(
        raw.routing?.claude_code_round_trip_threshold,
        DEFAULT_FERRY_CONFIG.routing.claude_code_round_trip_threshold
      )
    },
    ...raw.safety && typeof raw.safety === "object" && !Array.isArray(raw.safety) ? {
      safety: {
        ...typeof raw.safety.allow_skip_review === "boolean" ? {
          allow_skip_review: raw.safety.allow_skip_review
        } : {}
      }
    } : {}
  };
}
function mergeWorkflow(rawWorkflow) {
  const def = DEFAULT_FERRY_CONFIG.workflow;
  if (!rawWorkflow || typeof rawWorkflow !== "object") return def;
  const w = rawWorkflow;
  if (!w.agents || typeof w.agents !== "object") return def;
  const agents = w.agents;
  const str = (val, def2) => typeof val === "string" ? val : def2;
  const strOrNull = (obj, key, def2) => key in obj ? obj[key] === null ? null : typeof obj[key] === "string" ? obj[key] : def2 : def2;
  const refinerRaw = agents.refiner && typeof agents.refiner === "object" ? agents.refiner : {};
  const devRaw = agents.developer && typeof agents.developer === "object" ? agents.developer : {};
  const revRaw = agents.reviewer && typeof agents.reviewer === "object" ? agents.reviewer : {};
  const iterRaw = agents.iterator && typeof agents.iterator === "object" ? agents.iterator : {};
  const mergerRaw = agents.merger && typeof agents.merger === "object" ? agents.merger : {};
  return {
    agents: {
      refiner: {
        trigger_column: str(refinerRaw.trigger_column, def.agents.refiner.trigger_column),
        auto_transition: null
      },
      developer: {
        trigger_column: str(devRaw.trigger_column, def.agents.developer.trigger_column),
        auto_transition: strOrNull(devRaw, "auto_transition", def.agents.developer.auto_transition)
      },
      reviewer: {
        trigger_column: str(revRaw.trigger_column, def.agents.reviewer.trigger_column),
        auto_transition_approve: strOrNull(
          revRaw,
          "auto_transition_approve",
          def.agents.reviewer.auto_transition_approve
        ),
        auto_transition_changes: strOrNull(
          revRaw,
          "auto_transition_changes",
          def.agents.reviewer.auto_transition_changes
        )
      },
      iterator: {
        trigger_column: str(iterRaw.trigger_column, def.agents.iterator.trigger_column),
        auto_transition: strOrNull(iterRaw, "auto_transition", def.agents.iterator.auto_transition)
      },
      merger: {
        auto_transition_done: strOrNull(
          mergerRaw,
          "auto_transition_done",
          def.agents.merger.auto_transition_done
        )
      }
    }
  };
}
function applyEnvOverrides(cfg) {
  const models = { ...cfg.models };
  const limits = { ...cfg.limits };
  const providerFromEnv = (val) => {
    if (val === "anthropic" || val === "openai" || val === "google") return val;
    return void 0;
  };
  const refinerProvider = providerFromEnv(process.env.FERRY_REFINER_PROVIDER);
  if (refinerProvider) models.refiner = { ...models.refiner, provider: refinerProvider };
  if (process.env.FERRY_REFINER_MODEL) {
    models.refiner = { ...models.refiner, model: process.env.FERRY_REFINER_MODEL };
  }
  const devProvider = providerFromEnv(process.env.FERRY_DEV_PROVIDER);
  if (devProvider) models.dev = { ...models.dev, provider: devProvider };
  if (process.env.FERRY_DEV_MODEL) {
    models.dev = { ...models.dev, model: process.env.FERRY_DEV_MODEL };
  }
  const reviewProvider = providerFromEnv(process.env.FERRY_REVIEW_PROVIDER);
  if (reviewProvider) models.review = { ...models.review, provider: reviewProvider };
  if (process.env.FERRY_REVIEW_MODEL) {
    models.review = { ...models.review, model: process.env.FERRY_REVIEW_MODEL };
  }
  const iterProvider = providerFromEnv(process.env.FERRY_ITER_PROVIDER);
  if (iterProvider) models.iterate = { ...models.iterate, provider: iterProvider };
  if (process.env.FERRY_ITER_MODEL) {
    models.iterate = { ...models.iterate, model: process.env.FERRY_ITER_MODEL };
  }
  const maxAgentIter = parseInt(process.env.FERRY_DEV_MAX_ITERATIONS ?? "", 10);
  if (Number.isFinite(maxAgentIter)) limits.max_agent_iterations = maxAgentIter;
  const maxInputTok = parseInt(process.env.FERRY_DEV_MAX_INPUT_TOKENS ?? "", 10);
  if (Number.isFinite(maxInputTok)) limits.max_tokens_per_run = maxInputTok;
  const maxTok = parseInt(process.env.FERRY_DEV_MAX_TOKENS ?? "", 10);
  if (Number.isFinite(maxTok)) limits.max_tokens_per_message = maxTok;
  const maxCost = parseFloat(process.env.FERRY_MAX_COST_EUR_PER_RUN ?? "");
  if (Number.isFinite(maxCost)) limits.max_cost_eur_per_run = maxCost;
  const envInt = (key) => {
    const v = parseInt(process.env[key] ?? "", 10);
    return Number.isFinite(v) ? v : void 0;
  };
  const bashTimeoutMs = envInt("FERRY_BASH_TIMEOUT_MS");
  if (bashTimeoutMs !== void 0) limits.bash_timeout_ms = bashTimeoutMs;
  const bashTimeoutMaxMs = envInt("FERRY_BASH_TIMEOUT_MAX_MS");
  if (bashTimeoutMaxMs !== void 0) limits.bash_timeout_max_ms = bashTimeoutMaxMs;
  const grepTimeoutMs = envInt("FERRY_GREP_TIMEOUT_MS");
  if (grepTimeoutMs !== void 0) limits.grep_timeout_ms = grepTimeoutMs;
  const anthropicVerifyTimeoutMs = envInt("FERRY_ANTHROPIC_VERIFY_TIMEOUT_MS");
  if (anthropicVerifyTimeoutMs !== void 0)
    limits.anthropic_verify_timeout_ms = anthropicVerifyTimeoutMs;
  const jiraRetryBaseDelayMs = envInt("FERRY_JIRA_RETRY_BASE_DELAY_MS");
  if (jiraRetryBaseDelayMs !== void 0) limits.jira_retry_base_delay_ms = jiraRetryBaseDelayMs;
  const jiraRetryMaxAttempts = envInt("FERRY_JIRA_RETRY_MAX_ATTEMPTS");
  if (jiraRetryMaxAttempts !== void 0) limits.jira_retry_max_attempts = jiraRetryMaxAttempts;
  const envelopeInstructionsChars = envInt("FERRY_ENVELOPE_INSTRUCTIONS_CHARS");
  if (envelopeInstructionsChars !== void 0)
    limits.envelope_instructions_chars = envelopeInstructionsChars;
  const projectSnippetBytes = envInt("FERRY_PROJECT_SNIPPET_BYTES");
  if (projectSnippetBytes !== void 0) limits.project_snippet_bytes = projectSnippetBytes;
  const agentExtensionBytes = envInt("FERRY_AGENT_EXTENSION_BYTES");
  if (agentExtensionBytes !== void 0) limits.agent_extension_bytes = agentExtensionBytes;
  const tldrTotalChars = envInt("FERRY_TLDR_TOTAL_CHARS");
  if (tldrTotalChars !== void 0) limits.tldr_total_chars = tldrTotalChars;
  const tldrVerdictChars = envInt("FERRY_TLDR_VERDICT_CHARS");
  if (tldrVerdictChars !== void 0) limits.tldr_verdict_chars = tldrVerdictChars;
  const fileDisplayChars = envInt("FERRY_FILE_DISPLAY_CHARS");
  if (fileDisplayChars !== void 0) limits.file_display_chars = fileDisplayChars;
  const refinerSubtaskCap = envInt("FERRY_REFINER_SUBTASK_CAP");
  if (refinerSubtaskCap !== void 0) limits.refiner_subtask_cap = refinerSubtaskCap;
  const refinerTouchPathsCap = envInt("FERRY_REFINER_TOUCH_PATHS_CAP");
  if (refinerTouchPathsCap !== void 0) limits.refiner_touch_paths_cap = refinerTouchPathsCap;
  const reviewerMaxIterations = envInt("FERRY_REVIEWER_MAX_ITERATIONS");
  if (reviewerMaxIterations !== void 0) limits.reviewer_max_iterations = reviewerMaxIterations;
  const reviewerMaxTokens = envInt("FERRY_REVIEWER_MAX_TOKENS");
  if (reviewerMaxTokens !== void 0) limits.reviewer_max_tokens = reviewerMaxTokens;
  const reconcilerStaleWindowMinutes = envInt("FERRY_RECONCILER_STALE_WINDOW_MINUTES");
  if (reconcilerStaleWindowMinutes !== void 0)
    limits.reconciler_stale_window_minutes = reconcilerStaleWindowMinutes;
  process.env.FERRY_BASH_TIMEOUT_MS = String(limits.bash_timeout_ms);
  process.env.FERRY_BASH_TIMEOUT_MAX_MS = String(limits.bash_timeout_max_ms);
  process.env.FERRY_GREP_TIMEOUT_MS = String(limits.grep_timeout_ms);
  process.env.FERRY_ANTHROPIC_VERIFY_TIMEOUT_MS = String(limits.anthropic_verify_timeout_ms);
  process.env.FERRY_JIRA_RETRY_BASE_DELAY_MS = String(limits.jira_retry_base_delay_ms);
  process.env.FERRY_JIRA_RETRY_MAX_ATTEMPTS = String(limits.jira_retry_max_attempts);
  process.env.FERRY_ENVELOPE_INSTRUCTIONS_CHARS = String(limits.envelope_instructions_chars);
  process.env.FERRY_PROJECT_SNIPPET_BYTES = String(limits.project_snippet_bytes);
  process.env.FERRY_AGENT_EXTENSION_BYTES = String(limits.agent_extension_bytes);
  process.env.FERRY_TLDR_TOTAL_CHARS = String(limits.tldr_total_chars);
  process.env.FERRY_TLDR_VERDICT_CHARS = String(limits.tldr_verdict_chars);
  process.env.FERRY_FILE_DISPLAY_CHARS = String(limits.file_display_chars);
  process.env.FERRY_REFINER_SUBTASK_CAP = String(limits.refiner_subtask_cap);
  process.env.FERRY_REFINER_TOUCH_PATHS_CAP = String(limits.refiner_touch_paths_cap);
  process.env.FERRY_REVIEWER_MAX_ITERATIONS = String(limits.reviewer_max_iterations);
  process.env.FERRY_REVIEWER_MAX_TOKENS = String(limits.reviewer_max_tokens);
  process.env.FERRY_RECONCILER_STALE_WINDOW_MINUTES = String(
    limits.reconciler_stale_window_minutes
  );
  return { ...cfg, models, limits };
}
function loadFerryConfig(repoRoot) {
  const root = repoRoot ?? process.env.GITHUB_WORKSPACE ?? process.cwd();
  const raw = findAndReadConfigFile(root);
  if (raw === null) {
    return applyEnvOverrides(DEFAULT_FERRY_CONFIG);
  }
  const errors = validateConfigShape(raw);
  if (errors.length > 0) {
    throw new FerryError("state-invariant", {
      reason: "invalid-ferry-config",
      errors
    });
  }
  return applyEnvOverrides(mergeWithDefaults(raw));
}

// src/lib/labels/capabilities.ts
var FORCE_TYPE_LABELS = Object.freeze({
  "ferry:type:force-bug": "Bug",
  "ferry:type:force-spike": "Spike",
  "ferry:type:force-story": "Story"
});
var ENABLE_TASK_LABEL = "ferry:type:enable-task";
var AS_LABEL_PREFIX = "ferry:as/";
var AS_TYPE_LABELS = Object.freeze({
  bug: "Bug",
  spike: "Spike",
  story: "Story"
});
var BUILTIN_TYPE_LABELS = /* @__PURE__ */ new Set([
  ENABLE_TASK_LABEL,
  ...Object.keys(FORCE_TYPE_LABELS),
  ...Object.keys(AS_TYPE_LABELS).map((s) => `${AS_LABEL_PREFIX}${s}`)
]);
function resolveTypeOverrides(labels) {
  let bypassTaskSkip = false;
  let typeOverride;
  let forceLabel;
  for (const label of labels) {
    if (label === ENABLE_TASK_LABEL) {
      bypassTaskSkip = true;
    } else if (Object.prototype.hasOwnProperty.call(FORCE_TYPE_LABELS, label)) {
      typeOverride = FORCE_TYPE_LABELS[label];
      forceLabel = label;
    }
  }
  return { bypassTaskSkip, typeOverride, forceLabel };
}
function isBuiltinTypeLabel(label) {
  return BUILTIN_TYPE_LABELS.has(label);
}

// src/lib/labels/overrides.ts
var AGENT_PHASES = /* @__PURE__ */ new Set(["refiner", "dev", "review", "iterate"]);
var PHASES_ORDERED = ["refiner", "dev", "review", "iterate"];
var LLM_PROVIDERS = /* @__PURE__ */ new Set(["anthropic", "openai", "google"]);
var BRANCH_NAME_REGEX = /^[a-zA-Z0-9._/-]+$/;
var LabelConflictError = class extends Error {
  label1;
  label2;
  field;
  constructor(label1, label2, field) {
    super(`Conflicting ferry labels for "${field}": "${label1}" and "${label2}"`);
    this.name = "LabelConflictError";
    this.label1 = label1;
    this.label2 = label2;
    this.field = field;
  }
};
function parsePositiveFloat(s) {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : void 0;
}
function parsePositiveInt(s) {
  const n = Number(s);
  return Number.isInteger(n) && n > 0 ? n : void 0;
}
var MCP_LABEL_PREFIX = "ferry:mcp/";
var PROFILE_LABEL_PREFIX = "ferry:profile/";
var KNOWN_STATUS_LABELS = /* @__PURE__ */ new Set([
  "ferry:refining",
  "ferry:developing",
  "ferry:reviewing",
  "ferry:iterating",
  "ferry:ready",
  "ferry:approved",
  "ferry:cancelled",
  "ferry:blocked",
  "ferry:spend-cap",
  "ferry:audit-log:active"
]);
var SKIP_PHASE_ALIASES = Object.freeze({
  refiner: "refiner",
  dev: "dev",
  review: "review",
  iter: "iterate",
  // alias from issue #239 — "iter" maps to the Iterator phase
  iterate: "iterate"
});
function isKnownNonOverrideLabel(label) {
  if (isBuiltinTypeLabel(label)) return true;
  if (KNOWN_STATUS_LABELS.has(label)) return true;
  if (label.startsWith("ferry:cost-estimate:")) return true;
  if (label.startsWith(MCP_LABEL_PREFIX)) return true;
  if (label.startsWith(PROFILE_LABEL_PREFIX)) return true;
  return false;
}
function resolveTicketOverrides(labels, logger2, options) {
  const typeOverrides = resolveTypeOverrides(labels);
  let asLabel;
  let asTypeValue;
  for (const label of labels) {
    if (!label.startsWith(AS_LABEL_PREFIX)) continue;
    const suffix = label.slice(AS_LABEL_PREFIX.length);
    const mapped = AS_TYPE_LABELS[suffix];
    if (mapped === void 0) {
      logger2?.warn("unknown suffix in ferry:as label", { label, suffix });
      continue;
    }
    if (asTypeValue !== void 0 && asTypeValue !== mapped) {
      throw new LabelConflictError(asLabel, label, "typeOverride");
    }
    if (asTypeValue === void 0) {
      asTypeValue = mapped;
      asLabel = label;
    }
  }
  if (asTypeValue !== void 0) {
    if (typeOverrides.typeOverride !== void 0 && typeOverrides.typeOverride !== asTypeValue) {
      throw new LabelConflictError(typeOverrides.forceLabel, asLabel, "typeOverride");
    }
    typeOverrides.typeOverride = asTypeValue;
    typeOverrides.forceLabel = asLabel;
  }
  const modelOverrides = {};
  const modelSources = {};
  const providerSources = {};
  let blanketModel;
  let blanketModelSource;
  let blanketProvider;
  let blanketProviderSource;
  let budgetMaxCostLabel;
  let budgetMaxTokensLabel;
  let budgetMaxCostEur;
  let budgetMaxTokens;
  let budgetEurLabel;
  let budgetEur;
  let maxIterationsLabel;
  let maxIterations;
  let maxTokensLabel;
  let maxTokens;
  let thinkingLabel;
  let thinking;
  let reviewRubricLabel;
  let reviewRubric;
  let noPr = false;
  let paused = false;
  let noAutoTransition = false;
  let dryRun = false;
  let readOnly = false;
  let hasClaudeCode = false;
  let hasNoClaudeCode = false;
  let hasCodexCli = false;
  let hasNoCodexCli = false;
  const skipPhases = [];
  let baseBranchLabel;
  let baseBranch;
  let targetBranchLabel;
  let targetBranch;
  let prDraftLabel;
  let prDraft;
  for (const label of labels) {
    if (!label.startsWith("ferry:")) continue;
    if (isKnownNonOverrideLabel(label)) continue;
    if (label.startsWith("ferry:model/")) {
      const rest = label.slice("ferry:model/".length);
      if (!rest) {
        logger2?.warn("malformed ferry:model label (empty model name)", { label });
        continue;
      }
      const slashIdx = rest.indexOf("/");
      if (slashIdx < 0) {
        if (blanketModelSource !== void 0) {
          throw new LabelConflictError(blanketModelSource, label, "model");
        }
        blanketModel = rest;
        blanketModelSource = label;
        continue;
      }
      const firstSegment = rest.slice(0, slashIdx);
      const remainder = rest.slice(slashIdx + 1);
      if (AGENT_PHASES.has(firstSegment)) {
        const p = firstSegment;
        if (!remainder) {
          logger2?.warn("empty model-id in ferry:model label", { label });
          continue;
        }
        if (modelSources[p] !== void 0) {
          throw new LabelConflictError(modelSources[p], label, `model.${firstSegment}`);
        }
        modelSources[p] = label;
        modelOverrides[p] = { ...modelOverrides[p], model: remainder };
      } else {
        if (blanketModelSource !== void 0) {
          throw new LabelConflictError(blanketModelSource, label, "model");
        }
        blanketModel = rest;
        blanketModelSource = label;
      }
      continue;
    }
    if (label.startsWith("ferry:provider/")) {
      const parts = label.slice("ferry:provider/".length).split("/");
      if (parts.length === 1) {
        const provider2 = parts[0];
        if (!LLM_PROVIDERS.has(provider2)) {
          logger2?.warn("unknown provider in blanket ferry:provider label", { label, provider: provider2 });
          continue;
        }
        if (blanketProviderSource !== void 0) {
          throw new LabelConflictError(blanketProviderSource, label, "provider");
        }
        blanketProvider = provider2;
        blanketProviderSource = label;
        continue;
      }
      if (parts.length !== 2) {
        logger2?.warn(
          "malformed ferry:provider label (expected ferry:provider/<provider> or ferry:provider/<phase>/<provider>)",
          { label }
        );
        continue;
      }
      const [phase, provider] = parts;
      if (!AGENT_PHASES.has(phase)) {
        logger2?.warn("unknown phase in ferry:provider label", { label, phase });
        continue;
      }
      if (!LLM_PROVIDERS.has(provider)) {
        logger2?.warn("unknown provider in ferry:provider label", { label, provider });
        continue;
      }
      const p = phase;
      if (providerSources[p] !== void 0) {
        throw new LabelConflictError(providerSources[p], label, `provider.${phase}`);
      }
      providerSources[p] = label;
      modelOverrides[p] = {
        ...modelOverrides[p],
        provider
      };
      continue;
    }
    if (label.startsWith("ferry:budget/")) {
      const rest = label.slice("ferry:budget/".length);
      if (rest.startsWith("max-cost/")) {
        const raw = rest.slice("max-cost/".length);
        const val2 = parsePositiveFloat(raw);
        if (val2 === void 0) {
          logger2?.warn("invalid cost value in ferry:budget/max-cost label", { label });
          continue;
        }
        if (budgetMaxCostLabel !== void 0) {
          throw new LabelConflictError(budgetMaxCostLabel, label, "budget.maxCostEurPerRun");
        }
        budgetMaxCostLabel = label;
        budgetMaxCostEur = val2;
        continue;
      }
      if (rest.startsWith("max-tokens/")) {
        const raw = rest.slice("max-tokens/".length);
        const val2 = parsePositiveInt(raw);
        if (val2 === void 0) {
          logger2?.warn("invalid token count in ferry:budget/max-tokens label", { label });
          continue;
        }
        if (budgetMaxTokensLabel !== void 0) {
          throw new LabelConflictError(budgetMaxTokensLabel, label, "budget.maxTokensPerRun");
        }
        budgetMaxTokensLabel = label;
        budgetMaxTokens = val2;
        continue;
      }
      const val = parsePositiveInt(rest);
      if (val === void 0) {
        logger2?.warn("invalid EUR value in ferry:budget label (expected positive integer)", {
          label
        });
        continue;
      }
      if (budgetEurLabel !== void 0) {
        throw new LabelConflictError(budgetEurLabel, label, "budgetEur");
      }
      budgetEurLabel = label;
      budgetEur = val;
      continue;
    }
    if (label.startsWith("ferry:max-iterations/")) {
      const raw = label.slice("ferry:max-iterations/".length);
      const val = parsePositiveInt(raw);
      if (val === void 0) {
        logger2?.warn("invalid count in ferry:max-iterations label", { label });
        continue;
      }
      if (maxIterationsLabel !== void 0) {
        throw new LabelConflictError(maxIterationsLabel, label, "maxIterations");
      }
      maxIterationsLabel = label;
      maxIterations = val;
      continue;
    }
    if (label.startsWith("ferry:max-tokens/")) {
      const raw = label.slice("ferry:max-tokens/".length);
      const val = parsePositiveInt(raw);
      if (val === void 0) {
        logger2?.warn("invalid count in ferry:max-tokens label", { label });
        continue;
      }
      if (maxTokensLabel !== void 0) {
        throw new LabelConflictError(maxTokensLabel, label, "maxTokens");
      }
      maxTokensLabel = label;
      maxTokens = val;
      continue;
    }
    if (label.startsWith("ferry:skip/")) {
      const suffix = label.slice("ferry:skip/".length);
      const phase = SKIP_PHASE_ALIASES[suffix];
      if (phase === void 0) {
        logger2?.warn("unknown phase in ferry:skip label", { label, phase: suffix });
        continue;
      }
      if (phase === "review" && options?.allowSkipReview !== true) {
        logger2?.warn(
          "ferry:skip/review ignored \u2014 requires safety.allow_skip_review opt-in in ferry.config.yaml",
          { label }
        );
        continue;
      }
      if (!skipPhases.includes(phase)) skipPhases.push(phase);
      continue;
    }
    if (label === "ferry:no-auto-transition") {
      noAutoTransition = true;
      continue;
    }
    if (label.startsWith("ferry:thinking/")) {
      const suffix = label.slice("ferry:thinking/".length);
      let val;
      if (suffix === "on") val = "on";
      else if (suffix === "off") val = "off";
      else if (suffix === "extended") val = "extended";
      if (val === void 0) {
        logger2?.warn("unknown suffix in ferry:thinking label", { label, suffix });
        continue;
      }
      if (thinking !== void 0 && thinking !== val) {
        throw new LabelConflictError(thinkingLabel, label, "thinking");
      }
      if (thinking === void 0) {
        thinking = val;
        thinkingLabel = label;
      }
      continue;
    }
    if (label === "ferry:strict-review" || label === "ferry:lenient-review") {
      const val = label === "ferry:strict-review" ? "strict" : "lenient";
      if (reviewRubric !== void 0 && reviewRubric !== val) {
        throw new LabelConflictError(reviewRubricLabel, label, "reviewRubric");
      }
      if (reviewRubric === void 0) {
        reviewRubric = val;
        reviewRubricLabel = label;
      }
      continue;
    }
    if (label === "ferry:git/no-pr") {
      noPr = true;
      continue;
    }
    if (label.startsWith("ferry:base/")) {
      const branch = label.slice("ferry:base/".length);
      if (!BRANCH_NAME_REGEX.test(branch)) {
        logger2?.warn("invalid branch name in ferry:base label (expected ^[a-zA-Z0-9._/-]+$)", {
          label
        });
        continue;
      }
      if (baseBranch !== void 0 && baseBranch !== branch) {
        throw new LabelConflictError(baseBranchLabel, label, "git.baseBranch");
      }
      if (baseBranch === void 0) {
        baseBranch = branch;
        baseBranchLabel = label;
      }
      continue;
    }
    if (label.startsWith("ferry:target/")) {
      const branch = label.slice("ferry:target/".length);
      if (!BRANCH_NAME_REGEX.test(branch)) {
        logger2?.warn("invalid branch name in ferry:target label (expected ^[a-zA-Z0-9._/-]+$)", {
          label
        });
        continue;
      }
      if (targetBranch !== void 0 && targetBranch !== branch) {
        throw new LabelConflictError(targetBranchLabel, label, "git.targetBranch");
      }
      if (targetBranch === void 0) {
        targetBranch = branch;
        targetBranchLabel = label;
      }
      continue;
    }
    if (label.startsWith("ferry:pr/")) {
      const suffix = label.slice("ferry:pr/".length);
      let val;
      if (suffix === "draft") val = true;
      else if (suffix === "ready") val = false;
      if (val === void 0) {
        logger2?.warn("unknown suffix in ferry:pr label (expected draft or ready)", {
          label,
          suffix
        });
        continue;
      }
      if (prDraft !== void 0 && prDraft !== val) {
        throw new LabelConflictError(prDraftLabel, label, "git.prDraft");
      }
      if (prDraft === void 0) {
        prDraft = val;
        prDraftLabel = label;
      }
      continue;
    }
    if (label === "ferry:paused") {
      paused = true;
      continue;
    }
    if (label === "ferry:dry-run") {
      dryRun = true;
      continue;
    }
    if (label === "ferry:read-only") {
      readOnly = true;
      continue;
    }
    if (label === "ferry:claude-code") {
      hasClaudeCode = true;
      continue;
    }
    if (label === "ferry:no-claude-code") {
      hasNoClaudeCode = true;
      continue;
    }
    if (label === "ferry:codex-cli") {
      hasCodexCli = true;
      continue;
    }
    if (label === "ferry:no-codex-cli") {
      hasNoCodexCli = true;
      continue;
    }
    logger2?.warn("unknown ferry override label ignored", { label });
  }
  const positiveDirectActionCount = Number(hasClaudeCode) + Number(hasCodexCli);
  const hasAnyDirectActionLabel = hasClaudeCode || hasNoClaudeCode || hasCodexCli || hasNoCodexCli;
  let executionPath;
  if (hasAnyDirectActionLabel) {
    executionPath = "script";
    if (positiveDirectActionCount === 1 && !hasNoClaudeCode && !hasNoCodexCli) {
      executionPath = hasClaudeCode ? "claude-code" : "codex-cli";
    }
  }
  const claudeCodePath = executionPath === "claude-code" || executionPath === "script" ? executionPath : void 0;
  if (blanketModel !== void 0) {
    for (const phase of PHASES_ORDERED) {
      if (modelSources[phase] === void 0) {
        modelOverrides[phase] = { ...modelOverrides[phase], model: blanketModel };
      }
    }
  }
  if (blanketProvider !== void 0) {
    for (const phase of PHASES_ORDERED) {
      if (providerSources[phase] === void 0) {
        modelOverrides[phase] = { ...modelOverrides[phase], provider: blanketProvider };
      }
    }
  }
  const hasModelOverrides = Object.keys(modelOverrides).length > 0;
  const hasBudget = budgetMaxCostEur !== void 0 || budgetMaxTokens !== void 0;
  const hasGit = noPr || baseBranch !== void 0 || targetBranch !== void 0 || prDraft !== void 0;
  const gitOverride = hasGit ? {
    ...noPr ? { noPr: true } : {},
    ...baseBranch !== void 0 ? { baseBranch } : {},
    ...targetBranch !== void 0 ? { targetBranch } : {},
    ...prDraft !== void 0 ? { prDraft } : {}
  } : void 0;
  return {
    ...typeOverrides,
    ...hasModelOverrides ? { modelOverrides } : {},
    ...hasBudget ? {
      budget: {
        ...budgetMaxCostEur !== void 0 ? { maxCostEurPerRun: budgetMaxCostEur } : {},
        ...budgetMaxTokens !== void 0 ? { maxTokensPerRun: budgetMaxTokens } : {}
      }
    } : {},
    ...budgetEur !== void 0 ? { budgetEur } : {},
    ...maxIterations !== void 0 ? { maxIterations } : {},
    ...maxTokens !== void 0 ? { maxTokens } : {},
    ...skipPhases.length > 0 ? { skipPhases } : {},
    ...noAutoTransition ? { noAutoTransition: true } : {},
    ...thinking !== void 0 ? { thinking } : {},
    ...reviewRubric !== void 0 ? { reviewRubric } : {},
    ...gitOverride ? { git: gitOverride } : {},
    ...paused ? { paused: true } : {},
    ...dryRun ? { dryRun: true } : {},
    ...readOnly ? { readOnly: true } : {},
    ...executionPath !== void 0 ? { executionPath } : {},
    ...claudeCodePath !== void 0 ? { claudeCodePath } : {}
  };
}

// src/lib/dispatch/derive-role.ts
var EVENT_TYPE_TO_ROLE = Object.freeze({
  "ferry-refine": "refiner",
  "ferry-dev": "developer",
  "ferry-review": "reviewer",
  "ferry-iterate": "iterator",
  "ferry-merge": "merger"
});
var ROLE_TO_PHASE = Object.freeze({
  refiner: "refine",
  developer: "dev",
  reviewer: "review",
  iterator: "iterate",
  merger: "merge"
});
function roleToPhase(role) {
  return ROLE_TO_PHASE[role];
}
function deriveAgentRole(eventType, toStatus, cfg) {
  const direct = EVENT_TYPE_TO_ROLE[eventType];
  if (direct) return direct;
  if (eventType !== "ferry-transition") return "none";
  const wanted = toStatus?.trim().toLowerCase();
  if (!wanted) return "none";
  const agents = cfg.workflow.agents;
  const columnToRole = [
    [agents.refiner.trigger_column, "refiner"],
    [agents.developer.trigger_column, "developer"],
    [agents.reviewer.trigger_column, "reviewer"],
    [agents.iterator.trigger_column, "iterator"]
    // merger deliberately absent — ADR-0005 no-auto-merge invariant.
  ];
  const hit = columnToRole.find(([column]) => column.trim().toLowerCase() === wanted);
  return hit ? hit[1] : "none";
}

// src/lib/cc-wrappers/routing.ts
function markerRoleToken(role) {
  return role === "developer" ? "dev" : role;
}
var HEURISTIC_ROLES = /* @__PURE__ */ new Set(["developer", "iterator"]);
function isAnthropicOnlyConfig(cfg) {
  const m = cfg.models;
  return m.refiner.provider === "anthropic" && m.dev.provider === "anthropic" && m.review.provider === "anthropic" && m.iterate.provider === "anthropic";
}
function providerForRole(cfg, role) {
  switch (role) {
    case "developer":
      return cfg.models.dev.provider;
    case "iterator":
      return cfg.models.iterate.provider;
    case "reviewer":
      return cfg.models.review.provider;
    case "refiner":
      return cfg.models.refiner.provider;
    case "merger":
      return "anthropic";
  }
}
function isDirectPathAvailable(path2, input) {
  if (path2 === "script") return true;
  if (path2 === "claude-code") return input.anthropicOnly;
  if (path2 === "codex-cli") return input.roleProvider === "openai";
  return false;
}
function resolveExecutionPath(input) {
  if (input.configuredPath === "script") {
    return { path: "script", reason: "default" };
  }
  const requestedDirectPath = input.labelOverride === "claude-code" || input.labelOverride === "codex-cli" ? input.labelOverride : input.configuredPath === "claude-code" || input.configuredPath === "codex-cli" ? input.configuredPath : void 0;
  if (requestedDirectPath !== void 0 && !isDirectPathAvailable(requestedDirectPath, input)) {
    return { path: "script", reason: "provider-gate" };
  }
  if (!input.anthropicOnly && requestedDirectPath === void 0) {
    return { path: "script", reason: "provider-gate" };
  }
  if (input.labelOverride !== void 0) {
    return { path: input.labelOverride, reason: "label" };
  }
  const defaultPath = input.configuredPath === "claude-code" || input.configuredPath === "codex-cli" ? input.configuredPath : input.anthropicOnly ? "claude-code" : "script";
  if (defaultPath === "script" && HEURISTIC_ROLES.has(input.role) && input.roundTripThreshold > 0 && input.priorRoundTrips >= input.roundTripThreshold) {
    return { path: "claude-code", reason: "heuristic" };
  }
  return { path: defaultPath, reason: "default" };
}
function formatExecutionPathAudit(role, runId, decision) {
  return `[ferry:${markerRoleToken(role)}:${runId}] execution-path: ${decision.path} (reason: ${decision.reason})`;
}

// src/lib/logger/index.ts
function isDebugEnabled() {
  return process.env.LOG_VERBOSITY === "debug";
}
function isPretty() {
  return process.env.LOG_FORMAT === "pretty";
}
function buildRecord(level, correlationId, component, message, bindings, meta) {
  return {
    level,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    correlation_id: correlationId,
    component,
    message,
    ...bindings,
    ...meta
  };
}
function writeRecord(record) {
  if (isPretty()) {
    const { level, ts, correlation_id, component, message, ...rest } = record;
    const extras = Object.keys(rest).length > 0 ? `  ${JSON.stringify(rest)}` : "";
    process.stderr.write(
      `${ts}  ${level.toUpperCase().padEnd(5)}  [${component}]  ${correlation_id ? `(${correlation_id})  ` : ""}${message}${extras}
`
    );
  } else {
    process.stderr.write(JSON.stringify(record) + "\n");
  }
}
function makeLogger(correlationId, component, bindings = {}, _writeRecord = writeRecord) {
  function log(level, message, meta) {
    if (level === "debug" && !isDebugEnabled()) return;
    _writeRecord(buildRecord(level, correlationId, component, message, bindings, meta));
  }
  return {
    debug: (msg, meta) => log("debug", msg, meta),
    info: (msg, meta) => log("info", msg, meta),
    warn: (msg, meta) => log("warn", msg, meta),
    error: (msg, meta) => log("error", msg, meta),
    child: (newBindings) => makeLogger(correlationId, component, { ...bindings, ...newBindings }, _writeRecord)
  };
}
function createLogger(correlationId, component = "ferry") {
  return makeLogger(correlationId, component);
}

// src/lib/dispatch/route-action.ts
var VALID_ROLES = ["refiner", "developer", "reviewer", "iterator", "merger"];
var logger = createLogger("", "ferry:route");
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    logger.error(`${name} is not set`);
    process.exit(1);
  }
  return v;
}
function parseRole(raw) {
  if (!raw || !VALID_ROLES.includes(raw)) {
    logger.error("FERRY_AGENT_ROLE is invalid", {
      valid: VALID_ROLES.join(", "),
      got: raw ?? "(unset)"
    });
    process.exit(1);
  }
  return raw;
}
function writeOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    process.stdout.write(`${name}=${value}
`);
    return;
  }
  appendFileSync(outputFile, `${name}=${value}
`);
}
async function runRouteAction() {
  const raw = requireEnv("FERRY_ENVELOPE_PAYLOAD");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error("FERRY_ENVELOPE_PAYLOAD is not valid JSON");
    process.exit(1);
  }
  const envelope = validateEnvelope(parsed);
  const config = loadFerryConfig(process.cwd());
  const explicitRole = process.env.FERRY_AGENT_ROLE;
  const role = explicitRole ? parseRole(explicitRole) : deriveAgentRole(process.env.FERRY_EVENT_TYPE ?? "", envelope.to_status, config);
  if (role === "none") {
    logger.info("dispatch maps to no agent \u2014 no-op", {
      eventType: process.env.FERRY_EVENT_TYPE ?? "(unset)",
      toStatus: envelope.to_status ?? "(unset)"
    });
    writeOutput("path", "none");
    writeOutput("reason", "unmapped-status");
    writeOutput("role", "none");
    writeOutput("phase", "");
    return { path: "none", reason: "unmapped-status", role: "none" };
  }
  const jiraBaseUrl = requireEnv("FERRY_JIRA_BASE_URL");
  const jiraEmail = requireEnv("FERRY_JIRA_EMAIL");
  const jiraApiToken = requireEnv("FERRY_JIRA_API_TOKEN");
  const jira = new JiraRestClient(jiraBaseUrl, jiraEmail, jiraApiToken);
  const issue = await jira.getIssue(envelope.ticket_key);
  const overrides = resolveTicketOverrides(issue.fields.labels ?? [], logger, {
    allowSkipReview: config.safety?.allow_skip_review === true
  });
  const decision = resolveExecutionPath({
    configuredPath: config.execution_path,
    anthropicOnly: isAnthropicOnlyConfig(config),
    roleProvider: providerForRole(config, role),
    labelOverride: overrides.executionPath ?? overrides.claudeCodePath,
    role,
    // #FOLLOW-UP: derive priorRoundTrips from the audit issue's `[ferry:iterator:*]
    // complete. Pushed fixes to PR#…` markers (same source `countPriorIterations`
    // uses in src/agents/reviewer/changes-guard.ts). Stubbed to 0 here so the
    // heuristic-escalation branch never fires until that loader lands.
    priorRoundTrips: 0,
    roundTripThreshold: config.routing.claude_code_round_trip_threshold
  });
  writeOutput("path", decision.path);
  writeOutput("reason", decision.reason);
  writeOutput("role", role);
  writeOutput("phase", roleToPhase(role));
  process.stdout.write(`${formatExecutionPathAudit(role, envelope.event_id, decision)}
`);
  return { ...decision, role };
}
var invokedDirectly = typeof process !== "undefined" && process.argv[1]?.endsWith("route-action.js");
if (invokedDirectly) {
  void runRouteAction().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ferry-route: ${msg}
`);
    process.exit(1);
  });
}
export {
  runRouteAction
};
