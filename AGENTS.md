# AGENTS.md

## Project scope

This repository contains a Distill-style static interactive chapter.

- Published output: `public/**` only
- Internal-only artifacts: `references/`, `prompts/`, `notes/`, `tools/`

Do not move internal artifacts into `public/`.

## Local development

- Preferred:
  - `npm run dev`
  - open `http://127.0.0.1:8011/index.html`
- Fallback:
  - `cd public && python3 -m http.server 8011`

## Runtime ownership map

- Narrative and structure: `public/index.html`
- Article styles: `public/css/styles.css`
- Interactive styles: `public/css/rain.css`
- Engine logic: `public/js/rain/rain_engine.js`
- Bayesian model: `public/js/rain/rain_model.js`
- Conditional/replay visual modules: `public/js/rain/*.js`

## Guardrails

- Follow `design/design_context.md` as canonical guidance.
- Preserve narrative-first flow and progressive disclosure.
- Keep controls keyboard-operable with visible focus states.
- Respect `prefers-reduced-motion` behavior.
- Keep animation loops bounded and avoid layout thrash.
- Keep runtime offline-capable (no CDN dependencies).

## Adding a new chapter/page

1. Add a static HTML page under `public/` (for example `public/chapters/ch09.html`).
2. Reuse Distill structure (`d-front-matter`, `d-title`, `d-article`, `d-figure`) and current CSS conventions.
3. Keep relative paths valid from the new location.
4. Update chapter navigation links.

## Definition of done

- `npm run check` passes.
- Runtime behavior is unchanged unless intentionally requested.
- No internal artifacts are added to `public/`.
- Accessibility and reduced-motion behavior remain intact.
