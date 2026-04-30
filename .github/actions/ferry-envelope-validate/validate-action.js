// src/lib/envelope/validate-action.ts
import { appendFileSync } from "fs";

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
function validateEnvelope(raw2) {
  if (!validateFn(raw2)) {
    const safePaths = (validateFn.errors ?? []).map((e) => `${e.instancePath} ${e.keyword}`);
    throw new FerryError("state-invariant", { paths: safePaths });
  }
  const envelope = raw2;
  if (envelope.instructions !== void 0) {
    envelope.instructions = envelope.instructions.slice(0, 2e3);
  }
  return envelope;
}

// src/lib/envelope/validate-action.ts
var raw = process.env.FERRY_ENVELOPE_PAYLOAD;
if (!raw) {
  console.error("[ferry:envelope] FERRY_ENVELOPE_PAYLOAD is not set");
  process.exit(1);
}
var parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.error("[ferry:envelope] FERRY_ENVELOPE_PAYLOAD is not valid JSON");
  process.exit(1);
}
try {
  const envelope = validateEnvelope(parsed);
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    appendFileSync(
      output,
      `ticket_key=${envelope.ticket_key}
phase=${envelope.phase}
event_id=${envelope.event_id}
`
    );
  }
  process.exit(0);
} catch (e) {
  console.error("[ferry:envelope] Envelope validation failed:", e.message);
  process.exit(1);
}
