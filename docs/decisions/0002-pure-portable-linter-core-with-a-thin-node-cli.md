# Pure portable linter core with a thin Node CLI

Status: accepted (generated, pending human review)

## Context

MCP tool definitions need CI linting against the 2025-11-25 tool name rules, input schema structure, description quality and token budgets. The linter must also run in browsers, process untrusted JSON safely and give deterministic, bounded output.

## Decision

Put all logic in src/index.ts as pure functions over already parsed JSON with zero dependencies and no node: imports. Isolate file IO, argument parsing and exit codes in src/cli.ts behind run(argv, io), which takes injected streams. Enforce limits in order: whole-input nesting depth (64, iterative), serialized size (5 MiB), tool count (1000), finding cap (10_000 kept, counts cover all). Walk schemas iteratively and read keys only through Object.keys and Object.hasOwn so __proto__ keys are plain data. Rule configuration is validated against the rule table before linting starts, and a single typed error class carries stable codes.

## Consequences

The library is portable and trivially testable, and results are deterministic because findings are sorted by tool index, path and rule id. The depth limit applies to the whole document, so schemas can nest about 30 levels. $ref is not resolved and no JSON Schema meta-validation is done, so semantic mistakes behind references go unseen. Path segments over 256 characters are truncated to keep memory bounded. Invalid numeric options raise RangeError because the specified error codes do not cover them.
