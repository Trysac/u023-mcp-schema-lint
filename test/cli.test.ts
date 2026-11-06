import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "../src/cli.js";

const GOOD_TOOL = {
  name: "get_user",
  description: "Fetch a user record by its identifier.",
  inputSchema: { type: "object", additionalProperties: false },
};

let dir = "";

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mcp-schema-lint-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, value: unknown): string {
  const path = join(dir, name);
  const text = typeof value === "string" ? value : JSON.stringify(value);
  writeFileSync(path, text);
  return path;
}

interface Result {
  code: number;
  out: string;
  err: string;
}

async function exec(args: string[]): Promise<Result> {
  const out: string[] = [];
  const err: string[] = [];
  const io = {
    stdout: { write: (s: string) => out.push(s) },
    stderr: { write: (s: string) => err.push(s) },
    env: {},
  };
  const code = await run(args, io);
  return { code, out: out.join(""), err: err.join("") };
}

function list(...tools: unknown[]): unknown {
  return { tools };
}

describe("exit codes", () => {
  it("exits 0 when nothing is found", async () => {
    const file = write("clean.json", list(GOOD_TOOL));
    const result = await exec([file]);
    expect(result.code).toBe(0);
    expect(result.out).toBe("0 errors, 0 warnings\n");
    expect(result.err).toBe("");
  });

  it("exits 1 when an error is found", async () => {
    const file = write("err.json", list({ ...GOOD_TOOL, name: "get user" }));
    const result = await exec([file]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("error name-format get user /tools/0/name ");
    expect(result.out.endsWith("1 errors, 1 warnings\n")).toBe(true);
  });

  it("exits 0 for warnings unless --strict is set", async () => {
    const named = { ...GOOD_TOOL, name: "admin.tools.list" };
    const file = write("warn.json", list(named));
    expect((await exec([file])).code).toBe(0);
    expect((await exec(["--strict", file])).code).toBe(1);
    expect((await exec([file, "--strict"])).code).toBe(1);
  });

  it("exits 2 for an unreadable file", async () => {
    const result = await exec([join(dir, "missing.json")]);
    expect(result.code).toBe(2);
    expect(result.err.startsWith("error: cannot read input file")).toBe(true);
    expect((await exec([dir])).code).toBe(2);
  });

  it("exits 2 for invalid JSON", async () => {
    const file = write("bad.json", "{not json");
    const result = await exec([file]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("not valid JSON");
    expect(result.err).not.toContain("not json");
  });

  it("exits 2 for a LintInputError", async () => {
    const file = write("shape.json", {});
    const result = await exec([file]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("NOT_A_TOOLS_LIST");
  });

  it("checks the file size before parsing", async () => {
    const file = write("big.json", " ".repeat(5 * 1024 * 1024 + 1));
    const result = await exec([file]);
    expect(result.code).toBe(2);
    expect(result.err).toContain("TOO_LARGE");
  });
});

describe("options", () => {
  it("prints JSON with --format json", async () => {
    const file = write("fmt.json", list({ ...GOOD_TOOL, name: "get user" }));
    const result = await exec([file, "--format", "json"]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out).errorCount).toBe(1);
    const text = await exec([file, "--format", "text"]);
    expect(text.out).toContain("error name-format");
  });

  it("applies --max-tool-tokens", async () => {
    const file = write("tok.json", list(GOOD_TOOL));
    const result = await exec([file, "--max-tool-tokens", "1"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("warning size-budget get_user /tools/0 ");
    const strict = await exec([file, "--max-tool-tokens", "1", "--strict"]);
    expect(strict.code).toBe(1);
  });

  it("reads rules and thresholds from --config", async () => {
    const named = { ...GOOD_TOOL, name: "admin.tools.list" };
    const file = write("cfg-in.json", list(named));
    const off = write("cfg-off.json", { rules: { "name-portability": "off" } });
    expect((await exec([file, "--strict", "--config", off])).code).toBe(0);
    const long = write("cfg-long.json", { minDescriptionChars: 100 });
    const quality = await exec([file, "--config", long, "--strict"]);
    expect(quality.out).toContain("description-quality");
  });

  it("lets --max-tool-tokens override the config file", async () => {
    const file = write("ovr-in.json", list(GOOD_TOOL));
    const config = write("ovr-cfg.json", { maxToolTokens: 1 });
    const args = [file, "--strict", "--config", config];
    expect((await exec(args)).code).toBe(1);
    const wide = [...args, "--max-tool-tokens", "100000"];
    expect((await exec(wide)).code).toBe(0);
  });

  it("exits 2 for a bad config file", async () => {
    const file = write("bad-in.json", list(GOOD_TOOL));
    const cases: unknown[] = [
      "{oops",
      [],
      { rules: [] },
      { rules: { nope: "off" } },
      { maxToolTokens: "x" },
    ];
    for (const [i, content] of cases.entries()) {
      const config = write(`bad-cfg-${i}.json`, content);
      const result = await exec([file, "--config", config]);
      expect(result.code).toBe(2);
    }
    const missing = await exec([file, "--config", join(dir, "none.json")]);
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("config file");
  });
});

describe("usage errors", () => {
  it("exits 2 and prints usage for bad arguments", async () => {
    const file = write("use.json", list(GOOD_TOOL));
    const cases: string[][] = [
      [],
      [file, file],
      [file, "--bogus"],
      [file, "--format"],
      [file, "--format", "xml"],
      [file, "--config"],
      [file, "--max-tool-tokens"],
      [file, "--max-tool-tokens", "abc"],
      [file, "--max-tool-tokens", "-1"],
    ];
    for (const args of cases) {
      const result = await exec(args);
      expect(result.code).toBe(2);
      expect(result.err.startsWith("error: ")).toBe(true);
      expect(result.err).toContain("usage: mcp-schema-lint");
      expect(result.out).toBe("");
    }
  });
});
