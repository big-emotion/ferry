// src/lib/dispatch/cc-prepare-action.ts
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

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
      iterator: { trigger_column: "Changes Requested", auto_transition: "In Review" }
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
  if (c.execution_path !== void 0 && c.execution_path !== "script" && c.execution_path !== "claude-code") {
    errs.push('execution_path: must be "script" or "claude-code"');
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
    ...raw.execution_path === "script" || raw.execution_path === "claude-code" ? { execution_path: raw.execution_path } : {},
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
function resolveCapabilities(ticketLabels, configLabels, logger) {
  if (!configLabels) {
    return {
      mcpServerNames: [],
      serverAllowedTools: {},
      triggeredLabels: [],
      unknownFerryLabels: []
    };
  }
  const triggeredLabels = [];
  const unknownFerryLabels = [];
  const serverToolSets = {};
  for (const label of ticketLabels) {
    if (Object.prototype.hasOwnProperty.call(configLabels, label)) {
      triggeredLabels.push(label);
      const cap = configLabels[label];
      for (const server of cap.mcp_servers ?? []) {
        if (cap.tools && cap.tools.length > 0) {
          if (serverToolSets[server] === void 0) {
            serverToolSets[server] = new Set(cap.tools);
          } else if (serverToolSets[server] !== null) {
            for (const t of cap.tools) serverToolSets[server].add(t);
          }
        } else {
          serverToolSets[server] = null;
        }
      }
    } else if (label.startsWith("ferry:")) {
      if (!isBuiltinTypeLabel(label)) {
        unknownFerryLabels.push(label);
        logger?.warn("unknown ferry label ignored", { label });
      }
    }
  }
  const serverAllowedTools = {};
  for (const [server, tools] of Object.entries(serverToolSets)) {
    serverAllowedTools[server] = tools ? [...tools] : [];
  }
  return {
    mcpServerNames: Object.keys(serverToolSets),
    serverAllowedTools,
    triggeredLabels,
    unknownFerryLabels
  };
}
function filterMcpServers(pool, capabilities, hasLabelsConfig) {
  if (!hasLabelsConfig) return pool;
  return pool.filter((s) => capabilities.mcpServerNames.includes(s.name)).map((s) => {
    const allowedTools = capabilities.serverAllowedTools[s.name];
    if (allowedTools && allowedTools.length > 0) {
      return { ...s, allowed_tools: allowedTools };
    }
    return s;
  });
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
function resolveTicketOverrides(labels, logger, options) {
  const typeOverrides = resolveTypeOverrides(labels);
  let asLabel;
  let asTypeValue;
  for (const label of labels) {
    if (!label.startsWith(AS_LABEL_PREFIX)) continue;
    const suffix = label.slice(AS_LABEL_PREFIX.length);
    const mapped = AS_TYPE_LABELS[suffix];
    if (mapped === void 0) {
      logger?.warn("unknown suffix in ferry:as label", { label, suffix });
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
        logger?.warn("malformed ferry:model label (empty model name)", { label });
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
          logger?.warn("empty model-id in ferry:model label", { label });
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
          logger?.warn("unknown provider in blanket ferry:provider label", { label, provider: provider2 });
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
        logger?.warn(
          "malformed ferry:provider label (expected ferry:provider/<provider> or ferry:provider/<phase>/<provider>)",
          { label }
        );
        continue;
      }
      const [phase, provider] = parts;
      if (!AGENT_PHASES.has(phase)) {
        logger?.warn("unknown phase in ferry:provider label", { label, phase });
        continue;
      }
      if (!LLM_PROVIDERS.has(provider)) {
        logger?.warn("unknown provider in ferry:provider label", { label, provider });
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
          logger?.warn("invalid cost value in ferry:budget/max-cost label", { label });
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
          logger?.warn("invalid token count in ferry:budget/max-tokens label", { label });
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
        logger?.warn("invalid EUR value in ferry:budget label (expected positive integer)", {
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
        logger?.warn("invalid count in ferry:max-iterations label", { label });
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
        logger?.warn("invalid count in ferry:max-tokens label", { label });
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
        logger?.warn("unknown phase in ferry:skip label", { label, phase: suffix });
        continue;
      }
      if (phase === "review" && options?.allowSkipReview !== true) {
        logger?.warn(
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
        logger?.warn("unknown suffix in ferry:thinking label", { label, suffix });
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
        logger?.warn("invalid branch name in ferry:base label (expected ^[a-zA-Z0-9._/-]+$)", {
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
        logger?.warn("invalid branch name in ferry:target label (expected ^[a-zA-Z0-9._/-]+$)", {
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
        logger?.warn("unknown suffix in ferry:pr label (expected draft or ready)", {
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
    logger?.warn("unknown ferry override label ignored", { label });
  }
  const claudeCodePath = hasClaudeCode && !hasNoClaudeCode ? "claude-code" : hasClaudeCode || hasNoClaudeCode ? "script" : void 0;
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
    ...claudeCodePath !== void 0 ? { claudeCodePath } : {}
  };
}
function applyTicketOverrides(cfg, overrides) {
  if (!overrides.modelOverrides && !overrides.budget && overrides.budgetEur === void 0 && overrides.maxIterations === void 0 && overrides.maxTokens === void 0)
    return cfg;
  const models = { ...cfg.models };
  const limits = { ...cfg.limits };
  const mo = overrides.modelOverrides;
  if (mo) {
    if (mo.refiner) {
      models.refiner = {
        provider: mo.refiner.provider ?? models.refiner.provider,
        model: mo.refiner.model ?? models.refiner.model
      };
    }
    if (mo.dev) {
      models.dev = {
        provider: mo.dev.provider ?? models.dev.provider,
        model: mo.dev.model ?? models.dev.model
      };
    }
    if (mo.review) {
      models.review = {
        provider: mo.review.provider ?? models.review.provider,
        model: mo.review.model ?? models.review.model
      };
    }
    if (mo.iterate) {
      models.iterate = {
        provider: mo.iterate.provider ?? models.iterate.provider,
        model: mo.iterate.model ?? models.iterate.model
      };
    }
  }
  if (overrides.budget) {
    if (overrides.budget.maxCostEurPerRun !== void 0) {
      limits.max_cost_eur_per_run = overrides.budget.maxCostEurPerRun;
    }
    if (overrides.budget.maxTokensPerRun !== void 0) {
      limits.max_tokens_per_run = overrides.budget.maxTokensPerRun;
    }
  }
  if (overrides.budgetEur !== void 0) {
    limits.max_cost_eur_per_run = overrides.budgetEur;
  }
  if (overrides.maxIterations !== void 0) {
    limits.max_agent_iterations = overrides.maxIterations;
  }
  if (overrides.maxTokens !== void 0) {
    limits.max_tokens_per_message = overrides.maxTokens;
  }
  return { ...cfg, models, limits };
}

// src/lib/agent-runtime/idempotency.ts
function byEventId(role, eventId) {
  return `[ferry:${role}:${eventId}]`;
}
function byPrHeadSha(role, headSha) {
  return `[ferry:${role}:${headSha.slice(0, 7)}]`;
}

// src/lib/cc-wrappers/routing.ts
function isAnthropicOnlyConfig(cfg) {
  const m = cfg.models;
  return m.refiner.provider === "anthropic" && m.dev.provider === "anthropic" && m.review.provider === "anthropic" && m.iterate.provider === "anthropic";
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
var ISSUE_TYPE_LOCALE_MAP = {
  // French
  t\u00E2che: "Task",
  bogue: "Bug",
  histoire: "Story",
  \u00E9pique: "Epic",
  "sous-t\xE2che": "Sub-task"
};
function normalizeIssueType(raw) {
  return ISSUE_TYPE_LOCALE_MAP[raw.toLowerCase()] ?? raw;
}
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
      issueType: normalizeIssueType(issue.fields.issuetype.name),
      issueTypeRaw: issue.fields.issuetype.name
    };
  }
  async postComment(key, body) {
    await this.client.postComment(key, textToAdf(body));
  }
  async postTransition(key, transitionId) {
    await this.client.postTransition(key, transitionId);
  }
  async addLabel(key, label) {
    await this.client.addLabel(key, label);
  }
  async getSubtasks(key) {
    return this.client.getSubtasks(key);
  }
  async getSubtaskDetails(key) {
    const raw = await this.client.getSubtaskDetails(key);
    return raw.map((r) => ({
      key: r.key,
      title: r.title,
      description: adfToText(r.descriptionAdf),
      status: r.status
    }));
  }
  async createSubtask(parentKey, title, description) {
    const result = await this.client.createSubtask(parentKey, title, textToAdf(description));
    return { id: result.key };
  }
};

// src/lib/agent-runtime/developer-prepare.ts
import { execFileSync as execFileSync2 } from "node:child_process";

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

// src/lib/agent-runtime/git.ts
import { execSync, execFileSync } from "node:child_process";
function configureFerryGitUser(repoRoot) {
  execSync('git config user.name "ferry-bot"', { cwd: repoRoot });
  execSync('git config user.email "ferry-bot@users.noreply.github.com"', { cwd: repoRoot });
}

// src/lib/agent-runtime/prompt.ts
import { existsSync as existsSync3, readFileSync as readFileSync3 } from "node:fs";

// src/lib/prompts/resolve.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import * as path2 from "node:path";
function resolvePromptPath(name, repoRoot, _checkExists = existsSync2, _logger) {
  const overridesDir = process.env.FERRY_PROMPTS_DIR || path2.join(repoRoot, "prompts");
  const overridePath = path2.join(overridesDir, `${name}.md`);
  if (_checkExists(overridePath)) {
    return overridePath;
  }
  const bundledDir = process.env.FERRY_BUNDLED_PROMPTS_DIR ?? path2.join(repoRoot, ".ferry", "prompts");
  _logger?.info(`${name}: consumer override not found, using shipped default`);
  return path2.join(bundledDir, `${name}.md`);
}
var PROJECT_SNIPPET_MAX_BYTES = 2048;
function loadProjectSnippet(repoRoot, _checkExists = existsSync2, _readFile = (p, enc) => readFileSync2(p, enc), _logger) {
  const overridesDir = process.env.FERRY_PROMPTS_DIR || path2.join(repoRoot, "prompts");
  const candidates = [
    path2.join(overridesDir, "_project.md"),
    path2.join(repoRoot, ".ferry", "prompts", "_project.md")
  ];
  for (const candidate of candidates) {
    if (_checkExists(candidate)) {
      const raw = _readFile(candidate, "utf8");
      const limit = parseInt(process.env.FERRY_PROJECT_SNIPPET_BYTES ?? "", 10) || PROJECT_SNIPPET_MAX_BYTES;
      if (raw.length > limit) {
        _logger?.warn("_project.md exceeds limit \u2014 truncating", { limit });
        return raw.slice(0, limit);
      }
      _logger?.info("loaded _project.md", { path: candidate });
      return raw;
    }
  }
  return null;
}
var AGENT_EXTENSION_MAX_BYTES = 4096;
function loadAgentExtension(name, repoRoot, _checkExists = existsSync2, _readFile = (p, enc) => readFileSync2(p, enc), _logger) {
  const overridesDir = process.env.FERRY_PROMPTS_DIR || path2.join(repoRoot, "prompts");
  const candidate = path2.join(overridesDir, `${name}.extra.md`);
  if (!_checkExists(candidate)) {
    return null;
  }
  const raw = _readFile(candidate, "utf8");
  const limit = parseInt(process.env.FERRY_AGENT_EXTENSION_BYTES ?? "", 10) || AGENT_EXTENSION_MAX_BYTES;
  if (raw.length > limit) {
    _logger?.warn(`${name}.extra.md exceeds limit \u2014 truncating`, { limit });
    return raw.slice(0, limit);
  }
  _logger?.info(`loaded ${name}.extra.md`, { path: candidate });
  return raw;
}

// src/lib/agent-runtime/prompt.ts
function buildSystem(promptName, repoRoot, opts) {
  const _checkExists = opts?._checkExists ?? existsSync3;
  const _readFile = opts?._readFile ?? ((p, enc) => readFileSync3(p, enc));
  const resolvedPath = resolvePromptPath(promptName, repoRoot, _checkExists);
  const systemBase = _readFile(resolvedPath, "utf8");
  const agentExtension = loadAgentExtension(promptName, repoRoot, _checkExists, _readFile);
  const projectSnippet = loadProjectSnippet(repoRoot, _checkExists, _readFile);
  const separator = opts?.separator ?? "\n\n";
  const parts = [
    systemBase,
    agentExtension ? `## Project-specific guidance for ${promptName}

${agentExtension}` : null,
    ...opts?.extraParts ?? [],
    projectSnippet ? `## Project conventions

${projectSnippet}` : null
  ].filter((p) => Boolean(p));
  return parts.join(separator);
}
function loadOptionalPrompt(name, repoRoot, _readFile = (p, enc) => readFileSync3(p, enc), _checkExists = existsSync3) {
  const resolved = resolvePromptPath(name, repoRoot, _checkExists);
  try {
    return _readFile(resolved, "utf8");
  } catch {
    return null;
  }
}
function buildTicketBlock(ticketKey, issue, opts) {
  const effectiveType = opts?.typeOverride ?? issue.issueType;
  return [
    `TICKET: ${ticketKey}`,
    `TITLE: ${issue.summary}`,
    `TYPE: ${effectiveType}`,
    opts?.labels !== void 0 ? `LABELS: ${opts.labels || "none"}` : null,
    `DESCRIPTION:
${issue.description}`,
    opts?.comments ? `COMMENTS:
${opts.comments}` : ""
  ].filter(Boolean).join("\n");
}

// src/lib/agent-runtime/resolve-git-config.ts
function resolveBranchPrefix(prefix, issue) {
  if (typeof prefix === "string") return prefix;
  for (const label of issue.labels) {
    const match = /^ferry:type:(.+)$/.exec(label);
    if (match) {
      const labelType = match[1];
      if (labelType in prefix) return prefix[labelType];
      break;
    }
  }
  if (issue.issueType in prefix) return prefix[issue.issueType];
  return prefix["default"];
}

// src/lib/agent-runtime/developer-prepare.ts
var checkoutOrCreateBranchDefault = (branchName, baseBranch, repoRoot, logger) => {
  try {
    execFileSync2("git", ["ls-remote", "--exit-code", "--heads", "origin", branchName], {
      cwd: repoRoot,
      stdio: "pipe"
    });
    execFileSync2("git", ["fetch", "origin", branchName], { cwd: repoRoot });
    execFileSync2("git", ["checkout", branchName], { cwd: repoRoot });
    const existingLog = execFileSync2("git", ["log", `origin/${baseBranch}..HEAD`, "--oneline"], {
      cwd: repoRoot,
      encoding: "utf8"
    }).trim();
    if (existingLog) {
      logger.info("resuming branch", {
        branch: branchName,
        prior_commits: existingLog.split("\n").length
      });
    }
    const branchHeadSha = execFileSync2("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8"
    }).trim();
    return { branchHeadSha, existingLog };
  } catch {
    execFileSync2("git", ["checkout", "-B", branchName], { cwd: repoRoot });
    logger.info("created branch", { branch: branchName });
    return { branchHeadSha: "", existingLog: "" };
  }
};
async function prepareDeveloper(input) {
  const {
    envelope,
    issue,
    effectiveCfg,
    subtasks,
    testRunner,
    pkgManagerHint,
    tree,
    typeOverride,
    owner,
    repo,
    baseBranch,
    runner,
    mcpPool,
    repoRoot,
    dryRun,
    logger
  } = input;
  const buildSystem2 = input._buildSystem ?? buildSystem;
  const checkoutOrCreateBranch = input._checkoutOrCreateBranch ?? checkoutOrCreateBranchDefault;
  const configureGitUser = input._configureGitUser ?? configureFerryGitUser;
  const ticketKey = envelope.ticket_key;
  const eventId = envelope.event_id;
  const labels = issue.labels.join(", ");
  const comments = issue.comments.map((c) => `Comment: ${c}`).join("\n");
  const ticketBlock = buildTicketBlock(ticketKey, issue, {
    labels,
    comments,
    typeOverride
  });
  const system = buildSystem2("dev", repoRoot, {
    extraParts: pkgManagerHint ? [`## Detected package manager

${pkgManagerHint}`] : []
  });
  const branchName = `${resolveBranchPrefix(effectiveCfg.git.working_branch_prefix, issue)}${ticketKey}`;
  configureGitUser(repoRoot);
  const { branchHeadSha, existingLog } = checkoutOrCreateBranch(
    branchName,
    baseBranch,
    repoRoot,
    logger
  );
  const resumeContext = existingLog ? `
EXISTING WORK ON BRANCH (already committed \u2014 skip these, only do what remains):
${existingLog}` : "";
  let existingPrUrl = "";
  let existingPrContext = "";
  if (branchHeadSha && !dryRun) {
    try {
      const openPrs = await runner.listPRsForBranch(owner, repo, branchName);
      if (openPrs.length > 0) {
        const pr = openPrs[0];
        existingPrUrl = `https://github.com/${owner}/${repo}/pull/${pr.number}`;
        const prRef = { owner, repo, prNumber: pr.number };
        const prFiles = await runner.listPRFiles(prRef);
        const fileList = prFiles.map((f) => `${f.status}: ${f.filename}`).join("\n");
        existingPrContext = [
          `
EXISTING_IMPLEMENTATION:`,
          `Open PR: ${existingPrUrl} (head: ${branchHeadSha.slice(0, 7)})`,
          `Changed files:
${fileList}`,
          `If the spec is already fully satisfied by the existing code, call \`done\` with outcome="already_satisfied".`
        ].join("\n");
        logger.info("existing PR found", { pr: existingPrUrl, files: prFiles.length });
      }
    } catch {
    }
  }
  const idempotencyMarker = branchHeadSha ? byPrHeadSha("dev", branchHeadSha) : byEventId("dev", eventId);
  const baseInitialPrompt = [
    delimitUntrusted(ticketBlock),
    "",
    subtasks.length > 0 ? `SUBTASKS:
${subtasks.join("\n")}` : "SUBTASKS: (none)",
    "",
    `TEST_RUNNER: ${testRunner}`,
    "",
    `REPO TREE (depth 2):
${tree}`,
    "",
    "When you have finished implementing, call the `done` tool."
  ].join("\n");
  const initialPrompt = baseInitialPrompt + resumeContext + existingPrContext;
  const capabilities = resolveCapabilities(issue.labels, effectiveCfg.labels);
  const hasLabelsConfig = effectiveCfg.labels !== void 0;
  const mcpServers = filterMcpServers(mcpPool, capabilities, hasLabelsConfig);
  return {
    system,
    initialPrompt,
    baseInitialPrompt,
    mcpServers,
    idempotencyMarker,
    ticketBlock,
    subtasks,
    capabilities,
    branchName,
    branchHeadSha,
    existingPrUrl
  };
}

// src/lib/agent-runtime/reviewer-helpers.ts
var STRICT_DIRECTIVE = [
  "## Rubric override \u2014 strict",
  "",
  "For this review, apply a STRICTER bar than usual:",
  "",
  "- Block on any missing test coverage for new/changed behaviour.",
  "- Block on missing edge-case handling, error paths, or input validation.",
  "- Block on weak naming, dead code, or unreachable branches.",
  "- Block on incomplete documentation when public APIs change.",
  "- Approve only when every acceptance criterion is fully satisfied with concrete evidence."
].join("\n");
var LENIENT_DIRECTIVE = [
  "## Rubric override \u2014 lenient",
  "",
  "For this review, apply a MORE PERMISSIVE bar than usual:",
  "",
  "- Approve when the acceptance criteria are met, even if minor polish is missing.",
  "- Treat naming nits, non-blocking style issues, and stylistic preferences as comments \u2014 not blockers.",
  "- Block only on: failing tests, unimplemented ACs, merge conflicts, committed build artefacts, or security regressions.",
  '- Prefer "approve with comments" over "request changes" when issues are non-blocking.'
].join("\n");
function applyRubricToPrompt(basePrompt, rubric) {
  if (rubric === void 0) return basePrompt;
  const directive = rubric === "strict" ? STRICT_DIRECTIVE : LENIENT_DIRECTIVE;
  return `${basePrompt}

---

${directive}`;
}
function detectMergeConflicts(files) {
  const conflicted = [];
  for (const f of files) {
    if (f.patch && /^[+].*<{7}|^[+].*={7}|^[+].*>{7}/m.test(f.patch)) {
      conflicted.push(f.filename);
    }
  }
  return conflicted;
}
function buildFileList(files) {
  return files.map((f) => `${f.status.padEnd(8)} +${f.additions} -${f.deletions}  ${f.filename}`).join("\n");
}

// src/lib/agent-runtime/reviewer-prepare.ts
function prepareReviewer(input) {
  const {
    ticketKey,
    issue,
    pr,
    files,
    commits,
    branchName,
    typeOverride,
    reviewRubric,
    capabilities,
    idempotencyMarker,
    repoRoot
  } = input;
  const buildSystem2 = input._buildSystem ?? buildSystem;
  const loadOptionalPrompt2 = input._loadOptionalPrompt ?? loadOptionalPrompt;
  const headSha = pr.headSha;
  const prNumber = pr.number;
  const fileMap = new Map(files.map((f) => [f.filename, f.patch]));
  const conflictedFiles = detectMergeConflicts(files);
  const hasMergeConflicts = pr.mergeable === false || conflictedFiles.length > 0;
  const commitLog = commits.map((c) => `${c.sha.slice(0, 7)} ${c.message.split("\n")[0]}`).join("\n");
  const ticketBlock = buildTicketBlock(ticketKey, issue, { typeOverride });
  const mergeConflictWarning = hasMergeConflicts ? `
\u26A0\uFE0F  MERGE CONFLICTS DETECTED \u2014 mergeable=${String(pr.mergeable)}${conflictedFiles.length > 0 ? `, conflicted files: ${conflictedFiles.join(", ")}` : ""}` : "";
  const initialPrompt = [
    "## Jira Ticket",
    delimitUntrusted(ticketBlock),
    "",
    "## PR Metadata",
    `PR #${prNumber}: ${pr.title}`,
    `Base: ${pr.baseRef} \u2190 Head: ${branchName} (${headSha.slice(0, 7)})`,
    `Files changed: ${files.length}  Commits: ${commits.length}`,
    mergeConflictWarning,
    "",
    "## Commits",
    commitLog,
    "",
    "## Changed files (status  +additions  -deletions  path)",
    buildFileList(files),
    "",
    "Use get_file_patch to inspect individual file diffs, get_file_content for full file contents.",
    "When you have enough information, call finish_review."
  ].filter((l) => l !== null).join("\n");
  const baseSystem = buildSystem2("review", repoRoot, {
    extraParts: [loadOptionalPrompt2("review-comment", repoRoot)],
    separator: "\n\n---\n\n"
  });
  const system = applyRubricToPrompt(baseSystem, reviewRubric);
  const mcpServers = [];
  return {
    system,
    initialPrompt,
    mcpServers,
    idempotencyMarker,
    ticketBlock,
    capabilities,
    fileMap
  };
}

// src/lib/agent-runtime/iterator-prepare.ts
function prepareIterator(input) {
  const {
    ticketKey,
    issue,
    reviewComment,
    mergeConflicts,
    existingLog,
    mcpPool,
    configLabels,
    capabilities,
    idempotencyMarker,
    typeOverride,
    repoRoot
  } = input;
  const buildSystem2 = input._buildSystem ?? buildSystem;
  const system = buildSystem2("iterate", repoRoot);
  const ticketBlock = buildTicketBlock(ticketKey, issue, { typeOverride });
  const initialPrompt = [
    "## Jira Ticket",
    delimitUntrusted(ticketBlock),
    "",
    "## Review Findings (fix only what is listed here)",
    delimitUntrusted(reviewComment),
    "",
    mergeConflicts.length > 0 ? `## Merge Conflicts (resolve these first, before fixing review findings)
${mergeConflicts.map((f) => `- ${f}`).join("\n")}` : "",
    existingLog ? `## Existing commits on branch
${existingLog}` : "",
    "",
    "When you have fixed all findings, call the `done` tool."
  ].filter(Boolean).join("\n");
  const hasLabelsConfig = configLabels !== void 0;
  const mcpServers = filterMcpServers(mcpPool, capabilities, hasLabelsConfig);
  return {
    system,
    initialPrompt,
    mcpServers,
    idempotencyMarker,
    ticketBlock,
    capabilities
  };
}

// src/lib/agent-runtime/refiner-prepare.ts
var PRIOR_RUN_MARKER = /\[ferry:refiner:[^\]]+\]/;
async function prepareRefiner(input) {
  const { envelope, tracker } = input;
  const { ticket_key: ticketKey, event_id: eventId } = envelope;
  const issue = await tracker.getIssue(ticketKey);
  const existingSubtasks = await tracker.getSubtaskDetails(ticketKey);
  const priorRefinerRuns = issue.comments.filter((c) => PRIOR_RUN_MARKER.test(c));
  const runLink = `https://github.com/${process.env.GITHUB_REPO ?? "unknown"}/actions/runs/${process.env.GITHUB_RUN_ID ?? "0"}`;
  const idempotencyMarker = byEventId("refiner", eventId);
  return {
    issue,
    existingSubtasks,
    priorRefinerRuns,
    runLink,
    idempotencyMarker
  };
}

// src/lib/io/tracker/in-memory.ts
var InMemoryTracker = class {
  issues = /* @__PURE__ */ new Map();
  postedComments = [];
  postedTransitions = [];
  addedLabels = [];
  createdSubtasks = [];
  subtaskMap = /* @__PURE__ */ new Map();
  subtaskDetailMap = /* @__PURE__ */ new Map();
  seed(issue) {
    this.issues.set(issue.key, { ...issue, comments: [...issue.comments] });
  }
  seedSubtasks(parentKey, summaries) {
    this.subtaskMap.set(parentKey, [...summaries]);
  }
  seedSubtaskDetails(parentKey, subtasks) {
    this.subtaskDetailMap.set(
      parentKey,
      subtasks.map((s) => ({ ...s }))
    );
  }
  async getIssue(key) {
    const issue = this.issues.get(key);
    if (!issue) throw new Error(`InMemoryTracker: issue ${key} not found`);
    return { ...issue, comments: [...issue.comments] };
  }
  async postComment(key, body) {
    const issue = this.issues.get(key);
    if (!issue) throw new Error(`InMemoryTracker: issue ${key} not found`);
    this.postedComments.push({ key, body });
    issue.comments.push(body);
  }
  async postTransition(key, transitionId) {
    this.postedTransitions.push({ key, transitionId });
  }
  async addLabel(key, label) {
    const issue = this.issues.get(key);
    if (!issue) throw new Error(`InMemoryTracker: issue ${key} not found`);
    this.addedLabels.push({ key, label });
    issue.labels.push(label);
  }
  async getSubtasks(key) {
    return this.subtaskMap.get(key) ?? [];
  }
  async getSubtaskDetails(key) {
    return (this.subtaskDetailMap.get(key) ?? []).map((s) => ({ ...s }));
  }
  async createSubtask(parentKey, title, description) {
    const id = `subtask-${this.createdSubtasks.length + 1}`;
    this.createdSubtasks.push({ parentKey, title, description });
    const existing = this.subtaskDetailMap.get(parentKey) ?? [];
    existing.push({ key: id, title, description, status: "To Do" });
    this.subtaskDetailMap.set(parentKey, existing);
    return { id };
  }
};

// src/agents/refiner/refine.ts
import { createRequire as createRequire3 } from "module";

// src/agents/refiner/schema.ts
var REFINER_OUTPUT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://ferry.dev/schemas/refiner-output.v2.json",
  type: "object",
  required: ["actions", "touch_paths", "output_locale", "audit_summary"],
  additionalProperties: false,
  properties: {
    actions: {
      type: "array",
      minItems: 1,
      items: {
        anyOf: [
          {
            type: "object",
            required: ["type", "title", "description"],
            additionalProperties: false,
            properties: {
              type: { const: "create" },
              title: { type: "string", minLength: 1, maxLength: 200 },
              description: { type: "string", minLength: 1, maxLength: 4e3 }
            }
          },
          {
            type: "object",
            required: ["type", "existing_key", "reason"],
            additionalProperties: false,
            properties: {
              type: { const: "keep" },
              existing_key: { type: "string", minLength: 1 },
              reason: { type: "string", minLength: 1 }
            }
          },
          {
            type: "object",
            required: ["type", "existing_key", "reason"],
            additionalProperties: false,
            properties: {
              type: { const: "mark_stale" },
              existing_key: { type: "string", minLength: 1 },
              reason: { type: "string", minLength: 1 }
            }
          },
          {
            type: "object",
            required: ["type", "reason"],
            additionalProperties: false,
            properties: {
              type: { const: "noop" },
              reason: { type: "string", minLength: 1 }
            }
          }
        ]
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
    },
    cost_estimate: {
      type: "object",
      required: ["loUsd", "hiUsd", "confidence", "baselineRuns"],
      additionalProperties: false,
      properties: {
        loUsd: { type: "number", minimum: 0 },
        hiUsd: { type: "number", minimum: 0 },
        confidence: { enum: ["low", "medium", "high"] },
        baselineRuns: { type: "integer", minimum: 0 }
      }
    }
  }
};

// src/agents/refiner/refine.ts
var _require3 = createRequire3(import.meta.url);
var ajvModule2 = _require3("ajv/dist/2020");
var ajvInstance2 = new ajvModule2.Ajv2020({ strict: true });
var validatePlan = ajvInstance2.compile(REFINER_OUTPUT_SCHEMA);
var SCHEMA_EXAMPLE = `{
  "actions": [
    { "type": "create", "title": "imperative verb, specific, max 200 chars", "description": "concrete acceptance criteria; max 4000 chars" },
    { "type": "keep", "existing_key": "PROJ-91", "reason": "still valid" },
    { "type": "mark_stale", "existing_key": "PROJ-92", "reason": "superseded by ticket edit" },
    { "type": "noop", "reason": "ticket and existing sub-tasks unchanged" }
  ],
  "touch_paths": ["src/path/to/file.ts"],
  "output_locale": "en",
  "audit_summary": "one sentence summarising the plan"
}`;
function formatExistingSubtasks(subtasks) {
  if (subtasks.length === 0) return "(none)";
  return subtasks.map((s) => `- [${s.key}] ${s.title} (status: ${s.status})`).join("\n");
}
function buildRefinerPrompt(input) {
  const ticketBlock = [
    `TICKET ${input.ticket.key}`,
    `TITLE: ${input.ticket.title}`,
    `LABELS: ${input.ticket.labels.join(", ")}`,
    `DESCRIPTION:
${input.ticket.description}`,
    `COMMENTS:
${input.ticket.comments.join("\n---\n")}`
  ].join("\n\n");
  const existingBlock = [
    `EXISTING_SUBTASKS (do NOT re-create these unless the ticket has materially changed):`,
    formatExistingSubtasks(input.existingSubtasks ?? [])
  ].join("\n");
  const priorRunsBlock = (input.priorRefinerRuns ?? []).length > 0 ? `PRIOR_REFINER_RUNS:
${input.priorRefinerRuns.join("\n---\n")}` : "PRIOR_REFINER_RUNS: (none)";
  return [
    "You are the Ferry Refiner. Analyse the ticket and its existing sub-tasks, then return a reconciliation plan.",
    "Reply with JSON only \u2014 no prose, no code fences \u2014 matching this exact schema:",
    SCHEMA_EXAMPLE,
    [
      "Rules:",
      '- Use "noop" when the ticket and existing sub-tasks are already aligned.',
      '- Use "keep" for existing sub-tasks that are still valid.',
      '- Use "mark_stale" for existing sub-tasks superseded by a ticket edit.',
      '- Use "create" only for genuinely missing sub-tasks (max 12 total; prefer 3\u20137).',
      '- Sub-tasks with status "In Progress" or "Done" must always be "keep".',
      '- output_locale must be "en" or "fr" matching the ticket language.',
      "- touch_paths lists every file the new sub-tasks will touch (max 20)."
    ].join("\n"),
    delimitUntrusted([ticketBlock, existingBlock, priorRunsBlock].join("\n\n"))
  ].join("\n\n");
}

// src/lib/claude-code/tool-profiles.ts
var ROLE_ACCESS = {
  refiner: "read-only",
  reviewer: "read-only",
  developer: "read-write",
  iterator: "read-write"
};
var READ_ONLY_NATIVE_TOOLS = ["Read", "Glob", "Grep"];
var READ_WRITE_NATIVE_TOOLS = ["Bash", "Read", "Write", "Edit", "Glob", "Grep"];
function isFerryRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_ACCESS, role);
}
function nativeToolsForRole(role) {
  if (!isFerryRole(role)) {
    throw new Error(`unknown ferry role: ${String(role)}`);
  }
  return ROLE_ACCESS[role] === "read-only" ? [...READ_ONLY_NATIVE_TOOLS] : [...READ_WRITE_NATIVE_TOOLS];
}

// src/lib/llm/agent-loop/types.ts
function isStdioMcpServer(s) {
  return s.type === "stdio";
}

// src/lib/claude-code/mcp-config.ts
function mapStdio(s) {
  const out = { type: "stdio", command: s.command };
  if (s.args && s.args.length > 0) out.args = [...s.args];
  if (s.env && Object.keys(s.env).length > 0) out.env = { ...s.env };
  return out;
}
function mapHttp(s) {
  const out = { type: "http", url: s.url };
  if (s.authorization_token) {
    out.headers = { Authorization: `Bearer ${s.authorization_token}` };
  }
  return out;
}
function toClaudeCodeMcpConfig(servers) {
  const mcpServers = {};
  for (const s of servers) {
    if (Object.prototype.hasOwnProperty.call(mcpServers, s.name)) {
      throw new Error(`duplicate mcp server name: ${s.name}`);
    }
    mcpServers[s.name] = isStdioMcpServer(s) ? mapStdio(s) : mapHttp(s);
  }
  return { mcpServers };
}
function mcpToolAllowlist(servers) {
  const allow = [];
  for (const s of servers) {
    const denied = new Set(s.denied_tools ?? []);
    if (s.allowed_tools && s.allowed_tools.length > 0) {
      for (const tool of s.allowed_tools) {
        if (denied.has(tool)) continue;
        allow.push(`mcp__${s.name}__${tool}`);
      }
    } else if (denied.size > 0) {
      throw new Error(
        `mcp server "${s.name}" sets denied_tools without allowed_tools: claude-code-action --allowedTools cannot express a deny-only allowlist (failing closed to avoid silently re-allowing denied tools)`
      );
    } else {
      allow.push(`mcp__${s.name}`);
    }
  }
  return allow;
}

// src/lib/claude-code/claude-args.ts
function buildClaudeArgs(input) {
  const servers = input.mcpServers ?? [];
  const allowedTools = [...nativeToolsForRole(input.role), ...mcpToolAllowlist(servers)];
  const args = [
    "--append-system-prompt",
    input.system,
    "--allowedTools",
    allowedTools.join(",")
  ];
  if (servers.length > 0) {
    args.push("--mcp-config", JSON.stringify(toClaudeCodeMcpConfig(servers)));
  }
  if (input.maxTurns !== void 0) {
    if (!Number.isInteger(input.maxTurns) || input.maxTurns <= 0) {
      throw new Error(`max-turns must be a positive integer, got ${input.maxTurns}`);
    }
    args.push("--max-turns", String(input.maxTurns));
  }
  if (input.model !== void 0 && input.model.trim().length > 0) {
    args.push("--model", input.model);
  }
  return args;
}

// src/lib/claude-code/output-artifact.ts
var CC_OUTPUT_ARTIFACT_PATH = ".ferry/cc-output.json";
var DONE_OUTCOMES = ["implemented", "already_satisfied", "blocked"];
function fail(detail) {
  throw new Error(`Invalid ${CC_OUTPUT_ARTIFACT_PATH}: ${detail}`);
}
function asObject(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail("expected a JSON object");
  }
  return raw;
}
function nonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function isStringArray(v) {
  return Array.isArray(v) && v.every((e) => typeof e === "string");
}
function parseDevIterArtifact(raw) {
  const o = asObject(raw);
  const outcome = o.outcome;
  if (typeof outcome !== "string" || !DONE_OUTCOMES.includes(outcome)) {
    fail(`outcome must be one of ${DONE_OUTCOMES.join(", ")}`);
  }
  if (!nonEmptyString(o.summary)) fail("summary is required");
  if (o.validation !== void 0) {
    if (!Array.isArray(o.validation) || !o.validation.every(
      (e) => typeof e === "object" && e !== null && nonEmptyString(e.command) && typeof e.outcome === "string"
    )) {
      fail("validation must be an array of { command, outcome }");
    }
  }
  if (o.notes !== void 0 && !isStringArray(o.notes)) {
    fail("notes must be an array of strings");
  }
  const done = outcome;
  const payload = {
    actionable: done !== "blocked",
    outcome: done,
    summary: o.summary.trim()
  };
  if (typeof o.commit_message === "string") payload.commit_message = o.commit_message;
  if (typeof o.reason === "string") payload.reason = o.reason;
  if (o.validation !== void 0) {
    payload.validation = o.validation;
  }
  if (o.notes !== void 0) payload.notes = o.notes;
  return payload;
}
function parseReviewerArtifact(raw) {
  const o = asObject(raw);
  if (typeof o.approved !== "boolean") fail("approved must be a boolean");
  if (!nonEmptyString(o.comment)) fail("comment is required");
  return { approved: o.approved, comment: o.comment };
}
function parseRefinerAction(a, idx) {
  const o = asObject(a);
  switch (o.type) {
    case "create":
      if (!nonEmptyString(o.title) || !nonEmptyString(o.description)) {
        fail(`actions[${idx}] create requires title and description`);
      }
      return { type: "create", title: o.title, description: o.description };
    case "keep":
    case "mark_stale":
      if (!nonEmptyString(o.existing_key) || !nonEmptyString(o.reason)) {
        fail(`actions[${idx}] ${o.type} requires existing_key and reason`);
      }
      return {
        type: o.type,
        existing_key: o.existing_key,
        reason: o.reason
      };
    case "noop":
      if (!nonEmptyString(o.reason)) fail(`actions[${idx}] noop requires reason`);
      return { type: "noop", reason: o.reason };
    default:
      return fail(`actions[${idx}] has unknown type ${String(o.type)}`);
  }
}
function parseRefinerCostEstimate(raw) {
  const o = asObject(raw);
  if (typeof o.loUsd !== "number" || !Number.isFinite(o.loUsd) || o.loUsd < 0) {
    fail("cost_estimate.loUsd must be a non-negative number");
  }
  if (typeof o.hiUsd !== "number" || !Number.isFinite(o.hiUsd) || o.hiUsd < 0) {
    fail("cost_estimate.hiUsd must be a non-negative number");
  }
  if (o.confidence !== "low" && o.confidence !== "medium" && o.confidence !== "high") {
    fail("cost_estimate.confidence must be 'low', 'medium', or 'high'");
  }
  if (typeof o.baselineRuns !== "number" || !Number.isInteger(o.baselineRuns) || o.baselineRuns < 0) {
    fail("cost_estimate.baselineRuns must be a non-negative integer");
  }
  return {
    loUsd: o.loUsd,
    hiUsd: o.hiUsd,
    confidence: o.confidence,
    baselineRuns: o.baselineRuns
  };
}
function parseRefinerArtifact(raw) {
  const o = asObject(raw);
  if (!Array.isArray(o.actions) || o.actions.length === 0) {
    fail("actions must be a non-empty array");
  }
  if (!isStringArray(o.touch_paths)) fail("touch_paths must be an array of strings");
  if (o.output_locale !== "en" && o.output_locale !== "fr") {
    fail("output_locale must be 'en' or 'fr'");
  }
  if (!nonEmptyString(o.audit_summary)) fail("audit_summary is required");
  if (o.attachments !== void 0 && !isStringArray(o.attachments)) {
    fail("attachments must be an array of strings");
  }
  const out = {
    actions: o.actions.map(parseRefinerAction),
    touch_paths: o.touch_paths,
    output_locale: o.output_locale,
    audit_summary: o.audit_summary
  };
  if (o.attachments !== void 0) out.attachments = o.attachments;
  if (o.cost_estimate !== void 0) {
    out.cost_estimate = parseRefinerCostEstimate(o.cost_estimate);
  }
  return out;
}
function parseClaudeCodeArtifact(role, raw) {
  switch (role) {
    case "developer":
    case "iterator":
      return parseDevIterArtifact(raw);
    case "reviewer":
      return parseReviewerArtifact(raw);
    case "refiner":
      return parseRefinerArtifact(raw);
    default:
      throw new Error(`unknown ferry role: ${String(role)}`);
  }
}
var DEV_ITER_SHAPE = '{ "outcome": "implemented" | "already_satisfied" | "blocked", "summary": string, "commit_message"?: string, "reason"?: string, "validation"?: [{ "command": string, "outcome": string }], "notes"?: string[] }';
var REVIEWER_SHAPE = '{ "approved": boolean, "comment": string }';
var REFINER_SHAPE = '{ "actions": [...], "touch_paths": string[], "output_locale": "en" | "fr", "audit_summary": string }';
function outcomePromptSuffix(role) {
  const header = `

---
FINAL OUTPUT (claude-code path): the \`done\`/\`finish_review\` tools are not available here. As your LAST action, write your result as a single JSON object to \`${CC_OUTPUT_ARTIFACT_PATH}\`, then stop.`;
  if (role === "reviewer") {
    return `${header} Shape: ${REVIEWER_SHAPE}`;
  }
  if (role === "refiner") {
    return `${header} Shape: ${REFINER_SHAPE} (same as the bundled refiner JSON contract).`;
  }
  const access = ROLE_ACCESS[role];
  return `${header} Commit and push your work with \`git\` first (there is no \`commit_progress\` tool on this path; access=${access}). Then write: ${DEV_ITER_SHAPE}`;
}

// src/lib/claude-code/job.ts
var CLAUDE_CODE_AUTH_INPUT = "claude_code_oauth_token";
var FORBIDDEN_AUTH_INPUT = "anthropic_api_key";
function buildClaudeCodeJob(input) {
  const allowedNativeTools = nativeToolsForRole(input.role);
  return {
    role: input.role,
    access: ROLE_ACCESS[input.role],
    prompt: input.initialPrompt + outcomePromptSuffix(input.role),
    claudeArgs: buildClaudeArgs({
      role: input.role,
      system: input.system,
      mcpServers: input.mcpServers,
      maxTurns: input.maxTurns,
      model: input.model
    }),
    authInput: CLAUDE_CODE_AUTH_INPUT,
    allowedNativeTools,
    outputArtifactPath: CC_OUTPUT_ARTIFACT_PATH,
    parseOutput: (raw) => parseClaudeCodeArtifact(input.role, raw)
  };
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

// src/lib/dispatch/cc-prepare-action.ts
var VALID_ROLES = ["refiner", "developer", "reviewer", "iterator"];
async function prepareCcJob(input) {
  const { envelope, issue, role } = input;
  if (!isAnthropicOnlyConfig(input.input.effectiveCfg)) {
    throw new Error(
      "cc-prepare: refusing to build a claude-code job \u2014 ferry.config is not anthropic-only (every agent provider must be `anthropic`; see ADR-0006 \xA71, issue #329)."
    );
  }
  let system;
  let initialPrompt;
  let mcpServers;
  let idempotencyMarker;
  let model;
  switch (role) {
    case "developer": {
      assertRoleInput(input.input, "developer");
      const ri = input.input;
      const ctx = await prepareDeveloper({
        envelope,
        issue,
        effectiveCfg: ri.effectiveCfg,
        subtasks: ri.subtasks,
        testRunner: ri.testRunner,
        pkgManagerHint: ri.pkgManagerHint,
        tree: ri.tree,
        typeOverride: ri.typeOverride,
        owner: ri.owner,
        repo: ri.repo,
        baseBranch: ri.baseBranch,
        runner: ri._runner ?? throwMissing("developer._runner"),
        mcpPool: ri.mcpPool,
        repoRoot: ri.repoRoot ?? process.cwd(),
        dryRun: ri.dryRun,
        logger: createLogger(envelope.event_id, "ferry:cc-prepare"),
        ...ri._buildSystem ? { _buildSystem: ri._buildSystem } : {},
        ...ri._checkoutOrCreateBranch ? { _checkoutOrCreateBranch: ri._checkoutOrCreateBranch } : {},
        ...ri._configureGitUser ? { _configureGitUser: ri._configureGitUser } : {}
      });
      ({ system, initialPrompt, mcpServers, idempotencyMarker } = pickPrepared(ctx));
      model = ri.effectiveCfg.models.dev.model;
      break;
    }
    case "reviewer": {
      assertRoleInput(input.input, "reviewer");
      const ri = input.input;
      const marker = byPrHeadSha("reviewer", ri.pr.headSha);
      const ctx = prepareReviewer({
        ticketKey: envelope.ticket_key,
        issue,
        pr: ri.pr,
        files: ri.files,
        commits: ri.commits,
        branchName: ri.branchName,
        typeOverride: ri.typeOverride,
        reviewRubric: ri.reviewRubric,
        capabilities: ri.capabilities,
        idempotencyMarker: marker,
        repoRoot: ri.repoRoot,
        ...ri._buildSystem ? { _buildSystem: ri._buildSystem } : {},
        ...ri._loadOptionalPrompt ? { _loadOptionalPrompt: ri._loadOptionalPrompt } : {}
      });
      ({ system, initialPrompt, mcpServers, idempotencyMarker } = pickPrepared(ctx));
      model = ri.effectiveCfg.models.review.model;
      break;
    }
    case "iterator": {
      assertRoleInput(input.input, "iterator");
      const ri = input.input;
      const marker = byPrHeadSha("iterator", ri.headSha);
      const ctx = prepareIterator({
        ticketKey: envelope.ticket_key,
        issue,
        headSha: ri.headSha,
        reviewComment: ri.reviewComment,
        mergeConflicts: ri.mergeConflicts,
        existingLog: ri.existingLog,
        mcpPool: ri.mcpPool,
        configLabels: ri.configLabels,
        capabilities: ri.capabilities,
        idempotencyMarker: marker,
        typeOverride: ri.typeOverride,
        repoRoot: ri.repoRoot,
        ...ri._buildSystem ? { _buildSystem: ri._buildSystem } : {}
      });
      ({ system, initialPrompt, mcpServers, idempotencyMarker } = pickPrepared(ctx));
      model = ri.effectiveCfg.models.iterate.model;
      break;
    }
    case "refiner": {
      assertRoleInput(input.input, "refiner");
      const ri = input.input;
      const _buildSystem = ri._buildSystem ?? buildSystem;
      system = _buildSystem("refiner", ri.repoRoot);
      initialPrompt = buildRefinerPrompt({
        ticket: {
          key: envelope.ticket_key,
          title: issue.summary,
          description: issue.description,
          comments: issue.comments,
          labels: issue.labels
        },
        existingSubtasks: ri.existingSubtasks,
        priorRefinerRuns: ri.priorRefinerRuns,
        callLlm: () => Promise.reject(new Error("cc-prepare: refiner callLlm must not be invoked")),
        runLink: ri.runLink
      });
      mcpServers = [];
      idempotencyMarker = byEventId("refiner", envelope.event_id);
      model = ri.effectiveCfg.models.refiner.model;
      break;
    }
    default:
      throw new Error(`unknown ferry role: ${String(role)}`);
  }
  const job = buildClaudeCodeJob({
    role,
    system,
    initialPrompt,
    mcpServers,
    ...model ? { model } : {}
  });
  return {
    prompt: job.prompt,
    claudeArgs: job.claudeArgs,
    allowedNativeTools: job.allowedNativeTools,
    outputArtifactPath: job.outputArtifactPath,
    // `--mcp-config` value is JSON-encoded inside claudeArgs; we ALSO expose the
    // structured object as a top-level output so workflow authors can read it
    // without re-parsing the args list.
    mcpConfig: toClaudeCodeMcpConfig(mcpServers ?? []),
    idempotencyMarker
  };
}
function pickPrepared(ctx) {
  return {
    system: ctx.system,
    initialPrompt: ctx.initialPrompt,
    mcpServers: ctx.mcpServers,
    idempotencyMarker: ctx.idempotencyMarker
  };
}
function assertRoleInput(ri, role) {
  if (ri.role !== role) {
    throw new Error(`cc-prepare: role mismatch \u2014 top-level role=${role} but input.role=${ri.role}`);
  }
}
function throwMissing(field) {
  throw new Error(`cc-prepare: required field missing: ${field}`);
}
function parseRole(raw) {
  if (!raw || !VALID_ROLES.includes(raw)) {
    throw new Error(
      `cc-prepare: FERRY_AGENT_ROLE is invalid (got: ${raw ?? "(unset)"}; valid: ${VALID_ROLES.join(", ")})`
    );
  }
  return raw;
}
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`cc-prepare: ${name} is not set`);
  return v;
}
function writeOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  const useHeredoc = value.includes("\n");
  if (useHeredoc) {
    const delimiter = `__FERRY_EOF_${randomBytes(6).toString("hex")}__`;
    if (value.split("\n").includes(delimiter)) {
      throw new Error(
        `cc-prepare: output value contains heredoc delimiter collision for '${name}' \u2014 refusing to write to $GITHUB_OUTPUT`
      );
    }
    const line2 = `${name}<<${delimiter}
${value}
${delimiter}
`;
    if (!outputFile) {
      process.stdout.write(line2);
      return;
    }
    appendFileSync(outputFile, line2);
    return;
  }
  const line = `${name}=${value}
`;
  if (!outputFile) {
    process.stdout.write(line);
    return;
  }
  appendFileSync(outputFile, line);
}
function enforceAuthInvariant() {
  const hasOauth = Boolean(process.env.CLAUDE_CODE_OAUTH_TOKEN);
  const hasApiKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (hasOauth && hasApiKey) {
    throw new Error(
      `cc-prepare: ANTHROPIC_API_KEY must NOT be set alongside CLAUDE_CODE_OAUTH_TOKEN (ADR-0006 \xA76 \u2014 the claude-code path authenticates exclusively via ${CLAUDE_CODE_AUTH_INPUT}, never ${FORBIDDEN_AUTH_INPUT}).`
    );
  }
}
function enforceProviderGate(cfg) {
  if (!isAnthropicOnlyConfig(cfg)) {
    throw new Error(
      "cc-prepare: refusing to run \u2014 ferry.config is not anthropic-only. The claude-code path requires every agent provider to be `anthropic` (ADR-0006 \xA71, issue #329)."
    );
  }
}
async function runCcPrepareAction() {
  enforceAuthInvariant();
  const raw = requireEnv("FERRY_ENVELOPE_PAYLOAD");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("cc-prepare: FERRY_ENVELOPE_PAYLOAD is not valid JSON");
  }
  const envelope = validateEnvelope(parsed);
  const role = parseRole(process.env.FERRY_AGENT_ROLE);
  const repoRoot = process.cwd();
  const ferryCfg = loadFerryConfig(repoRoot);
  enforceProviderGate(ferryCfg);
  const logger = createLogger(envelope.event_id, "ferry:cc-prepare");
  const jiraBaseUrl = requireEnv("FERRY_JIRA_BASE_URL");
  const jiraEmail = requireEnv("FERRY_JIRA_EMAIL");
  const jiraApiToken = requireEnv("FERRY_JIRA_API_TOKEN");
  const jira = new JiraRestClient(jiraBaseUrl, jiraEmail, jiraApiToken);
  const tracker = new JiraTracker(jira);
  const issue = await tracker.getIssue(envelope.ticket_key);
  const overrides = resolveTicketOverrides(issue.labels, logger, {
    allowSkipReview: ferryCfg.safety?.allow_skip_review === true
  });
  const effectiveCfg = applyTicketOverrides(ferryCfg, overrides);
  enforceProviderGate(effectiveCfg);
  let outputs;
  switch (role) {
    case "refiner": {
      const innerTracker = new InMemoryTracker();
      innerTracker.seed(issue);
      const allowedRefinerTrackerMethods = /* @__PURE__ */ new Set(["seed", "getIssue"]);
      const trackerForRefiner = new Proxy(innerTracker, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (typeof value !== "function") {
            return value;
          }
          const propName = typeof prop === "string" ? prop : String(prop);
          if (allowedRefinerTrackerMethods.has(propName)) {
            return value.bind(target);
          }
          return () => {
            throw new Error(
              `cc-prepare: refiner tracker stub only permits 'getIssue' \u2014 '${propName}' was invoked. If prepareRefiner now calls additional tracker methods, the Jira-dedup adapter must be rebuilt to either hit Jira or stub the new method.`
            );
          };
        }
      });
      const refinerPrepared = await prepareRefiner({
        envelope,
        tracker: trackerForRefiner
      });
      outputs = await prepareCcJob({
        envelope,
        issue,
        role: "refiner",
        input: {
          role: "refiner",
          effectiveCfg,
          existingSubtasks: refinerPrepared.existingSubtasks,
          priorRefinerRuns: refinerPrepared.priorRefinerRuns,
          runLink: refinerPrepared.runLink,
          repoRoot
        }
      });
      break;
    }
    default:
      throw new Error(
        `cc-prepare: role '${role}' not yet wired into the composite entrypoint. The remaining upstream state (PR / branch / files / commits) lands via #333.`
      );
  }
  writeOutput("prompt", outputs.prompt);
  writeOutput("claude_args", JSON.stringify(outputs.claudeArgs));
  writeOutput("allowed_native_tools", JSON.stringify(outputs.allowedNativeTools));
  writeOutput("output_artifact_path", outputs.outputArtifactPath);
  writeOutput("mcp_config", JSON.stringify(outputs.mcpConfig));
  writeOutput("idempotency_marker", outputs.idempotencyMarker);
  return outputs;
}
var invokedDirectly = typeof process !== "undefined" && process.argv[1]?.endsWith("cc-prepare-action.js");
if (invokedDirectly) {
  void runCcPrepareAction().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ferry-cc-prepare: ${msg}
`);
    process.exit(1);
  });
}
export {
  prepareCcJob,
  runCcPrepareAction
};
