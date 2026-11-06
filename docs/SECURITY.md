# Security practices

How this repository keeps the package and its users safe. The disclosure policy is in
[../SECURITY.md](../SECURITY.md).

## Threat model

The input is an untrusted JSON document, possibly produced by a third-party MCP server. The package parses no network data and has no runtime dependencies.

Defended:

- Oversized input: the CLI rejects files larger than 5 MiB before `JSON.parse`; the library rejects inputs whose serialized form is longer than 5 MiB with `TOO_LARGE`.
- Deep or circular nesting: the library checks nesting depth iteratively and rejects more than 64 levels with `TOO_DEEP`, which also stops circular structures.
- Tool flooding: more than 1000 tools are rejected with `TOO_LARGE`, and findings are capped at 10 000 with `truncated` set.
- Prototype keys: property names are read only with `Object.keys` and `Object.hasOwn`, so a `__proto__` key from `JSON.parse` is treated as ordinary data. Rule overrides are accepted only for the ten known ids.
- Hostile text in messages: labels are truncated to 200 characters, pointer segments to 256, and `formatText` replaces control characters and U+2028/U+2029 with `?`.
- Code execution: the library uses no `eval`, dynamic `Function` construction or child processes.

Not defended:

- Content safety: descriptions are checked for length and generic wording only. Prompt injection or misleading instructions in descriptions are not detected.
- Schema semantics: `$ref` is not resolved, and the package is not a full JSON Schema validator, so invalid schemas that pass the structural rules are not reported.
- Memory use: the 5 MiB limit bounds the input, but parsing and serializing it still allocate memory; there is no streaming.
- File access: the CLI reads any path it is given and imposes no directory restrictions.
- Configuration files: `--config` files are read with the same size limit but are not otherwise sandboxed.

## Secrets

- No secrets, tokens or credentials in the repository, commit history, logs or prompts.
- `gitleaks` runs as the last step of `npm run check` and as a dedicated CI job. Its configuration is
  `.gitleaks.toml`.
- Publishing credentials live only in the CI secret store or the maintainer's local npm configuration.

## Dependencies

- Runtime dependencies are avoided; development dependencies are limited to the toolchain listed in
  [STACK.md](STACK.md).
- Dependabot opens weekly updates for npm packages and GitHub Actions.
- Commit the generated `package-lock.json` so installs are reproducible.

## Code

- No `eval`, dynamic `Function` construction or shelling out from library code.
- Inputs from callers are validated and rejected with explicit errors.

## Publishing

- Packages are published from a clean checkout after `npm run check` passes.
- Only `dist/` is included in the published tarball.
