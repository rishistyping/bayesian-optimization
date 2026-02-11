# Distill Context for This Repo

## Overview
This project is a Distill-style static interactive chapter for *The Last Assumption*. Keep the essay readable first, then interactive second. Changes should preserve the narrative arc and avoid turning the page into an app dashboard.

## Distill Structure in This Repo
- Preserve and reuse the current Distill custom elements:
  - `d-front-matter` for metadata
  - `d-title` for chapter heading
  - `d-byline` for author metadata block
  - `d-article` for narrative body
  - `d-figure` and `figcaption` for explorable/figure framing
  - `d-math` for inline or block math
- Keep article-level branding/content in `public/index.html` and article CSS in `public/css/styles.css`.
- Keep explorable-specific visuals and controls in `public/css/rain.css` and `public/js/rain/*`.

## Layout and Reading Ergonomics
- Favor consistent vertical rhythm over dense UI.
- Keep sections in a linear reading flow; avoid sticky panels that compete with prose.
- Use compact, readable paragraph lengths and avoid abrupt full-width control blocks unless necessary.
- For chapter-level elements (title, chapter nav), use subtle styling and spacing that matches the existing page rhythm.

## Figures and Media
- Every major figure/explorable should have a clear `figcaption`.
- Prefer responsive SVG/HTML elements over heavy binary media.
- Avoid large animated assets and repeated raster exports in history.
- If media is needed, compress and verify size before committing.
- Keep figure styling scoped so it does not leak into general article typography.

## Interaction Design
- Use progressive disclosure: readers should not have to learn all controls at once.
- In this repo, narrative unlock by step is intentional; preserve it when adding features.
- Avoid "play ahead" UI that lets readers skip conceptual setup without context.
- Controls should support guided narrative first, sandbox second.

## Accessibility
- All interactive controls must be keyboard reachable.
- Provide visible `:focus-visible` states for links, buttons, and inputs.
- Use semantic landmarks (`nav`, `section`, `figure`) and labels (`aria-label`) where useful.
- Ensure color choices preserve contrast against light backgrounds.
- Respect `prefers-reduced-motion`: disable or simplify non-essential animations.
- Keep live regions concise and meaningful; avoid chatty announcements.

## Performance
- Prefer simple DOM/SVG updates and bounded transitions.
- Avoid layout thrash (read/write style loops) in animation logic.
- Keep particle and transition counts moderate for mobile safety.
- Recompute only what changed; avoid full redraws when a local update is enough.
- Keep page offline-friendly: no required CDN/runtime dependencies.

## Citations and Footnotes
- Use concise citations and footnote patterns consistent with Distill-style longform writing.
- Keep footnotes readable and scannable; avoid citation spam in dense UI regions.
- If adding chapter references, tie them to narrative claims, not decorative callouts.

## Local Preview Caveats
- Opening `public/index.html` directly with `file://` can trigger browser restrictions.
- Preferred preview:
  - `cd public`
  - `python3 -m http.server 8011`
  - open `http://127.0.0.1:8011/index.html`

## Distill Tone
- Keep prose crisp and concrete.
- Use show-then-tell structure: concrete example first, abstraction second.
- Minimize jargon; define terms when introduced.
- Maintain confident, non-hyped instructional voice.
- Keep paragraphs short enough for scanning while preserving argument continuity.

## Repo File Map
- `public/index.html`: chapter structure, Distill elements, explorable placement.
- `public/css/styles.css`: article-level typography/chrome.
- `public/css/rain.css`: explorable-specific layout and interactions.
- `public/js/template.v2.js`: Distill template/runtime integration.
- `public/js/hider.js`: progressive reveal/collapsible behavior.
- `public/js/rain/rain_model.js`: Bayesian model math/state helpers.
- `public/js/rain/rain_engine.js`: explorable rendering, controls, replay behavior.
- `public/[GENERATIVE] TLA Final Edit.md`: manuscript reference for chapter naming and sequencing.

## Manuscript Chapter Mapping
- Current explorable corresponds to Chapter 8 in manuscript: **How to Change Your Mind**.
- When wiring chapter navigation, use manuscript-aligned slugs so future chapter pages can be added without renaming existing links.

## References
- Distill Author Guide: https://distill.pub/guide/
- Distill FAQ (licensing and reuse notes): https://distill.pub/faq/
- Repo local notes: `README.md`
