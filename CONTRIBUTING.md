# Contributing

## Workflow

1. Create a feature branch from `master`.
2. Make focused changes.
3. Run checks locally:
   - `npm run check`
4. Open a PR with a concise summary and verification notes.

## Quickstart

- Install dependencies:
  - `npm install`
  - installs Git hook wiring for pre-push checks
- Run local server:
  - `npm run dev`
- Open:
  - `http://127.0.0.1:8011/index.html`

## Repo rules

- Publish boundary is `public/**` only.
- Keep prompts/notes/references/tools outside `public/`.
- Follow `design/design_context.md` and `AGENTS.md`.
- Keep runtime changes offline-friendly and minimal.
- Pre-push enforces `npm run check`; run it locally before pushing.
