import { describe, expect, it } from "vitest";
import * as lib from "../src/index.js";

const GOOD = "Fetch a user record by its identifier.";

function one(over: Record<string, unknown>): lib.LintReport {
  return lib.lintTools({
    tools: [{ name: "get_user", description: GOOD, inputSchema: { type: "object" }, ...over }],
  });
}

function ids(r: lib.LintReport): string[] {
  return r.findings.map((f) => f.ruleId);
}

describe("acceptance literals", () => {
  it("escapes pointer '/tools/0/inputSchema/properties/a~1b'", () => {
    const r = one({ inputSchema: { type: "object", properties: { "a/b": {} } } });
    expect(r.findings.map((f) => f.path)).toContain("/tools/0/inputSchema/properties/a~1b");
  });

  it("formats '<severity> <ruleId> <tool> <path> <message>'", () => {
    const r = one({ name: "get user" });
    const lines = lib
      .formatText(r)
      .split("\n")
      .filter((l) => l !== "");
    const f = r.findings[0];
    if (!f) throw new Error("expected a finding");
    expect(lines[0]).toBe(`${f.severity} ${f.ruleId} ${f.tool} ${f.path} ${f.message}`);
    expect(lines[lines.length - 1]).toBe("1 errors, 1 warnings");
  });

  it("name length: .repeat(128) passes it, .repeat(129) fails", () => {
    expect(ids(one({ name: "x".repeat(128) }))).not.toContain("name-format");
    expect(ids(one({ name: "x".repeat(129) }))).toContain("name-format");
  });

  it("name rules: 'x'.repeat(129) is an error 'name-format' while 'x'.repeat(128) passes it", () => {
    expect(ids(one({ name: "x".repeat(129) }))).toContain("name-format");
    expect(ids(one({ name: "x".repeat(128) }))).not.toContain("name-format");
    expect(ids(one({ name: "get_user " }))).toContain("name-format");
  });

  it("'admin.tools.list' passes name-format but warns 'name-portability', and a repeated name is an error 'name-duplicate'", () => {
    const r = one({ name: "admin.tools.list" });
    expect(ids(r)).toContain("name-portability");
    expect(ids(r)).not.toContain("name-format");
    const t = { name: "a", description: GOOD, inputSchema: { type: "object" } };
    expect(ids(lib.lintTools([t, t]))).toContain("name-duplicate");
  });

  it("required ['b'] without property b is an error 'required-undefined', and {type: 'object', additionalProperties: false} alone yields no findings", () => {
    const r = one({ inputSchema: { type: "object", required: ["b"] } });
    const f = r.findings.find((x) => x.ruleId === "required-undefined");
    expect(f?.severity).toBe("error");
    expect(f?.path).toBe("/tools/0/inputSchema/required/0");
    expect(one({ inputSchema: { type: "object", additionalProperties: false } }).findings).toEqual(
      [],
    );
  });
});
