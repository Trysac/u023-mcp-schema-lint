import { describe, expect, it } from "vitest";
import * as lib from "../src/index.js";

const GOOD = "Fetch a user record by its identifier.";

type Obj = Record<string, unknown>;

function tool(over: Obj = {}): Obj {
  return {
    name: "get_user",
    description: GOOD,
    inputSchema: { type: "object", additionalProperties: false },
    ...over,
  };
}

function withProps(properties: Obj): Obj {
  return tool({ inputSchema: { type: "object", properties } });
}

function lint(tools: unknown[], config?: lib.LintConfig): lib.LintReport {
  return lib.lintTools({ tools }, config);
}

function summary(report: lib.LintReport): string[] {
  return report.findings.map((f) => `${f.severity} ${f.ruleId}`);
}

function paths(report: lib.LintReport): string[] {
  return report.findings.map((f) => f.path);
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return error instanceof lib.LintInputError ? error.code : "OTHER";
  }
  return "NONE";
}

function nest(depth: number): unknown {
  let value: unknown = [];
  for (let i = 1; i < depth; i += 1) {
    value = [value];
  }
  return value;
}

const PROP = "/tools/0/inputSchema/properties";

describe("clean input", () => {
  it("reports nothing for a clean tool", () => {
    const report = lint([tool()]);
    expect(report.findings).toEqual([]);
    expect(report.toolCount).toBe(1);
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(0);
    expect(report.truncated).toBe(false);
  });

  it("accepts an empty tools array and an empty bare array", () => {
    const report = lint([]);
    expect(report.findings).toEqual([]);
    expect(report.toolCount).toBe(0);
    expect(lib.lintTools([]).toolCount).toBe(0);
  });

  it("accepts unicode descriptions", () => {
    const desc = "Récupère un utilisateur par son identifiant.";
    expect(lint([tool({ description: desc })]).findings).toEqual([]);
  });

  it("uses bare array paths", () => {
    const report = lib.lintTools([tool({ name: "get user" })]);
    expect(paths(report)).toEqual(["/0/name", "/0/name"]);
  });
});

describe("finding shape and text output", () => {
  it("escapes pointer segments per RFC 6901", () => {
    const props = { "a/b": { type: "string" }, "a~b": { type: "string" } };
    const report = lint([withProps(props)]);
    expect(paths(report)).toEqual([`${PROP}/a~0b`, `${PROP}/a~1b`]);
    const first = report.findings[0];
    expect(first?.ruleId).toBe("param-description-missing");
    expect(first?.severity).toBe("warning");
    expect(first?.tool).toBe("get_user");
    expect(first?.message.length).toBeGreaterThan(0);
    expect(first?.suggestion.length).toBeGreaterThan(0);
  });

  it("escapes both special characters in one key", () => {
    const report = lint([withProps({ "~/": { type: "string" } })]);
    expect(paths(report)).toEqual([`${PROP}/~0~1`]);
  });

  it("formats one line per finding and a summary", () => {
    const props = { p: { description: "d" } };
    const t = tool({ name: "get user", inputSchema: { type: "object", properties: props } });
    const text = lib.formatText(lint([t]));
    const lines = text.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(
      /^warning param-type-missing get user \/tools\/0\/inputSchema\/properties\/p /,
    );
    expect(lines[1]).toMatch(/^error name-format get user \/tools\/0\/name /);
    expect(lines[2]).toMatch(/^warning name-portability get user /);
    expect(lines[3]).toBe("1 errors, 2 warnings");
  });

  it("prints only the summary for a clean report", () => {
    expect(lib.formatText(lint([tool()]))).toBe("0 errors, 0 warnings");
  });

  it("notes truncation before the summary line", () => {
    const props: Obj = {};
    for (let i = 0; i < 5001; i++) props[`p${i}`] = {};
    const report = lint([withProps(props)]);
    expect(report.truncated).toBe(true);
    const lines = lib.formatText(report).split("\n");
    expect(lines).toHaveLength(report.findings.length + 2);
    expect(lines[lines.length - 2]).toBe("output truncated to 10000 findings");
  });

  it("keeps untrusted control characters out of the text", () => {
    const text = lib.formatText(lint([tool({ name: "a\nb" })]));
    expect(text.split("\n")).toHaveLength(3);
  });

  it("renders JSON with a 2-space indent", () => {
    const report = lint([tool({ name: "get user" })]);
    const json = lib.formatJson(report);
    expect(json).toBe(JSON.stringify(report, null, 2));
    expect(json.startsWith('{\n  "findings": [')).toBe(true);
    expect(JSON.parse(json).errorCount).toBe(1);
  });

  it("sorts by tool index, path and rule id", () => {
    const first = withProps({ z: { type: "string" } });
    first.name = "a_tool_one";
    first.description = "Too short";
    const report = lint([first, tool({ name: "get user" })]);
    expect(paths(report)).toEqual([
      "/tools/0/description",
      `${PROP}/z`,
      "/tools/1/name",
      "/tools/1/name",
    ]);
    const ids = report.findings.map((f) => f.ruleId);
    expect(ids.slice(2)).toEqual(["name-format", "name-portability"]);
  });
});

describe("name rules", () => {
  it("rejects invalid names with name-format", () => {
    for (const name of ["get user", "get_user ", "x".repeat(129)]) {
      const report = lint([tool({ name })]);
      expect(summary(report)).toContain("error name-format");
    }
  });

  it("suggests a repaired name", () => {
    const report = lint([tool({ name: "get user" })]);
    expect(report.findings[0]?.suggestion).toContain("get_user");
  });

  it("accepts 128 characters for name-format", () => {
    const report = lint([tool({ name: "x".repeat(128) })]);
    expect(summary(report)).toEqual(["warning name-portability"]);
  });

  it("warns about portability for dots", () => {
    const report = lint([tool({ name: "admin.tools.list" })]);
    expect(summary(report)).toEqual(["warning name-portability"]);
    expect(report.errorCount).toBe(0);
  });

  it("accepts portable names", () => {
    expect(lint([tool({ name: "x".repeat(64) })]).findings).toEqual([]);
    expect(lint([tool({ name: "get-user_2" })]).findings).toEqual([]);
  });

  it("flags a repeated name", () => {
    const report = lint([tool(), tool()]);
    expect(summary(report)).toEqual(["error name-duplicate"]);
    expect(paths(report)).toEqual(["/tools/1/name"]);
  });

  it("flags missing and non-string names", () => {
    const missing = lint([tool({ name: undefined })]);
    expect(summary(missing)).toEqual(["error name-format"]);
    expect(missing.findings[0]?.tool).toBe("tools[0]");
    const numeric = lint([tool({ name: 5 })]);
    expect(summary(numeric)).toEqual(["error name-format"]);
  });

  it("bounds messages built from hostile names", () => {
    const report = lint([tool({ name: "\u0000".repeat(500) })]);
    expect(report.findings.length).toBeGreaterThan(0);
    for (const f of report.findings) {
      expect(f.message.length).toBeLessThanOrEqual(200);
      expect(f.suggestion.length).toBeLessThanOrEqual(200);
      expect(f.tool.length).toBeLessThanOrEqual(200);
      expect(f.message).not.toContain("\u0000");
    }
  });
});

describe("description rules", () => {
  it("requires a description", () => {
    for (const description of [undefined, "", "   ", 5]) {
      const report = lint([tool({ description })]);
      expect(summary(report)).toEqual(["error description-missing"]);
      expect(paths(report)).toEqual(["/tools/0/description"]);
    }
  });

  it("warns about short descriptions at the boundary", () => {
    const short = lint([tool({ description: "x".repeat(19) })]);
    expect(summary(short)).toEqual(["warning description-quality"]);
    expect(lint([tool({ description: "x".repeat(20) })]).findings).toEqual([]);
    const custom = lint([tool({ description: "short" })], {
      minDescriptionChars: 5,
    });
    expect(custom.findings).toEqual([]);
  });

  it("counts code points, not UTF-16 units", () => {
    const short = lint([tool({ description: "🙂".repeat(12) })]);
    expect(summary(short)).toEqual(["warning description-quality"]);
    expect(lint([tool({ description: "🙂".repeat(20) })]).findings).toEqual([]);
  });

  it("warns when the description repeats the name", () => {
    const name = "fetch_user_records_by_id";
    const report = lint([tool({ name, description: name.toUpperCase() })]);
    expect(summary(report)).toEqual(["warning description-quality"]);
  });

  it("warns about generic phrases", () => {
    const config = { minDescriptionChars: 1 };
    for (const description of ["does stuff", "Tool", "helper.", "TODO!"]) {
      const report = lint([tool({ description })], config);
      expect(summary(report)).toEqual(["warning description-quality"]);
    }
  });

  it("does not flag phrases that merely contain a generic word", () => {
    const description = "A helper that resolves user names";
    expect(lint([tool({ description })]).findings).toEqual([]);
  });

  it("stays fast on long whitespace runs", () => {
    const description = `a${" ".repeat(200_000)}b`;
    expect(lint([tool({ description })], { rules: { "size-budget": "off" } }).findings).toEqual([]);
  });
});

describe("schema rules", () => {
  it("requires an input schema of type object", () => {
    const bad: unknown[] = [undefined, 5, "x", [], null, true, {}];
    for (const inputSchema of bad) {
      const report = lint([tool({ inputSchema })]);
      expect(summary(report)).toEqual(["error schema-root"]);
      expect(paths(report)).toEqual(["/tools/0/inputSchema"]);
    }
    const wrong = lint([tool({ inputSchema: { type: "string" } })]);
    expect(summary(wrong)).toEqual(["error schema-root"]);
  });

  it("accepts a bare object schema", () => {
    const schema = { type: "object", additionalProperties: false };
    expect(lint([tool({ inputSchema: schema })]).findings).toEqual([]);
  });

  it("flags required entries without a property", () => {
    const schema = {
      type: "object",
      required: ["b"],
      properties: { a: { type: "string", description: "A" } },
    };
    const report = lint([tool({ inputSchema: schema })]);
    expect(summary(report)).toEqual(["error required-undefined"]);
    expect(paths(report)).toEqual(["/tools/0/inputSchema/required/0"]);
  });

  it("accepts required entries that are declared", () => {
    const schema = {
      type: "object",
      required: ["a"],
      properties: { a: { type: "string", description: "A" } },
    };
    expect(lint([tool({ inputSchema: schema })]).findings).toEqual([]);
  });

  it("does not mistake prototype keys for declared properties", () => {
    const schema = { type: "object", required: ["constructor", "toString"] };
    const report = lint([tool({ inputSchema: schema })]);
    expect(summary(report)).toEqual(["error required-undefined", "error required-undefined"]);
  });

  it("flags non-string required entries and ignores non-arrays", () => {
    const bad = { type: "object", required: [1] };
    const report = lint([tool({ inputSchema: bad })]);
    expect(summary(report)).toEqual(["error required-undefined"]);
    const ignored = { type: "object", required: true };
    expect(lint([tool({ inputSchema: ignored })]).findings).toEqual([]);
  });

  it("checks required inside nested objects", () => {
    const inner = { type: "object", description: "O", required: ["z"] };
    const report = lint([withProps({ o: inner })]);
    expect(paths(report)).toEqual([`${PROP}/o/required/0`]);
  });

  it("counts properties declared in allOf branches", () => {
    const schema = {
      type: "object",
      required: ["b"],
      allOf: [{ properties: { b: { type: "string", description: "B" } } }],
    };
    expect(lint([tool({ inputSchema: schema })]).findings).toEqual([]);
  });
});

describe("parameter rules", () => {
  it("warns about a bare property", () => {
    const report = lint([withProps({ a: {} })]);
    expect(summary(report)).toEqual([
      "warning param-description-missing",
      "warning param-type-missing",
    ]);
    expect(paths(report)).toEqual([`${PROP}/a`, `${PROP}/a`]);
  });

  it("accepts every typing keyword", () => {
    const keywords: Array<[string, unknown]> = [
      ["type", "string"],
      ["enum", [1]],
      ["const", 1],
      ["$ref", "#/$defs/x"],
      ["anyOf", [{ type: "string" }]],
      ["oneOf", [{ type: "string" }]],
      ["allOf", [{ type: "string" }]],
    ];
    for (const [key, value] of keywords) {
      const prop = { description: "d", [key]: value };
      expect(lint([withProps({ a: prop })]).findings).toEqual([]);
    }
  });

  it("treats a blank description as missing", () => {
    const prop = { type: "string", description: "  " };
    const report = lint([withProps({ a: prop })]);
    expect(summary(report)).toEqual(["warning param-description-missing"]);
  });

  it("checks nested properties", () => {
    const outer = {
      type: "object",
      description: "O",
      properties: { inner: { type: "string" } },
    };
    const report = lint([withProps({ outer })]);
    expect(summary(report)).toEqual(["warning param-description-missing"]);
    expect(paths(report)).toEqual([`${PROP}/outer/properties/inner`]);
  });

  it("checks array items", () => {
    const list = { type: "array", description: "L", items: { type: "string" } };
    const report = lint([withProps({ list })]);
    expect(summary(report)).toEqual(["warning param-description-missing"]);
    expect(paths(report)).toEqual([`${PROP}/list/items`]);
    const untyped = { type: "array", description: "L", items: {} };
    const both = lint([withProps({ list: untyped })]);
    expect(summary(both)).toHaveLength(2);
  });

  it("checks tuple items and prefixItems", () => {
    const done = { type: "string", description: "S" };
    const tuple = { type: "array", description: "T", prefixItems: [done, {}] };
    const report = lint([withProps({ t: tuple })]);
    expect(paths(report)).toEqual([`${PROP}/t/prefixItems/1`, `${PROP}/t/prefixItems/1`]);
    const legacy = { type: "array", description: "T", items: [{}] };
    const old = lint([withProps({ t: legacy })]);
    expect(paths(old)).toEqual([`${PROP}/t/items/0`, `${PROP}/t/items/0`]);
  });

  it("treats boolean schemas as typed-any or never", () => {
    const anyOk = lint([withProps({ t: true })]);
    expect(summary(anyOk)).toEqual(["warning param-type-missing"]);
    expect(lint([withProps({ f: false })]).findings).toEqual([]);
    const junk = lint([withProps({ s: "oops", n: null })]);
    expect(summary(junk)).toEqual(["warning param-type-missing", "warning param-type-missing"]);
  });

  it("walks $defs and combinator branches", () => {
    const defs = {
      type: "object",
      $defs: { D: { type: "object", properties: { q: { type: "string" } } } },
    };
    const report = lint([tool({ inputSchema: defs })]);
    expect(paths(report)).toEqual(["/tools/0/inputSchema/$defs/D/properties/q"]);
    const branch = {
      description: "U",
      anyOf: [{ type: "object", properties: { z: { type: "string" } } }],
    };
    const nested = lint([withProps({ u: branch })]);
    expect(paths(nested)).toEqual([`${PROP}/u/anyOf/0/properties/z`]);
  });

  it("treats __proto__ keys from JSON.parse as ordinary data", () => {
    const text = [
      '{"tools":[{"name":"__proto__",',
      `"description":"${GOOD}",`,
      '"inputSchema":{"type":"object",',
      '"properties":{"__proto__":{"type":"string"}}}}]}',
    ].join("");
    const report = lib.lintTools(JSON.parse(text));
    expect(summary(report)).toEqual(["warning param-description-missing"]);
    expect(paths(report)).toEqual([`${PROP}/__proto__`]);
    expect(Object.hasOwn(report.estimatedTokens.perTool, "__proto__")).toBe(true);
    expect(({} as Obj).type).toBeUndefined();
  });

  it("bounds very long property keys in paths", () => {
    const report = lint([withProps({ ["k".repeat(300)]: { type: "string" } })]);
    const path = report.findings[0]?.path ?? "";
    expect(path.endsWith("…")).toBe(true);
    expect(path.length).toBeLessThan(400);
  });
});

describe("size budget", () => {
  it("warns about a tool above maxToolTokens", () => {
    const big = tool({ description: "x".repeat(4000) });
    const report = lint([big]);
    const expected = Math.ceil(JSON.stringify(big).length / 4);
    expect(report.estimatedTokens.perTool.get_user).toBe(expected);
    expect(summary(report)).toEqual(["warning size-budget"]);
    expect(paths(report)).toEqual(["/tools/0"]);
    const roomy = lint([big], { maxToolTokens: 10_000 });
    expect(roomy.findings).toEqual([]);
  });

  it("warns about a list above maxTotalTokens", () => {
    const tools = [tool({ name: "get_a" }), tool({ name: "get_b" })];
    const total = Math.ceil(JSON.stringify(tools).length / 4);
    const report = lint(tools, { maxTotalTokens: total - 1 });
    expect(report.estimatedTokens.total).toBe(total);
    expect(summary(report)).toEqual(["warning size-budget"]);
    expect(report.findings[0]?.tool).toBe("(all tools)");
    expect(report.findings[0]?.path).toBe("/tools");
    expect(lint(tools, { maxTotalTokens: total }).findings).toEqual([]);
  });

  it("uses an empty path for the total of a bare array", () => {
    const report = lib.lintTools([tool()], { maxTotalTokens: 1 });
    expect(report.findings[0]?.path).toBe("");
  });
});

describe("configuration", () => {
  it("applies rule overrides", () => {
    const t = withProps({ a: { type: "string" } });
    t.description = "Too short";
    const before = lint([t]);
    expect(summary(before)).toEqual([
      "warning description-quality",
      "warning param-description-missing",
    ]);
    const after = lint([t], {
      rules: {
        "param-description-missing": "off",
        "description-quality": "error",
      },
    });
    expect(summary(after)).toEqual(["error description-quality"]);
    expect(after.errorCount).toBe(1);
    expect(after.warningCount).toBe(0);
  });

  it("can demote an error to a warning", () => {
    const report = lint([tool({ name: "get user" })], {
      rules: { "name-format": "warning" },
    });
    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(2);
  });

  it("rejects unknown rules and invalid levels", () => {
    expect(codeOf(() => lint([tool()], { rules: { nope: "off" } }))).toBe("UNKNOWN_RULE");
    const bad = { rules: { "name-format": "fatal" } } as unknown as lib.LintConfig;
    expect(codeOf(() => lint([tool()], bad))).toBe("UNKNOWN_RULE");
    const proto = JSON.parse('{"rules":{"__proto__":"off"}}');
    expect(codeOf(() => lint([tool()], proto))).toBe("UNKNOWN_RULE");
    const inherited = { rules: { toString: "off" } } as lib.LintConfig;
    expect(codeOf(() => lint([tool()], inherited))).toBe("UNKNOWN_RULE");
  });

  it("rejects invalid numeric options", () => {
    expect(() => lint([tool()], { maxToolTokens: -1 })).toThrow(RangeError);
    const nan = { minDescriptionChars: Number.NaN };
    expect(() => lint([tool()], nan)).toThrow(RangeError);
  });

  it("lists ten documented rules", () => {
    const ids = lib.RULES.map((rule) => rule.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
    expect(ids).toContain("size-budget");
    const severity = new Map(lib.RULES.map((r) => [r.id, r.defaultSeverity]));
    expect(severity.get("name-format")).toBe("error");
    expect(severity.get("name-portability")).toBe("warning");
    for (const rule of lib.RULES) {
      expect(rule.description.length).toBeGreaterThan(0);
    }
  });
});

describe("limits", () => {
  const roomy = { maxToolTokens: 1e9, maxTotalTokens: 1e9 };

  function manyProps(count: number): Obj {
    const props: Obj = {};
    for (let i = 0; i < count; i += 1) {
      props[`p${i}`] = { type: "string" };
    }
    return withProps(props);
  }

  it("keeps the first 10_000 findings of 10_001", () => {
    const report = lint([manyProps(10_001)], roomy);
    expect(report.findings).toHaveLength(10_000);
    expect(report.truncated).toBe(true);
    expect(report.warningCount).toBe(10_001);
    expect(report.findings[0]?.path.endsWith("/p0")).toBe(true);
  });

  it("does not truncate exactly 10_000 findings", () => {
    const report = lint([manyProps(10_000)], roomy);
    expect(report.findings).toHaveLength(10_000);
    expect(report.truncated).toBe(false);
  });

  it("rejects inputs over 5 MiB", () => {
    const huge = { name: "a", description: "x".repeat(5 * 1024 * 1024) };
    expect(codeOf(() => lint([huge]))).toBe("TOO_LARGE");
    const text = "x".repeat(5 * 1024 * 1024 + 1);
    expect(codeOf(() => lib.lintTools(text))).toBe("TOO_LARGE");
  });

  it("limits the number of tools to 1000", () => {
    const make = (n: number): Obj[] => Array.from({ length: n }, (_, i) => tool({ name: `t${i}` }));
    expect(codeOf(() => lint(make(1001)))).toBe("TOO_LARGE");
    const report = lint(make(1000), roomy);
    expect(report.toolCount).toBe(1000);
    expect(report.findings).toEqual([]);
  });

  it("limits nesting to 64 levels", () => {
    expect(codeOf(() => lint([tool({ meta: nest(62) })]))).toBe("TOO_DEEP");
    expect(codeOf(() => lint([tool({ meta: nest(61) })]))).toBe("NONE");
    expect(codeOf(() => lib.lintTools(nest(65)))).toBe("TOO_DEEP");
  });

  it("stops on circular input", () => {
    const loop: Obj = {};
    loop.self = loop;
    expect(codeOf(() => lint([loop]))).toBe("TOO_DEEP");
  });

  it("rejects inputs that are not tools lists", () => {
    const bad: unknown[] = [
      undefined,
      null,
      5,
      "x",
      {},
      { tools: 5 },
      { tools: {} },
      [1],
      [null],
      [[]],
      { tools: ["x"] },
      { tools: [{ name: 1n }] },
    ];
    for (const input of bad) {
      expect(codeOf(() => lib.lintTools(input))).toBe("NOT_A_TOOLS_LIST");
    }
  });

  it("exposes a stable error class", () => {
    const error = new lib.LintInputError("TOO_LARGE", "m");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("LintInputError");
    expect(error.code).toBe("TOO_LARGE");
  });
});
