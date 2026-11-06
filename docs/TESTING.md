# Testing

## Tools

- [Vitest](https://vitest.dev/) runs the suites in `test/`.
- Coverage is collected with V8 (`@vitest/coverage-v8`) over `src/`.

## Test files

- `test/index.test.ts`: the library API. Covers clean input, finding shape and the text and JSON formatters, every rule (name, description, schema, parameter and size rules), sorting, rule overrides and config validation, the 10 000 findings cap, and the input limits (5 MiB, 1000 tools, depth 64, non-tools-list input, circular input).
- `test/acceptance.test.ts`: acceptance checks for the pointer escaping, the text line format, name length and portability, duplicate names, and `required` handling.
- `test/cli.test.ts`: `run` from `src/cli.ts` with in-memory streams. Covers exit codes 0, 1 and 2, `--strict`, `--format`, `--max-tool-tokens`, `--config`, bad configuration files, the 5 MiB file check and usage errors. Temporary files are created in the OS temp directory and removed afterwards.

## Commands

```sh
npm test            # vitest run --coverage
npx vitest          # watch mode while developing
npm run check       # every gate, including tests
```

## Rules

- Coverage thresholds are set in `vitest.config.ts` and must not be lowered.
- Tests go through the public entry points (`src/index.ts` and `run` in `src/cli.ts`) and assert observable behaviour: return values, thrown errors and their codes, and output text.
- Each bug fix adds a test that fails without the fix.
- Tests are deterministic: no network, no real clock or randomness, no shared state between tests.

## Reports

Coverage reports are written to `coverage/` (text summary and `lcov`). The folder is ignored by git.
