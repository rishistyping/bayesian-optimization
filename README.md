# How to Change Your Mind | The Last Assumption (Interactive Edition)

Interactive chapter adaptation of _The Last Assumption_ Chapter 8 ("How to Change Your Mind").

## Publish boundary

This repository is structured to publish **only** `public/**`.

- Published runtime site: `public/`
- Internal non-published artifacts: `references/`, `prompts/`, `notes/`, `tools/`

Do not place specs, captures, prompt logs, archives, or prototypes inside `public/`.

## Local preview

- Quick smoke check: open `public/index.html` directly (`file://`).
- Recommended preview:
  - `cd public`
  - `python3 -m http.server 8011`
  - open `http://127.0.0.1:8011/index.html`

Use local HTTP preview for full behavior parity with production browser policies.

## Developer commands

1. Install dependencies:
   - `npm install`
   - This also installs the repo pre-push hook (`npm run check` before push).
2. Run local server:
   - `npm run dev`
3. Run quality checks:
   - `npm run lint`
   - `npm run test`
   - `npm run check`
4. Reinstall hooks manually if needed:
   - `npm run setup:hooks`

## Repo layout

- `public/`: production HTML/CSS/JS/assets
- `references/`: inspiration, captures, specs, prototypes
- `prompts/`: planning and prompt artifacts
- `notes/`: editorial and implementation notes
- `tools/`: local utility scripts/workflows

## Guidance docs

- Canonical design guidance for this repo: `design/design_context.md`
- Layout specification (Distill Guide-derived): `design/layout_spec.md`
- How to request precise design/layout changes: `design/README.md`
- Compatibility pointer: `design/distill_context.md`
- Agent/developer operating rules: `AGENTS.md`
- Contributor workflow: `CONTRIBUTING.md`
- Scaffolding implementation notes: `notes/scaffolding_plan.md`
- Interactive guardrails: `notes/interactive_guardrails.md`

## Adding a new chapter/page

1. Add a new static page under `public/` (for example `public/chapters/ch09.html`).
2. Reuse existing Distill article structure and style conventions from `design/design_context.md`.
3. Add/update navigation links (chapter contents and prev/next links).
4. Verify local script/style paths remain relative to the new page location.
