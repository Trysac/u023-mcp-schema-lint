# Architecture

## Overview

`@trysac/mcp-schema-lint` is a small, dependency-free TypeScript package published to npm as ES modules with type declarations. It lints the tools of an MCP `tools/list` result against ten rules covering tool names, input schema structure, description quality and token budgets, and renders the findings as text or JSON.

## Modules

| Module | Responsibility |
|---|---|
| `src/index.ts` | Public library API: `lintTools`, `formatText`, `formatJson`, `RULES`, `LintInputError` and the types. No Node.js imports. |
| `src/cli.ts` | Command-line front end, `run(argv, io)`. The only module that uses Node.js APIs (`node:fs`). Not re-exported from `index.ts`. |

## Processing

1. The input is checked for nesting depth (64 levels, iterative traversal) and serialized size (5 MiB) before anything else.
2. The tools array is extracted from `{ tools: [...] }` or a bare array; each entry must be an object and the count is limited to 1000.
3. Each tool is checked for name, description, input schema and parameters. Schema traversal is iterative over `properties`, `items`, `prefixItems`, `anyOf`, `oneOf`, `allOf` and `$defs`.
4. Findings are collected per tool, sorted by path and rule id, and capped at 10 000 findings. Counts cover all findings.

## Boundaries

- No runtime dependencies. The library imports nothing from Node.js and performs no I/O.
- Only `src/cli.ts` reads files from disk.
- Errors are thrown as `LintInputError` for input and configuration problems with a stable `code`, and as `RangeError` for invalid numeric options.

## Build and distribution

The package is compiled with `tsc` and published as ES modules with type declarations.

## Decisions

Architectural decisions are recorded in [decisions/](decisions/), starting with
[0001](decisions/0001-record-architecture-decisions.md).
