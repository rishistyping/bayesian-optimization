# How to Change Your Mind | The Last Assumption (Interactive Edition)

Interactive chapter adaptation of _The Last Assumption_.

## Publish boundary

This repository is structured to publish **only** `public/**`.

- Published runtime site: `public/`
- Internal non-published artifacts: `references/`, `prompts/`, `notes/`, `tools/`

Do not place specs, captures, prompt logs, archives, or prototypes inside `public/`.

## Local preview

- Quick smoke check: open `public/index.html` directly (`file://`).
- Recommended preview:
  - `npm run dev`
  - open `http://127.0.0.1:8011/index.html`
- Fallback:
  - `cd public`
  - `python3 -m http.server 8011`

Current pages:

- Chapter 8: `http://127.0.0.1:8011/index.html`
- Chapter 3: `http://127.0.0.1:8011/chapters/ch03_epistemic_zero.html`

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

## Runtime implementation notes

### Chapter 8 (`public/index.html`)

Main JS modules:

- `public/js/rain/rain_model.js`: Bayesian state derivation (single and sequential updates).
- `public/js/rain/rain_engine.js`: UI orchestration, replay, hash sync, interactions.
- `public/js/rain/rain_preview_d3.js`: rain preview panel.
- `public/js/rain/rain_conditional_d3.js`: conditional sample-space animation.

Main CSS modules:

- `public/css/rain.css`: interactive styling for Chapter 8 components.
- `public/css/styles.css`: global Distill/article styles and shared UI treatments.

Current Chapter 8 UX features include:

- 5-step replay (`Prior -> Channel -> Update-1 -> Update-2 -> Decision`).
- Factorized testimony channel (hit and false-alarm paths).
- Second-signal update controls (including quick action buttons).
- Always-visible evidence summary (bits, KL update cost, signed shift).
- Scenario comparison rows (`Current`, `Casual friend`, `Weather expert`, `Friend who jokes`).
- Formula disclosure tabs (`Intuition`, `Symbols`, `Derivation`).

### Chapter 3 (`public/chapters/ch03_epistemic_zero.html`)

Main JS modules:

- `public/js/epzero/epzero_model.js`
- `public/js/epzero/epzero_viz_d3.js`
- `public/js/epzero/epzero_engine.js`

Styles:

- `public/css/epzero.css`

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
5. Run `npm run check` before commit/push.
