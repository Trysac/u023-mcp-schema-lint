# Project record: mcp-schema-lint

## Objective

Lint MCP tool definitions against the 2025-11-25 tool name rules, input schema structure, description quality and token budgets, with text and JSON reports. The utility gives developers of MCP servers a non-interactive check that reports ten rule findings with concrete fix suggestions, so that the check can run in continuous integration before tools reach agents.

## Scope

In scope:

- The library API in `src/index.ts`: `lintTools`, `formatText`, `formatJson`, `RULES` and `LintInputError`.
- The command-line front end `run(argv, io)` in `src/cli.ts`, with exit codes 0, 1 and 2.
- The ten rules listed in the README, with their default severities and configurable overrides.
- Token estimates per tool and for the whole list, with budgets.

Out of scope:

- Connecting to live MCP servers or calling tools.
- Full JSON Schema meta-validation; the package checks only the structural rules listed in the README.
- Resolving `$ref` targets.
- Automatically fixing findings; suggestions are text only.
- Interactive debugging, which is the purpose of MCP Inspector.

## Timeline

| Date | Milestone |
|---|---|
| 2026 | Repository created from the factory utility template. |

## Effort metrics

The factory records these values from its ledger and time log. Nothing is estimated in this file.

| Metric | Value | Source |
|---|---|---|
| Tokens (input / output) | 565067 / 116080 | factory ledger |
| Hours (human) | pending measurement | time log |
| Cost (USD) | 0.9430 | factory ledger |

## Factory run u023 (measured from API usage)

| Phase | Model | Batch | Input | Output | Cache write | Cache read | Cost (USD) |
|---|---|---|---|---|---|---|---|
| generation | claude-sonnet-5-5 | yes | 2490 | 87706 | 0 | 4473 | 0.4415 |
| fix-1 | claude-sonnet-5-5 | no | 4 | 2428 | 11307 | 27223 | 0.0553 |
| fix-2 | claude-sonnet-5-5 | no | 8 | 855 | 9177 | 63595 | 0.0379 |
| fix-3 | claude-sonnet-5-5 | no | 4 | 385 | 6639 | 25357 | 0.0230 |
| fix-4 | claude-sonnet-5-5 | no | 8 | 1684 | 7744 | 55253 | 0.0417 |
| fix-1 | claude-sonnet-5-5 | no | 6 | 501 | 7420 | 42074 | 0.0278 |
| fix-2 | claude-sonnet-5-5 | no | 6 | 647 | 8840 | 44815 | 0.0331 |
| fix-3 | claude-sonnet-5-5 | no | 6 | 657 | 6137 | 39627 | 0.0259 |
| audit | claude-sonnet-5-5 | no | 12 | 5217 | 40938 | 144000 | 0.1689 |
| fix-4 | claude-sonnet-5-5 | no | 10 | 3928 | 12404 | 79759 | 0.0783 |
| docs | claude-haiku-5-5 | no | 36337 | 12072 | 0 | 0 | 0.0097 |

Total: $0.9430. Prices: Anthropic list prices.
