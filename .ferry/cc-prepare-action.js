var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/fast-content-type-parse/index.js
var require_fast_content_type_parse = __commonJS({
  "node_modules/fast-content-type-parse/index.js"(exports, module) {
    "use strict";
    var NullObject = function NullObject2() {
    };
    NullObject.prototype = /* @__PURE__ */ Object.create(null);
    var paramRE = /; *([!#$%&'*+.^\w`|~-]+)=("(?:[\v\u0020\u0021\u0023-\u005b\u005d-\u007e\u0080-\u00ff]|\\[\v\u0020-\u00ff])*"|[!#$%&'*+.^\w`|~-]+) */gu;
    var quotedPairRE = /\\([\v\u0020-\u00ff])/gu;
    var mediaTypeRE = /^[!#$%&'*+.^\w|~-]+\/[!#$%&'*+.^\w|~-]+$/u;
    var defaultContentType = { type: "", parameters: new NullObject() };
    Object.freeze(defaultContentType.parameters);
    Object.freeze(defaultContentType);
    function parse2(header) {
      if (typeof header !== "string") {
        throw new TypeError("argument header is required and must be a string");
      }
      let index = header.indexOf(";");
      const type = index !== -1 ? header.slice(0, index).trim() : header.trim();
      if (mediaTypeRE.test(type) === false) {
        throw new TypeError("invalid media type");
      }
      const result = {
        type: type.toLowerCase(),
        parameters: new NullObject()
      };
      if (index === -1) {
        return result;
      }
      let key;
      let match;
      let value;
      paramRE.lastIndex = index;
      while (match = paramRE.exec(header)) {
        if (match.index !== index) {
          throw new TypeError("invalid parameter format");
        }
        index += match[0].length;
        key = match[1].toLowerCase();
        value = match[2];
        if (value[0] === '"') {
          value = value.slice(1, value.length - 1);
          quotedPairRE.test(value) && (value = value.replace(quotedPairRE, "$1"));
        }
        result.parameters[key] = value;
      }
      if (index !== header.length) {
        throw new TypeError("invalid parameter format");
      }
      return result;
    }
    function safeParse2(header) {
      if (typeof header !== "string") {
        return defaultContentType;
      }
      let index = header.indexOf(";");
      const type = index !== -1 ? header.slice(0, index).trim() : header.trim();
      if (mediaTypeRE.test(type) === false) {
        return defaultContentType;
      }
      const result = {
        type: type.toLowerCase(),
        parameters: new NullObject()
      };
      if (index === -1) {
        return result;
      }
      let key;
      let match;
      let value;
      paramRE.lastIndex = index;
      while (match = paramRE.exec(header)) {
        if (match.index !== index) {
          return defaultContentType;
        }
        index += match[0].length;
        key = match[1].toLowerCase();
        value = match[2];
        if (value[0] === '"') {
          value = value.slice(1, value.length - 1);
          quotedPairRE.test(value) && (value = value.replace(quotedPairRE, "$1"));
        }
        result.parameters[key] = value;
      }
      if (index !== header.length) {
        return defaultContentType;
      }
      return result;
    }
    module.exports.default = { parse: parse2, safeParse: safeParse2 };
    module.exports.parse = parse2;
    module.exports.safeParse = safeParse2;
    module.exports.defaultContentType = defaultContentType;
  }
});

// src/lib/dispatch/cc-prepare-action.ts
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync as execFileSync5 } from "node:child_process";

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
function parseFerryConfigJson(jsonContent) {
  let raw;
  try {
    raw = JSON.parse(jsonContent);
  } catch (e) {
    throw new FerryError("state-invariant", {
      reason: "invalid-ferry-config",
      error: e.message
    });
  }
  const errors = validateConfigShape(raw);
  if (errors.length > 0) {
    throw new FerryError("state-invariant", { reason: "invalid-ferry-config", errors });
  }
  return applyEnvOverrides(mergeWithDefaults(raw));
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
function checkoutExistingBranch(branchName, repoRoot) {
  try {
    execFileSync("git", ["ls-remote", "--exit-code", "--heads", "origin", branchName], {
      cwd: repoRoot,
      stdio: "pipe"
    });
    execFileSync("git", ["fetch", "origin", branchName], { cwd: repoRoot });
    execFileSync("git", ["checkout", branchName], { cwd: repoRoot });
    return "ok";
  } catch {
    return "not-found";
  }
}
function fetchAndMergeBase(baseBranch, repoRoot) {
  execFileSync("git", ["fetch", "origin", baseBranch], { cwd: repoRoot });
  try {
    execFileSync("git", ["merge", `origin/${baseBranch}`, "--no-edit"], { cwd: repoRoot });
    return [];
  } catch {
    return execSync("git diff --name-only --diff-filter=U", { cwd: repoRoot, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  }
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
async function resolveGitConfig(ferryCfg, runner, owner, repo) {
  const { base_branch, target_branch, working_branch_prefix } = ferryCfg.git;
  const baseBranch = base_branch ?? await runner.getRepoDefaultBranch(owner, repo);
  const targetBranch = target_branch ?? baseBranch;
  return { baseBranch, targetBranch, workingBranchPrefix: working_branch_prefix };
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

// src/lib/agent-runtime/config-reload.ts
import { execFileSync as execFileSync3 } from "node:child_process";
function loadFerryConfigFromBaseBranch(baseBranch, repoRoot, fallback) {
  try {
    execFileSync3("git", ["fetch", "origin", baseBranch], { cwd: repoRoot, stdio: "pipe" });
  } catch {
    return fallback;
  }
  let jsonContent;
  try {
    jsonContent = execFileSync3("git", ["show", `origin/${baseBranch}:ferry.config.json`], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe"
    });
  } catch {
    return fallback;
  }
  return parseFerryConfigJson(jsonContent);
}

// src/lib/agent-runtime/env.ts
function isValidMcpServer(s) {
  if (s === null || typeof s !== "object") return false;
  const obj = s;
  if (typeof obj.name !== "string" || obj.name.length === 0) return false;
  if (obj.type === "stdio") {
    return typeof obj.command === "string" && obj.command.length > 0;
  }
  return typeof obj.url === "string" && obj.url.length > 0;
}
var DEFAULT_MCP_SERVERS = [
  { name: "context7", url: "https://mcp.context7.com/mcp" }
];
function loadMcpServers() {
  const defaults = process.env.FERRY_MCP_DEFAULTS_DISABLED === "true" ? [] : [...DEFAULT_MCP_SERVERS];
  const raw = process.env.AGENT_MCP_SERVERS;
  if (!raw) return defaults;
  let consumer;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaults;
    consumer = parsed.filter(isValidMcpServer);
  } catch {
    return defaults;
  }
  const consumerNames = new Set(consumer.map((s) => s.name));
  const filteredDefaults = defaults.filter((d) => !consumerNames.has(d.name));
  return [...filteredDefaults, ...consumer];
}

// src/agents/developer/workspace.ts
import { readFileSync as readFileSync4, existsSync as existsSync4 } from "node:fs";
import { execFileSync as execFileSync4 } from "node:child_process";
import * as path3 from "node:path";
function detectTestRunner(packageJsonPath2) {
  try {
    const pkg = JSON.parse(readFileSync4(packageJsonPath2, "utf8"));
    const deps = { ...pkg.dependencies ?? {}, ...pkg.devDependencies ?? {} };
    if (deps.vitest) return "vitest";
    if (deps.jest) return "jest";
    if (deps.mocha) return "mocha";
    if (deps.ava) return "ava";
    const scripts = pkg.scripts ?? {};
    if (Object.values(scripts).some((s) => s.includes("node:test"))) return "node:test";
    return "none";
  } catch {
    return "none";
  }
}
function repoTree(repoRoot) {
  try {
    return execFileSync4(
      "find",
      [
        repoRoot,
        "-maxdepth",
        "2",
        "-not",
        "-path",
        "*/node_modules/*",
        "-not",
        "-path",
        "*/.git/*"
      ],
      { encoding: "utf8" }
    ).split("\n").filter(Boolean).join("\n");
  } catch {
    return "(unavailable)";
  }
}
function packageJsonPath(repoRoot) {
  return path3.join(repoRoot, "package.json");
}
function detectPackageManager(repoRoot, _checkExists = existsSync4, _readFile = (p, enc) => readFileSync4(p, enc)) {
  const join4 = (file) => path3.join(repoRoot, file);
  if (_checkExists(join4("pnpm-lock.yaml"))) {
    return "pnpm lockfile detected (`pnpm-lock.yaml`). Use pnpm for all install and script commands.";
  }
  if (_checkExists(join4("package.json"))) {
    try {
      const pkg = JSON.parse(_readFile(join4("package.json"), "utf8"));
      const pm = typeof pkg.packageManager === "string" ? pkg.packageManager : "";
      if (pm.startsWith("pnpm")) {
        return "pnpm declared in `package.json` (`packageManager` field). Use pnpm for all install and script commands.";
      }
      if (pm.startsWith("yarn")) {
        return "yarn declared in `package.json` (`packageManager` field). Use yarn for all install and script commands.";
      }
      if (pm.startsWith("bun")) {
        return "bun declared in `package.json` (`packageManager` field). Use bun for all install and script commands.";
      }
      if (pm.startsWith("npm")) {
        return "npm declared in `package.json` (`packageManager` field). Use npm for all install and script commands.";
      }
    } catch {
    }
  }
  if (_checkExists(join4("yarn.lock"))) {
    return "yarn lockfile detected (`yarn.lock`). Use yarn for all install and script commands.";
  }
  if (_checkExists(join4("bun.lockb"))) {
    return "bun lockfile detected (`bun.lockb`). Use bun for all install and script commands.";
  }
  if (_checkExists(join4("package-lock.json"))) {
    return "npm lockfile detected (`package-lock.json`). Use npm for all install and script commands.";
  }
  const hasPyproject = _checkExists(join4("pyproject.toml"));
  const hasRequirements = _checkExists(join4("requirements.txt"));
  if (hasPyproject || hasRequirements) {
    const marker = hasPyproject ? "pyproject.toml" : "requirements.txt";
    return `Python project detected (\`${marker}\`). Use pip or the project's configured tool for dependency management.`;
  }
  if (_checkExists(join4("Gemfile.lock"))) {
    return "Ruby project detected (`Gemfile.lock`). Use bundler for dependency management.";
  }
  if (_checkExists(join4("Cargo.lock"))) {
    return "Rust project detected (`Cargo.lock`). Use cargo for dependency management.";
  }
  return null;
}

// node_modules/universal-user-agent/index.js
function getUserAgent() {
  if (typeof navigator === "object" && "userAgent" in navigator) {
    return navigator.userAgent;
  }
  if (typeof process === "object" && process.version !== void 0) {
    return `Node.js/${process.version.substr(1)} (${process.platform}; ${process.arch})`;
  }
  return "<environment undetectable>";
}

// node_modules/before-after-hook/lib/register.js
function register(state, name, method, options) {
  if (typeof method !== "function") {
    throw new Error("method for before hook must be a function");
  }
  if (!options) {
    options = {};
  }
  if (Array.isArray(name)) {
    return name.reverse().reduce((callback, name2) => {
      return register.bind(null, state, name2, callback, options);
    }, method)();
  }
  return Promise.resolve().then(() => {
    if (!state.registry[name]) {
      return method(options);
    }
    return state.registry[name].reduce((method2, registered) => {
      return registered.hook.bind(null, method2, options);
    }, method)();
  });
}

// node_modules/before-after-hook/lib/add.js
function addHook(state, kind, name, hook2) {
  const orig = hook2;
  if (!state.registry[name]) {
    state.registry[name] = [];
  }
  if (kind === "before") {
    hook2 = (method, options) => {
      return Promise.resolve().then(orig.bind(null, options)).then(method.bind(null, options));
    };
  }
  if (kind === "after") {
    hook2 = (method, options) => {
      let result;
      return Promise.resolve().then(method.bind(null, options)).then((result_) => {
        result = result_;
        return orig(result, options);
      }).then(() => {
        return result;
      });
    };
  }
  if (kind === "error") {
    hook2 = (method, options) => {
      return Promise.resolve().then(method.bind(null, options)).catch((error) => {
        return orig(error, options);
      });
    };
  }
  state.registry[name].push({
    hook: hook2,
    orig
  });
}

// node_modules/before-after-hook/lib/remove.js
function removeHook(state, name, method) {
  if (!state.registry[name]) {
    return;
  }
  const index = state.registry[name].map((registered) => {
    return registered.orig;
  }).indexOf(method);
  if (index === -1) {
    return;
  }
  state.registry[name].splice(index, 1);
}

// node_modules/before-after-hook/index.js
var bind = Function.bind;
var bindable = bind.bind(bind);
function bindApi(hook2, state, name) {
  const removeHookRef = bindable(removeHook, null).apply(
    null,
    name ? [state, name] : [state]
  );
  hook2.api = { remove: removeHookRef };
  hook2.remove = removeHookRef;
  ["before", "error", "after", "wrap"].forEach((kind) => {
    const args = name ? [state, kind, name] : [state, kind];
    hook2[kind] = hook2.api[kind] = bindable(addHook, null).apply(null, args);
  });
}
function Singular() {
  const singularHookName = /* @__PURE__ */ Symbol("Singular");
  const singularHookState = {
    registry: {}
  };
  const singularHook = register.bind(null, singularHookState, singularHookName);
  bindApi(singularHook, singularHookState, singularHookName);
  return singularHook;
}
function Collection() {
  const state = {
    registry: {}
  };
  const hook2 = register.bind(null, state);
  bindApi(hook2, state);
  return hook2;
}
var before_after_hook_default = { Singular, Collection };

// node_modules/@octokit/endpoint/dist-bundle/index.js
var VERSION = "0.0.0-development";
var userAgent = `octokit-endpoint.js/${VERSION} ${getUserAgent()}`;
var DEFAULTS = {
  method: "GET",
  baseUrl: "https://api.github.com",
  headers: {
    accept: "application/vnd.github.v3+json",
    "user-agent": userAgent
  },
  mediaType: {
    format: ""
  }
};
function lowercaseKeys(object) {
  if (!object) {
    return {};
  }
  return Object.keys(object).reduce((newObj, key) => {
    newObj[key.toLowerCase()] = object[key];
    return newObj;
  }, {});
}
function isPlainObject(value) {
  if (typeof value !== "object" || value === null) return false;
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const proto = Object.getPrototypeOf(value);
  if (proto === null) return true;
  const Ctor = Object.prototype.hasOwnProperty.call(proto, "constructor") && proto.constructor;
  return typeof Ctor === "function" && Ctor instanceof Ctor && Function.prototype.call(Ctor) === Function.prototype.call(value);
}
function mergeDeep(defaults, options) {
  const result = Object.assign({}, defaults);
  Object.keys(options).forEach((key) => {
    if (isPlainObject(options[key])) {
      if (!(key in defaults)) Object.assign(result, { [key]: options[key] });
      else result[key] = mergeDeep(defaults[key], options[key]);
    } else {
      Object.assign(result, { [key]: options[key] });
    }
  });
  return result;
}
function removeUndefinedProperties(obj) {
  for (const key in obj) {
    if (obj[key] === void 0) {
      delete obj[key];
    }
  }
  return obj;
}
function merge(defaults, route, options) {
  if (typeof route === "string") {
    let [method, url] = route.split(" ");
    options = Object.assign(url ? { method, url } : { url: method }, options);
  } else {
    options = Object.assign({}, route);
  }
  options.headers = lowercaseKeys(options.headers);
  removeUndefinedProperties(options);
  removeUndefinedProperties(options.headers);
  const mergedOptions = mergeDeep(defaults || {}, options);
  if (options.url === "/graphql") {
    if (defaults && defaults.mediaType.previews?.length) {
      mergedOptions.mediaType.previews = defaults.mediaType.previews.filter(
        (preview) => !mergedOptions.mediaType.previews.includes(preview)
      ).concat(mergedOptions.mediaType.previews);
    }
    mergedOptions.mediaType.previews = (mergedOptions.mediaType.previews || []).map((preview) => preview.replace(/-preview/, ""));
  }
  return mergedOptions;
}
function addQueryParameters(url, parameters) {
  const separator = /\?/.test(url) ? "&" : "?";
  const names = Object.keys(parameters);
  if (names.length === 0) {
    return url;
  }
  return url + separator + names.map((name) => {
    if (name === "q") {
      return "q=" + parameters.q.split("+").map(encodeURIComponent).join("+");
    }
    return `${name}=${encodeURIComponent(parameters[name])}`;
  }).join("&");
}
var urlVariableRegex = /\{[^{}}]+\}/g;
function removeNonChars(variableName) {
  return variableName.replace(/(?:^\W+)|(?:(?<!\W)\W+$)/g, "").split(/,/);
}
function extractUrlVariableNames(url) {
  const matches = url.match(urlVariableRegex);
  if (!matches) {
    return [];
  }
  return matches.map(removeNonChars).reduce((a, b) => a.concat(b), []);
}
function omit(object, keysToOmit) {
  const result = { __proto__: null };
  for (const key of Object.keys(object)) {
    if (keysToOmit.indexOf(key) === -1) {
      result[key] = object[key];
    }
  }
  return result;
}
function encodeReserved(str) {
  return str.split(/(%[0-9A-Fa-f]{2})/g).map(function(part) {
    if (!/%[0-9A-Fa-f]/.test(part)) {
      part = encodeURI(part).replace(/%5B/g, "[").replace(/%5D/g, "]");
    }
    return part;
  }).join("");
}
function encodeUnreserved(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, function(c) {
    return "%" + c.charCodeAt(0).toString(16).toUpperCase();
  });
}
function encodeValue(operator, value, key) {
  value = operator === "+" || operator === "#" ? encodeReserved(value) : encodeUnreserved(value);
  if (key) {
    return encodeUnreserved(key) + "=" + value;
  } else {
    return value;
  }
}
function isDefined(value) {
  return value !== void 0 && value !== null;
}
function isKeyOperator(operator) {
  return operator === ";" || operator === "&" || operator === "?";
}
function getValues(context, operator, key, modifier) {
  var value = context[key], result = [];
  if (isDefined(value) && value !== "") {
    if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
      value = value.toString();
      if (modifier && modifier !== "*") {
        value = value.substring(0, parseInt(modifier, 10));
      }
      result.push(
        encodeValue(operator, value, isKeyOperator(operator) ? key : "")
      );
    } else {
      if (modifier === "*") {
        if (Array.isArray(value)) {
          value.filter(isDefined).forEach(function(value2) {
            result.push(
              encodeValue(operator, value2, isKeyOperator(operator) ? key : "")
            );
          });
        } else {
          Object.keys(value).forEach(function(k) {
            if (isDefined(value[k])) {
              result.push(encodeValue(operator, value[k], k));
            }
          });
        }
      } else {
        const tmp = [];
        if (Array.isArray(value)) {
          value.filter(isDefined).forEach(function(value2) {
            tmp.push(encodeValue(operator, value2));
          });
        } else {
          Object.keys(value).forEach(function(k) {
            if (isDefined(value[k])) {
              tmp.push(encodeUnreserved(k));
              tmp.push(encodeValue(operator, value[k].toString()));
            }
          });
        }
        if (isKeyOperator(operator)) {
          result.push(encodeUnreserved(key) + "=" + tmp.join(","));
        } else if (tmp.length !== 0) {
          result.push(tmp.join(","));
        }
      }
    }
  } else {
    if (operator === ";") {
      if (isDefined(value)) {
        result.push(encodeUnreserved(key));
      }
    } else if (value === "" && (operator === "&" || operator === "?")) {
      result.push(encodeUnreserved(key) + "=");
    } else if (value === "") {
      result.push("");
    }
  }
  return result;
}
function parseUrl(template) {
  return {
    expand: expand.bind(null, template)
  };
}
function expand(template, context) {
  var operators = ["+", "#", ".", "/", ";", "?", "&"];
  template = template.replace(
    /\{([^\{\}]+)\}|([^\{\}]+)/g,
    function(_, expression, literal) {
      if (expression) {
        let operator = "";
        const values = [];
        if (operators.indexOf(expression.charAt(0)) !== -1) {
          operator = expression.charAt(0);
          expression = expression.substr(1);
        }
        expression.split(/,/g).forEach(function(variable) {
          var tmp = /([^:\*]*)(?::(\d+)|(\*))?/.exec(variable);
          values.push(getValues(context, operator, tmp[1], tmp[2] || tmp[3]));
        });
        if (operator && operator !== "+") {
          var separator = ",";
          if (operator === "?") {
            separator = "&";
          } else if (operator !== "#") {
            separator = operator;
          }
          return (values.length !== 0 ? operator : "") + values.join(separator);
        } else {
          return values.join(",");
        }
      } else {
        return encodeReserved(literal);
      }
    }
  );
  if (template === "/") {
    return template;
  } else {
    return template.replace(/\/$/, "");
  }
}
function parse(options) {
  let method = options.method.toUpperCase();
  let url = (options.url || "/").replace(/:([a-z]\w+)/g, "{$1}");
  let headers = Object.assign({}, options.headers);
  let body;
  let parameters = omit(options, [
    "method",
    "baseUrl",
    "url",
    "headers",
    "request",
    "mediaType"
  ]);
  const urlVariableNames = extractUrlVariableNames(url);
  url = parseUrl(url).expand(parameters);
  if (!/^http/.test(url)) {
    url = options.baseUrl + url;
  }
  const omittedParameters = Object.keys(options).filter((option) => urlVariableNames.includes(option)).concat("baseUrl");
  const remainingParameters = omit(parameters, omittedParameters);
  const isBinaryRequest = /application\/octet-stream/i.test(headers.accept);
  if (!isBinaryRequest) {
    if (options.mediaType.format) {
      headers.accept = headers.accept.split(/,/).map(
        (format) => format.replace(
          /application\/vnd(\.\w+)(\.v3)?(\.\w+)?(\+json)?$/,
          `application/vnd$1$2.${options.mediaType.format}`
        )
      ).join(",");
    }
    if (url.endsWith("/graphql")) {
      if (options.mediaType.previews?.length) {
        const previewsFromAcceptHeader = headers.accept.match(/(?<![\w-])[\w-]+(?=-preview)/g) || [];
        headers.accept = previewsFromAcceptHeader.concat(options.mediaType.previews).map((preview) => {
          const format = options.mediaType.format ? `.${options.mediaType.format}` : "+json";
          return `application/vnd.github.${preview}-preview${format}`;
        }).join(",");
      }
    }
  }
  if (["GET", "HEAD"].includes(method)) {
    url = addQueryParameters(url, remainingParameters);
  } else {
    if ("data" in remainingParameters) {
      body = remainingParameters.data;
    } else {
      if (Object.keys(remainingParameters).length) {
        body = remainingParameters;
      }
    }
  }
  if (!headers["content-type"] && typeof body !== "undefined") {
    headers["content-type"] = "application/json; charset=utf-8";
  }
  if (["PATCH", "PUT"].includes(method) && typeof body === "undefined") {
    body = "";
  }
  return Object.assign(
    { method, url, headers },
    typeof body !== "undefined" ? { body } : null,
    options.request ? { request: options.request } : null
  );
}
function endpointWithDefaults(defaults, route, options) {
  return parse(merge(defaults, route, options));
}
function withDefaults(oldDefaults, newDefaults) {
  const DEFAULTS2 = merge(oldDefaults, newDefaults);
  const endpoint2 = endpointWithDefaults.bind(null, DEFAULTS2);
  return Object.assign(endpoint2, {
    DEFAULTS: DEFAULTS2,
    defaults: withDefaults.bind(null, DEFAULTS2),
    merge: merge.bind(null, DEFAULTS2),
    parse
  });
}
var endpoint = withDefaults(null, DEFAULTS);

// node_modules/@octokit/request/dist-bundle/index.js
var import_fast_content_type_parse = __toESM(require_fast_content_type_parse(), 1);

// node_modules/json-with-bigint/json-with-bigint.js
var intRegex = /^-?\d+$/;
var noiseValue = /^-?\d+n+$/;
var originalStringify = JSON.stringify;
var originalParse = JSON.parse;
var customFormat = /^-?\d+n$/;
var bigIntsStringify = /([\[:])?"(-?\d+)n"($|([\\n]|\s)*(\s|[\\n])*[,\}\]])/g;
var noiseStringify = /([\[:])?("-?\d+n+)n("$|"([\\n]|\s)*(\s|[\\n])*[,\}\]])/g;
var JSONStringify = (value, replacer, space) => {
  if ("rawJSON" in JSON) {
    return originalStringify(
      value,
      (key, value2) => {
        if (typeof value2 === "bigint") return JSON.rawJSON(value2.toString());
        if (typeof replacer === "function") return replacer(key, value2);
        if (Array.isArray(replacer) && replacer.includes(key)) return value2;
        return value2;
      },
      space
    );
  }
  if (!value) return originalStringify(value, replacer, space);
  const convertedToCustomJSON = originalStringify(
    value,
    (key, value2) => {
      const isNoise = typeof value2 === "string" && noiseValue.test(value2);
      if (isNoise) return value2.toString() + "n";
      if (typeof value2 === "bigint") return value2.toString() + "n";
      if (typeof replacer === "function") return replacer(key, value2);
      if (Array.isArray(replacer) && replacer.includes(key)) return value2;
      return value2;
    },
    space
  );
  const processedJSON = convertedToCustomJSON.replace(
    bigIntsStringify,
    "$1$2$3"
  );
  const denoisedJSON = processedJSON.replace(noiseStringify, "$1$2$3");
  return denoisedJSON;
};
var featureCache = /* @__PURE__ */ new Map();
var isContextSourceSupported = () => {
  const parseFingerprint = JSON.parse.toString();
  if (featureCache.has(parseFingerprint)) {
    return featureCache.get(parseFingerprint);
  }
  try {
    const result = JSON.parse(
      "1",
      (_, __, context) => !!context?.source && context.source === "1"
    );
    featureCache.set(parseFingerprint, result);
    return result;
  } catch {
    featureCache.set(parseFingerprint, false);
    return false;
  }
};
var convertMarkedBigIntsReviver = (key, value, context, userReviver) => {
  const isCustomFormatBigInt = typeof value === "string" && customFormat.test(value);
  if (isCustomFormatBigInt) return BigInt(value.slice(0, -1));
  const isNoiseValue = typeof value === "string" && noiseValue.test(value);
  if (isNoiseValue) return value.slice(0, -1);
  if (typeof userReviver !== "function") return value;
  return userReviver(key, value, context);
};
var JSONParseV2 = (text, reviver) => {
  return JSON.parse(text, (key, value, context) => {
    const isBigNumber = typeof value === "number" && (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER);
    const isInt = context && intRegex.test(context.source);
    const isBigInt = isBigNumber && isInt;
    if (isBigInt) return BigInt(context.source);
    if (typeof reviver !== "function") return value;
    return reviver(key, value, context);
  });
};
var MAX_INT = Number.MAX_SAFE_INTEGER.toString();
var MAX_DIGITS = MAX_INT.length;
var stringsOrLargeNumbers = /"(?:\\.|[^"])*"|-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/g;
var noiseValueWithQuotes = /^"-?\d+n+"$/;
var JSONParse = (text, reviver) => {
  if (!text) return originalParse(text, reviver);
  if (isContextSourceSupported()) return JSONParseV2(text, reviver);
  const serializedData = text.replace(
    stringsOrLargeNumbers,
    (text2, digits, fractional, exponential) => {
      const isString = text2[0] === '"';
      const isNoise = isString && noiseValueWithQuotes.test(text2);
      if (isNoise) return text2.substring(0, text2.length - 1) + 'n"';
      const isFractionalOrExponential = fractional || exponential;
      const isLessThanMaxSafeInt = digits && (digits.length < MAX_DIGITS || digits.length === MAX_DIGITS && digits <= MAX_INT);
      if (isString || isFractionalOrExponential || isLessThanMaxSafeInt)
        return text2;
      return '"' + text2 + 'n"';
    }
  );
  return originalParse(
    serializedData,
    (key, value, context) => convertMarkedBigIntsReviver(key, value, context, reviver)
  );
};

// node_modules/@octokit/request-error/dist-src/index.js
var RequestError = class extends Error {
  name;
  /**
   * http status code
   */
  status;
  /**
   * Request options that lead to the error.
   */
  request;
  /**
   * Response object if a response was received
   */
  response;
  constructor(message, statusCode, options) {
    super(message, { cause: options.cause });
    this.name = "HttpError";
    this.status = Number.parseInt(statusCode);
    if (Number.isNaN(this.status)) {
      this.status = 0;
    }
    if ("response" in options) {
      this.response = options.response;
    }
    const requestCopy = Object.assign({}, options.request);
    if (options.request.headers.authorization) {
      requestCopy.headers = Object.assign({}, options.request.headers, {
        authorization: options.request.headers.authorization.replace(
          /(?<! ) .*$/,
          " [REDACTED]"
        )
      });
    }
    requestCopy.url = requestCopy.url.replace(/\bclient_secret=\w+/g, "client_secret=[REDACTED]").replace(/\baccess_token=\w+/g, "access_token=[REDACTED]");
    this.request = requestCopy;
  }
};

// node_modules/@octokit/request/dist-bundle/index.js
var VERSION2 = "10.0.8";
var defaults_default = {
  headers: {
    "user-agent": `octokit-request.js/${VERSION2} ${getUserAgent()}`
  }
};
function isPlainObject2(value) {
  if (typeof value !== "object" || value === null) return false;
  if (Object.prototype.toString.call(value) !== "[object Object]") return false;
  const proto = Object.getPrototypeOf(value);
  if (proto === null) return true;
  const Ctor = Object.prototype.hasOwnProperty.call(proto, "constructor") && proto.constructor;
  return typeof Ctor === "function" && Ctor instanceof Ctor && Function.prototype.call(Ctor) === Function.prototype.call(value);
}
var noop = () => "";
async function fetchWrapper(requestOptions) {
  const fetch2 = requestOptions.request?.fetch || globalThis.fetch;
  if (!fetch2) {
    throw new Error(
      "fetch is not set. Please pass a fetch implementation as new Octokit({ request: { fetch }}). Learn more at https://github.com/octokit/octokit.js/#fetch-missing"
    );
  }
  const log = requestOptions.request?.log || console;
  const parseSuccessResponseBody = requestOptions.request?.parseSuccessResponseBody !== false;
  const body = isPlainObject2(requestOptions.body) || Array.isArray(requestOptions.body) ? JSONStringify(requestOptions.body) : requestOptions.body;
  const requestHeaders = Object.fromEntries(
    Object.entries(requestOptions.headers).map(([name, value]) => [
      name,
      String(value)
    ])
  );
  let fetchResponse;
  try {
    fetchResponse = await fetch2(requestOptions.url, {
      method: requestOptions.method,
      body,
      redirect: requestOptions.request?.redirect,
      headers: requestHeaders,
      signal: requestOptions.request?.signal,
      // duplex must be set if request.body is ReadableStream or Async Iterables.
      // See https://fetch.spec.whatwg.org/#dom-requestinit-duplex.
      ...requestOptions.body && { duplex: "half" }
    });
  } catch (error) {
    let message = "Unknown Error";
    if (error instanceof Error) {
      if (error.name === "AbortError") {
        error.status = 500;
        throw error;
      }
      message = error.message;
      if (error.name === "TypeError" && "cause" in error) {
        if (error.cause instanceof Error) {
          message = error.cause.message;
        } else if (typeof error.cause === "string") {
          message = error.cause;
        }
      }
    }
    const requestError = new RequestError(message, 500, {
      request: requestOptions
    });
    requestError.cause = error;
    throw requestError;
  }
  const status = fetchResponse.status;
  const url = fetchResponse.url;
  const responseHeaders = {};
  for (const [key, value] of fetchResponse.headers) {
    responseHeaders[key] = value;
  }
  const octokitResponse = {
    url,
    status,
    headers: responseHeaders,
    data: ""
  };
  if ("deprecation" in responseHeaders) {
    const matches = responseHeaders.link && responseHeaders.link.match(/<([^<>]+)>; rel="deprecation"/);
    const deprecationLink = matches && matches.pop();
    log.warn(
      `[@octokit/request] "${requestOptions.method} ${requestOptions.url}" is deprecated. It is scheduled to be removed on ${responseHeaders.sunset}${deprecationLink ? `. See ${deprecationLink}` : ""}`
    );
  }
  if (status === 204 || status === 205) {
    return octokitResponse;
  }
  if (requestOptions.method === "HEAD") {
    if (status < 400) {
      return octokitResponse;
    }
    throw new RequestError(fetchResponse.statusText, status, {
      response: octokitResponse,
      request: requestOptions
    });
  }
  if (status === 304) {
    octokitResponse.data = await getResponseData(fetchResponse);
    throw new RequestError("Not modified", status, {
      response: octokitResponse,
      request: requestOptions
    });
  }
  if (status >= 400) {
    octokitResponse.data = await getResponseData(fetchResponse);
    throw new RequestError(toErrorMessage(octokitResponse.data), status, {
      response: octokitResponse,
      request: requestOptions
    });
  }
  octokitResponse.data = parseSuccessResponseBody ? await getResponseData(fetchResponse) : fetchResponse.body;
  return octokitResponse;
}
async function getResponseData(response) {
  const contentType = response.headers.get("content-type");
  if (!contentType) {
    return response.text().catch(noop);
  }
  const mimetype = (0, import_fast_content_type_parse.safeParse)(contentType);
  if (isJSONResponse(mimetype)) {
    let text = "";
    try {
      text = await response.text();
      return JSONParse(text);
    } catch (err) {
      return text;
    }
  } else if (mimetype.type.startsWith("text/") || mimetype.parameters.charset?.toLowerCase() === "utf-8") {
    return response.text().catch(noop);
  } else {
    return response.arrayBuffer().catch(
      /* v8 ignore next -- @preserve */
      () => new ArrayBuffer(0)
    );
  }
}
function isJSONResponse(mimetype) {
  return mimetype.type === "application/json" || mimetype.type === "application/scim+json";
}
function toErrorMessage(data) {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return "Unknown error";
  }
  if ("message" in data) {
    const suffix = "documentation_url" in data ? ` - ${data.documentation_url}` : "";
    return Array.isArray(data.errors) ? `${data.message}: ${data.errors.map((v) => JSON.stringify(v)).join(", ")}${suffix}` : `${data.message}${suffix}`;
  }
  return `Unknown error: ${JSON.stringify(data)}`;
}
function withDefaults2(oldEndpoint, newDefaults) {
  const endpoint2 = oldEndpoint.defaults(newDefaults);
  const newApi = function(route, parameters) {
    const endpointOptions = endpoint2.merge(route, parameters);
    if (!endpointOptions.request || !endpointOptions.request.hook) {
      return fetchWrapper(endpoint2.parse(endpointOptions));
    }
    const request2 = (route2, parameters2) => {
      return fetchWrapper(
        endpoint2.parse(endpoint2.merge(route2, parameters2))
      );
    };
    Object.assign(request2, {
      endpoint: endpoint2,
      defaults: withDefaults2.bind(null, endpoint2)
    });
    return endpointOptions.request.hook(request2, endpointOptions);
  };
  return Object.assign(newApi, {
    endpoint: endpoint2,
    defaults: withDefaults2.bind(null, endpoint2)
  });
}
var request = withDefaults2(endpoint, defaults_default);

// node_modules/@octokit/graphql/dist-bundle/index.js
var VERSION3 = "0.0.0-development";
function _buildMessageForResponseErrors(data) {
  return `Request failed due to following response errors:
` + data.errors.map((e) => ` - ${e.message}`).join("\n");
}
var GraphqlResponseError = class extends Error {
  constructor(request2, headers, response) {
    super(_buildMessageForResponseErrors(response));
    this.request = request2;
    this.headers = headers;
    this.response = response;
    this.errors = response.errors;
    this.data = response.data;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  name = "GraphqlResponseError";
  errors;
  data;
};
var NON_VARIABLE_OPTIONS = [
  "method",
  "baseUrl",
  "url",
  "headers",
  "request",
  "query",
  "mediaType",
  "operationName"
];
var FORBIDDEN_VARIABLE_OPTIONS = ["query", "method", "url"];
var GHES_V3_SUFFIX_REGEX = /\/api\/v3\/?$/;
function graphql(request2, query, options) {
  if (options) {
    if (typeof query === "string" && "query" in options) {
      return Promise.reject(
        new Error(`[@octokit/graphql] "query" cannot be used as variable name`)
      );
    }
    for (const key in options) {
      if (!FORBIDDEN_VARIABLE_OPTIONS.includes(key)) continue;
      return Promise.reject(
        new Error(
          `[@octokit/graphql] "${key}" cannot be used as variable name`
        )
      );
    }
  }
  const parsedOptions = typeof query === "string" ? Object.assign({ query }, options) : query;
  const requestOptions = Object.keys(
    parsedOptions
  ).reduce((result, key) => {
    if (NON_VARIABLE_OPTIONS.includes(key)) {
      result[key] = parsedOptions[key];
      return result;
    }
    if (!result.variables) {
      result.variables = {};
    }
    result.variables[key] = parsedOptions[key];
    return result;
  }, {});
  const baseUrl = parsedOptions.baseUrl || request2.endpoint.DEFAULTS.baseUrl;
  if (GHES_V3_SUFFIX_REGEX.test(baseUrl)) {
    requestOptions.url = baseUrl.replace(GHES_V3_SUFFIX_REGEX, "/api/graphql");
  }
  return request2(requestOptions).then((response) => {
    if (response.data.errors) {
      const headers = {};
      for (const key of Object.keys(response.headers)) {
        headers[key] = response.headers[key];
      }
      throw new GraphqlResponseError(
        requestOptions,
        headers,
        response.data
      );
    }
    return response.data.data;
  });
}
function withDefaults3(request2, newDefaults) {
  const newRequest = request2.defaults(newDefaults);
  const newApi = (query, options) => {
    return graphql(newRequest, query, options);
  };
  return Object.assign(newApi, {
    defaults: withDefaults3.bind(null, newRequest),
    endpoint: newRequest.endpoint
  });
}
var graphql2 = withDefaults3(request, {
  headers: {
    "user-agent": `octokit-graphql.js/${VERSION3} ${getUserAgent()}`
  },
  method: "POST",
  url: "/graphql"
});
function withCustomRequest(customRequest) {
  return withDefaults3(customRequest, {
    method: "POST",
    url: "/graphql"
  });
}

// node_modules/@octokit/auth-token/dist-bundle/index.js
var b64url = "(?:[a-zA-Z0-9_-]+)";
var sep = "\\.";
var jwtRE = new RegExp(`^${b64url}${sep}${b64url}${sep}${b64url}$`);
var isJWT = jwtRE.test.bind(jwtRE);
async function auth(token) {
  const isApp = isJWT(token);
  const isInstallation = token.startsWith("v1.") || token.startsWith("ghs_");
  const isUserToServer = token.startsWith("ghu_");
  const tokenType = isApp ? "app" : isInstallation ? "installation" : isUserToServer ? "user-to-server" : "oauth";
  return {
    type: "token",
    token,
    tokenType
  };
}
function withAuthorizationPrefix(token) {
  if (token.split(/\./).length === 3) {
    return `bearer ${token}`;
  }
  return `token ${token}`;
}
async function hook(token, request2, route, parameters) {
  const endpoint2 = request2.endpoint.merge(
    route,
    parameters
  );
  endpoint2.headers.authorization = withAuthorizationPrefix(token);
  return request2(endpoint2);
}
var createTokenAuth = function createTokenAuth2(token) {
  if (!token) {
    throw new Error("[@octokit/auth-token] No token passed to createTokenAuth");
  }
  if (typeof token !== "string") {
    throw new Error(
      "[@octokit/auth-token] Token passed to createTokenAuth is not a string"
    );
  }
  token = token.replace(/^(token|bearer) +/i, "");
  return Object.assign(auth.bind(null, token), {
    hook: hook.bind(null, token)
  });
};

// node_modules/@octokit/core/dist-src/version.js
var VERSION4 = "7.0.6";

// node_modules/@octokit/core/dist-src/index.js
var noop2 = () => {
};
var consoleWarn = console.warn.bind(console);
var consoleError = console.error.bind(console);
function createLogger(logger = {}) {
  if (typeof logger.debug !== "function") {
    logger.debug = noop2;
  }
  if (typeof logger.info !== "function") {
    logger.info = noop2;
  }
  if (typeof logger.warn !== "function") {
    logger.warn = consoleWarn;
  }
  if (typeof logger.error !== "function") {
    logger.error = consoleError;
  }
  return logger;
}
var userAgentTrail = `octokit-core.js/${VERSION4} ${getUserAgent()}`;
var Octokit = class {
  static VERSION = VERSION4;
  static defaults(defaults) {
    const OctokitWithDefaults = class extends this {
      constructor(...args) {
        const options = args[0] || {};
        if (typeof defaults === "function") {
          super(defaults(options));
          return;
        }
        super(
          Object.assign(
            {},
            defaults,
            options,
            options.userAgent && defaults.userAgent ? {
              userAgent: `${options.userAgent} ${defaults.userAgent}`
            } : null
          )
        );
      }
    };
    return OctokitWithDefaults;
  }
  static plugins = [];
  /**
   * Attach a plugin (or many) to your Octokit instance.
   *
   * @example
   * const API = Octokit.plugin(plugin1, plugin2, plugin3, ...)
   */
  static plugin(...newPlugins) {
    const currentPlugins = this.plugins;
    const NewOctokit = class extends this {
      static plugins = currentPlugins.concat(
        newPlugins.filter((plugin) => !currentPlugins.includes(plugin))
      );
    };
    return NewOctokit;
  }
  constructor(options = {}) {
    const hook2 = new before_after_hook_default.Collection();
    const requestDefaults = {
      baseUrl: request.endpoint.DEFAULTS.baseUrl,
      headers: {},
      request: Object.assign({}, options.request, {
        // @ts-ignore internal usage only, no need to type
        hook: hook2.bind(null, "request")
      }),
      mediaType: {
        previews: [],
        format: ""
      }
    };
    requestDefaults.headers["user-agent"] = options.userAgent ? `${options.userAgent} ${userAgentTrail}` : userAgentTrail;
    if (options.baseUrl) {
      requestDefaults.baseUrl = options.baseUrl;
    }
    if (options.previews) {
      requestDefaults.mediaType.previews = options.previews;
    }
    if (options.timeZone) {
      requestDefaults.headers["time-zone"] = options.timeZone;
    }
    this.request = request.defaults(requestDefaults);
    this.graphql = withCustomRequest(this.request).defaults(requestDefaults);
    this.log = createLogger(options.log);
    this.hook = hook2;
    if (!options.authStrategy) {
      if (!options.auth) {
        this.auth = async () => ({
          type: "unauthenticated"
        });
      } else {
        const auth2 = createTokenAuth(options.auth);
        hook2.wrap("request", auth2.hook);
        this.auth = auth2;
      }
    } else {
      const { authStrategy, ...otherOptions } = options;
      const auth2 = authStrategy(
        Object.assign(
          {
            request: this.request,
            log: this.log,
            // we pass the current octokit instance as well as its constructor options
            // to allow for authentication strategies that return a new octokit instance
            // that shares the same internal state as the current one. The original
            // requirement for this was the "event-octokit" authentication strategy
            // of https://github.com/probot/octokit-auth-probot.
            octokit: this,
            octokitOptions: otherOptions
          },
          options.auth
        )
      );
      hook2.wrap("request", auth2.hook);
      this.auth = auth2;
    }
    const classConstructor = this.constructor;
    for (let i = 0; i < classConstructor.plugins.length; ++i) {
      Object.assign(this, classConstructor.plugins[i](this, options));
    }
  }
  // assigned during constructor
  request;
  graphql;
  log;
  hook;
  // TODO: type `octokit.auth` based on passed options.authStrategy
  auth;
};

// node_modules/@octokit/plugin-request-log/dist-src/version.js
var VERSION5 = "6.0.0";

// node_modules/@octokit/plugin-request-log/dist-src/index.js
function requestLog(octokit) {
  octokit.hook.wrap("request", (request2, options) => {
    octokit.log.debug("request", options);
    const start = Date.now();
    const requestOptions = octokit.request.endpoint.parse(options);
    const path4 = requestOptions.url.replace(options.baseUrl, "");
    return request2(options).then((response) => {
      const requestId = response.headers["x-github-request-id"];
      octokit.log.info(
        `${requestOptions.method} ${path4} - ${response.status} with id ${requestId} in ${Date.now() - start}ms`
      );
      return response;
    }).catch((error) => {
      const requestId = error.response?.headers["x-github-request-id"] || "UNKNOWN";
      octokit.log.error(
        `${requestOptions.method} ${path4} - ${error.status} with id ${requestId} in ${Date.now() - start}ms`
      );
      throw error;
    });
  });
}
requestLog.VERSION = VERSION5;

// node_modules/@octokit/plugin-paginate-rest/dist-bundle/index.js
var VERSION6 = "0.0.0-development";
function normalizePaginatedListResponse(response) {
  if (!response.data) {
    return {
      ...response,
      data: []
    };
  }
  const responseNeedsNormalization = ("total_count" in response.data || "total_commits" in response.data) && !("url" in response.data);
  if (!responseNeedsNormalization) return response;
  const incompleteResults = response.data.incomplete_results;
  const repositorySelection = response.data.repository_selection;
  const totalCount = response.data.total_count;
  const totalCommits = response.data.total_commits;
  delete response.data.incomplete_results;
  delete response.data.repository_selection;
  delete response.data.total_count;
  delete response.data.total_commits;
  const namespaceKey = Object.keys(response.data)[0];
  const data = response.data[namespaceKey];
  response.data = data;
  if (typeof incompleteResults !== "undefined") {
    response.data.incomplete_results = incompleteResults;
  }
  if (typeof repositorySelection !== "undefined") {
    response.data.repository_selection = repositorySelection;
  }
  response.data.total_count = totalCount;
  response.data.total_commits = totalCommits;
  return response;
}
function iterator(octokit, route, parameters) {
  const options = typeof route === "function" ? route.endpoint(parameters) : octokit.request.endpoint(route, parameters);
  const requestMethod = typeof route === "function" ? route : octokit.request;
  const method = options.method;
  const headers = options.headers;
  let url = options.url;
  return {
    [Symbol.asyncIterator]: () => ({
      async next() {
        if (!url) return { done: true };
        try {
          const response = await requestMethod({ method, url, headers });
          const normalizedResponse = normalizePaginatedListResponse(response);
          url = ((normalizedResponse.headers.link || "").match(
            /<([^<>]+)>;\s*rel="next"/
          ) || [])[1];
          if (!url && "total_commits" in normalizedResponse.data) {
            const parsedUrl = new URL(normalizedResponse.url);
            const params = parsedUrl.searchParams;
            const page = parseInt(params.get("page") || "1", 10);
            const per_page = parseInt(params.get("per_page") || "250", 10);
            if (page * per_page < normalizedResponse.data.total_commits) {
              params.set("page", String(page + 1));
              url = parsedUrl.toString();
            }
          }
          return { value: normalizedResponse };
        } catch (error) {
          if (error.status !== 409) throw error;
          url = "";
          return {
            value: {
              status: 200,
              headers: {},
              data: []
            }
          };
        }
      }
    })
  };
}
function paginate(octokit, route, parameters, mapFn) {
  if (typeof parameters === "function") {
    mapFn = parameters;
    parameters = void 0;
  }
  return gather(
    octokit,
    [],
    iterator(octokit, route, parameters)[Symbol.asyncIterator](),
    mapFn
  );
}
function gather(octokit, results, iterator2, mapFn) {
  return iterator2.next().then((result) => {
    if (result.done) {
      return results;
    }
    let earlyExit = false;
    function done() {
      earlyExit = true;
    }
    results = results.concat(
      mapFn ? mapFn(result.value, done) : result.value.data
    );
    if (earlyExit) {
      return results;
    }
    return gather(octokit, results, iterator2, mapFn);
  });
}
var composePaginateRest = Object.assign(paginate, {
  iterator
});
function paginateRest(octokit) {
  return {
    paginate: Object.assign(paginate.bind(null, octokit), {
      iterator: iterator.bind(null, octokit)
    })
  };
}
paginateRest.VERSION = VERSION6;

// node_modules/@octokit/plugin-rest-endpoint-methods/dist-src/version.js
var VERSION7 = "17.0.0";

// node_modules/@octokit/plugin-rest-endpoint-methods/dist-src/generated/endpoints.js
var Endpoints = {
  actions: {
    addCustomLabelsToSelfHostedRunnerForOrg: [
      "POST /orgs/{org}/actions/runners/{runner_id}/labels"
    ],
    addCustomLabelsToSelfHostedRunnerForRepo: [
      "POST /repos/{owner}/{repo}/actions/runners/{runner_id}/labels"
    ],
    addRepoAccessToSelfHostedRunnerGroupInOrg: [
      "PUT /orgs/{org}/actions/runner-groups/{runner_group_id}/repositories/{repository_id}"
    ],
    addSelectedRepoToOrgSecret: [
      "PUT /orgs/{org}/actions/secrets/{secret_name}/repositories/{repository_id}"
    ],
    addSelectedRepoToOrgVariable: [
      "PUT /orgs/{org}/actions/variables/{name}/repositories/{repository_id}"
    ],
    approveWorkflowRun: [
      "POST /repos/{owner}/{repo}/actions/runs/{run_id}/approve"
    ],
    cancelWorkflowRun: [
      "POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel"
    ],
    createEnvironmentVariable: [
      "POST /repos/{owner}/{repo}/environments/{environment_name}/variables"
    ],
    createHostedRunnerForOrg: ["POST /orgs/{org}/actions/hosted-runners"],
    createOrUpdateEnvironmentSecret: [
      "PUT /repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}"
    ],
    createOrUpdateOrgSecret: ["PUT /orgs/{org}/actions/secrets/{secret_name}"],
    createOrUpdateRepoSecret: [
      "PUT /repos/{owner}/{repo}/actions/secrets/{secret_name}"
    ],
    createOrgVariable: ["POST /orgs/{org}/actions/variables"],
    createRegistrationTokenForOrg: [
      "POST /orgs/{org}/actions/runners/registration-token"
    ],
    createRegistrationTokenForRepo: [
      "POST /repos/{owner}/{repo}/actions/runners/registration-token"
    ],
    createRemoveTokenForOrg: ["POST /orgs/{org}/actions/runners/remove-token"],
    createRemoveTokenForRepo: [
      "POST /repos/{owner}/{repo}/actions/runners/remove-token"
    ],
    createRepoVariable: ["POST /repos/{owner}/{repo}/actions/variables"],
    createWorkflowDispatch: [
      "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches"
    ],
    deleteActionsCacheById: [
      "DELETE /repos/{owner}/{repo}/actions/caches/{cache_id}"
    ],
    deleteActionsCacheByKey: [
      "DELETE /repos/{owner}/{repo}/actions/caches{?key,ref}"
    ],
    deleteArtifact: [
      "DELETE /repos/{owner}/{repo}/actions/artifacts/{artifact_id}"
    ],
    deleteCustomImageFromOrg: [
      "DELETE /orgs/{org}/actions/hosted-runners/images/custom/{image_definition_id}"
    ],
    deleteCustomImageVersionFromOrg: [
      "DELETE /orgs/{org}/actions/hosted-runners/images/custom/{image_definition_id}/versions/{version}"
    ],
    deleteEnvironmentSecret: [
      "DELETE /repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}"
    ],
    deleteEnvironmentVariable: [
      "DELETE /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}"
    ],
    deleteHostedRunnerForOrg: [
      "DELETE /orgs/{org}/actions/hosted-runners/{hosted_runner_id}"
    ],
    deleteOrgSecret: ["DELETE /orgs/{org}/actions/secrets/{secret_name}"],
    deleteOrgVariable: ["DELETE /orgs/{org}/actions/variables/{name}"],
    deleteRepoSecret: [
      "DELETE /repos/{owner}/{repo}/actions/secrets/{secret_name}"
    ],
    deleteRepoVariable: [
      "DELETE /repos/{owner}/{repo}/actions/variables/{name}"
    ],
    deleteSelfHostedRunnerFromOrg: [
      "DELETE /orgs/{org}/actions/runners/{runner_id}"
    ],
    deleteSelfHostedRunnerFromRepo: [
      "DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}"
    ],
    deleteWorkflowRun: ["DELETE /repos/{owner}/{repo}/actions/runs/{run_id}"],
    deleteWorkflowRunLogs: [
      "DELETE /repos/{owner}/{repo}/actions/runs/{run_id}/logs"
    ],
    disableSelectedRepositoryGithubActionsOrganization: [
      "DELETE /orgs/{org}/actions/permissions/repositories/{repository_id}"
    ],
    disableWorkflow: [
      "PUT /repos/{owner}/{repo}/actions/workflows/{workflow_id}/disable"
    ],
    downloadArtifact: [
      "GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}/{archive_format}"
    ],
    downloadJobLogsForWorkflowRun: [
      "GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs"
    ],
    downloadWorkflowRunAttemptLogs: [
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/logs"
    ],
    downloadWorkflowRunLogs: [
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/logs"
    ],
    enableSelectedRepositoryGithubActionsOrganization: [
      "PUT /orgs/{org}/actions/permissions/repositories/{repository_id}"
    ],
    enableWorkflow: [
      "PUT /repos/{owner}/{repo}/actions/workflows/{workflow_id}/enable"
    ],
    forceCancelWorkflowRun: [
      "POST /repos/{owner}/{repo}/actions/runs/{run_id}/force-cancel"
    ],
    generateRunnerJitconfigForOrg: [
      "POST /orgs/{org}/actions/runners/generate-jitconfig"
    ],
    generateRunnerJitconfigForRepo: [
      "POST /repos/{owner}/{repo}/actions/runners/generate-jitconfig"
    ],
    getActionsCacheList: ["GET /repos/{owner}/{repo}/actions/caches"],
    getActionsCacheUsage: ["GET /repos/{owner}/{repo}/actions/cache/usage"],
    getActionsCacheUsageByRepoForOrg: [
      "GET /orgs/{org}/actions/cache/usage-by-repository"
    ],
    getActionsCacheUsageForOrg: ["GET /orgs/{org}/actions/cache/usage"],
    getAllowedActionsOrganization: [
      "GET /orgs/{org}/actions/permissions/selected-actions"
    ],
    getAllowedActionsRepository: [
      "GET /repos/{owner}/{repo}/actions/permissions/selected-actions"
    ],
    getArtifact: ["GET /repos/{owner}/{repo}/actions/artifacts/{artifact_id}"],
    getCustomImageForOrg: [
      "GET /orgs/{org}/actions/hosted-runners/images/custom/{image_definition_id}"
    ],
    getCustomImageVersionForOrg: [
      "GET /orgs/{org}/actions/hosted-runners/images/custom/{image_definition_id}/versions/{version}"
    ],
    getCustomOidcSubClaimForRepo: [
      "GET /repos/{owner}/{repo}/actions/oidc/customization/sub"
    ],
    getEnvironmentPublicKey: [
      "GET /repos/{owner}/{repo}/environments/{environment_name}/secrets/public-key"
    ],
    getEnvironmentSecret: [
      "GET /repos/{owner}/{repo}/environments/{environment_name}/secrets/{secret_name}"
    ],
    getEnvironmentVariable: [
      "GET /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}"
    ],
    getGithubActionsDefaultWorkflowPermissionsOrganization: [
      "GET /orgs/{org}/actions/permissions/workflow"
    ],
    getGithubActionsDefaultWorkflowPermissionsRepository: [
      "GET /repos/{owner}/{repo}/actions/permissions/workflow"
    ],
    getGithubActionsPermissionsOrganization: [
      "GET /orgs/{org}/actions/permissions"
    ],
    getGithubActionsPermissionsRepository: [
      "GET /repos/{owner}/{repo}/actions/permissions"
    ],
    getHostedRunnerForOrg: [
      "GET /orgs/{org}/actions/hosted-runners/{hosted_runner_id}"
    ],
    getHostedRunnersGithubOwnedImagesForOrg: [
      "GET /orgs/{org}/actions/hosted-runners/images/github-owned"
    ],
    getHostedRunnersLimitsForOrg: [
      "GET /orgs/{org}/actions/hosted-runners/limits"
    ],
    getHostedRunnersMachineSpecsForOrg: [
      "GET /orgs/{org}/actions/hosted-runners/machine-sizes"
    ],
    getHostedRunnersPartnerImagesForOrg: [
      "GET /orgs/{org}/actions/hosted-runners/images/partner"
    ],
    getHostedRunnersPlatformsForOrg: [
      "GET /orgs/{org}/actions/hosted-runners/platforms"
    ],
    getJobForWorkflowRun: ["GET /repos/{owner}/{repo}/actions/jobs/{job_id}"],
    getOrgPublicKey: ["GET /orgs/{org}/actions/secrets/public-key"],
    getOrgSecret: ["GET /orgs/{org}/actions/secrets/{secret_name}"],
    getOrgVariable: ["GET /orgs/{org}/actions/variables/{name}"],
    getPendingDeploymentsForRun: [
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments"
    ],
    getRepoPermissions: [
      "GET /repos/{owner}/{repo}/actions/permissions",
      {},
      { renamed: ["actions", "getGithubActionsPermissionsRepository"] }
    ],
    getRepoPublicKey: ["GET /repos/{owner}/{repo}/actions/secrets/public-key"],
    getRepoSecret: ["GET /repos/{owner}/{repo}/actions/secrets/{secret_name}"],
    getRepoVariable: ["GET /repos/{owner}/{repo}/actions/variables/{name}"],
    getReviewsForRun: [
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/approvals"
    ],
    getSelfHostedRunnerForOrg: ["GET /orgs/{org}/actions/runners/{runner_id}"],
    getSelfHostedRunnerForRepo: [
      "GET /repos/{owner}/{repo}/actions/runners/{runner_id}"
    ],
    getWorkflow: ["GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}"],
    getWorkflowAccessToRepository: [
      "GET /repos/{owner}/{repo}/actions/permissions/access"
    ],
    getWorkflowRun: ["GET /repos/{owner}/{repo}/actions/runs/{run_id}"],
    getWorkflowRunAttempt: [
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}"
    ],
    getWorkflowRunUsage: [
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/timing"
    ],
    getWorkflowUsage: [
      "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/timing"
    ],
    listArtifactsForRepo: ["GET /repos/{owner}/{repo}/actions/artifacts"],
    listCustomImageVersionsForOrg: [
      "GET /orgs/{org}/actions/hosted-runners/images/custom/{image_definition_id}/versions"
    ],
    listCustomImagesForOrg: [
      "GET /orgs/{org}/actions/hosted-runners/images/custom"
    ],
    listEnvironmentSecrets: [
      "GET /repos/{owner}/{repo}/environments/{environment_name}/secrets"
    ],
    listEnvironmentVariables: [
      "GET /repos/{owner}/{repo}/environments/{environment_name}/variables"
    ],
    listGithubHostedRunnersInGroupForOrg: [
      "GET /orgs/{org}/actions/runner-groups/{runner_group_id}/hosted-runners"
    ],
    listHostedRunnersForOrg: ["GET /orgs/{org}/actions/hosted-runners"],
    listJobsForWorkflowRun: [
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs"
    ],
    listJobsForWorkflowRunAttempt: [
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs"
    ],
    listLabelsForSelfHostedRunnerForOrg: [
      "GET /orgs/{org}/actions/runners/{runner_id}/labels"
    ],
    listLabelsForSelfHostedRunnerForRepo: [
      "GET /repos/{owner}/{repo}/actions/runners/{runner_id}/labels"
    ],
    listOrgSecrets: ["GET /orgs/{org}/actions/secrets"],
    listOrgVariables: ["GET /orgs/{org}/actions/variables"],
    listRepoOrganizationSecrets: [
      "GET /repos/{owner}/{repo}/actions/organization-secrets"
    ],
    listRepoOrganizationVariables: [
      "GET /repos/{owner}/{repo}/actions/organization-variables"
    ],
    listRepoSecrets: ["GET /repos/{owner}/{repo}/actions/secrets"],
    listRepoVariables: ["GET /repos/{owner}/{repo}/actions/variables"],
    listRepoWorkflows: ["GET /repos/{owner}/{repo}/actions/workflows"],
    listRunnerApplicationsForOrg: ["GET /orgs/{org}/actions/runners/downloads"],
    listRunnerApplicationsForRepo: [
      "GET /repos/{owner}/{repo}/actions/runners/downloads"
    ],
    listSelectedReposForOrgSecret: [
      "GET /orgs/{org}/actions/secrets/{secret_name}/repositories"
    ],
    listSelectedReposForOrgVariable: [
      "GET /orgs/{org}/actions/variables/{name}/repositories"
    ],
    listSelectedRepositoriesEnabledGithubActionsOrganization: [
      "GET /orgs/{org}/actions/permissions/repositories"
    ],
    listSelfHostedRunnersForOrg: ["GET /orgs/{org}/actions/runners"],
    listSelfHostedRunnersForRepo: ["GET /repos/{owner}/{repo}/actions/runners"],
    listWorkflowRunArtifacts: [
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts"
    ],
    listWorkflowRuns: [
      "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs"
    ],
    listWorkflowRunsForRepo: ["GET /repos/{owner}/{repo}/actions/runs"],
    reRunJobForWorkflowRun: [
      "POST /repos/{owner}/{repo}/actions/jobs/{job_id}/rerun"
    ],
    reRunWorkflow: ["POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun"],
    reRunWorkflowFailedJobs: [
      "POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs"
    ],
    removeAllCustomLabelsFromSelfHostedRunnerForOrg: [
      "DELETE /orgs/{org}/actions/runners/{runner_id}/labels"
    ],
    removeAllCustomLabelsFromSelfHostedRunnerForRepo: [
      "DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}/labels"
    ],
    removeCustomLabelFromSelfHostedRunnerForOrg: [
      "DELETE /orgs/{org}/actions/runners/{runner_id}/labels/{name}"
    ],
    removeCustomLabelFromSelfHostedRunnerForRepo: [
      "DELETE /repos/{owner}/{repo}/actions/runners/{runner_id}/labels/{name}"
    ],
    removeSelectedRepoFromOrgSecret: [
      "DELETE /orgs/{org}/actions/secrets/{secret_name}/repositories/{repository_id}"
    ],
    removeSelectedRepoFromOrgVariable: [
      "DELETE /orgs/{org}/actions/variables/{name}/repositories/{repository_id}"
    ],
    reviewCustomGatesForRun: [
      "POST /repos/{owner}/{repo}/actions/runs/{run_id}/deployment_protection_rule"
    ],
    reviewPendingDeploymentsForRun: [
      "POST /repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments"
    ],
    setAllowedActionsOrganization: [
      "PUT /orgs/{org}/actions/permissions/selected-actions"
    ],
    setAllowedActionsRepository: [
      "PUT /repos/{owner}/{repo}/actions/permissions/selected-actions"
    ],
    setCustomLabelsForSelfHostedRunnerForOrg: [
      "PUT /orgs/{org}/actions/runners/{runner_id}/labels"
    ],
    setCustomLabelsForSelfHostedRunnerForRepo: [
      "PUT /repos/{owner}/{repo}/actions/runners/{runner_id}/labels"
    ],
    setCustomOidcSubClaimForRepo: [
      "PUT /repos/{owner}/{repo}/actions/oidc/customization/sub"
    ],
    setGithubActionsDefaultWorkflowPermissionsOrganization: [
      "PUT /orgs/{org}/actions/permissions/workflow"
    ],
    setGithubActionsDefaultWorkflowPermissionsRepository: [
      "PUT /repos/{owner}/{repo}/actions/permissions/workflow"
    ],
    setGithubActionsPermissionsOrganization: [
      "PUT /orgs/{org}/actions/permissions"
    ],
    setGithubActionsPermissionsRepository: [
      "PUT /repos/{owner}/{repo}/actions/permissions"
    ],
    setSelectedReposForOrgSecret: [
      "PUT /orgs/{org}/actions/secrets/{secret_name}/repositories"
    ],
    setSelectedReposForOrgVariable: [
      "PUT /orgs/{org}/actions/variables/{name}/repositories"
    ],
    setSelectedRepositoriesEnabledGithubActionsOrganization: [
      "PUT /orgs/{org}/actions/permissions/repositories"
    ],
    setWorkflowAccessToRepository: [
      "PUT /repos/{owner}/{repo}/actions/permissions/access"
    ],
    updateEnvironmentVariable: [
      "PATCH /repos/{owner}/{repo}/environments/{environment_name}/variables/{name}"
    ],
    updateHostedRunnerForOrg: [
      "PATCH /orgs/{org}/actions/hosted-runners/{hosted_runner_id}"
    ],
    updateOrgVariable: ["PATCH /orgs/{org}/actions/variables/{name}"],
    updateRepoVariable: [
      "PATCH /repos/{owner}/{repo}/actions/variables/{name}"
    ]
  },
  activity: {
    checkRepoIsStarredByAuthenticatedUser: ["GET /user/starred/{owner}/{repo}"],
    deleteRepoSubscription: ["DELETE /repos/{owner}/{repo}/subscription"],
    deleteThreadSubscription: [
      "DELETE /notifications/threads/{thread_id}/subscription"
    ],
    getFeeds: ["GET /feeds"],
    getRepoSubscription: ["GET /repos/{owner}/{repo}/subscription"],
    getThread: ["GET /notifications/threads/{thread_id}"],
    getThreadSubscriptionForAuthenticatedUser: [
      "GET /notifications/threads/{thread_id}/subscription"
    ],
    listEventsForAuthenticatedUser: ["GET /users/{username}/events"],
    listNotificationsForAuthenticatedUser: ["GET /notifications"],
    listOrgEventsForAuthenticatedUser: [
      "GET /users/{username}/events/orgs/{org}"
    ],
    listPublicEvents: ["GET /events"],
    listPublicEventsForRepoNetwork: ["GET /networks/{owner}/{repo}/events"],
    listPublicEventsForUser: ["GET /users/{username}/events/public"],
    listPublicOrgEvents: ["GET /orgs/{org}/events"],
    listReceivedEventsForUser: ["GET /users/{username}/received_events"],
    listReceivedPublicEventsForUser: [
      "GET /users/{username}/received_events/public"
    ],
    listRepoEvents: ["GET /repos/{owner}/{repo}/events"],
    listRepoNotificationsForAuthenticatedUser: [
      "GET /repos/{owner}/{repo}/notifications"
    ],
    listReposStarredByAuthenticatedUser: ["GET /user/starred"],
    listReposStarredByUser: ["GET /users/{username}/starred"],
    listReposWatchedByUser: ["GET /users/{username}/subscriptions"],
    listStargazersForRepo: ["GET /repos/{owner}/{repo}/stargazers"],
    listWatchedReposForAuthenticatedUser: ["GET /user/subscriptions"],
    listWatchersForRepo: ["GET /repos/{owner}/{repo}/subscribers"],
    markNotificationsAsRead: ["PUT /notifications"],
    markRepoNotificationsAsRead: ["PUT /repos/{owner}/{repo}/notifications"],
    markThreadAsDone: ["DELETE /notifications/threads/{thread_id}"],
    markThreadAsRead: ["PATCH /notifications/threads/{thread_id}"],
    setRepoSubscription: ["PUT /repos/{owner}/{repo}/subscription"],
    setThreadSubscription: [
      "PUT /notifications/threads/{thread_id}/subscription"
    ],
    starRepoForAuthenticatedUser: ["PUT /user/starred/{owner}/{repo}"],
    unstarRepoForAuthenticatedUser: ["DELETE /user/starred/{owner}/{repo}"]
  },
  apps: {
    addRepoToInstallation: [
      "PUT /user/installations/{installation_id}/repositories/{repository_id}",
      {},
      { renamed: ["apps", "addRepoToInstallationForAuthenticatedUser"] }
    ],
    addRepoToInstallationForAuthenticatedUser: [
      "PUT /user/installations/{installation_id}/repositories/{repository_id}"
    ],
    checkToken: ["POST /applications/{client_id}/token"],
    createFromManifest: ["POST /app-manifests/{code}/conversions"],
    createInstallationAccessToken: [
      "POST /app/installations/{installation_id}/access_tokens"
    ],
    deleteAuthorization: ["DELETE /applications/{client_id}/grant"],
    deleteInstallation: ["DELETE /app/installations/{installation_id}"],
    deleteToken: ["DELETE /applications/{client_id}/token"],
    getAuthenticated: ["GET /app"],
    getBySlug: ["GET /apps/{app_slug}"],
    getInstallation: ["GET /app/installations/{installation_id}"],
    getOrgInstallation: ["GET /orgs/{org}/installation"],
    getRepoInstallation: ["GET /repos/{owner}/{repo}/installation"],
    getSubscriptionPlanForAccount: [
      "GET /marketplace_listing/accounts/{account_id}"
    ],
    getSubscriptionPlanForAccountStubbed: [
      "GET /marketplace_listing/stubbed/accounts/{account_id}"
    ],
    getUserInstallation: ["GET /users/{username}/installation"],
    getWebhookConfigForApp: ["GET /app/hook/config"],
    getWebhookDelivery: ["GET /app/hook/deliveries/{delivery_id}"],
    listAccountsForPlan: ["GET /marketplace_listing/plans/{plan_id}/accounts"],
    listAccountsForPlanStubbed: [
      "GET /marketplace_listing/stubbed/plans/{plan_id}/accounts"
    ],
    listInstallationReposForAuthenticatedUser: [
      "GET /user/installations/{installation_id}/repositories"
    ],
    listInstallationRequestsForAuthenticatedApp: [
      "GET /app/installation-requests"
    ],
    listInstallations: ["GET /app/installations"],
    listInstallationsForAuthenticatedUser: ["GET /user/installations"],
    listPlans: ["GET /marketplace_listing/plans"],
    listPlansStubbed: ["GET /marketplace_listing/stubbed/plans"],
    listReposAccessibleToInstallation: ["GET /installation/repositories"],
    listSubscriptionsForAuthenticatedUser: ["GET /user/marketplace_purchases"],
    listSubscriptionsForAuthenticatedUserStubbed: [
      "GET /user/marketplace_purchases/stubbed"
    ],
    listWebhookDeliveries: ["GET /app/hook/deliveries"],
    redeliverWebhookDelivery: [
      "POST /app/hook/deliveries/{delivery_id}/attempts"
    ],
    removeRepoFromInstallation: [
      "DELETE /user/installations/{installation_id}/repositories/{repository_id}",
      {},
      { renamed: ["apps", "removeRepoFromInstallationForAuthenticatedUser"] }
    ],
    removeRepoFromInstallationForAuthenticatedUser: [
      "DELETE /user/installations/{installation_id}/repositories/{repository_id}"
    ],
    resetToken: ["PATCH /applications/{client_id}/token"],
    revokeInstallationAccessToken: ["DELETE /installation/token"],
    scopeToken: ["POST /applications/{client_id}/token/scoped"],
    suspendInstallation: ["PUT /app/installations/{installation_id}/suspended"],
    unsuspendInstallation: [
      "DELETE /app/installations/{installation_id}/suspended"
    ],
    updateWebhookConfigForApp: ["PATCH /app/hook/config"]
  },
  billing: {
    getGithubActionsBillingOrg: ["GET /orgs/{org}/settings/billing/actions"],
    getGithubActionsBillingUser: [
      "GET /users/{username}/settings/billing/actions"
    ],
    getGithubBillingPremiumRequestUsageReportOrg: [
      "GET /organizations/{org}/settings/billing/premium_request/usage"
    ],
    getGithubBillingPremiumRequestUsageReportUser: [
      "GET /users/{username}/settings/billing/premium_request/usage"
    ],
    getGithubBillingUsageReportOrg: [
      "GET /organizations/{org}/settings/billing/usage"
    ],
    getGithubBillingUsageReportUser: [
      "GET /users/{username}/settings/billing/usage"
    ],
    getGithubPackagesBillingOrg: ["GET /orgs/{org}/settings/billing/packages"],
    getGithubPackagesBillingUser: [
      "GET /users/{username}/settings/billing/packages"
    ],
    getSharedStorageBillingOrg: [
      "GET /orgs/{org}/settings/billing/shared-storage"
    ],
    getSharedStorageBillingUser: [
      "GET /users/{username}/settings/billing/shared-storage"
    ]
  },
  campaigns: {
    createCampaign: ["POST /orgs/{org}/campaigns"],
    deleteCampaign: ["DELETE /orgs/{org}/campaigns/{campaign_number}"],
    getCampaignSummary: ["GET /orgs/{org}/campaigns/{campaign_number}"],
    listOrgCampaigns: ["GET /orgs/{org}/campaigns"],
    updateCampaign: ["PATCH /orgs/{org}/campaigns/{campaign_number}"]
  },
  checks: {
    create: ["POST /repos/{owner}/{repo}/check-runs"],
    createSuite: ["POST /repos/{owner}/{repo}/check-suites"],
    get: ["GET /repos/{owner}/{repo}/check-runs/{check_run_id}"],
    getSuite: ["GET /repos/{owner}/{repo}/check-suites/{check_suite_id}"],
    listAnnotations: [
      "GET /repos/{owner}/{repo}/check-runs/{check_run_id}/annotations"
    ],
    listForRef: ["GET /repos/{owner}/{repo}/commits/{ref}/check-runs"],
    listForSuite: [
      "GET /repos/{owner}/{repo}/check-suites/{check_suite_id}/check-runs"
    ],
    listSuitesForRef: ["GET /repos/{owner}/{repo}/commits/{ref}/check-suites"],
    rerequestRun: [
      "POST /repos/{owner}/{repo}/check-runs/{check_run_id}/rerequest"
    ],
    rerequestSuite: [
      "POST /repos/{owner}/{repo}/check-suites/{check_suite_id}/rerequest"
    ],
    setSuitesPreferences: [
      "PATCH /repos/{owner}/{repo}/check-suites/preferences"
    ],
    update: ["PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}"]
  },
  codeScanning: {
    commitAutofix: [
      "POST /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}/autofix/commits"
    ],
    createAutofix: [
      "POST /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}/autofix"
    ],
    createVariantAnalysis: [
      "POST /repos/{owner}/{repo}/code-scanning/codeql/variant-analyses"
    ],
    deleteAnalysis: [
      "DELETE /repos/{owner}/{repo}/code-scanning/analyses/{analysis_id}{?confirm_delete}"
    ],
    deleteCodeqlDatabase: [
      "DELETE /repos/{owner}/{repo}/code-scanning/codeql/databases/{language}"
    ],
    getAlert: [
      "GET /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}",
      {},
      { renamedParameters: { alert_id: "alert_number" } }
    ],
    getAnalysis: [
      "GET /repos/{owner}/{repo}/code-scanning/analyses/{analysis_id}"
    ],
    getAutofix: [
      "GET /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}/autofix"
    ],
    getCodeqlDatabase: [
      "GET /repos/{owner}/{repo}/code-scanning/codeql/databases/{language}"
    ],
    getDefaultSetup: ["GET /repos/{owner}/{repo}/code-scanning/default-setup"],
    getSarif: ["GET /repos/{owner}/{repo}/code-scanning/sarifs/{sarif_id}"],
    getVariantAnalysis: [
      "GET /repos/{owner}/{repo}/code-scanning/codeql/variant-analyses/{codeql_variant_analysis_id}"
    ],
    getVariantAnalysisRepoTask: [
      "GET /repos/{owner}/{repo}/code-scanning/codeql/variant-analyses/{codeql_variant_analysis_id}/repos/{repo_owner}/{repo_name}"
    ],
    listAlertInstances: [
      "GET /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}/instances"
    ],
    listAlertsForOrg: ["GET /orgs/{org}/code-scanning/alerts"],
    listAlertsForRepo: ["GET /repos/{owner}/{repo}/code-scanning/alerts"],
    listAlertsInstances: [
      "GET /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}/instances",
      {},
      { renamed: ["codeScanning", "listAlertInstances"] }
    ],
    listCodeqlDatabases: [
      "GET /repos/{owner}/{repo}/code-scanning/codeql/databases"
    ],
    listRecentAnalyses: ["GET /repos/{owner}/{repo}/code-scanning/analyses"],
    updateAlert: [
      "PATCH /repos/{owner}/{repo}/code-scanning/alerts/{alert_number}"
    ],
    updateDefaultSetup: [
      "PATCH /repos/{owner}/{repo}/code-scanning/default-setup"
    ],
    uploadSarif: ["POST /repos/{owner}/{repo}/code-scanning/sarifs"]
  },
  codeSecurity: {
    attachConfiguration: [
      "POST /orgs/{org}/code-security/configurations/{configuration_id}/attach"
    ],
    attachEnterpriseConfiguration: [
      "POST /enterprises/{enterprise}/code-security/configurations/{configuration_id}/attach"
    ],
    createConfiguration: ["POST /orgs/{org}/code-security/configurations"],
    createConfigurationForEnterprise: [
      "POST /enterprises/{enterprise}/code-security/configurations"
    ],
    deleteConfiguration: [
      "DELETE /orgs/{org}/code-security/configurations/{configuration_id}"
    ],
    deleteConfigurationForEnterprise: [
      "DELETE /enterprises/{enterprise}/code-security/configurations/{configuration_id}"
    ],
    detachConfiguration: [
      "DELETE /orgs/{org}/code-security/configurations/detach"
    ],
    getConfiguration: [
      "GET /orgs/{org}/code-security/configurations/{configuration_id}"
    ],
    getConfigurationForRepository: [
      "GET /repos/{owner}/{repo}/code-security-configuration"
    ],
    getConfigurationsForEnterprise: [
      "GET /enterprises/{enterprise}/code-security/configurations"
    ],
    getConfigurationsForOrg: ["GET /orgs/{org}/code-security/configurations"],
    getDefaultConfigurations: [
      "GET /orgs/{org}/code-security/configurations/defaults"
    ],
    getDefaultConfigurationsForEnterprise: [
      "GET /enterprises/{enterprise}/code-security/configurations/defaults"
    ],
    getRepositoriesForConfiguration: [
      "GET /orgs/{org}/code-security/configurations/{configuration_id}/repositories"
    ],
    getRepositoriesForEnterpriseConfiguration: [
      "GET /enterprises/{enterprise}/code-security/configurations/{configuration_id}/repositories"
    ],
    getSingleConfigurationForEnterprise: [
      "GET /enterprises/{enterprise}/code-security/configurations/{configuration_id}"
    ],
    setConfigurationAsDefault: [
      "PUT /orgs/{org}/code-security/configurations/{configuration_id}/defaults"
    ],
    setConfigurationAsDefaultForEnterprise: [
      "PUT /enterprises/{enterprise}/code-security/configurations/{configuration_id}/defaults"
    ],
    updateConfiguration: [
      "PATCH /orgs/{org}/code-security/configurations/{configuration_id}"
    ],
    updateEnterpriseConfiguration: [
      "PATCH /enterprises/{enterprise}/code-security/configurations/{configuration_id}"
    ]
  },
  codesOfConduct: {
    getAllCodesOfConduct: ["GET /codes_of_conduct"],
    getConductCode: ["GET /codes_of_conduct/{key}"]
  },
  codespaces: {
    addRepositoryForSecretForAuthenticatedUser: [
      "PUT /user/codespaces/secrets/{secret_name}/repositories/{repository_id}"
    ],
    addSelectedRepoToOrgSecret: [
      "PUT /orgs/{org}/codespaces/secrets/{secret_name}/repositories/{repository_id}"
    ],
    checkPermissionsForDevcontainer: [
      "GET /repos/{owner}/{repo}/codespaces/permissions_check"
    ],
    codespaceMachinesForAuthenticatedUser: [
      "GET /user/codespaces/{codespace_name}/machines"
    ],
    createForAuthenticatedUser: ["POST /user/codespaces"],
    createOrUpdateOrgSecret: [
      "PUT /orgs/{org}/codespaces/secrets/{secret_name}"
    ],
    createOrUpdateRepoSecret: [
      "PUT /repos/{owner}/{repo}/codespaces/secrets/{secret_name}"
    ],
    createOrUpdateSecretForAuthenticatedUser: [
      "PUT /user/codespaces/secrets/{secret_name}"
    ],
    createWithPrForAuthenticatedUser: [
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/codespaces"
    ],
    createWithRepoForAuthenticatedUser: [
      "POST /repos/{owner}/{repo}/codespaces"
    ],
    deleteForAuthenticatedUser: ["DELETE /user/codespaces/{codespace_name}"],
    deleteFromOrganization: [
      "DELETE /orgs/{org}/members/{username}/codespaces/{codespace_name}"
    ],
    deleteOrgSecret: ["DELETE /orgs/{org}/codespaces/secrets/{secret_name}"],
    deleteRepoSecret: [
      "DELETE /repos/{owner}/{repo}/codespaces/secrets/{secret_name}"
    ],
    deleteSecretForAuthenticatedUser: [
      "DELETE /user/codespaces/secrets/{secret_name}"
    ],
    exportForAuthenticatedUser: [
      "POST /user/codespaces/{codespace_name}/exports"
    ],
    getCodespacesForUserInOrg: [
      "GET /orgs/{org}/members/{username}/codespaces"
    ],
    getExportDetailsForAuthenticatedUser: [
      "GET /user/codespaces/{codespace_name}/exports/{export_id}"
    ],
    getForAuthenticatedUser: ["GET /user/codespaces/{codespace_name}"],
    getOrgPublicKey: ["GET /orgs/{org}/codespaces/secrets/public-key"],
    getOrgSecret: ["GET /orgs/{org}/codespaces/secrets/{secret_name}"],
    getPublicKeyForAuthenticatedUser: [
      "GET /user/codespaces/secrets/public-key"
    ],
    getRepoPublicKey: [
      "GET /repos/{owner}/{repo}/codespaces/secrets/public-key"
    ],
    getRepoSecret: [
      "GET /repos/{owner}/{repo}/codespaces/secrets/{secret_name}"
    ],
    getSecretForAuthenticatedUser: [
      "GET /user/codespaces/secrets/{secret_name}"
    ],
    listDevcontainersInRepositoryForAuthenticatedUser: [
      "GET /repos/{owner}/{repo}/codespaces/devcontainers"
    ],
    listForAuthenticatedUser: ["GET /user/codespaces"],
    listInOrganization: [
      "GET /orgs/{org}/codespaces",
      {},
      { renamedParameters: { org_id: "org" } }
    ],
    listInRepositoryForAuthenticatedUser: [
      "GET /repos/{owner}/{repo}/codespaces"
    ],
    listOrgSecrets: ["GET /orgs/{org}/codespaces/secrets"],
    listRepoSecrets: ["GET /repos/{owner}/{repo}/codespaces/secrets"],
    listRepositoriesForSecretForAuthenticatedUser: [
      "GET /user/codespaces/secrets/{secret_name}/repositories"
    ],
    listSecretsForAuthenticatedUser: ["GET /user/codespaces/secrets"],
    listSelectedReposForOrgSecret: [
      "GET /orgs/{org}/codespaces/secrets/{secret_name}/repositories"
    ],
    preFlightWithRepoForAuthenticatedUser: [
      "GET /repos/{owner}/{repo}/codespaces/new"
    ],
    publishForAuthenticatedUser: [
      "POST /user/codespaces/{codespace_name}/publish"
    ],
    removeRepositoryForSecretForAuthenticatedUser: [
      "DELETE /user/codespaces/secrets/{secret_name}/repositories/{repository_id}"
    ],
    removeSelectedRepoFromOrgSecret: [
      "DELETE /orgs/{org}/codespaces/secrets/{secret_name}/repositories/{repository_id}"
    ],
    repoMachinesForAuthenticatedUser: [
      "GET /repos/{owner}/{repo}/codespaces/machines"
    ],
    setRepositoriesForSecretForAuthenticatedUser: [
      "PUT /user/codespaces/secrets/{secret_name}/repositories"
    ],
    setSelectedReposForOrgSecret: [
      "PUT /orgs/{org}/codespaces/secrets/{secret_name}/repositories"
    ],
    startForAuthenticatedUser: ["POST /user/codespaces/{codespace_name}/start"],
    stopForAuthenticatedUser: ["POST /user/codespaces/{codespace_name}/stop"],
    stopInOrganization: [
      "POST /orgs/{org}/members/{username}/codespaces/{codespace_name}/stop"
    ],
    updateForAuthenticatedUser: ["PATCH /user/codespaces/{codespace_name}"]
  },
  copilot: {
    addCopilotSeatsForTeams: [
      "POST /orgs/{org}/copilot/billing/selected_teams"
    ],
    addCopilotSeatsForUsers: [
      "POST /orgs/{org}/copilot/billing/selected_users"
    ],
    cancelCopilotSeatAssignmentForTeams: [
      "DELETE /orgs/{org}/copilot/billing/selected_teams"
    ],
    cancelCopilotSeatAssignmentForUsers: [
      "DELETE /orgs/{org}/copilot/billing/selected_users"
    ],
    copilotMetricsForOrganization: ["GET /orgs/{org}/copilot/metrics"],
    copilotMetricsForTeam: ["GET /orgs/{org}/team/{team_slug}/copilot/metrics"],
    getCopilotOrganizationDetails: ["GET /orgs/{org}/copilot/billing"],
    getCopilotSeatDetailsForUser: [
      "GET /orgs/{org}/members/{username}/copilot"
    ],
    listCopilotSeats: ["GET /orgs/{org}/copilot/billing/seats"]
  },
  credentials: { revoke: ["POST /credentials/revoke"] },
  dependabot: {
    addSelectedRepoToOrgSecret: [
      "PUT /orgs/{org}/dependabot/secrets/{secret_name}/repositories/{repository_id}"
    ],
    createOrUpdateOrgSecret: [
      "PUT /orgs/{org}/dependabot/secrets/{secret_name}"
    ],
    createOrUpdateRepoSecret: [
      "PUT /repos/{owner}/{repo}/dependabot/secrets/{secret_name}"
    ],
    deleteOrgSecret: ["DELETE /orgs/{org}/dependabot/secrets/{secret_name}"],
    deleteRepoSecret: [
      "DELETE /repos/{owner}/{repo}/dependabot/secrets/{secret_name}"
    ],
    getAlert: ["GET /repos/{owner}/{repo}/dependabot/alerts/{alert_number}"],
    getOrgPublicKey: ["GET /orgs/{org}/dependabot/secrets/public-key"],
    getOrgSecret: ["GET /orgs/{org}/dependabot/secrets/{secret_name}"],
    getRepoPublicKey: [
      "GET /repos/{owner}/{repo}/dependabot/secrets/public-key"
    ],
    getRepoSecret: [
      "GET /repos/{owner}/{repo}/dependabot/secrets/{secret_name}"
    ],
    listAlertsForEnterprise: [
      "GET /enterprises/{enterprise}/dependabot/alerts"
    ],
    listAlertsForOrg: ["GET /orgs/{org}/dependabot/alerts"],
    listAlertsForRepo: ["GET /repos/{owner}/{repo}/dependabot/alerts"],
    listOrgSecrets: ["GET /orgs/{org}/dependabot/secrets"],
    listRepoSecrets: ["GET /repos/{owner}/{repo}/dependabot/secrets"],
    listSelectedReposForOrgSecret: [
      "GET /orgs/{org}/dependabot/secrets/{secret_name}/repositories"
    ],
    removeSelectedRepoFromOrgSecret: [
      "DELETE /orgs/{org}/dependabot/secrets/{secret_name}/repositories/{repository_id}"
    ],
    repositoryAccessForOrg: [
      "GET /organizations/{org}/dependabot/repository-access"
    ],
    setRepositoryAccessDefaultLevel: [
      "PUT /organizations/{org}/dependabot/repository-access/default-level"
    ],
    setSelectedReposForOrgSecret: [
      "PUT /orgs/{org}/dependabot/secrets/{secret_name}/repositories"
    ],
    updateAlert: [
      "PATCH /repos/{owner}/{repo}/dependabot/alerts/{alert_number}"
    ],
    updateRepositoryAccessForOrg: [
      "PATCH /organizations/{org}/dependabot/repository-access"
    ]
  },
  dependencyGraph: {
    createRepositorySnapshot: [
      "POST /repos/{owner}/{repo}/dependency-graph/snapshots"
    ],
    diffRange: [
      "GET /repos/{owner}/{repo}/dependency-graph/compare/{basehead}"
    ],
    exportSbom: ["GET /repos/{owner}/{repo}/dependency-graph/sbom"]
  },
  emojis: { get: ["GET /emojis"] },
  enterpriseTeamMemberships: {
    add: [
      "PUT /enterprises/{enterprise}/teams/{enterprise-team}/memberships/{username}"
    ],
    bulkAdd: [
      "POST /enterprises/{enterprise}/teams/{enterprise-team}/memberships/add"
    ],
    bulkRemove: [
      "POST /enterprises/{enterprise}/teams/{enterprise-team}/memberships/remove"
    ],
    get: [
      "GET /enterprises/{enterprise}/teams/{enterprise-team}/memberships/{username}"
    ],
    list: ["GET /enterprises/{enterprise}/teams/{enterprise-team}/memberships"],
    remove: [
      "DELETE /enterprises/{enterprise}/teams/{enterprise-team}/memberships/{username}"
    ]
  },
  enterpriseTeamOrganizations: {
    add: [
      "PUT /enterprises/{enterprise}/teams/{enterprise-team}/organizations/{org}"
    ],
    bulkAdd: [
      "POST /enterprises/{enterprise}/teams/{enterprise-team}/organizations/add"
    ],
    bulkRemove: [
      "POST /enterprises/{enterprise}/teams/{enterprise-team}/organizations/remove"
    ],
    delete: [
      "DELETE /enterprises/{enterprise}/teams/{enterprise-team}/organizations/{org}"
    ],
    getAssignment: [
      "GET /enterprises/{enterprise}/teams/{enterprise-team}/organizations/{org}"
    ],
    getAssignments: [
      "GET /enterprises/{enterprise}/teams/{enterprise-team}/organizations"
    ]
  },
  enterpriseTeams: {
    create: ["POST /enterprises/{enterprise}/teams"],
    delete: ["DELETE /enterprises/{enterprise}/teams/{team_slug}"],
    get: ["GET /enterprises/{enterprise}/teams/{team_slug}"],
    list: ["GET /enterprises/{enterprise}/teams"],
    update: ["PATCH /enterprises/{enterprise}/teams/{team_slug}"]
  },
  gists: {
    checkIsStarred: ["GET /gists/{gist_id}/star"],
    create: ["POST /gists"],
    createComment: ["POST /gists/{gist_id}/comments"],
    delete: ["DELETE /gists/{gist_id}"],
    deleteComment: ["DELETE /gists/{gist_id}/comments/{comment_id}"],
    fork: ["POST /gists/{gist_id}/forks"],
    get: ["GET /gists/{gist_id}"],
    getComment: ["GET /gists/{gist_id}/comments/{comment_id}"],
    getRevision: ["GET /gists/{gist_id}/{sha}"],
    list: ["GET /gists"],
    listComments: ["GET /gists/{gist_id}/comments"],
    listCommits: ["GET /gists/{gist_id}/commits"],
    listForUser: ["GET /users/{username}/gists"],
    listForks: ["GET /gists/{gist_id}/forks"],
    listPublic: ["GET /gists/public"],
    listStarred: ["GET /gists/starred"],
    star: ["PUT /gists/{gist_id}/star"],
    unstar: ["DELETE /gists/{gist_id}/star"],
    update: ["PATCH /gists/{gist_id}"],
    updateComment: ["PATCH /gists/{gist_id}/comments/{comment_id}"]
  },
  git: {
    createBlob: ["POST /repos/{owner}/{repo}/git/blobs"],
    createCommit: ["POST /repos/{owner}/{repo}/git/commits"],
    createRef: ["POST /repos/{owner}/{repo}/git/refs"],
    createTag: ["POST /repos/{owner}/{repo}/git/tags"],
    createTree: ["POST /repos/{owner}/{repo}/git/trees"],
    deleteRef: ["DELETE /repos/{owner}/{repo}/git/refs/{ref}"],
    getBlob: ["GET /repos/{owner}/{repo}/git/blobs/{file_sha}"],
    getCommit: ["GET /repos/{owner}/{repo}/git/commits/{commit_sha}"],
    getRef: ["GET /repos/{owner}/{repo}/git/ref/{ref}"],
    getTag: ["GET /repos/{owner}/{repo}/git/tags/{tag_sha}"],
    getTree: ["GET /repos/{owner}/{repo}/git/trees/{tree_sha}"],
    listMatchingRefs: ["GET /repos/{owner}/{repo}/git/matching-refs/{ref}"],
    updateRef: ["PATCH /repos/{owner}/{repo}/git/refs/{ref}"]
  },
  gitignore: {
    getAllTemplates: ["GET /gitignore/templates"],
    getTemplate: ["GET /gitignore/templates/{name}"]
  },
  hostedCompute: {
    createNetworkConfigurationForOrg: [
      "POST /orgs/{org}/settings/network-configurations"
    ],
    deleteNetworkConfigurationFromOrg: [
      "DELETE /orgs/{org}/settings/network-configurations/{network_configuration_id}"
    ],
    getNetworkConfigurationForOrg: [
      "GET /orgs/{org}/settings/network-configurations/{network_configuration_id}"
    ],
    getNetworkSettingsForOrg: [
      "GET /orgs/{org}/settings/network-settings/{network_settings_id}"
    ],
    listNetworkConfigurationsForOrg: [
      "GET /orgs/{org}/settings/network-configurations"
    ],
    updateNetworkConfigurationForOrg: [
      "PATCH /orgs/{org}/settings/network-configurations/{network_configuration_id}"
    ]
  },
  interactions: {
    getRestrictionsForAuthenticatedUser: ["GET /user/interaction-limits"],
    getRestrictionsForOrg: ["GET /orgs/{org}/interaction-limits"],
    getRestrictionsForRepo: ["GET /repos/{owner}/{repo}/interaction-limits"],
    getRestrictionsForYourPublicRepos: [
      "GET /user/interaction-limits",
      {},
      { renamed: ["interactions", "getRestrictionsForAuthenticatedUser"] }
    ],
    removeRestrictionsForAuthenticatedUser: ["DELETE /user/interaction-limits"],
    removeRestrictionsForOrg: ["DELETE /orgs/{org}/interaction-limits"],
    removeRestrictionsForRepo: [
      "DELETE /repos/{owner}/{repo}/interaction-limits"
    ],
    removeRestrictionsForYourPublicRepos: [
      "DELETE /user/interaction-limits",
      {},
      { renamed: ["interactions", "removeRestrictionsForAuthenticatedUser"] }
    ],
    setRestrictionsForAuthenticatedUser: ["PUT /user/interaction-limits"],
    setRestrictionsForOrg: ["PUT /orgs/{org}/interaction-limits"],
    setRestrictionsForRepo: ["PUT /repos/{owner}/{repo}/interaction-limits"],
    setRestrictionsForYourPublicRepos: [
      "PUT /user/interaction-limits",
      {},
      { renamed: ["interactions", "setRestrictionsForAuthenticatedUser"] }
    ]
  },
  issues: {
    addAssignees: [
      "POST /repos/{owner}/{repo}/issues/{issue_number}/assignees"
    ],
    addBlockedByDependency: [
      "POST /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by"
    ],
    addLabels: ["POST /repos/{owner}/{repo}/issues/{issue_number}/labels"],
    addSubIssue: [
      "POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues"
    ],
    checkUserCanBeAssigned: ["GET /repos/{owner}/{repo}/assignees/{assignee}"],
    checkUserCanBeAssignedToIssue: [
      "GET /repos/{owner}/{repo}/issues/{issue_number}/assignees/{assignee}"
    ],
    create: ["POST /repos/{owner}/{repo}/issues"],
    createComment: [
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments"
    ],
    createLabel: ["POST /repos/{owner}/{repo}/labels"],
    createMilestone: ["POST /repos/{owner}/{repo}/milestones"],
    deleteComment: [
      "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}"
    ],
    deleteLabel: ["DELETE /repos/{owner}/{repo}/labels/{name}"],
    deleteMilestone: [
      "DELETE /repos/{owner}/{repo}/milestones/{milestone_number}"
    ],
    get: ["GET /repos/{owner}/{repo}/issues/{issue_number}"],
    getComment: ["GET /repos/{owner}/{repo}/issues/comments/{comment_id}"],
    getEvent: ["GET /repos/{owner}/{repo}/issues/events/{event_id}"],
    getLabel: ["GET /repos/{owner}/{repo}/labels/{name}"],
    getMilestone: ["GET /repos/{owner}/{repo}/milestones/{milestone_number}"],
    getParent: ["GET /repos/{owner}/{repo}/issues/{issue_number}/parent"],
    list: ["GET /issues"],
    listAssignees: ["GET /repos/{owner}/{repo}/assignees"],
    listComments: ["GET /repos/{owner}/{repo}/issues/{issue_number}/comments"],
    listCommentsForRepo: ["GET /repos/{owner}/{repo}/issues/comments"],
    listDependenciesBlockedBy: [
      "GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by"
    ],
    listDependenciesBlocking: [
      "GET /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocking"
    ],
    listEvents: ["GET /repos/{owner}/{repo}/issues/{issue_number}/events"],
    listEventsForRepo: ["GET /repos/{owner}/{repo}/issues/events"],
    listEventsForTimeline: [
      "GET /repos/{owner}/{repo}/issues/{issue_number}/timeline"
    ],
    listForAuthenticatedUser: ["GET /user/issues"],
    listForOrg: ["GET /orgs/{org}/issues"],
    listForRepo: ["GET /repos/{owner}/{repo}/issues"],
    listLabelsForMilestone: [
      "GET /repos/{owner}/{repo}/milestones/{milestone_number}/labels"
    ],
    listLabelsForRepo: ["GET /repos/{owner}/{repo}/labels"],
    listLabelsOnIssue: [
      "GET /repos/{owner}/{repo}/issues/{issue_number}/labels"
    ],
    listMilestones: ["GET /repos/{owner}/{repo}/milestones"],
    listSubIssues: [
      "GET /repos/{owner}/{repo}/issues/{issue_number}/sub_issues"
    ],
    lock: ["PUT /repos/{owner}/{repo}/issues/{issue_number}/lock"],
    removeAllLabels: [
      "DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels"
    ],
    removeAssignees: [
      "DELETE /repos/{owner}/{repo}/issues/{issue_number}/assignees"
    ],
    removeDependencyBlockedBy: [
      "DELETE /repos/{owner}/{repo}/issues/{issue_number}/dependencies/blocked_by/{issue_id}"
    ],
    removeLabel: [
      "DELETE /repos/{owner}/{repo}/issues/{issue_number}/labels/{name}"
    ],
    removeSubIssue: [
      "DELETE /repos/{owner}/{repo}/issues/{issue_number}/sub_issue"
    ],
    reprioritizeSubIssue: [
      "PATCH /repos/{owner}/{repo}/issues/{issue_number}/sub_issues/priority"
    ],
    setLabels: ["PUT /repos/{owner}/{repo}/issues/{issue_number}/labels"],
    unlock: ["DELETE /repos/{owner}/{repo}/issues/{issue_number}/lock"],
    update: ["PATCH /repos/{owner}/{repo}/issues/{issue_number}"],
    updateComment: ["PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}"],
    updateLabel: ["PATCH /repos/{owner}/{repo}/labels/{name}"],
    updateMilestone: [
      "PATCH /repos/{owner}/{repo}/milestones/{milestone_number}"
    ]
  },
  licenses: {
    get: ["GET /licenses/{license}"],
    getAllCommonlyUsed: ["GET /licenses"],
    getForRepo: ["GET /repos/{owner}/{repo}/license"]
  },
  markdown: {
    render: ["POST /markdown"],
    renderRaw: [
      "POST /markdown/raw",
      { headers: { "content-type": "text/plain; charset=utf-8" } }
    ]
  },
  meta: {
    get: ["GET /meta"],
    getAllVersions: ["GET /versions"],
    getOctocat: ["GET /octocat"],
    getZen: ["GET /zen"],
    root: ["GET /"]
  },
  migrations: {
    deleteArchiveForAuthenticatedUser: [
      "DELETE /user/migrations/{migration_id}/archive"
    ],
    deleteArchiveForOrg: [
      "DELETE /orgs/{org}/migrations/{migration_id}/archive"
    ],
    downloadArchiveForOrg: [
      "GET /orgs/{org}/migrations/{migration_id}/archive"
    ],
    getArchiveForAuthenticatedUser: [
      "GET /user/migrations/{migration_id}/archive"
    ],
    getStatusForAuthenticatedUser: ["GET /user/migrations/{migration_id}"],
    getStatusForOrg: ["GET /orgs/{org}/migrations/{migration_id}"],
    listForAuthenticatedUser: ["GET /user/migrations"],
    listForOrg: ["GET /orgs/{org}/migrations"],
    listReposForAuthenticatedUser: [
      "GET /user/migrations/{migration_id}/repositories"
    ],
    listReposForOrg: ["GET /orgs/{org}/migrations/{migration_id}/repositories"],
    listReposForUser: [
      "GET /user/migrations/{migration_id}/repositories",
      {},
      { renamed: ["migrations", "listReposForAuthenticatedUser"] }
    ],
    startForAuthenticatedUser: ["POST /user/migrations"],
    startForOrg: ["POST /orgs/{org}/migrations"],
    unlockRepoForAuthenticatedUser: [
      "DELETE /user/migrations/{migration_id}/repos/{repo_name}/lock"
    ],
    unlockRepoForOrg: [
      "DELETE /orgs/{org}/migrations/{migration_id}/repos/{repo_name}/lock"
    ]
  },
  oidc: {
    getOidcCustomSubTemplateForOrg: [
      "GET /orgs/{org}/actions/oidc/customization/sub"
    ],
    updateOidcCustomSubTemplateForOrg: [
      "PUT /orgs/{org}/actions/oidc/customization/sub"
    ]
  },
  orgs: {
    addSecurityManagerTeam: [
      "PUT /orgs/{org}/security-managers/teams/{team_slug}",
      {},
      {
        deprecated: "octokit.rest.orgs.addSecurityManagerTeam() is deprecated, see https://docs.github.com/rest/orgs/security-managers#add-a-security-manager-team"
      }
    ],
    assignTeamToOrgRole: [
      "PUT /orgs/{org}/organization-roles/teams/{team_slug}/{role_id}"
    ],
    assignUserToOrgRole: [
      "PUT /orgs/{org}/organization-roles/users/{username}/{role_id}"
    ],
    blockUser: ["PUT /orgs/{org}/blocks/{username}"],
    cancelInvitation: ["DELETE /orgs/{org}/invitations/{invitation_id}"],
    checkBlockedUser: ["GET /orgs/{org}/blocks/{username}"],
    checkMembershipForUser: ["GET /orgs/{org}/members/{username}"],
    checkPublicMembershipForUser: ["GET /orgs/{org}/public_members/{username}"],
    convertMemberToOutsideCollaborator: [
      "PUT /orgs/{org}/outside_collaborators/{username}"
    ],
    createArtifactStorageRecord: [
      "POST /orgs/{org}/artifacts/metadata/storage-record"
    ],
    createInvitation: ["POST /orgs/{org}/invitations"],
    createIssueType: ["POST /orgs/{org}/issue-types"],
    createWebhook: ["POST /orgs/{org}/hooks"],
    customPropertiesForOrgsCreateOrUpdateOrganizationValues: [
      "PATCH /organizations/{org}/org-properties/values"
    ],
    customPropertiesForOrgsGetOrganizationValues: [
      "GET /organizations/{org}/org-properties/values"
    ],
    customPropertiesForReposCreateOrUpdateOrganizationDefinition: [
      "PUT /orgs/{org}/properties/schema/{custom_property_name}"
    ],
    customPropertiesForReposCreateOrUpdateOrganizationDefinitions: [
      "PATCH /orgs/{org}/properties/schema"
    ],
    customPropertiesForReposCreateOrUpdateOrganizationValues: [
      "PATCH /orgs/{org}/properties/values"
    ],
    customPropertiesForReposDeleteOrganizationDefinition: [
      "DELETE /orgs/{org}/properties/schema/{custom_property_name}"
    ],
    customPropertiesForReposGetOrganizationDefinition: [
      "GET /orgs/{org}/properties/schema/{custom_property_name}"
    ],
    customPropertiesForReposGetOrganizationDefinitions: [
      "GET /orgs/{org}/properties/schema"
    ],
    customPropertiesForReposGetOrganizationValues: [
      "GET /orgs/{org}/properties/values"
    ],
    delete: ["DELETE /orgs/{org}"],
    deleteAttestationsBulk: ["POST /orgs/{org}/attestations/delete-request"],
    deleteAttestationsById: [
      "DELETE /orgs/{org}/attestations/{attestation_id}"
    ],
    deleteAttestationsBySubjectDigest: [
      "DELETE /orgs/{org}/attestations/digest/{subject_digest}"
    ],
    deleteIssueType: ["DELETE /orgs/{org}/issue-types/{issue_type_id}"],
    deleteWebhook: ["DELETE /orgs/{org}/hooks/{hook_id}"],
    disableSelectedRepositoryImmutableReleasesOrganization: [
      "DELETE /orgs/{org}/settings/immutable-releases/repositories/{repository_id}"
    ],
    enableSelectedRepositoryImmutableReleasesOrganization: [
      "PUT /orgs/{org}/settings/immutable-releases/repositories/{repository_id}"
    ],
    get: ["GET /orgs/{org}"],
    getImmutableReleasesSettings: [
      "GET /orgs/{org}/settings/immutable-releases"
    ],
    getImmutableReleasesSettingsRepositories: [
      "GET /orgs/{org}/settings/immutable-releases/repositories"
    ],
    getMembershipForAuthenticatedUser: ["GET /user/memberships/orgs/{org}"],
    getMembershipForUser: ["GET /orgs/{org}/memberships/{username}"],
    getOrgRole: ["GET /orgs/{org}/organization-roles/{role_id}"],
    getOrgRulesetHistory: ["GET /orgs/{org}/rulesets/{ruleset_id}/history"],
    getOrgRulesetVersion: [
      "GET /orgs/{org}/rulesets/{ruleset_id}/history/{version_id}"
    ],
    getWebhook: ["GET /orgs/{org}/hooks/{hook_id}"],
    getWebhookConfigForOrg: ["GET /orgs/{org}/hooks/{hook_id}/config"],
    getWebhookDelivery: [
      "GET /orgs/{org}/hooks/{hook_id}/deliveries/{delivery_id}"
    ],
    list: ["GET /organizations"],
    listAppInstallations: ["GET /orgs/{org}/installations"],
    listArtifactStorageRecords: [
      "GET /orgs/{org}/artifacts/{subject_digest}/metadata/storage-records"
    ],
    listAttestationRepositories: ["GET /orgs/{org}/attestations/repositories"],
    listAttestations: ["GET /orgs/{org}/attestations/{subject_digest}"],
    listAttestationsBulk: [
      "POST /orgs/{org}/attestations/bulk-list{?per_page,before,after}"
    ],
    listBlockedUsers: ["GET /orgs/{org}/blocks"],
    listFailedInvitations: ["GET /orgs/{org}/failed_invitations"],
    listForAuthenticatedUser: ["GET /user/orgs"],
    listForUser: ["GET /users/{username}/orgs"],
    listInvitationTeams: ["GET /orgs/{org}/invitations/{invitation_id}/teams"],
    listIssueTypes: ["GET /orgs/{org}/issue-types"],
    listMembers: ["GET /orgs/{org}/members"],
    listMembershipsForAuthenticatedUser: ["GET /user/memberships/orgs"],
    listOrgRoleTeams: ["GET /orgs/{org}/organization-roles/{role_id}/teams"],
    listOrgRoleUsers: ["GET /orgs/{org}/organization-roles/{role_id}/users"],
    listOrgRoles: ["GET /orgs/{org}/organization-roles"],
    listOrganizationFineGrainedPermissions: [
      "GET /orgs/{org}/organization-fine-grained-permissions"
    ],
    listOutsideCollaborators: ["GET /orgs/{org}/outside_collaborators"],
    listPatGrantRepositories: [
      "GET /orgs/{org}/personal-access-tokens/{pat_id}/repositories"
    ],
    listPatGrantRequestRepositories: [
      "GET /orgs/{org}/personal-access-token-requests/{pat_request_id}/repositories"
    ],
    listPatGrantRequests: ["GET /orgs/{org}/personal-access-token-requests"],
    listPatGrants: ["GET /orgs/{org}/personal-access-tokens"],
    listPendingInvitations: ["GET /orgs/{org}/invitations"],
    listPublicMembers: ["GET /orgs/{org}/public_members"],
    listSecurityManagerTeams: [
      "GET /orgs/{org}/security-managers",
      {},
      {
        deprecated: "octokit.rest.orgs.listSecurityManagerTeams() is deprecated, see https://docs.github.com/rest/orgs/security-managers#list-security-manager-teams"
      }
    ],
    listWebhookDeliveries: ["GET /orgs/{org}/hooks/{hook_id}/deliveries"],
    listWebhooks: ["GET /orgs/{org}/hooks"],
    pingWebhook: ["POST /orgs/{org}/hooks/{hook_id}/pings"],
    redeliverWebhookDelivery: [
      "POST /orgs/{org}/hooks/{hook_id}/deliveries/{delivery_id}/attempts"
    ],
    removeMember: ["DELETE /orgs/{org}/members/{username}"],
    removeMembershipForUser: ["DELETE /orgs/{org}/memberships/{username}"],
    removeOutsideCollaborator: [
      "DELETE /orgs/{org}/outside_collaborators/{username}"
    ],
    removePublicMembershipForAuthenticatedUser: [
      "DELETE /orgs/{org}/public_members/{username}"
    ],
    removeSecurityManagerTeam: [
      "DELETE /orgs/{org}/security-managers/teams/{team_slug}",
      {},
      {
        deprecated: "octokit.rest.orgs.removeSecurityManagerTeam() is deprecated, see https://docs.github.com/rest/orgs/security-managers#remove-a-security-manager-team"
      }
    ],
    reviewPatGrantRequest: [
      "POST /orgs/{org}/personal-access-token-requests/{pat_request_id}"
    ],
    reviewPatGrantRequestsInBulk: [
      "POST /orgs/{org}/personal-access-token-requests"
    ],
    revokeAllOrgRolesTeam: [
      "DELETE /orgs/{org}/organization-roles/teams/{team_slug}"
    ],
    revokeAllOrgRolesUser: [
      "DELETE /orgs/{org}/organization-roles/users/{username}"
    ],
    revokeOrgRoleTeam: [
      "DELETE /orgs/{org}/organization-roles/teams/{team_slug}/{role_id}"
    ],
    revokeOrgRoleUser: [
      "DELETE /orgs/{org}/organization-roles/users/{username}/{role_id}"
    ],
    setImmutableReleasesSettings: [
      "PUT /orgs/{org}/settings/immutable-releases"
    ],
    setImmutableReleasesSettingsRepositories: [
      "PUT /orgs/{org}/settings/immutable-releases/repositories"
    ],
    setMembershipForUser: ["PUT /orgs/{org}/memberships/{username}"],
    setPublicMembershipForAuthenticatedUser: [
      "PUT /orgs/{org}/public_members/{username}"
    ],
    unblockUser: ["DELETE /orgs/{org}/blocks/{username}"],
    update: ["PATCH /orgs/{org}"],
    updateIssueType: ["PUT /orgs/{org}/issue-types/{issue_type_id}"],
    updateMembershipForAuthenticatedUser: [
      "PATCH /user/memberships/orgs/{org}"
    ],
    updatePatAccess: ["POST /orgs/{org}/personal-access-tokens/{pat_id}"],
    updatePatAccesses: ["POST /orgs/{org}/personal-access-tokens"],
    updateWebhook: ["PATCH /orgs/{org}/hooks/{hook_id}"],
    updateWebhookConfigForOrg: ["PATCH /orgs/{org}/hooks/{hook_id}/config"]
  },
  packages: {
    deletePackageForAuthenticatedUser: [
      "DELETE /user/packages/{package_type}/{package_name}"
    ],
    deletePackageForOrg: [
      "DELETE /orgs/{org}/packages/{package_type}/{package_name}"
    ],
    deletePackageForUser: [
      "DELETE /users/{username}/packages/{package_type}/{package_name}"
    ],
    deletePackageVersionForAuthenticatedUser: [
      "DELETE /user/packages/{package_type}/{package_name}/versions/{package_version_id}"
    ],
    deletePackageVersionForOrg: [
      "DELETE /orgs/{org}/packages/{package_type}/{package_name}/versions/{package_version_id}"
    ],
    deletePackageVersionForUser: [
      "DELETE /users/{username}/packages/{package_type}/{package_name}/versions/{package_version_id}"
    ],
    getAllPackageVersionsForAPackageOwnedByAnOrg: [
      "GET /orgs/{org}/packages/{package_type}/{package_name}/versions",
      {},
      { renamed: ["packages", "getAllPackageVersionsForPackageOwnedByOrg"] }
    ],
    getAllPackageVersionsForAPackageOwnedByTheAuthenticatedUser: [
      "GET /user/packages/{package_type}/{package_name}/versions",
      {},
      {
        renamed: [
          "packages",
          "getAllPackageVersionsForPackageOwnedByAuthenticatedUser"
        ]
      }
    ],
    getAllPackageVersionsForPackageOwnedByAuthenticatedUser: [
      "GET /user/packages/{package_type}/{package_name}/versions"
    ],
    getAllPackageVersionsForPackageOwnedByOrg: [
      "GET /orgs/{org}/packages/{package_type}/{package_name}/versions"
    ],
    getAllPackageVersionsForPackageOwnedByUser: [
      "GET /users/{username}/packages/{package_type}/{package_name}/versions"
    ],
    getPackageForAuthenticatedUser: [
      "GET /user/packages/{package_type}/{package_name}"
    ],
    getPackageForOrganization: [
      "GET /orgs/{org}/packages/{package_type}/{package_name}"
    ],
    getPackageForUser: [
      "GET /users/{username}/packages/{package_type}/{package_name}"
    ],
    getPackageVersionForAuthenticatedUser: [
      "GET /user/packages/{package_type}/{package_name}/versions/{package_version_id}"
    ],
    getPackageVersionForOrganization: [
      "GET /orgs/{org}/packages/{package_type}/{package_name}/versions/{package_version_id}"
    ],
    getPackageVersionForUser: [
      "GET /users/{username}/packages/{package_type}/{package_name}/versions/{package_version_id}"
    ],
    listDockerMigrationConflictingPackagesForAuthenticatedUser: [
      "GET /user/docker/conflicts"
    ],
    listDockerMigrationConflictingPackagesForOrganization: [
      "GET /orgs/{org}/docker/conflicts"
    ],
    listDockerMigrationConflictingPackagesForUser: [
      "GET /users/{username}/docker/conflicts"
    ],
    listPackagesForAuthenticatedUser: ["GET /user/packages"],
    listPackagesForOrganization: ["GET /orgs/{org}/packages"],
    listPackagesForUser: ["GET /users/{username}/packages"],
    restorePackageForAuthenticatedUser: [
      "POST /user/packages/{package_type}/{package_name}/restore{?token}"
    ],
    restorePackageForOrg: [
      "POST /orgs/{org}/packages/{package_type}/{package_name}/restore{?token}"
    ],
    restorePackageForUser: [
      "POST /users/{username}/packages/{package_type}/{package_name}/restore{?token}"
    ],
    restorePackageVersionForAuthenticatedUser: [
      "POST /user/packages/{package_type}/{package_name}/versions/{package_version_id}/restore"
    ],
    restorePackageVersionForOrg: [
      "POST /orgs/{org}/packages/{package_type}/{package_name}/versions/{package_version_id}/restore"
    ],
    restorePackageVersionForUser: [
      "POST /users/{username}/packages/{package_type}/{package_name}/versions/{package_version_id}/restore"
    ]
  },
  privateRegistries: {
    createOrgPrivateRegistry: ["POST /orgs/{org}/private-registries"],
    deleteOrgPrivateRegistry: [
      "DELETE /orgs/{org}/private-registries/{secret_name}"
    ],
    getOrgPrivateRegistry: ["GET /orgs/{org}/private-registries/{secret_name}"],
    getOrgPublicKey: ["GET /orgs/{org}/private-registries/public-key"],
    listOrgPrivateRegistries: ["GET /orgs/{org}/private-registries"],
    updateOrgPrivateRegistry: [
      "PATCH /orgs/{org}/private-registries/{secret_name}"
    ]
  },
  projects: {
    addItemForOrg: ["POST /orgs/{org}/projectsV2/{project_number}/items"],
    addItemForUser: [
      "POST /users/{username}/projectsV2/{project_number}/items"
    ],
    deleteItemForOrg: [
      "DELETE /orgs/{org}/projectsV2/{project_number}/items/{item_id}"
    ],
    deleteItemForUser: [
      "DELETE /users/{username}/projectsV2/{project_number}/items/{item_id}"
    ],
    getFieldForOrg: [
      "GET /orgs/{org}/projectsV2/{project_number}/fields/{field_id}"
    ],
    getFieldForUser: [
      "GET /users/{username}/projectsV2/{project_number}/fields/{field_id}"
    ],
    getForOrg: ["GET /orgs/{org}/projectsV2/{project_number}"],
    getForUser: ["GET /users/{username}/projectsV2/{project_number}"],
    getOrgItem: ["GET /orgs/{org}/projectsV2/{project_number}/items/{item_id}"],
    getUserItem: [
      "GET /users/{username}/projectsV2/{project_number}/items/{item_id}"
    ],
    listFieldsForOrg: ["GET /orgs/{org}/projectsV2/{project_number}/fields"],
    listFieldsForUser: [
      "GET /users/{username}/projectsV2/{project_number}/fields"
    ],
    listForOrg: ["GET /orgs/{org}/projectsV2"],
    listForUser: ["GET /users/{username}/projectsV2"],
    listItemsForOrg: ["GET /orgs/{org}/projectsV2/{project_number}/items"],
    listItemsForUser: [
      "GET /users/{username}/projectsV2/{project_number}/items"
    ],
    updateItemForOrg: [
      "PATCH /orgs/{org}/projectsV2/{project_number}/items/{item_id}"
    ],
    updateItemForUser: [
      "PATCH /users/{username}/projectsV2/{project_number}/items/{item_id}"
    ]
  },
  pulls: {
    checkIfMerged: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/merge"],
    create: ["POST /repos/{owner}/{repo}/pulls"],
    createReplyForReviewComment: [
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies"
    ],
    createReview: ["POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews"],
    createReviewComment: [
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments"
    ],
    deletePendingReview: [
      "DELETE /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}"
    ],
    deleteReviewComment: [
      "DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}"
    ],
    dismissReview: [
      "PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/dismissals"
    ],
    get: ["GET /repos/{owner}/{repo}/pulls/{pull_number}"],
    getReview: [
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}"
    ],
    getReviewComment: ["GET /repos/{owner}/{repo}/pulls/comments/{comment_id}"],
    list: ["GET /repos/{owner}/{repo}/pulls"],
    listCommentsForReview: [
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments"
    ],
    listCommits: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/commits"],
    listFiles: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/files"],
    listRequestedReviewers: [
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers"
    ],
    listReviewComments: [
      "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments"
    ],
    listReviewCommentsForRepo: ["GET /repos/{owner}/{repo}/pulls/comments"],
    listReviews: ["GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews"],
    merge: ["PUT /repos/{owner}/{repo}/pulls/{pull_number}/merge"],
    removeRequestedReviewers: [
      "DELETE /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers"
    ],
    requestReviewers: [
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/requested_reviewers"
    ],
    submitReview: [
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events"
    ],
    update: ["PATCH /repos/{owner}/{repo}/pulls/{pull_number}"],
    updateBranch: [
      "PUT /repos/{owner}/{repo}/pulls/{pull_number}/update-branch"
    ],
    updateReview: [
      "PUT /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}"
    ],
    updateReviewComment: [
      "PATCH /repos/{owner}/{repo}/pulls/comments/{comment_id}"
    ]
  },
  rateLimit: { get: ["GET /rate_limit"] },
  reactions: {
    createForCommitComment: [
      "POST /repos/{owner}/{repo}/comments/{comment_id}/reactions"
    ],
    createForIssue: [
      "POST /repos/{owner}/{repo}/issues/{issue_number}/reactions"
    ],
    createForIssueComment: [
      "POST /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions"
    ],
    createForPullRequestReviewComment: [
      "POST /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions"
    ],
    createForRelease: [
      "POST /repos/{owner}/{repo}/releases/{release_id}/reactions"
    ],
    createForTeamDiscussionCommentInOrg: [
      "POST /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}/reactions"
    ],
    createForTeamDiscussionInOrg: [
      "POST /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/reactions"
    ],
    deleteForCommitComment: [
      "DELETE /repos/{owner}/{repo}/comments/{comment_id}/reactions/{reaction_id}"
    ],
    deleteForIssue: [
      "DELETE /repos/{owner}/{repo}/issues/{issue_number}/reactions/{reaction_id}"
    ],
    deleteForIssueComment: [
      "DELETE /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions/{reaction_id}"
    ],
    deleteForPullRequestComment: [
      "DELETE /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions/{reaction_id}"
    ],
    deleteForRelease: [
      "DELETE /repos/{owner}/{repo}/releases/{release_id}/reactions/{reaction_id}"
    ],
    deleteForTeamDiscussion: [
      "DELETE /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/reactions/{reaction_id}"
    ],
    deleteForTeamDiscussionComment: [
      "DELETE /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}/reactions/{reaction_id}"
    ],
    listForCommitComment: [
      "GET /repos/{owner}/{repo}/comments/{comment_id}/reactions"
    ],
    listForIssue: ["GET /repos/{owner}/{repo}/issues/{issue_number}/reactions"],
    listForIssueComment: [
      "GET /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions"
    ],
    listForPullRequestReviewComment: [
      "GET /repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions"
    ],
    listForRelease: [
      "GET /repos/{owner}/{repo}/releases/{release_id}/reactions"
    ],
    listForTeamDiscussionCommentInOrg: [
      "GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}/reactions"
    ],
    listForTeamDiscussionInOrg: [
      "GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/reactions"
    ]
  },
  repos: {
    acceptInvitation: [
      "PATCH /user/repository_invitations/{invitation_id}",
      {},
      { renamed: ["repos", "acceptInvitationForAuthenticatedUser"] }
    ],
    acceptInvitationForAuthenticatedUser: [
      "PATCH /user/repository_invitations/{invitation_id}"
    ],
    addAppAccessRestrictions: [
      "POST /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/apps",
      {},
      { mapToData: "apps" }
    ],
    addCollaborator: ["PUT /repos/{owner}/{repo}/collaborators/{username}"],
    addStatusCheckContexts: [
      "POST /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts",
      {},
      { mapToData: "contexts" }
    ],
    addTeamAccessRestrictions: [
      "POST /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/teams",
      {},
      { mapToData: "teams" }
    ],
    addUserAccessRestrictions: [
      "POST /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/users",
      {},
      { mapToData: "users" }
    ],
    cancelPagesDeployment: [
      "POST /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}/cancel"
    ],
    checkAutomatedSecurityFixes: [
      "GET /repos/{owner}/{repo}/automated-security-fixes"
    ],
    checkCollaborator: ["GET /repos/{owner}/{repo}/collaborators/{username}"],
    checkImmutableReleases: ["GET /repos/{owner}/{repo}/immutable-releases"],
    checkPrivateVulnerabilityReporting: [
      "GET /repos/{owner}/{repo}/private-vulnerability-reporting"
    ],
    checkVulnerabilityAlerts: [
      "GET /repos/{owner}/{repo}/vulnerability-alerts"
    ],
    codeownersErrors: ["GET /repos/{owner}/{repo}/codeowners/errors"],
    compareCommits: ["GET /repos/{owner}/{repo}/compare/{base}...{head}"],
    compareCommitsWithBasehead: [
      "GET /repos/{owner}/{repo}/compare/{basehead}"
    ],
    createAttestation: ["POST /repos/{owner}/{repo}/attestations"],
    createAutolink: ["POST /repos/{owner}/{repo}/autolinks"],
    createCommitComment: [
      "POST /repos/{owner}/{repo}/commits/{commit_sha}/comments"
    ],
    createCommitSignatureProtection: [
      "POST /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures"
    ],
    createCommitStatus: ["POST /repos/{owner}/{repo}/statuses/{sha}"],
    createDeployKey: ["POST /repos/{owner}/{repo}/keys"],
    createDeployment: ["POST /repos/{owner}/{repo}/deployments"],
    createDeploymentBranchPolicy: [
      "POST /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies"
    ],
    createDeploymentProtectionRule: [
      "POST /repos/{owner}/{repo}/environments/{environment_name}/deployment_protection_rules"
    ],
    createDeploymentStatus: [
      "POST /repos/{owner}/{repo}/deployments/{deployment_id}/statuses"
    ],
    createDispatchEvent: ["POST /repos/{owner}/{repo}/dispatches"],
    createForAuthenticatedUser: ["POST /user/repos"],
    createFork: ["POST /repos/{owner}/{repo}/forks"],
    createInOrg: ["POST /orgs/{org}/repos"],
    createOrUpdateEnvironment: [
      "PUT /repos/{owner}/{repo}/environments/{environment_name}"
    ],
    createOrUpdateFileContents: ["PUT /repos/{owner}/{repo}/contents/{path}"],
    createOrgRuleset: ["POST /orgs/{org}/rulesets"],
    createPagesDeployment: ["POST /repos/{owner}/{repo}/pages/deployments"],
    createPagesSite: ["POST /repos/{owner}/{repo}/pages"],
    createRelease: ["POST /repos/{owner}/{repo}/releases"],
    createRepoRuleset: ["POST /repos/{owner}/{repo}/rulesets"],
    createUsingTemplate: [
      "POST /repos/{template_owner}/{template_repo}/generate"
    ],
    createWebhook: ["POST /repos/{owner}/{repo}/hooks"],
    customPropertiesForReposCreateOrUpdateRepositoryValues: [
      "PATCH /repos/{owner}/{repo}/properties/values"
    ],
    customPropertiesForReposGetRepositoryValues: [
      "GET /repos/{owner}/{repo}/properties/values"
    ],
    declineInvitation: [
      "DELETE /user/repository_invitations/{invitation_id}",
      {},
      { renamed: ["repos", "declineInvitationForAuthenticatedUser"] }
    ],
    declineInvitationForAuthenticatedUser: [
      "DELETE /user/repository_invitations/{invitation_id}"
    ],
    delete: ["DELETE /repos/{owner}/{repo}"],
    deleteAccessRestrictions: [
      "DELETE /repos/{owner}/{repo}/branches/{branch}/protection/restrictions"
    ],
    deleteAdminBranchProtection: [
      "DELETE /repos/{owner}/{repo}/branches/{branch}/protection/enforce_admins"
    ],
    deleteAnEnvironment: [
      "DELETE /repos/{owner}/{repo}/environments/{environment_name}"
    ],
    deleteAutolink: ["DELETE /repos/{owner}/{repo}/autolinks/{autolink_id}"],
    deleteBranchProtection: [
      "DELETE /repos/{owner}/{repo}/branches/{branch}/protection"
    ],
    deleteCommitComment: ["DELETE /repos/{owner}/{repo}/comments/{comment_id}"],
    deleteCommitSignatureProtection: [
      "DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures"
    ],
    deleteDeployKey: ["DELETE /repos/{owner}/{repo}/keys/{key_id}"],
    deleteDeployment: [
      "DELETE /repos/{owner}/{repo}/deployments/{deployment_id}"
    ],
    deleteDeploymentBranchPolicy: [
      "DELETE /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies/{branch_policy_id}"
    ],
    deleteFile: ["DELETE /repos/{owner}/{repo}/contents/{path}"],
    deleteInvitation: [
      "DELETE /repos/{owner}/{repo}/invitations/{invitation_id}"
    ],
    deleteOrgRuleset: ["DELETE /orgs/{org}/rulesets/{ruleset_id}"],
    deletePagesSite: ["DELETE /repos/{owner}/{repo}/pages"],
    deletePullRequestReviewProtection: [
      "DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_pull_request_reviews"
    ],
    deleteRelease: ["DELETE /repos/{owner}/{repo}/releases/{release_id}"],
    deleteReleaseAsset: [
      "DELETE /repos/{owner}/{repo}/releases/assets/{asset_id}"
    ],
    deleteRepoRuleset: ["DELETE /repos/{owner}/{repo}/rulesets/{ruleset_id}"],
    deleteWebhook: ["DELETE /repos/{owner}/{repo}/hooks/{hook_id}"],
    disableAutomatedSecurityFixes: [
      "DELETE /repos/{owner}/{repo}/automated-security-fixes"
    ],
    disableDeploymentProtectionRule: [
      "DELETE /repos/{owner}/{repo}/environments/{environment_name}/deployment_protection_rules/{protection_rule_id}"
    ],
    disableImmutableReleases: [
      "DELETE /repos/{owner}/{repo}/immutable-releases"
    ],
    disablePrivateVulnerabilityReporting: [
      "DELETE /repos/{owner}/{repo}/private-vulnerability-reporting"
    ],
    disableVulnerabilityAlerts: [
      "DELETE /repos/{owner}/{repo}/vulnerability-alerts"
    ],
    downloadArchive: [
      "GET /repos/{owner}/{repo}/zipball/{ref}",
      {},
      { renamed: ["repos", "downloadZipballArchive"] }
    ],
    downloadTarballArchive: ["GET /repos/{owner}/{repo}/tarball/{ref}"],
    downloadZipballArchive: ["GET /repos/{owner}/{repo}/zipball/{ref}"],
    enableAutomatedSecurityFixes: [
      "PUT /repos/{owner}/{repo}/automated-security-fixes"
    ],
    enableImmutableReleases: ["PUT /repos/{owner}/{repo}/immutable-releases"],
    enablePrivateVulnerabilityReporting: [
      "PUT /repos/{owner}/{repo}/private-vulnerability-reporting"
    ],
    enableVulnerabilityAlerts: [
      "PUT /repos/{owner}/{repo}/vulnerability-alerts"
    ],
    generateReleaseNotes: [
      "POST /repos/{owner}/{repo}/releases/generate-notes"
    ],
    get: ["GET /repos/{owner}/{repo}"],
    getAccessRestrictions: [
      "GET /repos/{owner}/{repo}/branches/{branch}/protection/restrictions"
    ],
    getAdminBranchProtection: [
      "GET /repos/{owner}/{repo}/branches/{branch}/protection/enforce_admins"
    ],
    getAllDeploymentProtectionRules: [
      "GET /repos/{owner}/{repo}/environments/{environment_name}/deployment_protection_rules"
    ],
    getAllEnvironments: ["GET /repos/{owner}/{repo}/environments"],
    getAllStatusCheckContexts: [
      "GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts"
    ],
    getAllTopics: ["GET /repos/{owner}/{repo}/topics"],
    getAppsWithAccessToProtectedBranch: [
      "GET /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/apps"
    ],
    getAutolink: ["GET /repos/{owner}/{repo}/autolinks/{autolink_id}"],
    getBranch: ["GET /repos/{owner}/{repo}/branches/{branch}"],
    getBranchProtection: [
      "GET /repos/{owner}/{repo}/branches/{branch}/protection"
    ],
    getBranchRules: ["GET /repos/{owner}/{repo}/rules/branches/{branch}"],
    getClones: ["GET /repos/{owner}/{repo}/traffic/clones"],
    getCodeFrequencyStats: ["GET /repos/{owner}/{repo}/stats/code_frequency"],
    getCollaboratorPermissionLevel: [
      "GET /repos/{owner}/{repo}/collaborators/{username}/permission"
    ],
    getCombinedStatusForRef: ["GET /repos/{owner}/{repo}/commits/{ref}/status"],
    getCommit: ["GET /repos/{owner}/{repo}/commits/{ref}"],
    getCommitActivityStats: ["GET /repos/{owner}/{repo}/stats/commit_activity"],
    getCommitComment: ["GET /repos/{owner}/{repo}/comments/{comment_id}"],
    getCommitSignatureProtection: [
      "GET /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures"
    ],
    getCommunityProfileMetrics: ["GET /repos/{owner}/{repo}/community/profile"],
    getContent: ["GET /repos/{owner}/{repo}/contents/{path}"],
    getContributorsStats: ["GET /repos/{owner}/{repo}/stats/contributors"],
    getCustomDeploymentProtectionRule: [
      "GET /repos/{owner}/{repo}/environments/{environment_name}/deployment_protection_rules/{protection_rule_id}"
    ],
    getDeployKey: ["GET /repos/{owner}/{repo}/keys/{key_id}"],
    getDeployment: ["GET /repos/{owner}/{repo}/deployments/{deployment_id}"],
    getDeploymentBranchPolicy: [
      "GET /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies/{branch_policy_id}"
    ],
    getDeploymentStatus: [
      "GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses/{status_id}"
    ],
    getEnvironment: [
      "GET /repos/{owner}/{repo}/environments/{environment_name}"
    ],
    getLatestPagesBuild: ["GET /repos/{owner}/{repo}/pages/builds/latest"],
    getLatestRelease: ["GET /repos/{owner}/{repo}/releases/latest"],
    getOrgRuleSuite: ["GET /orgs/{org}/rulesets/rule-suites/{rule_suite_id}"],
    getOrgRuleSuites: ["GET /orgs/{org}/rulesets/rule-suites"],
    getOrgRuleset: ["GET /orgs/{org}/rulesets/{ruleset_id}"],
    getOrgRulesets: ["GET /orgs/{org}/rulesets"],
    getPages: ["GET /repos/{owner}/{repo}/pages"],
    getPagesBuild: ["GET /repos/{owner}/{repo}/pages/builds/{build_id}"],
    getPagesDeployment: [
      "GET /repos/{owner}/{repo}/pages/deployments/{pages_deployment_id}"
    ],
    getPagesHealthCheck: ["GET /repos/{owner}/{repo}/pages/health"],
    getParticipationStats: ["GET /repos/{owner}/{repo}/stats/participation"],
    getPullRequestReviewProtection: [
      "GET /repos/{owner}/{repo}/branches/{branch}/protection/required_pull_request_reviews"
    ],
    getPunchCardStats: ["GET /repos/{owner}/{repo}/stats/punch_card"],
    getReadme: ["GET /repos/{owner}/{repo}/readme"],
    getReadmeInDirectory: ["GET /repos/{owner}/{repo}/readme/{dir}"],
    getRelease: ["GET /repos/{owner}/{repo}/releases/{release_id}"],
    getReleaseAsset: ["GET /repos/{owner}/{repo}/releases/assets/{asset_id}"],
    getReleaseByTag: ["GET /repos/{owner}/{repo}/releases/tags/{tag}"],
    getRepoRuleSuite: [
      "GET /repos/{owner}/{repo}/rulesets/rule-suites/{rule_suite_id}"
    ],
    getRepoRuleSuites: ["GET /repos/{owner}/{repo}/rulesets/rule-suites"],
    getRepoRuleset: ["GET /repos/{owner}/{repo}/rulesets/{ruleset_id}"],
    getRepoRulesetHistory: [
      "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}/history"
    ],
    getRepoRulesetVersion: [
      "GET /repos/{owner}/{repo}/rulesets/{ruleset_id}/history/{version_id}"
    ],
    getRepoRulesets: ["GET /repos/{owner}/{repo}/rulesets"],
    getStatusChecksProtection: [
      "GET /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks"
    ],
    getTeamsWithAccessToProtectedBranch: [
      "GET /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/teams"
    ],
    getTopPaths: ["GET /repos/{owner}/{repo}/traffic/popular/paths"],
    getTopReferrers: ["GET /repos/{owner}/{repo}/traffic/popular/referrers"],
    getUsersWithAccessToProtectedBranch: [
      "GET /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/users"
    ],
    getViews: ["GET /repos/{owner}/{repo}/traffic/views"],
    getWebhook: ["GET /repos/{owner}/{repo}/hooks/{hook_id}"],
    getWebhookConfigForRepo: [
      "GET /repos/{owner}/{repo}/hooks/{hook_id}/config"
    ],
    getWebhookDelivery: [
      "GET /repos/{owner}/{repo}/hooks/{hook_id}/deliveries/{delivery_id}"
    ],
    listActivities: ["GET /repos/{owner}/{repo}/activity"],
    listAttestations: [
      "GET /repos/{owner}/{repo}/attestations/{subject_digest}"
    ],
    listAutolinks: ["GET /repos/{owner}/{repo}/autolinks"],
    listBranches: ["GET /repos/{owner}/{repo}/branches"],
    listBranchesForHeadCommit: [
      "GET /repos/{owner}/{repo}/commits/{commit_sha}/branches-where-head"
    ],
    listCollaborators: ["GET /repos/{owner}/{repo}/collaborators"],
    listCommentsForCommit: [
      "GET /repos/{owner}/{repo}/commits/{commit_sha}/comments"
    ],
    listCommitCommentsForRepo: ["GET /repos/{owner}/{repo}/comments"],
    listCommitStatusesForRef: [
      "GET /repos/{owner}/{repo}/commits/{ref}/statuses"
    ],
    listCommits: ["GET /repos/{owner}/{repo}/commits"],
    listContributors: ["GET /repos/{owner}/{repo}/contributors"],
    listCustomDeploymentRuleIntegrations: [
      "GET /repos/{owner}/{repo}/environments/{environment_name}/deployment_protection_rules/apps"
    ],
    listDeployKeys: ["GET /repos/{owner}/{repo}/keys"],
    listDeploymentBranchPolicies: [
      "GET /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies"
    ],
    listDeploymentStatuses: [
      "GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses"
    ],
    listDeployments: ["GET /repos/{owner}/{repo}/deployments"],
    listForAuthenticatedUser: ["GET /user/repos"],
    listForOrg: ["GET /orgs/{org}/repos"],
    listForUser: ["GET /users/{username}/repos"],
    listForks: ["GET /repos/{owner}/{repo}/forks"],
    listInvitations: ["GET /repos/{owner}/{repo}/invitations"],
    listInvitationsForAuthenticatedUser: ["GET /user/repository_invitations"],
    listLanguages: ["GET /repos/{owner}/{repo}/languages"],
    listPagesBuilds: ["GET /repos/{owner}/{repo}/pages/builds"],
    listPublic: ["GET /repositories"],
    listPullRequestsAssociatedWithCommit: [
      "GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls"
    ],
    listReleaseAssets: [
      "GET /repos/{owner}/{repo}/releases/{release_id}/assets"
    ],
    listReleases: ["GET /repos/{owner}/{repo}/releases"],
    listTags: ["GET /repos/{owner}/{repo}/tags"],
    listTeams: ["GET /repos/{owner}/{repo}/teams"],
    listWebhookDeliveries: [
      "GET /repos/{owner}/{repo}/hooks/{hook_id}/deliveries"
    ],
    listWebhooks: ["GET /repos/{owner}/{repo}/hooks"],
    merge: ["POST /repos/{owner}/{repo}/merges"],
    mergeUpstream: ["POST /repos/{owner}/{repo}/merge-upstream"],
    pingWebhook: ["POST /repos/{owner}/{repo}/hooks/{hook_id}/pings"],
    redeliverWebhookDelivery: [
      "POST /repos/{owner}/{repo}/hooks/{hook_id}/deliveries/{delivery_id}/attempts"
    ],
    removeAppAccessRestrictions: [
      "DELETE /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/apps",
      {},
      { mapToData: "apps" }
    ],
    removeCollaborator: [
      "DELETE /repos/{owner}/{repo}/collaborators/{username}"
    ],
    removeStatusCheckContexts: [
      "DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts",
      {},
      { mapToData: "contexts" }
    ],
    removeStatusCheckProtection: [
      "DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks"
    ],
    removeTeamAccessRestrictions: [
      "DELETE /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/teams",
      {},
      { mapToData: "teams" }
    ],
    removeUserAccessRestrictions: [
      "DELETE /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/users",
      {},
      { mapToData: "users" }
    ],
    renameBranch: ["POST /repos/{owner}/{repo}/branches/{branch}/rename"],
    replaceAllTopics: ["PUT /repos/{owner}/{repo}/topics"],
    requestPagesBuild: ["POST /repos/{owner}/{repo}/pages/builds"],
    setAdminBranchProtection: [
      "POST /repos/{owner}/{repo}/branches/{branch}/protection/enforce_admins"
    ],
    setAppAccessRestrictions: [
      "PUT /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/apps",
      {},
      { mapToData: "apps" }
    ],
    setStatusCheckContexts: [
      "PUT /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks/contexts",
      {},
      { mapToData: "contexts" }
    ],
    setTeamAccessRestrictions: [
      "PUT /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/teams",
      {},
      { mapToData: "teams" }
    ],
    setUserAccessRestrictions: [
      "PUT /repos/{owner}/{repo}/branches/{branch}/protection/restrictions/users",
      {},
      { mapToData: "users" }
    ],
    testPushWebhook: ["POST /repos/{owner}/{repo}/hooks/{hook_id}/tests"],
    transfer: ["POST /repos/{owner}/{repo}/transfer"],
    update: ["PATCH /repos/{owner}/{repo}"],
    updateBranchProtection: [
      "PUT /repos/{owner}/{repo}/branches/{branch}/protection"
    ],
    updateCommitComment: ["PATCH /repos/{owner}/{repo}/comments/{comment_id}"],
    updateDeploymentBranchPolicy: [
      "PUT /repos/{owner}/{repo}/environments/{environment_name}/deployment-branch-policies/{branch_policy_id}"
    ],
    updateInformationAboutPagesSite: ["PUT /repos/{owner}/{repo}/pages"],
    updateInvitation: [
      "PATCH /repos/{owner}/{repo}/invitations/{invitation_id}"
    ],
    updateOrgRuleset: ["PUT /orgs/{org}/rulesets/{ruleset_id}"],
    updatePullRequestReviewProtection: [
      "PATCH /repos/{owner}/{repo}/branches/{branch}/protection/required_pull_request_reviews"
    ],
    updateRelease: ["PATCH /repos/{owner}/{repo}/releases/{release_id}"],
    updateReleaseAsset: [
      "PATCH /repos/{owner}/{repo}/releases/assets/{asset_id}"
    ],
    updateRepoRuleset: ["PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}"],
    updateStatusCheckPotection: [
      "PATCH /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks",
      {},
      { renamed: ["repos", "updateStatusCheckProtection"] }
    ],
    updateStatusCheckProtection: [
      "PATCH /repos/{owner}/{repo}/branches/{branch}/protection/required_status_checks"
    ],
    updateWebhook: ["PATCH /repos/{owner}/{repo}/hooks/{hook_id}"],
    updateWebhookConfigForRepo: [
      "PATCH /repos/{owner}/{repo}/hooks/{hook_id}/config"
    ],
    uploadReleaseAsset: [
      "POST /repos/{owner}/{repo}/releases/{release_id}/assets{?name,label}",
      { baseUrl: "https://uploads.github.com" }
    ]
  },
  search: {
    code: ["GET /search/code"],
    commits: ["GET /search/commits"],
    issuesAndPullRequests: ["GET /search/issues"],
    labels: ["GET /search/labels"],
    repos: ["GET /search/repositories"],
    topics: ["GET /search/topics"],
    users: ["GET /search/users"]
  },
  secretScanning: {
    createPushProtectionBypass: [
      "POST /repos/{owner}/{repo}/secret-scanning/push-protection-bypasses"
    ],
    getAlert: [
      "GET /repos/{owner}/{repo}/secret-scanning/alerts/{alert_number}"
    ],
    getScanHistory: ["GET /repos/{owner}/{repo}/secret-scanning/scan-history"],
    listAlertsForOrg: ["GET /orgs/{org}/secret-scanning/alerts"],
    listAlertsForRepo: ["GET /repos/{owner}/{repo}/secret-scanning/alerts"],
    listLocationsForAlert: [
      "GET /repos/{owner}/{repo}/secret-scanning/alerts/{alert_number}/locations"
    ],
    listOrgPatternConfigs: [
      "GET /orgs/{org}/secret-scanning/pattern-configurations"
    ],
    updateAlert: [
      "PATCH /repos/{owner}/{repo}/secret-scanning/alerts/{alert_number}"
    ],
    updateOrgPatternConfigs: [
      "PATCH /orgs/{org}/secret-scanning/pattern-configurations"
    ]
  },
  securityAdvisories: {
    createFork: [
      "POST /repos/{owner}/{repo}/security-advisories/{ghsa_id}/forks"
    ],
    createPrivateVulnerabilityReport: [
      "POST /repos/{owner}/{repo}/security-advisories/reports"
    ],
    createRepositoryAdvisory: [
      "POST /repos/{owner}/{repo}/security-advisories"
    ],
    createRepositoryAdvisoryCveRequest: [
      "POST /repos/{owner}/{repo}/security-advisories/{ghsa_id}/cve"
    ],
    getGlobalAdvisory: ["GET /advisories/{ghsa_id}"],
    getRepositoryAdvisory: [
      "GET /repos/{owner}/{repo}/security-advisories/{ghsa_id}"
    ],
    listGlobalAdvisories: ["GET /advisories"],
    listOrgRepositoryAdvisories: ["GET /orgs/{org}/security-advisories"],
    listRepositoryAdvisories: ["GET /repos/{owner}/{repo}/security-advisories"],
    updateRepositoryAdvisory: [
      "PATCH /repos/{owner}/{repo}/security-advisories/{ghsa_id}"
    ]
  },
  teams: {
    addOrUpdateMembershipForUserInOrg: [
      "PUT /orgs/{org}/teams/{team_slug}/memberships/{username}"
    ],
    addOrUpdateRepoPermissionsInOrg: [
      "PUT /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}"
    ],
    checkPermissionsForRepoInOrg: [
      "GET /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}"
    ],
    create: ["POST /orgs/{org}/teams"],
    createDiscussionCommentInOrg: [
      "POST /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments"
    ],
    createDiscussionInOrg: ["POST /orgs/{org}/teams/{team_slug}/discussions"],
    deleteDiscussionCommentInOrg: [
      "DELETE /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}"
    ],
    deleteDiscussionInOrg: [
      "DELETE /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}"
    ],
    deleteInOrg: ["DELETE /orgs/{org}/teams/{team_slug}"],
    getByName: ["GET /orgs/{org}/teams/{team_slug}"],
    getDiscussionCommentInOrg: [
      "GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}"
    ],
    getDiscussionInOrg: [
      "GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}"
    ],
    getMembershipForUserInOrg: [
      "GET /orgs/{org}/teams/{team_slug}/memberships/{username}"
    ],
    list: ["GET /orgs/{org}/teams"],
    listChildInOrg: ["GET /orgs/{org}/teams/{team_slug}/teams"],
    listDiscussionCommentsInOrg: [
      "GET /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments"
    ],
    listDiscussionsInOrg: ["GET /orgs/{org}/teams/{team_slug}/discussions"],
    listForAuthenticatedUser: ["GET /user/teams"],
    listMembersInOrg: ["GET /orgs/{org}/teams/{team_slug}/members"],
    listPendingInvitationsInOrg: [
      "GET /orgs/{org}/teams/{team_slug}/invitations"
    ],
    listReposInOrg: ["GET /orgs/{org}/teams/{team_slug}/repos"],
    removeMembershipForUserInOrg: [
      "DELETE /orgs/{org}/teams/{team_slug}/memberships/{username}"
    ],
    removeRepoInOrg: [
      "DELETE /orgs/{org}/teams/{team_slug}/repos/{owner}/{repo}"
    ],
    updateDiscussionCommentInOrg: [
      "PATCH /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}/comments/{comment_number}"
    ],
    updateDiscussionInOrg: [
      "PATCH /orgs/{org}/teams/{team_slug}/discussions/{discussion_number}"
    ],
    updateInOrg: ["PATCH /orgs/{org}/teams/{team_slug}"]
  },
  users: {
    addEmailForAuthenticated: [
      "POST /user/emails",
      {},
      { renamed: ["users", "addEmailForAuthenticatedUser"] }
    ],
    addEmailForAuthenticatedUser: ["POST /user/emails"],
    addSocialAccountForAuthenticatedUser: ["POST /user/social_accounts"],
    block: ["PUT /user/blocks/{username}"],
    checkBlocked: ["GET /user/blocks/{username}"],
    checkFollowingForUser: ["GET /users/{username}/following/{target_user}"],
    checkPersonIsFollowedByAuthenticated: ["GET /user/following/{username}"],
    createGpgKeyForAuthenticated: [
      "POST /user/gpg_keys",
      {},
      { renamed: ["users", "createGpgKeyForAuthenticatedUser"] }
    ],
    createGpgKeyForAuthenticatedUser: ["POST /user/gpg_keys"],
    createPublicSshKeyForAuthenticated: [
      "POST /user/keys",
      {},
      { renamed: ["users", "createPublicSshKeyForAuthenticatedUser"] }
    ],
    createPublicSshKeyForAuthenticatedUser: ["POST /user/keys"],
    createSshSigningKeyForAuthenticatedUser: ["POST /user/ssh_signing_keys"],
    deleteAttestationsBulk: [
      "POST /users/{username}/attestations/delete-request"
    ],
    deleteAttestationsById: [
      "DELETE /users/{username}/attestations/{attestation_id}"
    ],
    deleteAttestationsBySubjectDigest: [
      "DELETE /users/{username}/attestations/digest/{subject_digest}"
    ],
    deleteEmailForAuthenticated: [
      "DELETE /user/emails",
      {},
      { renamed: ["users", "deleteEmailForAuthenticatedUser"] }
    ],
    deleteEmailForAuthenticatedUser: ["DELETE /user/emails"],
    deleteGpgKeyForAuthenticated: [
      "DELETE /user/gpg_keys/{gpg_key_id}",
      {},
      { renamed: ["users", "deleteGpgKeyForAuthenticatedUser"] }
    ],
    deleteGpgKeyForAuthenticatedUser: ["DELETE /user/gpg_keys/{gpg_key_id}"],
    deletePublicSshKeyForAuthenticated: [
      "DELETE /user/keys/{key_id}",
      {},
      { renamed: ["users", "deletePublicSshKeyForAuthenticatedUser"] }
    ],
    deletePublicSshKeyForAuthenticatedUser: ["DELETE /user/keys/{key_id}"],
    deleteSocialAccountForAuthenticatedUser: ["DELETE /user/social_accounts"],
    deleteSshSigningKeyForAuthenticatedUser: [
      "DELETE /user/ssh_signing_keys/{ssh_signing_key_id}"
    ],
    follow: ["PUT /user/following/{username}"],
    getAuthenticated: ["GET /user"],
    getById: ["GET /user/{account_id}"],
    getByUsername: ["GET /users/{username}"],
    getContextForUser: ["GET /users/{username}/hovercard"],
    getGpgKeyForAuthenticated: [
      "GET /user/gpg_keys/{gpg_key_id}",
      {},
      { renamed: ["users", "getGpgKeyForAuthenticatedUser"] }
    ],
    getGpgKeyForAuthenticatedUser: ["GET /user/gpg_keys/{gpg_key_id}"],
    getPublicSshKeyForAuthenticated: [
      "GET /user/keys/{key_id}",
      {},
      { renamed: ["users", "getPublicSshKeyForAuthenticatedUser"] }
    ],
    getPublicSshKeyForAuthenticatedUser: ["GET /user/keys/{key_id}"],
    getSshSigningKeyForAuthenticatedUser: [
      "GET /user/ssh_signing_keys/{ssh_signing_key_id}"
    ],
    list: ["GET /users"],
    listAttestations: ["GET /users/{username}/attestations/{subject_digest}"],
    listAttestationsBulk: [
      "POST /users/{username}/attestations/bulk-list{?per_page,before,after}"
    ],
    listBlockedByAuthenticated: [
      "GET /user/blocks",
      {},
      { renamed: ["users", "listBlockedByAuthenticatedUser"] }
    ],
    listBlockedByAuthenticatedUser: ["GET /user/blocks"],
    listEmailsForAuthenticated: [
      "GET /user/emails",
      {},
      { renamed: ["users", "listEmailsForAuthenticatedUser"] }
    ],
    listEmailsForAuthenticatedUser: ["GET /user/emails"],
    listFollowedByAuthenticated: [
      "GET /user/following",
      {},
      { renamed: ["users", "listFollowedByAuthenticatedUser"] }
    ],
    listFollowedByAuthenticatedUser: ["GET /user/following"],
    listFollowersForAuthenticatedUser: ["GET /user/followers"],
    listFollowersForUser: ["GET /users/{username}/followers"],
    listFollowingForUser: ["GET /users/{username}/following"],
    listGpgKeysForAuthenticated: [
      "GET /user/gpg_keys",
      {},
      { renamed: ["users", "listGpgKeysForAuthenticatedUser"] }
    ],
    listGpgKeysForAuthenticatedUser: ["GET /user/gpg_keys"],
    listGpgKeysForUser: ["GET /users/{username}/gpg_keys"],
    listPublicEmailsForAuthenticated: [
      "GET /user/public_emails",
      {},
      { renamed: ["users", "listPublicEmailsForAuthenticatedUser"] }
    ],
    listPublicEmailsForAuthenticatedUser: ["GET /user/public_emails"],
    listPublicKeysForUser: ["GET /users/{username}/keys"],
    listPublicSshKeysForAuthenticated: [
      "GET /user/keys",
      {},
      { renamed: ["users", "listPublicSshKeysForAuthenticatedUser"] }
    ],
    listPublicSshKeysForAuthenticatedUser: ["GET /user/keys"],
    listSocialAccountsForAuthenticatedUser: ["GET /user/social_accounts"],
    listSocialAccountsForUser: ["GET /users/{username}/social_accounts"],
    listSshSigningKeysForAuthenticatedUser: ["GET /user/ssh_signing_keys"],
    listSshSigningKeysForUser: ["GET /users/{username}/ssh_signing_keys"],
    setPrimaryEmailVisibilityForAuthenticated: [
      "PATCH /user/email/visibility",
      {},
      { renamed: ["users", "setPrimaryEmailVisibilityForAuthenticatedUser"] }
    ],
    setPrimaryEmailVisibilityForAuthenticatedUser: [
      "PATCH /user/email/visibility"
    ],
    unblock: ["DELETE /user/blocks/{username}"],
    unfollow: ["DELETE /user/following/{username}"],
    updateAuthenticated: ["PATCH /user"]
  }
};
var endpoints_default = Endpoints;

// node_modules/@octokit/plugin-rest-endpoint-methods/dist-src/endpoints-to-methods.js
var endpointMethodsMap = /* @__PURE__ */ new Map();
for (const [scope, endpoints] of Object.entries(endpoints_default)) {
  for (const [methodName, endpoint2] of Object.entries(endpoints)) {
    const [route, defaults, decorations] = endpoint2;
    const [method, url] = route.split(/ /);
    const endpointDefaults = Object.assign(
      {
        method,
        url
      },
      defaults
    );
    if (!endpointMethodsMap.has(scope)) {
      endpointMethodsMap.set(scope, /* @__PURE__ */ new Map());
    }
    endpointMethodsMap.get(scope).set(methodName, {
      scope,
      methodName,
      endpointDefaults,
      decorations
    });
  }
}
var handler = {
  has({ scope }, methodName) {
    return endpointMethodsMap.get(scope).has(methodName);
  },
  getOwnPropertyDescriptor(target, methodName) {
    return {
      value: this.get(target, methodName),
      // ensures method is in the cache
      configurable: true,
      writable: true,
      enumerable: true
    };
  },
  defineProperty(target, methodName, descriptor) {
    Object.defineProperty(target.cache, methodName, descriptor);
    return true;
  },
  deleteProperty(target, methodName) {
    delete target.cache[methodName];
    return true;
  },
  ownKeys({ scope }) {
    return [...endpointMethodsMap.get(scope).keys()];
  },
  set(target, methodName, value) {
    return target.cache[methodName] = value;
  },
  get({ octokit, scope, cache }, methodName) {
    if (cache[methodName]) {
      return cache[methodName];
    }
    const method = endpointMethodsMap.get(scope).get(methodName);
    if (!method) {
      return void 0;
    }
    const { endpointDefaults, decorations } = method;
    if (decorations) {
      cache[methodName] = decorate(
        octokit,
        scope,
        methodName,
        endpointDefaults,
        decorations
      );
    } else {
      cache[methodName] = octokit.request.defaults(endpointDefaults);
    }
    return cache[methodName];
  }
};
function endpointsToMethods(octokit) {
  const newMethods = {};
  for (const scope of endpointMethodsMap.keys()) {
    newMethods[scope] = new Proxy({ octokit, scope, cache: {} }, handler);
  }
  return newMethods;
}
function decorate(octokit, scope, methodName, defaults, decorations) {
  const requestWithDefaults = octokit.request.defaults(defaults);
  function withDecorations(...args) {
    let options = requestWithDefaults.endpoint.merge(...args);
    if (decorations.mapToData) {
      options = Object.assign({}, options, {
        data: options[decorations.mapToData],
        [decorations.mapToData]: void 0
      });
      return requestWithDefaults(options);
    }
    if (decorations.renamed) {
      const [newScope, newMethodName] = decorations.renamed;
      octokit.log.warn(
        `octokit.${scope}.${methodName}() has been renamed to octokit.${newScope}.${newMethodName}()`
      );
    }
    if (decorations.deprecated) {
      octokit.log.warn(decorations.deprecated);
    }
    if (decorations.renamedParameters) {
      const options2 = requestWithDefaults.endpoint.merge(...args);
      for (const [name, alias] of Object.entries(
        decorations.renamedParameters
      )) {
        if (name in options2) {
          octokit.log.warn(
            `"${name}" parameter is deprecated for "octokit.${scope}.${methodName}()". Use "${alias}" instead`
          );
          if (!(alias in options2)) {
            options2[alias] = options2[name];
          }
          delete options2[name];
        }
      }
      return requestWithDefaults(options2);
    }
    return requestWithDefaults(...args);
  }
  return Object.assign(withDecorations, requestWithDefaults);
}

// node_modules/@octokit/plugin-rest-endpoint-methods/dist-src/index.js
function restEndpointMethods(octokit) {
  const api = endpointsToMethods(octokit);
  return {
    rest: api
  };
}
restEndpointMethods.VERSION = VERSION7;
function legacyRestEndpointMethods(octokit) {
  const api = endpointsToMethods(octokit);
  return {
    ...api,
    rest: api
  };
}
legacyRestEndpointMethods.VERSION = VERSION7;

// node_modules/@octokit/rest/dist-src/version.js
var VERSION8 = "22.0.1";

// node_modules/@octokit/rest/dist-src/index.js
var Octokit2 = Octokit.plugin(requestLog, legacyRestEndpointMethods, paginateRest).defaults(
  {
    userAgent: `octokit-rest.js/${VERSION8}`
  }
);

// src/lib/dispatch/routing.ts
var PHASE_TO_WORKFLOW = Object.freeze({
  refine: Object.freeze({ workflow: "ferry-refine.yml", dispatchType: "ferry-refine" }),
  dev: Object.freeze({ workflow: "ferry-dev.yml", dispatchType: "ferry-dev" }),
  review: Object.freeze({ workflow: "ferry-review.yml", dispatchType: "ferry-review" }),
  iterate: Object.freeze({ workflow: "ferry-iterate.yml", dispatchType: "ferry-iterate" })
});

// src/lib/dispatch/runner/github-actions/index.ts
var MAX_CONTENT_CHARS_DEFAULT = 4e4;
var GitHubActionsRunner = class {
  octokit;
  defaultOwner;
  defaultRepo;
  constructor(tokenOrOctokit, owner, repo) {
    this.octokit = typeof tokenOrOctokit === "string" ? new Octokit2({ auth: tokenOrOctokit }) : tokenOrOctokit;
    this.defaultOwner = owner;
    this.defaultRepo = repo;
  }
  async dispatch(phase, payload) {
    const route = PHASE_TO_WORKFLOW[phase];
    if (!route) throw new Error(`Unknown phase for dispatch: ${phase}`);
    await this.octokit.repos.createDispatchEvent({
      owner: this.defaultOwner,
      repo: this.defaultRepo,
      event_type: route.dispatchType,
      client_payload: payload
    });
  }
  async getRepoDefaultBranch(owner, repo) {
    const { data } = await this.octokit.repos.get({ owner, repo });
    return data.default_branch;
  }
  async listPRsForBranch(owner, repo, branch) {
    const { data } = await this.octokit.pulls.list({
      owner,
      repo,
      state: "open",
      head: `${owner}:${branch}`,
      per_page: 1
    });
    return data.map((p) => ({
      number: p.number,
      title: p.title,
      baseRef: p.base.ref,
      headRef: p.head.ref,
      headSha: p.head.sha,
      mergeable: null
    }));
  }
  async getPR(prRef) {
    const { data } = await this.octokit.pulls.get({
      owner: prRef.owner,
      repo: prRef.repo,
      pull_number: prRef.prNumber
    });
    return {
      number: data.number,
      title: data.title,
      baseRef: data.base.ref,
      headRef: data.head.ref,
      headSha: data.head.sha,
      mergeable: data.mergeable ?? null
    };
  }
  async listPRFiles(prRef) {
    const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
      owner: prRef.owner,
      repo: prRef.repo,
      pull_number: prRef.prNumber,
      per_page: 100
    });
    return files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch
    }));
  }
  async listPRCommits(prRef) {
    const { data } = await this.octokit.pulls.listCommits({
      owner: prRef.owner,
      repo: prRef.repo,
      pull_number: prRef.prNumber,
      per_page: 50
    });
    return data.map((c) => ({ sha: c.sha, message: c.commit.message }));
  }
  async getCommitStatus(owner, repo, sha) {
    const { data } = await this.octokit.checks.listForRef({ owner, repo, ref: sha, per_page: 100 });
    const runs = data.check_runs;
    if (runs.some((r) => r.status !== "completed")) return "pending";
    if (runs.some((r) => r.conclusion === "failure" || r.conclusion === "timed_out")) return "red";
    return "green";
  }
  async getFileContent(owner, repo, path4, ref) {
    try {
      const { data } = await this.octokit.repos.getContent({ owner, repo, path: path4, ref });
      if ("content" in data && typeof data.content === "string") {
        const decoded = Buffer.from(data.content, "base64").toString("utf8");
        const maxChars = parseInt(process.env.FERRY_FILE_DISPLAY_CHARS ?? "", 10) || MAX_CONTENT_CHARS_DEFAULT;
        return decoded.length > maxChars ? decoded.slice(0, maxChars) + "\n... (truncated)" : decoded;
      }
      return "(binary file or directory \u2014 cannot display)";
    } catch (e) {
      return `(error fetching content: ${e.message})`;
    }
  }
  async createPR(owner, repo, head, base, title, body, options) {
    try {
      const { data } = await this.octokit.pulls.create({
        owner,
        repo,
        head,
        base,
        title,
        body,
        draft: options?.draft ?? true
      });
      return data.html_url;
    } catch {
      const { data: existing } = await this.octokit.pulls.list({
        owner,
        repo,
        state: "open",
        head: `${owner}:${head}`,
        per_page: 1
      });
      if (existing.length > 0) return existing[0].html_url;
      throw new Error(`Failed to create or find PR for head branch ${head}`);
    }
  }
  async markPRReadyForReview(owner, repo, prNumber) {
    const { data } = await this.octokit.pulls.get({ owner, repo, pull_number: prNumber });
    await this.octokit.graphql(
      `mutation($pullRequestId: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
          pullRequest { id }
        }
      }`,
      { pullRequestId: data.node_id }
    );
  }
  async commentOnPR(prRef, body) {
    await this.octokit.issues.createComment({
      owner: prRef.owner,
      repo: prRef.repo,
      issue_number: prRef.prNumber,
      body
    });
  }
  async addLabelsToPR(prRef, labels) {
    await this.octokit.issues.addLabels({
      owner: prRef.owner,
      repo: prRef.repo,
      issue_number: prRef.prNumber,
      labels
    });
  }
  async removeLabelFromPR(prRef, label) {
    await this.octokit.issues.removeLabel({
      owner: prRef.owner,
      repo: prRef.repo,
      issue_number: prRef.prNumber,
      name: label
    });
  }
  async listPRComments(prRef, count) {
    const { data } = await this.octokit.issues.listComments({
      owner: prRef.owner,
      repo: prRef.repo,
      issue_number: prRef.prNumber,
      sort: "created",
      direction: "desc",
      per_page: count
    });
    return data.map((c) => ({ id: c.id, body: c.body ?? "" }));
  }
};

// src/lib/dispatch/runner/gitlab/index.ts
var MAX_CONTENT_CHARS_DEFAULT2 = 4e4;
var DRAFT_PREFIX = "Draft: ";
var GitLabRunner = class {
  constructor(token, defaultOwner, defaultRepo, opts = {}) {
    this.defaultOwner = defaultOwner;
    this.defaultRepo = defaultRepo;
    this.authHeader = `Bearer ${token}`;
    this.apiBase = (opts.apiBase ?? "https://gitlab.com/api/v4").replace(/\/+$/, "");
    this.pipelineTriggerToken = opts.pipelineTriggerToken;
    this.triggerRef = opts.triggerRef ?? "main";
  }
  defaultOwner;
  defaultRepo;
  authHeader;
  apiBase;
  pipelineTriggerToken;
  triggerRef;
  // ── Internals ────────────────────────────────────────────────────────────
  projectPath(owner, repo) {
    return encodeURIComponent(`${owner}/${repo}`);
  }
  baseHeaders(extra) {
    return { Authorization: this.authHeader, Accept: "application/json", ...extra };
  }
  async request(method, path4, init = {}) {
    const headers = this.baseHeaders(init.headers);
    let body;
    if (init.rawBody !== void 0) {
      body = init.rawBody;
    } else if (init.body !== void 0) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.body);
    }
    const url = `${this.apiBase}${path4}`;
    const response = await fetch(url, { method, headers, body });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new FerryError("transient", {
        reason: "gitlab-request-failed",
        method,
        path: path4,
        status: response.status,
        body: text.slice(0, 500)
      });
    }
    if (response.status === 204) return void 0;
    return await response.json();
  }
  async getProject(owner, repo) {
    return this.request("GET", `/projects/${this.projectPath(owner, repo)}`);
  }
  // ── CIRunner methods ─────────────────────────────────────────────────────
  async dispatch(phase, payload) {
    const route = PHASE_TO_WORKFLOW[phase];
    if (!route) throw new Error(`Unknown phase for dispatch: ${phase}`);
    if (!this.pipelineTriggerToken) {
      throw new FerryError("state-invariant", {
        reason: "missing-pipeline-trigger-token",
        env: "FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN"
      });
    }
    const form = new URLSearchParams();
    form.set("token", this.pipelineTriggerToken);
    form.set("ref", this.triggerRef);
    form.set("variables[FERRY_DISPATCH_TYPE]", route.dispatchType);
    form.set("variables[FERRY_ENVELOPE_PAYLOAD]", JSON.stringify(payload));
    const url = `${this.apiBase}/projects/${this.projectPath(this.defaultOwner, this.defaultRepo)}/trigger/pipeline`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new FerryError("transient", {
        reason: "gitlab-pipeline-trigger-failed",
        status: response.status,
        body: text.slice(0, 500)
      });
    }
  }
  async getRepoDefaultBranch(owner, repo) {
    const project = await this.getProject(owner, repo);
    return project.default_branch;
  }
  async listPRsForBranch(owner, repo, branch) {
    const path4 = `/projects/${this.projectPath(owner, repo)}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}&per_page=1`;
    const mrs = await this.request("GET", path4);
    return mrs.map((mr) => this.toPR(mr));
  }
  async getPR(prRef) {
    const path4 = `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}`;
    const mr = await this.request("GET", path4);
    return this.toPR(mr);
  }
  async listPRFiles(prRef) {
    const path4 = `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}/changes`;
    const data = await this.request("GET", path4);
    return data.changes.map((c) => ({
      filename: c.new_path || c.old_path,
      status: c.new_file ? "added" : c.deleted_file ? "removed" : c.renamed_file ? "renamed" : "modified",
      additions: countDiffLines(c.diff, "+"),
      deletions: countDiffLines(c.diff, "-"),
      patch: c.diff || void 0
    }));
  }
  async listPRCommits(prRef) {
    const path4 = `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}/commits?per_page=50`;
    const commits = await this.request("GET", path4);
    return commits.map((c) => ({ sha: c.id, message: c.message }));
  }
  async getCommitStatus(owner, repo, sha) {
    const path4 = `/projects/${this.projectPath(owner, repo)}/pipelines?sha=${encodeURIComponent(sha)}&per_page=1&order_by=id&sort=desc`;
    const pipelines = await this.request("GET", path4);
    if (pipelines.length === 0) return "pending";
    return collapsePipelineStatus(pipelines[0].status);
  }
  async getFileContent(owner, repo, path4, ref) {
    try {
      const url = `${this.apiBase}/projects/${this.projectPath(owner, repo)}/repository/files/${encodeURIComponent(path4)}/raw?ref=${encodeURIComponent(ref)}`;
      const response = await fetch(url, { method: "GET", headers: this.baseHeaders() });
      if (!response.ok) {
        return `(error fetching content: HTTP ${response.status})`;
      }
      const text = await response.text();
      const maxChars = parseInt(process.env.FERRY_FILE_DISPLAY_CHARS ?? "", 10) || MAX_CONTENT_CHARS_DEFAULT2;
      return text.length > maxChars ? text.slice(0, maxChars) + "\n... (truncated)" : text;
    } catch (e) {
      return `(error fetching content: ${e.message})`;
    }
  }
  async createPR(owner, repo, head, base, title, body) {
    const draftTitle = title.startsWith(DRAFT_PREFIX) ? title : `${DRAFT_PREFIX}${title}`;
    const path4 = `/projects/${this.projectPath(owner, repo)}/merge_requests`;
    try {
      const mr = await this.request("POST", path4, {
        body: {
          source_branch: head,
          target_branch: base,
          title: draftTitle,
          description: body
        }
      });
      return mr.web_url;
    } catch {
      const existing = await this.listPRsForBranch(owner, repo, head);
      if (existing.length > 0) {
        const mr = await this.request(
          "GET",
          `/projects/${this.projectPath(owner, repo)}/merge_requests/${existing[0].number}`
        );
        return mr.web_url;
      }
      throw new Error(`Failed to create or find MR for source branch ${head}`);
    }
  }
  async markPRReadyForReview(owner, repo, prNumber) {
    const mr = await this.request(
      "GET",
      `/projects/${this.projectPath(owner, repo)}/merge_requests/${prNumber}`
    );
    if (!mr.title.startsWith(DRAFT_PREFIX)) return;
    const newTitle = mr.title.slice(DRAFT_PREFIX.length);
    await this.request(
      "PUT",
      `/projects/${this.projectPath(owner, repo)}/merge_requests/${prNumber}`,
      {
        body: { title: newTitle }
      }
    );
  }
  async commentOnPR(prRef, body) {
    await this.request(
      "POST",
      `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}/notes`,
      { body: { body } }
    );
  }
  async addLabelsToPR(prRef, labels) {
    if (labels.length === 0) return;
    await this.request(
      "PUT",
      `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}`,
      { body: { add_labels: labels.join(",") } }
    );
  }
  async removeLabelFromPR(prRef, label) {
    await this.request(
      "PUT",
      `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}`,
      { body: { remove_labels: label } }
    );
  }
  async listPRComments(prRef, count) {
    const perPage = Math.min(Math.max(count, 1), 100);
    const path4 = `/projects/${this.projectPath(prRef.owner, prRef.repo)}/merge_requests/${prRef.prNumber}/notes?sort=desc&order_by=created_at&per_page=${perPage}`;
    const notes = await this.request("GET", path4);
    return notes.map((n) => ({ id: n.id, body: n.body ?? "" }));
  }
  // ── Helpers ──────────────────────────────────────────────────────────────
  toPR(mr) {
    const conflict = mr.has_conflicts === true || typeof mr.detailed_merge_status === "string" && mr.detailed_merge_status.includes("conflict");
    const mergeable = conflict === true ? false : mr.has_conflicts === false ? true : null;
    return {
      number: mr.iid,
      title: mr.title,
      baseRef: mr.target_branch,
      headRef: mr.source_branch,
      headSha: mr.sha,
      mergeable
    };
  }
};
function countDiffLines(diff, prefix) {
  if (!diff) return 0;
  let count = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith(prefix) && !line.startsWith(prefix.repeat(3))) count += 1;
  }
  return count;
}
function collapsePipelineStatus(status) {
  switch (status) {
    case "success":
    case "skipped":
    case "manual":
      return "green";
    case "failed":
      return "red";
    case "canceled":
      return "red";
    case "created":
    case "waiting_for_resource":
    case "preparing":
    case "pending":
    case "running":
    case "scheduled":
      return "pending";
  }
}

// src/lib/dispatch/runner/factory.ts
function resolveForgeFromEnv() {
  const raw = (process.env.FERRY_FORGE ?? "").trim().toLowerCase();
  if (raw === "" || raw === "github") return "github";
  if (raw === "gitlab") return "gitlab";
  throw new FerryError("state-invariant", {
    reason: "unknown-forge",
    value: raw,
    supported: ["github", "gitlab"]
  });
}
function createRunnerFromEnv(token, owner, repo) {
  const forge = resolveForgeFromEnv();
  switch (forge) {
    case "github":
      return new GitHubActionsRunner(token, owner, repo);
    case "gitlab":
      return new GitLabRunner(token, owner, repo, {
        apiBase: process.env.FERRY_GITLAB_API_BASE,
        pipelineTriggerToken: process.env.FERRY_GITLAB_PIPELINE_TRIGGER_TOKEN,
        triggerRef: process.env.FERRY_GITLAB_TRIGGER_REF
      });
  }
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

// src/lib/claude-code/tool-policy.ts
var NO_AUTO_MERGE_DENY = [
  "Bash(gh pr merge)",
  "Bash(gh pr merge:*)",
  "Bash(gh merge:*)",
  "Bash(gh pr close)",
  "Bash(gh pr close:*)",
  "Bash(git push)",
  "Bash(git push:*)"
];
function assertToolPolicyEnforcesNoAutoMerge(policy) {
  const denySet = new Set(policy.disallowedTools);
  const missing = NO_AUTO_MERGE_DENY.filter((rule) => !denySet.has(rule));
  if (missing.length > 0) {
    throw new Error(`no-auto-merge invariant violated: deny set is missing ${missing.join(", ")}`);
  }
  const regranted = policy.allowedTools.filter((rule) => denySet.has(rule));
  if (regranted.length > 0) {
    throw new Error(
      `no-auto-merge invariant violated: allowed tools re-grant denied rule(s) ${regranted.join(
        ", "
      )}`
    );
  }
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

// src/lib/claude-code/claude-args.ts
function buildClaudeArgs(input) {
  const servers = input.mcpServers ?? [];
  const allowedTools = [
    ...nativeToolsForRole(input.role),
    `Write(${CC_OUTPUT_ARTIFACT_PATH})`,
    ...mcpToolAllowlist(servers)
  ];
  const disallowedTools = [...NO_AUTO_MERGE_DENY];
  assertToolPolicyEnforcesNoAutoMerge({ allowedTools, disallowedTools });
  const args = [
    "--append-system-prompt",
    input.system,
    "--allowedTools",
    allowedTools.join(","),
    "--disallowedTools",
    disallowedTools.join(",")
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

// src/lib/claude-code/job-permissions.ts
var REQUIRED_WRITE_SCOPES = ["contents", "pull-requests", "issues", "id-token"];
var CLAUDE_CODE_JOB_PERMISSIONS = {
  contents: "write",
  "pull-requests": "write",
  issues: "write",
  "id-token": "write"
};
function assertLeastPrivilege(permissions) {
  const fail2 = (reason) => {
    throw new Error(`least-privilege violation: ${reason}`);
  };
  if ("write-all" in permissions || "read-all" in permissions) {
    fail2("blanket grant (write-all / read-all) is forbidden for the claude-code job");
  }
  for (const scope of REQUIRED_WRITE_SCOPES) {
    if (permissions[scope] !== "write") {
      fail2(`required scope "${scope}" must be "write" (got "${permissions[scope] ?? "missing"}")`);
    }
  }
  for (const [scope, level] of Object.entries(permissions)) {
    if (REQUIRED_WRITE_SCOPES.includes(scope)) continue;
    if (level !== "none") {
      fail2(
        `scope "${scope}: ${level}" exceeds least privilege (only contents / pull-requests / issues may be granted)`
      );
    }
  }
}
function renderPermissionsYaml(permissions) {
  const granted = Object.entries(permissions).filter(([, level]) => level !== "none");
  const ordered = [
    ...REQUIRED_WRITE_SCOPES.filter((s) => granted.some(([k]) => k === s)).map(
      (s) => [s, permissions[s]]
    ),
    ...granted.filter(([k]) => !REQUIRED_WRITE_SCOPES.includes(k)).sort(([a], [b]) => a.localeCompare(b))
  ];
  return ["permissions:", ...ordered.map(([scope, level]) => `  ${scope}: ${level}`)].join("\n");
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
function createLogger2(correlationId, component = "ferry") {
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
  assertLeastPrivilege(CLAUDE_CODE_JOB_PERMISSIONS);
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
        logger: createLogger2(envelope.event_id, "ferry:cc-prepare"),
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
    idempotencyMarker,
    // Canonical least-privilege permissions block for the calling workflow job.
    permissionsYaml: renderPermissionsYaml(CLAUDE_CODE_JOB_PERMISSIONS)
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
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    throw new Error(
      "cc-prepare: CLAUDE_CODE_OAUTH_TOKEN is not set. Run `claude setup-token` and add the resulting token to repo secrets as CLAUDE_CODE_OAUTH_TOKEN (ADR-0006 \xA76)."
    );
  }
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
  const logger = createLogger2(envelope.event_id, "ferry:cc-prepare");
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
  let prNumber;
  switch (role) {
    case "refiner": {
      const innerTracker = new InMemoryTracker();
      innerTracker.seed(issue);
      const allowedRefinerTrackerMethods = /* @__PURE__ */ new Set([
        "seed",
        "getIssue",
        "getSubtaskDetails"
      ]);
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
    case "developer": {
      const {
        runner,
        owner,
        repo,
        baseBranch,
        effectiveCfg: roleCfg,
        roleOverrides
      } = await resolveRoleRuntimeContext({ ferryCfg, issue, repoRoot, logger });
      const branchName = `${resolveBranchPrefix(roleCfg.git.working_branch_prefix, issue)}${envelope.ticket_key}`;
      const openPrs = await runner.listPRsForBranch(owner, repo, branchName).catch((err) => {
        logger.warn(
          "cc-prepare: listPRsForBranch failed for developer pr_number probe \u2014 leaving pr_number empty",
          { err: err instanceof Error ? err.message : String(err) }
        );
        return [];
      });
      prNumber = openPrs[0]?.number;
      const subtasks = await tracker.getSubtasks(envelope.ticket_key);
      const testRunner = detectTestRunner(packageJsonPath(repoRoot));
      const pkgManagerHint = detectPackageManager(repoRoot);
      const tree = repoTree(repoRoot);
      const mcpPool = loadMcpServers();
      outputs = await prepareCcJob({
        envelope,
        issue,
        role: "developer",
        input: {
          role: "developer",
          effectiveCfg: roleCfg,
          subtasks,
          testRunner,
          pkgManagerHint,
          tree,
          typeOverride: roleOverrides.typeOverride,
          owner,
          repo,
          baseBranch,
          mcpPool,
          repoRoot,
          dryRun: roleOverrides.dryRun === true,
          _runner: runner
        }
      });
      break;
    }
    case "reviewer": {
      const {
        runner,
        owner,
        repo,
        effectiveCfg: roleCfg,
        roleOverrides
      } = await resolveRoleRuntimeContext({ ferryCfg, issue, repoRoot, logger });
      const branchName = `${resolveBranchPrefix(roleCfg.git.working_branch_prefix, issue)}${envelope.ticket_key}`;
      const prs = await runner.listPRsForBranch(owner, repo, branchName);
      if (prs.length === 0) {
        throw new Error(
          `cc-prepare: no open PR found for branch '${branchName}' \u2014 reviewer cannot run.`
        );
      }
      const pr = await runner.getPR({ owner, repo, prNumber: prs[0].number });
      const files = await runner.listPRFiles({ owner, repo, prNumber: pr.number });
      const commits = await runner.listPRCommits({ owner, repo, prNumber: pr.number });
      prNumber = pr.number;
      const capabilities = resolveCapabilities(issue.labels, roleCfg.labels, logger);
      outputs = await prepareCcJob({
        envelope,
        issue,
        role: "reviewer",
        input: {
          role: "reviewer",
          effectiveCfg: roleCfg,
          pr,
          files,
          commits,
          branchName,
          typeOverride: roleOverrides.typeOverride,
          reviewRubric: roleOverrides.reviewRubric,
          capabilities,
          repoRoot
        }
      });
      break;
    }
    case "iterator": {
      const {
        runner,
        owner,
        repo,
        baseBranch,
        effectiveCfg: roleCfg,
        roleOverrides
      } = await resolveRoleRuntimeContext({ ferryCfg, issue, repoRoot, logger });
      const branchName = `${resolveBranchPrefix(roleCfg.git.working_branch_prefix, issue)}${envelope.ticket_key}`;
      const prs = await runner.listPRsForBranch(owner, repo, branchName);
      if (prs.length === 0) {
        throw new Error(
          `cc-prepare: no open PR found for branch '${branchName}' \u2014 iterator cannot run.`
        );
      }
      const pr = await runner.getPR({ owner, repo, prNumber: prs[0].number });
      prNumber = pr.number;
      const headSha = pr.headSha;
      const recentComments = await runner.listPRComments({ owner, repo, prNumber: pr.number }, 30);
      const reviewComments = recentComments.filter((c) => c.body.includes("[ferry:reviewer:"));
      if (reviewComments.length === 0) {
        throw new Error(
          `cc-prepare: no reviewer comment found on PR#${pr.number} \u2014 iterator cannot run.`
        );
      }
      const reviewComment = reviewComments[0].body;
      if (/\*\*Verdict\*\*:\s*Approved\b/.test(reviewComment)) {
        throw new Error(
          `cc-prepare: PR#${pr.number} latest reviewer comment shows Approved verdict \u2014 iterator should not have been dispatched.`
        );
      }
      configureFerryGitUser(repoRoot);
      if (checkoutExistingBranch(branchName, repoRoot) === "not-found") {
        throw new Error(
          `cc-prepare: branch '${branchName}' not found on origin \u2014 iterator cannot run.`
        );
      }
      const mergeConflicts = fetchAndMergeBase(baseBranch, repoRoot);
      const existingLog = execFileSync5("git", ["log", `origin/${baseBranch}..HEAD`, "--oneline"], {
        cwd: repoRoot,
        encoding: "utf8"
      }).trim();
      const capabilities = resolveCapabilities(issue.labels, roleCfg.labels, logger);
      const mcpPool = loadMcpServers();
      outputs = await prepareCcJob({
        envelope,
        issue,
        role: "iterator",
        input: {
          role: "iterator",
          effectiveCfg: roleCfg,
          headSha,
          reviewComment,
          mergeConflicts,
          existingLog,
          mcpPool,
          configLabels: roleCfg.labels,
          capabilities,
          typeOverride: roleOverrides.typeOverride,
          repoRoot
        }
      });
      break;
    }
    default: {
      const _exhaustive = role;
      throw new Error(`cc-prepare: unknown ferry role: ${String(_exhaustive)}`);
    }
  }
  writeOutput("prompt", outputs.prompt);
  writeOutput("claude_args", JSON.stringify(outputs.claudeArgs));
  writeOutput("allowed_native_tools", JSON.stringify(outputs.allowedNativeTools));
  writeOutput("output_artifact_path", outputs.outputArtifactPath);
  writeOutput("mcp_config", JSON.stringify(outputs.mcpConfig));
  writeOutput("idempotency_marker", outputs.idempotencyMarker);
  writeOutput("permissions_yaml", outputs.permissionsYaml);
  writeOutput("pr_number", prNumber !== void 0 ? String(prNumber) : "");
  return outputs;
}
async function resolveRoleRuntimeContext(args) {
  const { ferryCfg, issue, repoRoot, logger } = args;
  const githubToken = requireEnv("GITHUB_TOKEN");
  const githubRepo = requireEnv("GITHUB_REPO");
  const [owner, repo] = githubRepo.split("/");
  if (!owner || !repo) {
    throw new Error(
      `cc-prepare: GITHUB_REPO is malformed (expected owner/repo, got: ${githubRepo})`
    );
  }
  const runner = createRunnerFromEnv(githubToken, owner, repo);
  const { baseBranch } = await resolveGitConfig(ferryCfg, runner, owner, repo);
  const cfgFromBase = loadFerryConfigFromBaseBranch(baseBranch, repoRoot, ferryCfg);
  const roleOverrides = resolveTicketOverrides(issue.labels, logger, {
    allowSkipReview: cfgFromBase.safety?.allow_skip_review === true
  });
  const effectiveCfg = applyTicketOverrides(cfgFromBase, roleOverrides);
  enforceProviderGate(effectiveCfg);
  return { runner, owner, repo, baseBranch, effectiveCfg, roleOverrides };
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
/*! Bundled license information:

@octokit/request-error/dist-src/index.js:
  (* v8 ignore else -- @preserve -- Bug with vitest coverage where it sees an else branch that doesn't exist *)

@octokit/request/dist-bundle/index.js:
  (* v8 ignore next -- @preserve *)
  (* v8 ignore else -- @preserve *)
*/
