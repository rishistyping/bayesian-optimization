# Tools

Non-published utility scripts and helper tooling.

## Current scripts

- `tools/sanity_check.mjs`
  - lightweight repo sanity checks used by `npm run test`.
  - validates runtime file references and key structural constraints.
- `tools/setup_hooks.mjs`
  - installs local git hooks (including pre-push checks).

## Usage

- Run sanity checks: `npm run test`
- Run full checks: `npm run check`
- Reinstall hooks: `npm run setup:hooks`

Do not place runtime app logic in this folder.
