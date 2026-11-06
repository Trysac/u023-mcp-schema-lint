/**
 * Command line front end of mcp-schema-lint. The only module that uses
 * Node.js APIs; the library in `index.ts` stays portable.
 *
 * @packageDocumentation
 */

import { readFileSync, statSync } from "node:fs";
import * as lib from "./index.js";

/** Streams and environment used by {@link run}. */
export interface CliIo {
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
  /** Reserved for future use. */
  env?: Record<string, string | undefined>;
}

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const USAGE = [
  "usage: mcp-schema-lint FILE [--format text|json] [--strict]",
  "                       [--config FILE] [--max-tool-tokens N]",
  "",
].join("\n");
const NUMBER_KEYS = ["minDescriptionChars", "maxToolTokens", "maxTotalTokens"] as const;

class CliError extends Error {
  readonly usage: boolean;

  constructor(message: string, usage: boolean) {
    super(message);
    this.name = "CliError";
    this.usage = usage;
  }
}

interface Options {
  file: string;
  format: "text" | "json";
  strict: boolean;
  configFile: string | undefined;
  maxToolTokens: number | undefined;
}

function needValue(value: string | undefined, flag: string): string {
  if (value === undefined) {
    throw new CliError(`${flag} needs a value`, true);
  }
  return value;
}

function parseCount(value: string | undefined): number {
  const text = needValue(value, "--max-tool-tokens");
  if (!/^\d{1,15}$/.test(text)) {
    throw new CliError("--max-tool-tokens needs a whole number", true);
  }
  return Number(text);
}

function parseArgs(argv: string[]): Options {
  let file: string | undefined;
  let format: "text" | "json" = "text";
  let strict = false;
  let configFile: string | undefined;
  let maxToolTokens: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--strict") {
      strict = true;
    } else if (arg === "--format") {
      i += 1;
      const value = argv[i];
      if (value !== "text" && value !== "json") {
        throw new CliError("--format must be text or json", true);
      }
      format = value;
    } else if (arg === "--config") {
      i += 1;
      configFile = needValue(argv[i], "--config");
    } else if (arg === "--max-tool-tokens") {
      i += 1;
      maxToolTokens = parseCount(argv[i]);
    } else if (arg.startsWith("-")) {
      const shown = JSON.stringify(arg.slice(0, 40));
      throw new CliError(`unknown option ${shown}`, true);
    } else if (file !== undefined) {
      throw new CliError("only one FILE is allowed", true);
    } else {
      file = arg;
    }
  }
  if (file === undefined) {
    throw new CliError("missing FILE", true);
  }
  return { file, format, strict, configFile, maxToolTokens };
}

function readJson(path: string, what: string): unknown {
  let size: number;
  let text: string;
  try {
    size = statSync(path).size;
  } catch {
    throw new CliError(`cannot read ${what}`, false);
  }
  if (size > MAX_FILE_BYTES) {
    throw new lib.LintInputError("TOO_LARGE", `${what} is larger than 5 MiB`);
  }
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new CliError(`cannot read ${what}`, false);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new CliError(`${what} is not valid JSON`, false);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadConfig(path: string | undefined, maxTool: number | undefined): lib.LintConfig {
  const config: lib.LintConfig = {};
  if (path !== undefined) {
    const raw = readJson(path, "config file");
    if (!isRecord(raw)) {
      throw new CliError("config file must hold a JSON object", false);
    }
    for (const key of NUMBER_KEYS) {
      if (Object.hasOwn(raw, key)) {
        config[key] = raw[key] as number;
      }
    }
    if (Object.hasOwn(raw, "rules")) {
      if (!isRecord(raw.rules)) {
        throw new CliError("config rules must be a JSON object", false);
      }
      config.rules = raw.rules as Record<string, lib.Severity | "off">;
    }
  }
  if (maxTool !== undefined) {
    config.maxToolTokens = maxTool;
  }
  return config;
}

function render(report: lib.LintReport, format: "text" | "json"): string {
  if (format === "json") {
    return lib.formatJson(report);
  }
  return lib.formatText(report);
}

function describe(error: unknown): string | undefined {
  if (error instanceof CliError) {
    return error.message;
  }
  if (error instanceof lib.LintInputError) {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof RangeError) {
    return error.message;
  }
  return undefined;
}

/**
 * Runs the linter.
 *
 * Usage: `FILE [--format text|json] [--strict] [--config FILE]
 * [--max-tool-tokens N]`.
 *
 * @param argv - Arguments without the program name.
 * @param io - Output streams.
 * @returns 0 when clean, 1 when errors are found (or warnings under
 * `--strict`), 2 for usage, IO or parse errors.
 */
export async function run(argv: string[], io: CliIo): Promise<number> {
  try {
    const opts = parseArgs(argv);
    const config = loadConfig(opts.configFile, opts.maxToolTokens);
    const input = readJson(opts.file, "input file");
    const report = lib.lintTools(input, config);
    io.stdout.write(`${render(report, opts.format)}\n`);
    if (report.errorCount > 0) {
      return 1;
    }
    if (opts.strict && report.warningCount > 0) {
      return 1;
    }
    return 0;
  } catch (error) {
    const message = describe(error);
    if (message === undefined) {
      throw error;
    }
    io.stderr.write(`error: ${message}\n`);
    if (error instanceof CliError && error.usage) {
      io.stderr.write(USAGE);
    }
    return 2;
  }
}
