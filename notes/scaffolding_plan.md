# Scaffolding Plan

## Goal

Add a lightweight development scaffolding layer for this static Distill-style site without changing runtime architecture or publish boundaries.

## Best-practice checklist (distilled)

- Keep one canonical command surface for contributors (`npm run ...`).
- Keep CI checks deterministic and quick.
- Validate runtime file references and publish boundaries automatically.
- Keep documentation explicit about what ships (`public/**`) vs internal artifacts.
- Keep linting correctness-focused to avoid unnecessary churn in legacy static code.
- Preserve accessibility and reduced-motion expectations while adding tooling.

## Mapping to this repo

- `AGENTS.md`: project rules and definition of done.
- `CONTRIBUTING.md`: contributor quickstart and PR expectations.
- `.editorconfig`: consistent editor baseline.
- `package.json`: `dev`, `format`, `lint`, `test`, `check`.
- `tools/sanity_check.mjs`: static runtime/a11y/publish-boundary checks.
- `.github/workflows/check.yml`: run `npm run check` on PR/push.

## Commands

- `npm run dev`: local preview on port `8011`.
- `npm run format`: format docs/config/tooling files.
- `npm run lint`: JS + CSS lint.
- `npm run test`: static sanity checks for runtime paths and a11y basics.
- `npm run check`: full local gate (`format:check`, `lint`, `test`).

## Risks and mitigations

- Risk: linting noise from legacy static code.
  - Mitigation: minimal correctness-first rules.
- Risk: false positives in CSS linting due to existing patterns.
  - Mitigation: targeted rule relaxations only.
- Risk: accidental publication of internal artifacts.
  - Mitigation: keep existing repo guard workflow + sanity boundary checks.
