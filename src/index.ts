/**
 * Lint MCP `tools/list` results: tool names, input schema structure,
 * description quality and token budgets.
 *
 * This module has no runtime dependencies and imports nothing from Node.js,
 * so it also runs in browsers.
 *
 * @packageDocumentation
 */

/** Severity of a finding. */
export type Severity = "error" | "warning";

/** One lint finding. */
export interface Finding {
  /** Stable rule identifier, one of the ids in {@link RULES}. */
  readonly ruleId: string;
  /** Effective severity after applying the configuration. */
  readonly severity: Severity;
  /** Tool name, or a placeholder such as `tools[0]` for unusable names. */
  readonly tool: string;
  /** RFC 6901 JSON Pointer to the offending value. */
  readonly path: string;
  /** Human readable description of the problem. */
  readonly message: string;
  /** Concrete advice on how to fix it. */
  readonly suggestion: string;
}

/** Configuration of {@link lintTools}. */
export interface LintConfig {
  /** Minimum description length in characters. Default 20. */
  minDescriptionChars?: number;
  /** Token budget of one tool. Default 800. */
  maxToolTokens?: number;
  /** Token budget of the whole list. Default 8000. */
  maxTotalTokens?: number;
  /** Per rule severity override, or `off` to disable a rule. */
  rules?: Record<string, Severity | "off">;
}

/** Result of {@link lintTools}. */
export interface LintReport {
  /** Findings sorted by tool index, path and rule id (at most 10_000). */
  findings: readonly Finding[];
  /** Number of tools in the input. */
  toolCount: number;
  /** Token estimates, ceil(JSON.stringify(x).length / 4). */
  estimatedTokens: { total: number; perTool: Record<string, number> };
  /** Number of error findings, including truncated ones. */
  errorCount: number;
  /** Number of warning findings, including truncated ones. */
  warningCount: number;
  /** True when more than 10_000 findings were produced. */
  truncated: boolean;
}

/** Description of one lint rule. */
export interface RuleInfo {
  readonly id: string;
  readonly defaultSeverity: Severity;
  readonly description: string;
}

/** All rules, with their default severity. */
export const RULES: readonly RuleInfo[] = [
  {
    id: "name-format",
    defaultSeverity: "error",
    description: "Name is 1-128 characters of A-Z, a-z, 0-9, _, - and .",
  },
  {
    id: "name-portability",
    defaultSeverity: "warning",
    description: "Name fits the stricter ^[a-zA-Z0-9_-]{1,64}$ API pattern",
  },
  {
    id: "name-duplicate",
    defaultSeverity: "error",
    description: "Tool names are unique within the list",
  },
  {
    id: "description-missing",
    defaultSeverity: "error",
    description: "Every tool has a non-empty description",
  },
  {
    id: "description-quality",
    defaultSeverity: "warning",
    description: "Description is specific, not short or generic",
  },
  {
    id: "schema-root",
    defaultSeverity: "error",
    description: "inputSchema is a JSON Schema object with type object",
  },
  {
    id: "required-undefined",
    defaultSeverity: "error",
    description: "Every required entry is declared in properties",
  },
  {
    id: "param-type-missing",
    defaultSeverity: "warning",
    description: "Every parameter declares its type",
  },
  {
    id: "param-description-missing",
    defaultSeverity: "warning",
    description: "Every parameter has a description",
  },
  {
    id: "size-budget",
    defaultSeverity: "warning",
    description: "Tool and list token estimates stay within budget",
  },
];

/** Machine-readable codes of {@link LintInputError}. */
export type LintErrorCode = "NOT_A_TOOLS_LIST" | "TOO_LARGE" | "TOO_DEEP" | "UNKNOWN_RULE";

/** Raised when the input or the rule configuration is not acceptable. */
export class LintInputError extends Error {
  /** Stable machine-readable error code. */
  readonly code: LintErrorCode;

  constructor(code: LintErrorCode, message: string) {
    super(message);
    this.name = "LintInputError";
    this.code = code;
  }
}

const MAX_INPUT_CHARS = 5 * 1024 * 1024;
const MAX_TOOLS = 1000;
const MAX_FINDINGS = 10_000;
const MAX_DEPTH = 64;
const MAX_LABEL = 200;
const MAX_SEGMENT = 256;
const NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const PORTABLE_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const GENERIC = new Set(["does stuff", "tool", "helper", "todo"]);
const TYPE_KEYS = ["type", "enum", "const", "$ref"];
const COMBINATORS = ["anyOf", "oneOf", "allOf"] as const;
const TYPED_KEYS = [...TYPE_KEYS, ...COMBINATORS];

const ERR_DEEP = "input is nested deeper than 64 levels";
const ERR_BIG = "input is larger than 5 MiB";
const ERR_JSON = "input is not JSON serializable";
const ERR_SHAPE = "expected a tools array or an object with a tools array";
const ERR_COUNT = "too many tools, the limit is 1000";
const ERR_TOOL = "every tool must be a JSON object";

const MSG_NAME_TYPE = "name is missing or not a string";
const MSG_DESC_MISSING = "description is missing or empty";
const MSG_SCHEMA_MISSING = "inputSchema is missing";
const MSG_SCHEMA_OBJ = "inputSchema is not a JSON Schema object";
const MSG_SCHEMA_TYPE = "inputSchema must have type object";
const MSG_TYPE = "parameter declares no type, enum, const, $ref or combinator";
const MSG_ANY = "schema is true, so the parameter accepts any value";
const MSG_NOT_SCHEMA = "parameter schema is not an object";
const MSG_PARAM_DESC = "parameter has no description";
const MSG_REQ_STR = "required entry is not a string";

const HINT_NAME = "Use 1-128 characters from A-Z, a-z, 0-9, _, - and .";
const HINT_DUP = "Give every tool a unique name.";
const HINT_DESC = "Describe what the tool does and when to call it.";
const HINT_QUALITY = "Say what the tool does, its inputs and when to use it.";
const HINT_ROOT = "Declare inputSchema as a JSON Schema with type object.";
const HINT_REQ = "Add the property to properties or drop it from required.";
const HINT_TYPE = "Add a type, enum, const or $ref to the parameter.";
const HINT_PARAM = "Add a description that tells the model what to pass.";
const HINT_SIZE = "Shorten descriptions and schemas, or split the tools.";

type Obj = Record<string, unknown>;
type Add = (rule: string, path: string, msg: string, hint: string) => void;

interface Settings {
  minDesc: number;
  maxTool: number;
  maxTotal: number;
  levels: Map<string, Severity | "off">;
}

interface ToolCtx {
  add: Add;
  path: string;
  index: number;
  seen: Map<string, number>;
  st: Settings;
}

interface Step {
  schema: unknown;
  path: string;
  kind: "root" | "param" | "other";
}

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function get(obj: Obj, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function trunc(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function quote(text: string): string {
  return trunc(JSON.stringify(trunc(text, 40)), 80);
}

function seg(key: string): string {
  return trunc(key, MAX_SEGMENT).replaceAll("~", "~0").replaceAll("/", "~1");
}

function isLevel(value: unknown): value is Severity | "off" {
  return value === "error" || value === "warning" || value === "off";
}

function num(value: number | undefined, dflt: number, label: string): number {
  if (value === undefined) {
    return dflt;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative number`);
  }
  return value;
}

function settings(config: LintConfig): Settings {
  const levels = new Map<string, Severity | "off">();
  for (const rule of RULES) {
    levels.set(rule.id, rule.defaultSeverity);
  }
  const rules: Obj = config.rules ?? {};
  for (const id of Object.keys(rules)) {
    const level = get(rules, id);
    if (!levels.has(id)) {
      const msg = `unknown rule ${quote(id)}`;
      throw new LintInputError("UNKNOWN_RULE", msg);
    }
    if (!isLevel(level)) {
      const msg = `invalid level for rule ${quote(id)}`;
      throw new LintInputError("UNKNOWN_RULE", msg);
    }
    levels.set(id, level);
  }
  return {
    minDesc: num(config.minDescriptionChars, 20, "minDescriptionChars"),
    maxTool: num(config.maxToolTokens, 800, "maxToolTokens"),
    maxTotal: num(config.maxTotalTokens, 8000, "maxTotalTokens"),
    levels,
  };
}

function assertDepth(root: unknown): void {
  const stack: Array<[unknown, number]> = [[root, 1]];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const [value, depth] = item;
    if (typeof value !== "object" || value === null) {
      continue;
    }
    if (depth > MAX_DEPTH) {
      throw new LintInputError("TOO_DEEP", ERR_DEEP);
    }
    let kids: unknown[] = [];
    if (Array.isArray(value)) {
      kids = value;
    } else {
      kids = Object.keys(value).map((key) => get(value as Obj, key));
    }
    for (const kid of kids) {
      if (typeof kid === "object" && kid !== null) {
        stack.push([kid, depth + 1]);
      }
    }
  }
}

function assertSize(input: unknown): void {
  let json: string | undefined;
  try {
    json = JSON.stringify(input);
  } catch {
    json = undefined;
  }
  if (json === undefined) {
    throw new LintInputError("NOT_A_TOOLS_LIST", ERR_JSON);
  }
  if (json.length > MAX_INPUT_CHARS) {
    throw new LintInputError("TOO_LARGE", ERR_BIG);
  }
}

function extract(input: unknown): { tools: unknown[]; base: string } {
  assertDepth(input);
  assertSize(input);
  let tools: unknown;
  let base = "";
  if (Array.isArray(input)) {
    tools = input;
  } else if (isObj(input)) {
    tools = get(input, "tools");
    base = "/tools";
  }
  if (!Array.isArray(tools)) {
    throw new LintInputError("NOT_A_TOOLS_LIST", ERR_SHAPE);
  }
  if (tools.length > MAX_TOOLS) {
    throw new LintInputError("TOO_LARGE", ERR_COUNT);
  }
  for (const entry of tools) {
    if (!isObj(entry)) {
      throw new LintInputError("NOT_A_TOOLS_LIST", ERR_TOOL);
    }
  }
  return { tools, base };
}

function estimate(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function makeAdd(st: Settings, tool: string, out: Finding[]): Add {
  return (rule, path, msg, hint) => {
    const level = st.levels.get(rule) ?? "off";
    if (level === "off") {
      return;
    }
    out.push({
      ruleId: rule,
      severity: level,
      tool,
      path,
      message: msg,
      suggestion: hint,
    });
  };
}

function compare(a: Finding, b: Finding): number {
  if (a.path !== b.path) {
    return a.path < b.path ? -1 : 1;
  }
  if (a.ruleId === b.ruleId) {
    return 0;
  }
  return a.ruleId < b.ruleId ? -1 : 1;
}

function suggest(name: string, bad: RegExp, max: number): string {
  const fixed = name.replace(bad, "_").slice(0, max);
  return fixed === "" ? "tool" : fixed;
}

function labelOf(name: unknown, index: number): string {
  if (typeof name === "string") {
    return trunc(name, MAX_LABEL);
  }
  return `tools[${index}]`;
}

function checkName(name: unknown, c: ToolCtx): void {
  const path = `${c.path}/name`;
  if (typeof name !== "string") {
    c.add("name-format", path, MSG_NAME_TYPE, HINT_NAME);
    return;
  }
  const q = quote(name);
  if (!NAME_RE.test(name)) {
    const msg = `name ${q} must be 1-128 characters from A-Z a-z 0-9 _ - .`;
    const fix = quote(suggest(name, /[^A-Za-z0-9_.-]/g, 128));
    c.add("name-format", path, msg, `Rename it, for example to ${fix}.`);
  }
  if (!PORTABLE_RE.test(name)) {
    const msg = `name ${q} does not match ^[a-zA-Z0-9_-]{1,64}$`;
    const fix = quote(suggest(name, /[^a-zA-Z0-9_-]/g, 64));
    const hint = `Anthropic and OpenAI APIs need names like ${fix}.`;
    c.add("name-portability", path, msg, hint);
  }
  const first = c.seen.get(name);
  if (first === undefined) {
    c.seen.set(name, c.index);
    return;
  }
  const msg = `name ${q} is already used by tool ${first}`;
  c.add("name-duplicate", path, msg, HINT_DUP);
}

function stripEnd(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === "." || text[end - 1] === "!")) {
    end -= 1;
  }
  return text.slice(0, end);
}

function isShort(text: string, min: number): boolean {
  if (text.length >= min * 2) {
    return false;
  }
  return Array.from(text).length < min;
}

function checkDescription(name: unknown, desc: unknown, c: ToolCtx): void {
  const path = `${c.path}/description`;
  if (typeof desc !== "string" || desc.trim() === "") {
    c.add("description-missing", path, MSG_DESC_MISSING, HINT_DESC);
    return;
  }
  const text = desc.trim().toLowerCase();
  let reason = "";
  if (typeof name === "string" && text === name.toLowerCase()) {
    reason = "description only repeats the tool name";
  } else if (GENERIC.has(stripEnd(text))) {
    reason = "description is a generic phrase";
  } else if (isShort(text, c.st.minDesc)) {
    reason = `description is shorter than ${c.st.minDesc} characters`;
  }
  if (reason !== "") {
    c.add("description-quality", path, reason, HINT_QUALITY);
  }
}

function declared(schema: Obj): Set<string> {
  const names = new Set<string>();
  const sources: unknown[] = [schema];
  for (const key of COMBINATORS) {
    const list = get(schema, key);
    if (Array.isArray(list)) {
      for (const branch of list) {
        sources.push(branch);
      }
    }
  }
  for (const source of sources) {
    const props = isObj(source) ? get(source, "properties") : undefined;
    if (isObj(props)) {
      for (const key of Object.keys(props)) {
        names.add(key);
      }
    }
  }
  return names;
}

function checkRequired(schema: Obj, path: string, add: Add): void {
  const required = get(schema, "required");
  if (!Array.isArray(required)) {
    return;
  }
  const known = declared(schema);
  for (let i = 0; i < required.length; i += 1) {
    const entry: unknown = required[i];
    const where = `${path}/required/${i}`;
    if (typeof entry !== "string") {
      add("required-undefined", where, MSG_REQ_STR, HINT_REQ);
    } else if (!known.has(entry)) {
      const msg = `required property ${quote(entry)} is not declared`;
      add("required-undefined", where, msg, HINT_REQ);
    }
  }
}

function checkParam(schema: unknown, path: string, add: Add): void {
  if (schema === true) {
    add("param-type-missing", path, MSG_ANY, HINT_TYPE);
    return;
  }
  if (schema === false) {
    return;
  }
  if (!isObj(schema)) {
    add("param-type-missing", path, MSG_NOT_SCHEMA, HINT_TYPE);
    return;
  }
  const typed = TYPED_KEYS.some((key) => Object.hasOwn(schema, key));
  if (!typed) {
    add("param-type-missing", path, MSG_TYPE, HINT_TYPE);
  }
  const desc = get(schema, "description");
  if (typeof desc !== "string" || desc.trim() === "") {
    add("param-description-missing", path, MSG_PARAM_DESC, HINT_PARAM);
  }
}

function pushAll(list: unknown[], base: string, kind: Step["kind"], stack: Step[]): void {
  for (let i = 0; i < list.length; i += 1) {
    stack.push({ schema: list[i], path: `${base}/${i}`, kind });
  }
}

function pushChildren(schema: Obj, path: string, stack: Step[]): void {
  const props = get(schema, "properties");
  if (isObj(props)) {
    for (const key of Object.keys(props)) {
      const p = `${path}/properties/${seg(key)}`;
      stack.push({ schema: get(props, key), path: p, kind: "param" });
    }
  }
  const items = get(schema, "items");
  if (Array.isArray(items)) {
    pushAll(items, `${path}/items`, "param", stack);
  } else if (items !== undefined) {
    stack.push({ schema: items, path: `${path}/items`, kind: "param" });
  }
  const prefix = get(schema, "prefixItems");
  if (Array.isArray(prefix)) {
    pushAll(prefix, `${path}/prefixItems`, "param", stack);
  }
  for (const key of COMBINATORS) {
    const list = get(schema, key);
    if (Array.isArray(list)) {
      pushAll(list, `${path}/${key}`, "other", stack);
    }
  }
  const defs = get(schema, "$defs");
  if (isObj(defs)) {
    for (const key of Object.keys(defs)) {
      const p = `${path}/$defs/${seg(key)}`;
      stack.push({ schema: get(defs, key), path: p, kind: "other" });
    }
  }
}

function walk(root: Obj, rootPath: string, add: Add): void {
  const stack: Step[] = [{ schema: root, path: rootPath, kind: "root" }];
  for (let step = stack.pop(); step !== undefined; step = stack.pop()) {
    if (step.kind === "param") {
      checkParam(step.schema, step.path, add);
    }
    if (!isObj(step.schema)) {
      continue;
    }
    if (step.kind !== "other") {
      checkRequired(step.schema, step.path, add);
    }
    pushChildren(step.schema, step.path, stack);
  }
}

function checkSchema(schema: unknown, c: ToolCtx): void {
  const path = `${c.path}/inputSchema`;
  if (schema === undefined) {
    c.add("schema-root", path, MSG_SCHEMA_MISSING, HINT_ROOT);
    return;
  }
  if (!isObj(schema)) {
    c.add("schema-root", path, MSG_SCHEMA_OBJ, HINT_ROOT);
    return;
  }
  if (get(schema, "type") !== "object") {
    c.add("schema-root", path, MSG_SCHEMA_TYPE, HINT_ROOT);
  }
  walk(schema, path, c.add);
}

function lintOne(tool: Obj, c: ToolCtx): void {
  const name = get(tool, "name");
  checkName(name, c);
  checkDescription(name, get(tool, "description"), c);
  checkSchema(get(tool, "inputSchema"), c);
}

/**
 * Lints the tools of an MCP `tools/list` result.
 *
 * @param input - A parsed JSON document: `{ tools: [...] }` or a bare array.
 * @param config - Optional thresholds and per rule severities.
 * @returns The report. Findings are sorted by tool index, path and rule id.
 * @throws {LintInputError} For oversized, too deep or malformed input and
 * for unknown rule ids in `config.rules`.
 * @throws {RangeError} When a numeric option is negative or not finite.
 */
export function lintTools(input: unknown, config?: LintConfig): LintReport {
  const st = settings(config ?? {});
  const { tools, base } = extract(input);
  const kept: Finding[] = [];
  const perTool: Record<string, number> = Object.create(null);
  let errors = 0;
  let warnings = 0;
  let counted = 0;
  const flush = (list: Finding[]): void => {
    list.sort(compare);
    for (const finding of list) {
      counted += 1;
      if (finding.severity === "error") {
        errors += 1;
      } else {
        warnings += 1;
      }
      if (kept.length < MAX_FINDINGS) {
        kept.push(finding);
      }
    }
  };
  const total = estimate(tools);
  if (total > st.maxTotal) {
    const list: Finding[] = [];
    const add = makeAdd(st, "(all tools)", list);
    const msg = `tool list is about ${total} tokens, budget is ${st.maxTotal}`;
    add("size-budget", base, msg, HINT_SIZE);
    flush(list);
  }
  const seen = new Map<string, number>();
  for (let i = 0; i < tools.length; i += 1) {
    const tool = tools[i] as Obj;
    const label = labelOf(get(tool, "name"), i);
    const list: Finding[] = [];
    const ctx: ToolCtx = {
      add: makeAdd(st, label, list),
      path: `${base}/${i}`,
      index: i,
      seen,
      st,
    };
    lintOne(tool, ctx);
    const tokens = estimate(tool);
    perTool[label] = (perTool[label] ?? 0) + tokens;
    if (tokens > st.maxTool) {
      const msg = `tool is about ${tokens} tokens, budget is ${st.maxTool}`;
      ctx.add("size-budget", ctx.path, msg, HINT_SIZE);
    }
    flush(list);
  }
  return {
    findings: kept,
    toolCount: tools.length,
    estimatedTokens: { total, perTool },
    errorCount: errors,
    warningCount: warnings,
    truncated: counted > MAX_FINDINGS,
  };
}

function oneLine(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const low = code < 32 || code === 127;
    const sep = code === 0x2028 || code === 0x2029;
    if (low || sep) {
      out += "?";
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * Renders a report as text: one line `<severity> <ruleId> <tool> <path>
 * <message>` per finding, then a summary such as `1 errors, 2 warnings`.
 * Control characters in untrusted fields are replaced by `?`.
 *
 * @param report - The report to render.
 * @returns The text without a trailing newline.
 */
export function formatText(report: LintReport): string {
  const lines = report.findings.map((f) => {
    const fields = [f.severity, f.ruleId, f.tool, f.path, f.message];
    return fields.map((field) => oneLine(field)).join(" ");
  });
  const { errorCount: e, warningCount: w } = report;
  if (report.truncated) {
    lines.push(`output truncated to ${report.findings.length} findings`);
  }
  lines.push(`${e} errors, ${w} warnings`);
  return lines.join("\n");
}

/**
 * Renders a report as JSON with a 2-space indent.
 *
 * @param report - The report to render.
 * @returns The JSON text.
 */
export function formatJson(report: LintReport): string {
  return JSON.stringify(report, null, 2);
}
