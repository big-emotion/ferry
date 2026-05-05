// src/agents/refiner/refiner-action.ts
import { pathToFileURL } from "node:url";

// src/lib/io/spend-cap.ts
function classifyHttpStatus(status) {
  if (status === 429 || status === 402) return "spend-cap";
  if (status >= 500) return "transient";
  if (status >= 200 && status < 300) return "ok";
  if (status >= 400) return "spend-cap";
  return "transient";
}

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
};
function createJiraRestClientFromEnv() {
  const baseUrl = process.env.FERRY_JIRA_BASE_URL;
  const email = process.env.FERRY_JIRA_EMAIL;
  const apiToken = process.env.FERRY_JIRA_API_TOKEN;
  if (!baseUrl)
    throw new FerryError("state-invariant", { reason: "missing-env", key: "FERRY_JIRA_BASE_URL" });
  if (!email)
    throw new FerryError("state-invariant", { reason: "missing-env", key: "FERRY_JIRA_EMAIL" });
  if (!apiToken)
    throw new FerryError("state-invariant", {
      reason: "missing-env",
      key: "FERRY_JIRA_API_TOKEN"
    });
  return new JiraRestClient(baseUrl, email, apiToken);
}

// src/lib/io/jira-adf.ts
function textToAdf(text) {
  const paragraphs = text.split("\n\n").filter((p) => p.length > 0);
  if (paragraphs.length === 0) {
    return {
      version: 1,
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }]
    };
  }
  const content = paragraphs.map((para) => {
    const lines = para.split("\n");
    const paraContent = [];
    lines.forEach((line, i) => {
      if (i > 0) paraContent.push({ type: "hardBreak" });
      if (line.length > 0) paraContent.push({ type: "text", text: line });
    });
    return { type: "paragraph", content: paraContent };
  });
  return { version: 1, type: "doc", content };
}
function adfToText(adf) {
  if (!adf || !Array.isArray(adf.content)) return "";
  return adf.content.map((para) => {
    if (!Array.isArray(para.content)) return "";
    return para.content.map((node) => node.type === "text" ? node.text : "\n").join("");
  }).join("\n\n");
}

// src/lib/io/tracker/jira/tracker.ts
var JiraTracker = class {
  constructor(client) {
    this.client = client;
  }
  client;
  async getIssue(key) {
    const issue = await this.client.getIssue(key);
    return {
      key: issue.key,
      summary: issue.fields.summary,
      description: adfToText(issue.fields.description),
      comments: issue.fields.comment.comments.map((c) => adfToText(c.body)),
      labels: issue.fields.labels,
      issueType: issue.fields.issuetype.name
    };
  }
  async postComment(key, body) {
    await this.client.postComment(key, textToAdf(body));
  }
  async postTransition(key, transitionId) {
    await this.client.postTransition(key, transitionId);
  }
  async getSubtasks(key) {
    return this.client.getSubtasks(key);
  }
  async createSubtask(parentKey, title, description) {
    const result = await this.client.createSubtask(parentKey, title, textToAdf(description));
    return { id: result.key };
  }
};

// src/lib/io/tracker/factory.ts
function createTrackerFromEnv() {
  return new JiraTracker(createJiraRestClientFromEnv());
}

// src/lib/dry-run.ts
function isDryRun() {
  return process.env.FERRY_DRY_RUN === "1" || process.env.FERRY_DRY_RUN === "true";
}

// src/lib/config.ts
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
var _require = createRequire(import.meta.url);
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
      iterator: { trigger_column: "Changes Requested", auto_transition: "In Review" }
    }
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
        if (typeof g.working_branch_prefix !== "string" || g.working_branch_prefix.length === 0) {
          errs.push("git.working_branch_prefix: must be a non-empty string");
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
    const mod = _require("yaml");
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
      working_branch_prefix: typeof g.working_branch_prefix === "string" ? g.working_branch_prefix : DEFAULT_FERRY_CONFIG.git.working_branch_prefix
    },
    ...labels !== void 0 ? { labels } : {},
    workflow: mergeWorkflow(raw.workflow)
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

// src/lib/llm/call.ts
import Anthropic2 from "@anthropic-ai/sdk";

// src/lib/io/retry.ts
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function computeDelayMs(attemptIndex, opts) {
  const base = opts.baseDelayMs * Math.pow(opts.backoffFactor, attemptIndex);
  const jitter = (Math.random() * 2 - 1) * opts.jitterRatio;
  return Math.max(0, Math.round(base * (1 + jitter)));
}
function retry(fn, options) {
  const opts = {
    jitterRatio: 0.5,
    backoffFactor: 2,
    ...options
  };
  return async (...args) => {
    let lastErr;
    for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
      try {
        return await fn(...args);
      } catch (e) {
        lastErr = e;
        const isTransient = e instanceof FerryError && e.code === "transient";
        const shouldRetry = isTransient && attempt < opts.maxAttempts - 1;
        if (!shouldRetry) break;
        const delayMs = computeDelayMs(attempt, opts);
        await sleep(delayMs);
      }
    }
    if (lastErr instanceof FerryError && lastErr.code === "transient") {
      throw new FerryError("unknown");
    }
    throw lastErr;
  };
}

// src/lib/llm/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";

// src/lib/llm/pricing.ts
var RATES = {
  "anthropic/claude-sonnet-4-6": { inputPer1M: 2.79, outputPer1M: 13.95 },
  "anthropic/claude-opus": { inputPer1M: 13.95, outputPer1M: 69.75 },
  "anthropic/claude-haiku": { inputPer1M: 0.23, outputPer1M: 1.16 },
  "openai/gpt-4.1-mini": { inputPer1M: 0.14, outputPer1M: 0.56 },
  "openai/gpt-4.": { inputPer1M: 2.79, outputPer1M: 8.37 },
  "openai/gpt-5.": { inputPer1M: 2.79, outputPer1M: 8.37 },
  "google/gemini-2.5-flash": { inputPer1M: 0.07, outputPer1M: 0.28 },
  "google/gemini-2.5-pro": { inputPer1M: 1.05, outputPer1M: 4.2 }
};
var PROVIDER_FALLBACK = {
  anthropic: RATES["anthropic/claude-opus"],
  openai: RATES["openai/gpt-4."],
  google: RATES["google/gemini-2.5-pro"]
};
function lookupRates(provider, model) {
  const exactKey = `${provider}/${model}`;
  if (RATES[exactKey]) return RATES[exactKey];
  for (const key of Object.keys(RATES)) {
    if (key !== exactKey && key.startsWith(`${provider}/`) && model.startsWith(key.slice(provider.length + 1))) {
      return RATES[key];
    }
  }
  return PROVIDER_FALLBACK[provider];
}
function computeCostEur(provider, model, inputTokens, outputTokens) {
  const rates = lookupRates(provider, model);
  const cost = inputTokens / 1e6 * rates.inputPer1M + outputTokens / 1e6 * rates.outputPer1M;
  return Math.round(cost * 1e4) / 1e4;
}

// src/lib/llm/anthropic.ts
async function invokeAnthropic(opts) {
  try {
    const msg = await opts.client.messages.create({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [{ role: "user", content: opts.prompt }]
    });
    const textBlock = msg.content.find((b) => b.type === "text");
    const text = textBlock && textBlock.type === "text" ? textBlock.text : "";
    const inputTokens = msg.usage.input_tokens;
    const outputTokens = msg.usage.output_tokens;
    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        costEur: computeCostEur("anthropic", opts.model, inputTokens, outputTokens)
      }
    };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) {
      throw new FerryError("spend-cap", { reason: "rate-limit" });
    }
    if (e instanceof Anthropic.APIError && e.status >= 500) {
      throw new FerryError("transient", { reason: "server-error", status: e.status });
    }
    if (e instanceof Error && isNetworkError(e.message)) {
      throw new FerryError("transient", { reason: "network-error" });
    }
    throw e;
  }
}
function isNetworkError(msg) {
  return msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ETIMEDOUT");
}

// src/lib/llm/openai.ts
import OpenAI from "openai";
async function invokeOpenAI(opts) {
  const client = new OpenAI({ apiKey: opts.apiKey });
  try {
    const completion = await client.chat.completions.create({
      model: opts.model,
      messages: [{ role: "user", content: opts.prompt }],
      max_tokens: opts.maxTokens
    });
    const text = completion.choices[0]?.message.content ?? "";
    const inputTokens = completion.usage?.prompt_tokens ?? 0;
    const outputTokens = completion.usage?.completion_tokens ?? 0;
    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        costEur: computeCostEur("openai", opts.model, inputTokens, outputTokens)
      }
    };
  } catch (e) {
    if (e instanceof OpenAI.RateLimitError) {
      throw new FerryError("spend-cap", { reason: "rate-limit" });
    }
    if (e instanceof OpenAI.APIConnectionError) {
      throw new FerryError("transient", { reason: "network-error" });
    }
    if (e instanceof OpenAI.APIError && e.status >= 500) {
      throw new FerryError("transient", { reason: "server-error", status: e.status });
    }
    throw e;
  }
}

// src/lib/llm/google.ts
import { GoogleGenAI } from "@google/genai";
async function invokeGoogle(opts) {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  try {
    const response = await ai.models.generateContent({
      model: opts.model,
      contents: opts.prompt
    });
    const text = response.text ?? "";
    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    return {
      text,
      usage: {
        inputTokens,
        outputTokens,
        costEur: computeCostEur("google", opts.model, inputTokens, outputTokens)
      }
    };
  } catch (e) {
    if (e instanceof Error) {
      throw new FerryError("transient", { reason: "network-error", message: e.message });
    }
    throw e;
  }
}

// src/lib/llm/anthropic-auth.ts
function resolveAnthropicAuth(input) {
  const env = input.env ?? process.env;
  const oauthToken = env["CLAUDE_CODE_OAUTH_TOKEN"];
  if (oauthToken) {
    return { authToken: oauthToken };
  }
  const apiKey = env[input.apiKeyEnv];
  if (apiKey) {
    return { apiKey };
  }
  throw new FerryError("state-invariant", { reason: "missing-env", key: input.apiKeyEnv });
}

// src/lib/llm/call.ts
var MAX_TOKENS = parseInt(process.env.FERRY_LLM_UTILITY_MAX_TOKENS ?? "", 10) || 4096;
var LLM_RETRY_BASE_DELAY_MS = parseInt(process.env.FERRY_LLM_RETRY_BASE_DELAY_MS ?? "", 10) || 2e3;
var LLM_RETRY_MAX_ATTEMPTS = parseInt(process.env.FERRY_LLM_RETRY_MAX_ATTEMPTS ?? "", 10) || 3;
function requireEnv(key) {
  const val = process.env[key];
  if (!val) {
    throw new FerryError("state-invariant", { reason: "missing-env", key });
  }
  return val;
}
function createLlmCall(route) {
  if (route.provider === "anthropic") {
    const auth = resolveAnthropicAuth({ apiKeyEnv: "ANTHROPIC_API_KEY" });
    const client = new Anthropic2(auth);
    return retry(
      (prompt) => invokeAnthropic({ client, model: route.model, prompt, maxTokens: MAX_TOKENS }),
      { baseDelayMs: LLM_RETRY_BASE_DELAY_MS, maxAttempts: LLM_RETRY_MAX_ATTEMPTS }
    );
  }
  if (route.provider === "openai") {
    const apiKey = requireEnv("FERRY_OPENAI_KEY");
    return retry(
      (prompt) => invokeOpenAI({ apiKey, model: route.model, prompt, maxTokens: MAX_TOKENS }),
      { baseDelayMs: LLM_RETRY_BASE_DELAY_MS, maxAttempts: LLM_RETRY_MAX_ATTEMPTS }
    );
  }
  if (route.provider === "google") {
    const apiKey = requireEnv("FERRY_GOOGLE_AI_KEY");
    return retry((prompt) => invokeGoogle({ apiKey, model: route.model, prompt }), {
      baseDelayMs: LLM_RETRY_BASE_DELAY_MS,
      maxAttempts: LLM_RETRY_MAX_ATTEMPTS
    });
  }
  throw new FerryError("state-invariant", { reason: "unknown-provider", provider: route.provider });
}

// src/lib/agent-runtime/env.ts
function requireEnv2(key) {
  const val = process.env[key];
  if (!val) throw new FerryError("state-invariant", { reason: "missing-env", key });
  return val;
}

// src/lib/envelope/validate.ts
import { createRequire as createRequire2 } from "module";
var _require2 = createRequire2(import.meta.url);
var eventSchema = _require2("./schemas/event.v1.schema.json");
var ajvModule = _require2("ajv/dist/2020");
var ajvInstance = new ajvModule.Ajv2020({ strict: true });
_require2("ajv-formats").default(ajvInstance);
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

// src/lib/agent-runtime/run-agent.ts
var COMPONENT = {
  refiner: "ferry:refiner-action",
  developer: "ferry:dev-action",
  reviewer: "ferry:review-action",
  iterator: "ferry:iterate-action"
};
async function runAgent(role, handler) {
  const component = COMPONENT[role];
  const bootstrapLogger = createLogger("", component);
  try {
    const rawPayload = requireEnv2("FERRY_ENVELOPE_PAYLOAD");
    const envelope = validateEnvelope(JSON.parse(rawPayload));
    const logger = createLogger(envelope.event_id, component);
    await handler(envelope, logger);
  } catch (err) {
    bootstrapLogger.error("fatal", { error: err.message });
    process.exit(1);
  }
}

// src/lib/dispatch/routing.ts
var PHASE_TO_WORKFLOW = Object.freeze({
  refine: Object.freeze({ workflow: "ferry-refine.yml", dispatchType: "ferry-refine" }),
  dev: Object.freeze({ workflow: "ferry-dev.yml", dispatchType: "ferry-dev" }),
  review: Object.freeze({ workflow: "ferry-review.yml", dispatchType: "ferry-review" }),
  iterate: Object.freeze({ workflow: "ferry-iterate.yml", dispatchType: "ferry-iterate" })
});

// src/agents/refiner/refine.ts
import { createRequire as createRequire3 } from "module";

// src/lib/llm/delimit-untrusted.ts
var OPEN = "<<<UNTRUSTED>>>";
var CLOSE = "<<<END UNTRUSTED>>>";
var OPEN_ESCAPE = "<<<UNTRUSTED-LITERAL>>>";
var CLOSE_ESCAPE = "<<<END UNTRUSTED-LITERAL>>>";
function delimitUntrusted(value) {
  const escaped = value.split(OPEN).join(OPEN_ESCAPE).split(CLOSE).join(CLOSE_ESCAPE);
  return `${OPEN}
${escaped}
${CLOSE}`;
}

// src/agents/refiner/parse.ts
function extractFirstJsonObject(text) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) {
        start = i;
      }
      depth++;
    } else if (ch === "}") {
      if (depth > 0) {
        depth--;
        if (depth === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }
  return null;
}

// src/agents/refiner/schema.ts
var REFINER_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ferry.dev/schemas/refiner-output.v1.json",
  type: "object",
  required: ["subtasks", "touch_paths", "output_locale", "audit_summary"],
  additionalProperties: false,
  properties: {
    subtasks: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "description"],
        additionalProperties: false,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          description: { type: "string", minLength: 1, maxLength: 4e3 }
        }
      }
    },
    touch_paths: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 400 }
    },
    output_locale: { enum: ["en", "fr"] },
    audit_summary: { type: "string", minLength: 1, maxLength: 2e3 },
    attachments: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 400 }
    }
  }
};
var REFINER_TOUCH_PATHS_CAP = 20;
function getRefinerTouchPathsCap() {
  return parseInt(process.env.FERRY_REFINER_TOUCH_PATHS_CAP ?? "", 10) || REFINER_TOUCH_PATHS_CAP;
}

// src/agents/refiner/refine.ts
var _require3 = createRequire3(import.meta.url);
var ajvModule2 = _require3("ajv/dist/2020");
var ajvInstance2 = new ajvModule2.Ajv2020({ strict: true });
var validatePlan = ajvInstance2.compile(REFINER_OUTPUT_SCHEMA);
var SCHEMA_EXAMPLE = `{
  "subtasks": [
    {
      "title": "imperative verb, specific, max 200 chars",
      "description": "concrete acceptance criteria, file paths, done criteria; max 4000 chars"
    }
  ],
  "touch_paths": ["src/path/to/file.ts"],
  "output_locale": "en",
  "audit_summary": "one sentence summarising the plan"
}`;
function buildPrompt(input) {
  const block = [
    `TICKET ${input.ticket.key}`,
    `TITLE: ${input.ticket.title}`,
    `LABELS: ${input.ticket.labels.join(", ")}`,
    `DESCRIPTION:
${input.ticket.description}`,
    `COMMENTS:
${input.ticket.comments.join("\n---\n")}`
  ].join("\n\n");
  return [
    "You are the Ferry Refiner. Decompose the ticket into concrete sub-tasks.",
    "Reply with JSON only \u2014 no prose, no code fences \u2014 matching this exact schema:",
    SCHEMA_EXAMPLE,
    'Rules: max 12 subtasks (prefer 3\u20137). output_locale must be "en" or "fr" matching the ticket language. touch_paths lists every file the subtasks will touch (max 20).',
    delimitUntrusted(block)
  ].join("\n\n");
}
var SAMPLE_MAX = 512;
function sampleOf(text) {
  return text.length <= SAMPLE_MAX ? text : text.slice(0, SAMPLE_MAX);
}
function parseJsonOrThrow(text) {
  const candidate = extractFirstJsonObject(text);
  if (candidate !== null) {
    try {
      return JSON.parse(candidate);
    } catch {
    }
  }
  throw new FerryError("state-invariant", {
    reason: "refiner-output-invalid",
    stage: "parse",
    sample: sampleOf(text),
    text_length: text.length
  });
}
function ensureSchemaValid(plan, rawText) {
  if (!validatePlan(plan)) {
    throw new FerryError("state-invariant", {
      reason: "refiner-output-invalid",
      stage: "schema",
      paths: (validatePlan.errors ?? []).map((e) => `${e.instancePath} ${e.keyword}`),
      sample: sampleOf(rawText),
      text_length: rawText.length
    });
  }
}
async function runRefiner(input) {
  const prompt = buildPrompt(input);
  const llm = await input.callLlm(prompt);
  const parsed = parseJsonOrThrow(llm.text);
  ensureSchemaValid(parsed, llm.text);
  const touchPathsCap = getRefinerTouchPathsCap();
  if (parsed.touch_paths.length > touchPathsCap) {
    throw new FerryError("oscillation", {
      reason: "spec-too-broad",
      touchPaths: parsed.touch_paths.length,
      cap: touchPathsCap
    });
  }
  return {
    plan: parsed,
    auditSummary: {
      subtaskCount: parsed.subtasks.length,
      costEur: llm.usage?.costEur ?? 0,
      runLink: input.runLink,
      attachmentNames: input.ticket.attachments ?? []
    }
  };
}

// src/agents/refiner/batch.ts
var SUBTASK_CAP = 12;
function prepareBatch(plan, planId, cap) {
  const subtaskCap = cap ?? (parseInt(process.env.FERRY_REFINER_SUBTASK_CAP ?? "", 10) || SUBTASK_CAP);
  const original = plan.subtasks;
  const truncated = original.length > subtaskCap;
  const slice = truncated ? original.slice(0, subtaskCap) : original;
  const subtasks = slice.map((s, i) => ({
    title: s.title,
    description: `${s.description}

[ferry:refiner-subtask:${planId}:${i}]`
  }));
  return {
    subtasks,
    truncated,
    originalCount: original.length,
    planId
  };
}
async function applyBatch(prepared, create) {
  try {
    const refs = await create(prepared.subtasks);
    return { createdCount: refs.length, ids: refs.map((r) => r.id) };
  } catch (e) {
    throw new FerryError("transient", {
      reason: "batch-create-failed",
      cause: e instanceof Error ? e.message : String(e)
    });
  }
}

// src/agents/refiner/idempotency.ts
var MARKER_REGEX = /\[ferry:refiner-subtask:[^\]]+\]/;
function extractSubtaskMarker(description) {
  const match = description.match(MARKER_REGEX);
  return match ? match[0] : null;
}
function filterExistingSubtasks(prepared, existingDescriptions) {
  const existingMarkers = new Set(
    existingDescriptions.map(extractSubtaskMarker).filter((m) => m !== null)
  );
  const subtasks = prepared.subtasks.filter((s) => {
    const m = extractSubtaskMarker(s.description);
    return m === null || !existingMarkers.has(m);
  });
  return { ...prepared, subtasks };
}

// src/agents/refiner/refiner-action.ts
var REPO_ROOT = process.env.GITHUB_WORKSPACE ?? process.cwd();
async function run(envelope, deps) {
  const { ticket_key: ticketKey, event_id: eventId } = envelope;
  const logger = deps.logger ?? createLogger(eventId, "ferry:refiner-action");
  const dryRun = isDryRun();
  const issue = await deps.tracker.getIssue(ticketKey);
  const runLink = `https://github.com/${process.env.GITHUB_REPO ?? "unknown"}/actions/runs/${process.env.GITHUB_RUN_ID ?? "0"}`;
  const { plan, auditSummary } = await runRefiner({
    ticket: {
      key: issue.key,
      title: issue.summary,
      description: issue.description,
      comments: issue.comments,
      labels: issue.labels
    },
    callLlm: deps.callLlm,
    runLink
  });
  if (dryRun) {
    logger.info("DRY_RUN \u2014 plan (no Jira writes)", {
      ticket: ticketKey,
      subtasks: auditSummary.subtaskCount,
      plan
    });
    return;
  }
  const idempotencyMarker = `[ferry:refiner:${eventId}]`;
  const existingSubtasks = await deps.tracker.getSubtasks(ticketKey);
  const batch = filterExistingSubtasks(prepareBatch(plan, eventId), existingSubtasks);
  const applied = await applyBatch(
    batch,
    (items) => Promise.all(
      items.map((item) => deps.tracker.createSubtask(ticketKey, item.title, item.description))
    )
  );
  logger.info("subtasks created", { ticket: ticketKey, count: applied.createdCount });
  await deps.tracker.postComment(
    ticketKey,
    `${idempotencyMarker} Refined. Created ${applied.createdCount} sub-task(s). See run: ${runLink}`
  );
}
async function main(envelope, logger) {
  const ferryCfg = loadFerryConfig(REPO_ROOT);
  const route = ferryCfg.models.refiner;
  const callLlm = createLlmCall(route);
  const tracker = createTrackerFromEnv();
  await run(envelope, { tracker, callLlm, logger });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runAgent("refiner", main);
}
export {
  run
};
