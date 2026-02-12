# Layout Specification (Distill Guide-Derived)

## 1) Purpose

This document defines the layout contract for this repository's Distill-style static site. Use it for layout-only changes so updates remain precise, consistent, and safe for the current runtime architecture.

Primary source: `https://distill.pub/guide/`

## 2) Source and Citation Policy

- This spec is derived from Distill Guide layout and article-structure guidance.
- Keep summaries repo-specific; avoid long verbatim copying.
- For layout decisions, cite `https://distill.pub/guide/` in PR notes or implementation plans.

## 3) Repo Mapping: Distill Concepts -> This Repo

Distill Guide examples use `dt-*` elements. This repo uses `d-*` custom elements via `public/js/template.v2.js`.

- Distill `dt-article` intent -> repo `d-article`
- Distill `dt-byline` intent -> repo `d-byline`
- Distill `dt-appendix` intent -> appendix region after `d-article`
- Distill front matter script intent -> repo `script#distill-front-matter` JSON in `public/index.html`

Implementation notes for this repo:

- Page structure entrypoint: `public/index.html`
- Article/chrome styling: `public/css/styles.css`
- Interactive-specific layout/styling: `public/css/rain.css`
- Interactive behavior/state: `public/js/rain/*.js`

## 4) Layout Primitives and When to Use Them

Use Distill layout classes intentionally. Choose the smallest layout that preserves readability.

| Layout class                                           | Intended content                        | Do                                            | Don't                                                      | Mobile expectation                    |
| ------------------------------------------------------ | --------------------------------------- | --------------------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| `.l-body`                                              | Default prose + standard figures        | Use for most narrative blocks                 | Use for dense wide diagrams that need more horizontal room | Stays primary text width              |
| `.l-middle`                                            | Medium-width diagrams                   | Use for visuals slightly wider than body      | Use as default for every section                           | Collapses toward body width           |
| `.l-page`                                              | Wide figures and comparison views       | Use for broad charts that benefit from width  | Use for tiny widgets                                       | Scales down cleanly; avoid overflow   |
| `.l-body-outset`, `.l-middle-outset`, `.l-page-outset` | Controlled "poke out" visuals           | Use sparingly for emphasis                    | Stack multiple outset blocks in a row                      | Reflow to avoid clipping              |
| `.l-screen`                                            | Full-width scenes                       | Use for high-value panoramic views            | Use for routine controls/forms                             | Should remain scroll-safe             |
| `.l-screen-inset`                                      | Near full-width with side padding       | Use when full-width needs edge breathing room | Use if `.l-page` is sufficient                             | Preserve side padding and readability |
| `.l-body.side`, `.l-middle.side`, `.l-page.side`       | Floated side content                    | Use for optional supporting visuals           | Put primary narrative logic here                           | Floats collapse in mobile flow        |
| `.l-gutter`                                            | Marginalia/asides/footnote-like content | Use for optional notes                        | Put required core controls here                            | Moves into flow on small screens      |

Source: `https://distill.pub/guide/`

## 5) Article Structure Contract

Layout changes must preserve this order and role separation:

1. Front-matter metadata block
2. Title/byline identity region
3. Main article narrative (`d-article`)
4. Figures embedded at relevant narrative points
5. Appendix-like sections at the end when needed

Do not convert primary prose into dashboard-style control walls. Keep narrative progression explicit.

Appendix placement rule for this repo:

- Use `d-appendix` immediately after `d-article` for metadata sections such as Footnotes, References, Updates and Corrections, Reuse, and Citation.
- Keep bibliography assets publishable under `public/**` (for example `public/references.bib`).

Source: `https://distill.pub/guide/`

## 6) Interactive Figure Placement Rules

- Mount complex interactives inside `d-figure` blocks within narrative order.
- Keep figure spacing consistent with surrounding paragraphs; avoid abrupt vertical jumps.
- Place optional controls in lower-emphasis regions; keep primary concept visible first.
- For this repo, keep Rain engine layout changes in `public/index.html` and `public/css/rain.css` only unless structure changes require article-level updates.
- Keep chapter navigation and helper UI low emphasis relative to teaching visuals.

Implementation notes for this repo:

- Main interactive anchor: `d-figure#rain-engine` in `public/index.html`
- Shared visual rhythm and typography: `public/css/styles.css`
- Interactive card/grid rules: `public/css/rain.css`

## 7) Accessibility + Reduced-Motion Layout Implications

- Preserve logical reading and tab order after any layout reflow.
- Do not use purely positional meaning; keep labels and headings explicit.
- Ensure focus indicators remain visible after spacing changes.
- Reduced-motion mode must preserve information hierarchy without relying on animated transitions.
- Avoid layouts that hide essential controls behind hover-only affordances.

## 8) Performance-Related Layout Constraints

- Prefer CSS layout changes over JS layout thrashing.
- Avoid repeatedly measuring and writing layout in the same frame for animated panels.
- Keep interactive containers dimensionally stable where possible to reduce reflow.
- When adding new visual regions, keep DOM depth and repaint area bounded.

## 9) Change Checklist for Layout PRs

Before merge, confirm:

1. Publish boundary preserved (`public/**` only for runtime assets).
2. No runtime path regressions (`href/src` still valid).
3. Layout class choice is explicit and justified.
4. Desktop + mobile behavior specified and verified.
5. Keyboard order and focus visibility preserved.
6. Reduced-motion behavior still understandable.
7. No added overlap/overflow in interactive regions.
8. `npm run check` passes.

## 10) References

- Distill Guide: `https://distill.pub/guide/`
