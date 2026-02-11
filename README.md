# How to Change Your Mind | The Last Assumption (Interactive Edition)

Distill-style interactive chapter adaptation of *The Last Assumption* Chapter 8 ("How to Change Your Mind").

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

## Repo layout

- `public/`: production HTML/CSS/JS/assets
- `references/`: inspiration, captures, specs, prototypes
- `prompts/`: planning and prompt artifacts
- `notes/`: editorial and implementation notes
- `tools/`: local utility scripts/workflows

## Guidance docs

- Canonical Distill guidance for this repo: `distill_context.md`
- Backward compatibility pointer: `design_context.md`

## Adding a new chapter/page

1. Add a new static page under `public/` (for example `public/chapters/ch09.html`).
2. Reuse existing Distill article structure and style conventions from `distill_context.md`.
3. Add/update navigation links (chapter contents and prev/next links).
4. Verify local script/style paths remain relative to the new page location.
