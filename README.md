# mcp-schema-lint

[![npm version](https://img.shields.io/npm/v/@trysac/mcp-schema-lint.svg)](https://www.npmjs.com/package/@trysac/mcp-schema-lint)
[![license: MIT](https://img.shields.io/npm/l/@trysac/mcp-schema-lint.svg)](LICENSE)
[![CI](https://github.com/Trysac/u023-mcp-schema-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/Trysac/u023-mcp-schema-lint/actions/workflows/ci.yml)

Lint MCP tool definitions against the 2025-11-25 tool name rules, input schema structure, description quality and token budgets, with text and JSON reports

## Problem

MCP tools with vague descriptions, invalid names, untyped parameters or huge schemas make agents pick the wrong tool, fail on clients with stricter name rules and waste context tokens. These problems often go unnoticed until behaviour degrades. mcp-schema-lint checks a saved `tools/list` document against ten rules and suggests a fix for each finding, so the check can run in CI. It does not connect to servers; it only reads JSON.

## Install

```sh
npm install @trysac/mcp-schema-lint
```

Requires Node.js 20 or newer. The package ships ES modules with TypeScript declarations and has no runtime dependencies. The library in `src/index.ts` does not import any `node:` module, so it also runs in browsers.

## Usage

```ts
import { lintTools, formatText } from "@trysac/mcp-schema-lint";

const report = lintTools({
  tools: [{ name: "get user", description: "Fetch a user.", inputSchema: { type: "object" } }],
});
console.log(formatText(report));
```

The input is a `tools/list` result `{ tools: [...] }` or a bare array of tool objects. `formatText` prints one line per finding and a final summary line such as `2 errors, 1 warnings`.

### Configuration

| Option | Default | Description |
|---|---|---|
| `minDescriptionChars` | 20 | Descriptions with fewer code points warn `description-quality`. |
| `maxToolTokens` | 800 | Token budget of one tool. |
| `maxTotalTokens` | 8000 | Token budget of the whole list. |
| `rules` | none | Map of rule id to `'error'`, `'warning'` or `'off'`. |

Token estimates are `Math.ceil(JSON.stringify(x).length / 4)`. A negative or non-finite numeric option throws `RangeError`. An unknown rule id or an invalid level throws `LintInputError` with code `UNKNOWN_RULE`.

### Limits

Input is limited to 5 MiB of serialized JSON, 1000 tools and 64 levels of nesting. Findings are capped at 10 000. Beyond that cap the first 10 000 findings in sort order are kept, `truncated` is `true`, the error and warning counts still cover all findings, and `formatText` prints `output truncated to 10000 findings` before the summary.

## API

| Export | Signature | Description |
|---|---|---|
| `lintTools` | `(input: unknown, config?: LintConfig) => LintReport` | Lints a tools list. Throws `LintInputError` or `RangeError`. |
| `formatText` | `(report: LintReport) => string` | One line per finding, then a summary line. Control characters in untrusted fields are replaced by `?`. |
| `formatJson` | `(report: LintReport) => string` | The report as JSON with a 2-space indent. |
| `RULES` | `readonly { id, defaultSeverity, description }[]` | The ten rules with their default severity. |
| `LintInputError` | `class extends Error` | `code` is `NOT_A_TOOLS_LIST`, `TOO_LARGE`, `TOO_DEEP` or `UNKNOWN_RULE`. |
| `Finding`, `LintConfig`, `LintReport`, `Severity` | types | Report and configuration shapes. |

Each finding has `ruleId`, `severity`, `tool`, `path` (an RFC 6901 JSON Pointer), `message` and `suggestion`.

## Rules

| Id | Default | Checks |
|---|---|---|
| `name-format` | error | Name is 1 to 128 characters of `A-Z a-z 0-9 _ - .`, as in MCP 2025-11-25. |
| `name-portability` | warning | Name does not match `^[a-zA-Z0-9_-]{1,64}$`, the stricter pattern of the Anthropic and OpenAI tool APIs. |
| `name-duplicate` | error | A tool name is used by more than one tool in the list. |
| `description-missing` | error | Tool has no description or a blank one. |
| `description-quality` | warning | Description is shorter than `minDescriptionChars`, equals the tool name ignoring case, or is one of `does stuff`, `tool`, `helper`, `todo`. |
| `schema-root` | error | `inputSchema` is missing, is not an object, or its `type` is not `object`. |
| `required-undefined` | error | A `required` entry is not a string or names a property not declared in `properties`, including `allOf`, `anyOf` and `oneOf` branches. |
| `param-type-missing` | warning | A property declares no `type`, `enum`, `const`, `$ref`, `anyOf`, `oneOf` or `allOf`. |
| `param-description-missing` | warning | A property has no description. |
| `size-budget` | warning | A tool exceeds `maxToolTokens`, or the list exceeds `maxTotalTokens`. |

`$ref` targets are not resolved.

## Why not MCP Inspector

MCP Inspector is an interactive debugger for connecting to a server and calling its tools. mcp-schema-lint is a non-interactive linter that reads a saved `tools/list` document, returns findings and sets an exit code, so it fits CI pipelines.

## CLI

The command-line front end is `run(argv, io)` in `src/cli.ts`. The package does not declare a `bin` entry, so the command is invoked from code with the arguments `FILE [--format text|json] [--strict] [--config FILE] [--max-tool-tokens N]`.

Exit codes: `0` no errors, `1` errors found or warnings with `--strict`, `2` unreadable file, invalid JSON, invalid configuration, input error or usage error. The file size is checked against 5 MiB before parsing.

## Security

The threat model and the limits of the input handling are described in [docs/SECURITY.md](docs/SECURITY.md).

## Development

```sh
npm install
npm test
```

Test layout and coverage rules are described in [docs/TESTING.md](docs/TESTING.md).

## License

[MIT](LICENSE) © 2026 Miguel Gomez
