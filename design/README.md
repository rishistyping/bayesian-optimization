# Design Folder Usage

Use this folder when you want to request or implement layout changes with clear, precise instructions.
The goal is to make changes specific enough that implementation is straightforward and review is fast.

## What is in this folder

- `design/design_context.md`: high-level design and interaction standards.
- `design/layout_spec.md`: concrete layout rules based on Distill guidance.
- `design/distill_context.md`: compatibility pointer.

## Current design notes for this repo

- Chapter 8 is a dense interactive chapter. Keep its narrative-first progression intact: prior -> channel -> forced update -> conditional perspective -> reflection.
- Chapter 8 interaction visuals live primarily in `public/css/rain.css`.
- Shared/global article and utility visuals live in `public/css/styles.css`.
- If a style is chapter-specific, prefer `rain.css`; if shared across chapters/components, keep it in `styles.css`.

## How to write good layout instructions

When asking for a layout change, describe:

1. What should change visually.
2. Exactly where it should change.
3. What should not change.
4. How it should behave on desktop and mobile.
5. How to verify the result.

If you skip any of these, requests become vague and implementation quality drops.

## Recommended workflow

1. Read `design/layout_spec.md` first.
2. Choose the relevant layout pattern/class for your change.
3. Write a request using the template below.
4. Keep the change scoped to the minimum required files.
5. Run `npm run check` before commit/push.

## Appendix metadata sections (Footnotes / References / Reuse / Citation)

When a request touches scholarly metadata or legal/citation sections, be explicit:

1. Keep bibliography sources in `public/` (for example `public/references.bib`).
2. Use inline `d-cite`/`d-footnote` near the exact claim they support.
3. Place appendix metadata blocks in `d-appendix` after `d-article`.
4. Use stable heading IDs:
   `updates-and-corrections`, `reuse`, `citation`.
5. Keep legal language explicit and policy-safe (do not imply permissive reuse unless explicitly intended).

Use this request pattern:

```md
Goal

- Add/adjust Distill-style appendix metadata sections.

In scope

- `public/index.html` (d-cite/d-footnote/d-appendix)
- `public/references.bib` (or existing bibliography source)

Out of scope

- No changes to model math, replay logic, or state/hash behavior.

Acceptance criteria

1. Footnotes and References render.
2. Updates/Corrections, Reuse, and Citation sections appear in appendix.
3. All citation keys resolve.
4. Runtime behavior remains unchanged.
```

## Request template (natural language, but precise)

Copy/paste this and fill in the brackets:

```md
Goal

- I want [specific visual result] in [specific section/component].

Scope

- Change only: [exact sections/components].
- Do not change: [explicit exclusions such as runtime logic, model math, navigation URLs].

Files

- Expected files to edit: [paths]
- Files that must remain untouched: [paths]

Layout behavior

- Use [layout class/pattern] from `design/layout_spec.md`.
- Desktop: [placement, width, alignment, spacing]
- Mobile: [stacking/reflow rules]

Accessibility and motion

- Keep keyboard order and visible focus intact.
- Keep reduced-motion behavior understandable and equivalent.

Acceptance criteria

1. [clear visual check]
2. [responsive check]
3. [no runtime/logic regression]
4. `npm run check` passes
```

## Verification checklist

- Runtime assets remain under `public/**`.
- No runtime references to `references/`, `prompts/`, `notes/`, or `tools/`.
- No broken local `src`/`href` paths.
- Layout works on desktop and mobile.
- Keyboard/focus and reduced-motion behavior remain valid.
- `npm run check` passes.

## Related docs

- `design/design_context.md`
- `design/layout_spec.md`
- `AGENTS.md`
- `CONTRIBUTING.md`
