// src/lib/io/jira.ts
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, unlink } from "node:fs/promises";

// src/lib/io/idempotency.ts
function checkIdempotencyMarker(marker, items) {
  for (const item of items) {
    if (item.includes(marker)) return { skipped: true };
  }
  return { skipped: false };
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

// src/lib/io/jira-upsert.ts
function upsertJiraComment(input) {
  const prefix = `[ferry:${input.role}:`;
  const match = input.existing_comments.find((c) => c.body.includes(prefix));
  const marker = `[ferry:${input.role}:${input.run_id}]`;
  const body2 = `${marker} ${input.body}`;
  if (match) return { action: "update", target_id: match.id, body: body2 };
  return { action: "create", body: body2 };
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

// src/lib/safety/scan.ts
import { spawn } from "node:child_process";
function normalizeFinding(raw2) {
  return {
    ruleId: raw2.RuleID ?? "",
    description: raw2.Description ?? "",
    file: raw2.File ?? "",
    startLine: raw2.StartLine ?? 0,
    endLine: raw2.EndLine ?? 0
  };
}
async function scanWithGitleaks(opts) {
  const spawnFn = opts.spawnFn ?? spawn;
  const args = [
    "detect",
    `--source=${opts.path}`,
    "--report-format=json",
    "--report-path=/dev/stdout",
    "--no-banner"
  ];
  if (opts.configPath) {
    args.push(`--config=${opts.configPath}`);
  }
  const child = spawnFn(opts.binaryPath, args);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? -1));
  });
  if (exitCode !== 0 && exitCode !== 1) {
    throw new FerryError("unknown", {
      stage: "scan",
      reason: "unexpected-exit-code",
      exitCode,
      // stderr length only — never the content (could contain leaked text).
      stderrLength: stderr.length
    });
  }
  let findings = [];
  const trimmed = stdout.trim();
  if (trimmed.length > 0) {
    try {
      const parsed2 = JSON.parse(trimmed);
      if (Array.isArray(parsed2)) {
        findings = parsed2.map(normalizeFinding);
      }
    } catch {
      throw new FerryError("unknown", {
        stage: "parse",
        reason: "invalid-json",
        // Length only — never the body (could contain leaked content).
        stdoutLength: stdout.length
      });
    }
  }
  return {
    leaksFound: findings.length > 0,
    findings
  };
}

// src/lib/io/jira.ts
async function scanStringPayload(text) {
  const tmpFile = join(tmpdir(), `ferry-scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    await writeFile(tmpFile, text, "utf8");
    const result = await scanWithGitleaks({
      path: tmpFile,
      binaryPath: process.env.GITLEAKS_PATH ?? "gitleaks"
    });
    if (result.leaksFound) {
      throw new FerryError("spend-cap", { reason: "secret-scan-hit" });
    }
  } finally {
    await unlink(tmpFile).catch(() => {
    });
  }
}
function parseMarker(marker) {
  const match = marker.match(/^\[ferry:(refiner|developer|reviewer|iterator):([^\]]+)\]$/);
  if (!match) return null;
  return { role: match[1], runId: match[2] };
}
async function postComment(params) {
  const items = params.recentComments.map((c2) => c2.body);
  const idempotency = checkIdempotencyMarker(params.idempotencyMarker, items);
  if (idempotency.skipped) return { skipped: true };
  const markerParsed = parseMarker(params.idempotencyMarker);
  const directive = markerParsed ? upsertJiraComment({
    existing_comments: params.recentComments,
    role: markerParsed.role,
    run_id: markerParsed.runId,
    body: params.body
  }) : { action: "create", body: params.body };
  await scanStringPayload(directive.body);
  const c = createJiraRestClientFromEnv();
  const jiraRetryBaseDelayMs = parseInt(process.env.FERRY_JIRA_RETRY_BASE_DELAY_MS ?? "", 10) || 2e3;
  const jiraRetryMaxAttempts = parseInt(process.env.FERRY_JIRA_RETRY_MAX_ATTEMPTS ?? "", 10) || 3;
  const run = retry(
    async () => {
      if (directive.action === "update") {
        await c.putComment(
          params.ticketKey,
          String(directive.target_id),
          textToAdf(directive.body)
        );
      } else {
        await c.postComment(params.ticketKey, textToAdf(directive.body));
      }
      return { skipped: false, body: params.body };
    },
    { baseDelayMs: jiraRetryBaseDelayMs, maxAttempts: jiraRetryMaxAttempts }
  );
  return run();
}

// src/lib/envelope/validate.ts
import { createRequire } from "module";
var _require = createRequire(import.meta.url);
var eventSchema = _require("./schemas/event.v1.schema.json");
var ajvModule = _require("ajv/dist/2020");
var ajvInstance = new ajvModule.Ajv2020({ strict: true });
_require("ajv-formats").default(ajvInstance);
var validateFn = ajvInstance.compile(eventSchema);
function validateEnvelope(raw2) {
  if (!validateFn(raw2)) {
    const safePaths = (validateFn.errors ?? []).map((e) => `${e.instancePath} ${e.keyword}`);
    throw new FerryError("state-invariant", { paths: safePaths });
  }
  const envelope2 = raw2;
  if (envelope2.instructions !== void 0) {
    const cap = parseInt(process.env.FERRY_ENVELOPE_INSTRUCTIONS_CHARS ?? "", 10) || 2e3;
    envelope2.instructions = envelope2.instructions.slice(0, cap);
  }
  return envelope2;
}

// src/lib/dispatch/routing.ts
var PHASE_TO_WORKFLOW = Object.freeze({
  refine: Object.freeze({ workflow: "ferry-refine.yml", dispatchType: "ferry-refine" }),
  dev: Object.freeze({ workflow: "ferry-dev.yml", dispatchType: "ferry-dev" }),
  review: Object.freeze({ workflow: "ferry-review.yml", dispatchType: "ferry-review" }),
  iterate: Object.freeze({ workflow: "ferry-iterate.yml", dispatchType: "ferry-iterate" })
});
function shouldSkipForTaskType(issueType2) {
  if (issueType2 === "Task") {
    return { skip: true, reason: "ticket type Task is not processed by Ferry" };
  }
  return { skip: false };
}
function buildTaskSkipComment(role2, runId) {
  return `[ferry:${role2}:${runId}] Skipped \u2014 ticket type Task is not processed by Ferry`;
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

// src/lib/dispatch/skip-task-type-action.ts
var logger = createLogger("", "ferry:dispatch");
var raw = process.env.FERRY_ENVELOPE_PAYLOAD;
if (!raw) {
  logger.error("FERRY_ENVELOPE_PAYLOAD is not set");
  process.exit(1);
}
var parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  logger.error("FERRY_ENVELOPE_PAYLOAD is not valid JSON");
  process.exit(1);
}
var envelope = validateEnvelope(parsed);
var issueType = envelope.issue_type;
if (!issueType) process.exit(0);
var skip = shouldSkipForTaskType(issueType);
if (!skip.skip) process.exit(0);
var VALID_ROLES = ["refiner", "developer", "reviewer", "iterator"];
var rawRole = process.env.FERRY_AGENT_ROLE;
if (!rawRole || !VALID_ROLES.includes(rawRole)) {
  logger.error("FERRY_AGENT_ROLE is invalid", {
    valid: VALID_ROLES.join(", "),
    got: rawRole ?? "(unset)"
  });
  process.exit(1);
}
var role = rawRole;
var body = buildTaskSkipComment(role, envelope.event_id);
await postComment({
  ticketKey: envelope.ticket_key,
  body,
  idempotencyMarker: `[ferry:${role}:${envelope.event_id}]`,
  recentComments: []
});
process.exit(0);
