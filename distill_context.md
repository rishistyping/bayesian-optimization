# Distill Context for This Repo

## Purpose + Scope
This is the canonical design and interaction guideline document for this repository. It captures how this project applies Distill authoring conventions and interactive-article practices while keeping a static, offline-friendly implementation.

Source: https://distill.pub/guide/

## Project Structure + Publishing Boundary
This repo follows the Distill project-structure pattern where publishable files are isolated in `public/` and only that tree is deployed. Internal artifacts (prompts, notes, captures, specs, prototypes, utilities) must stay outside `public/`.

Source: https://distill.pub/guide/

## Distill Article Anatomy in This Repo
Preserve these structural patterns used in the current chapter implementation:
- `d-front-matter` for metadata
- `d-title` and `d-byline` for article identity
- `d-article` for prose and section flow
- `d-figure` for explorable blocks
- `d-math` for formulas

Repo mapping:
- Entry page: `public/index.html`
- Article-level styling: `public/css/styles.css`
- Explorable styling: `public/css/rain.css`
- Runtime interaction logic: `public/js/rain/*`

Source: https://distill.pub/guide/

## Layout + Reading Ergonomics
Preserve Distill reading rhythm:
- Keep prose flow primary and controls secondary.
- Use spacing and figure cadence to guide attention.
- Use page/body/screen/gutter layout intent when adding new sections.
- Keep chapter navigation low-emphasis and non-intrusive.

Source: https://distill.pub/guide/

## Interaction Best Practices for This Repo
Interaction must follow narrative-first teaching goals:
- Use progressive disclosure so users meet concepts in sequence.
- Prefer details-on-demand to avoid visual overload.
- Keep play/replay interruptible by direct user input.
- Use scrollytelling patterns only when they clarify causality.
- Avoid adding interactivity where static explanation is clearer.

Source: https://distill.pub/2020/communicating-with-interactive-articles/

## Accessibility Guidance
Accessibility baseline for all interactive additions:
- Keyboard operable controls and logical focus order.
- Visible and consistent focus styling.
- ARIA labels/live regions only where they improve comprehension.
- `prefers-reduced-motion` support for animations and auto-play features.
- Adequate contrast in both light and dark themes.

Source: https://distill.pub/2020/communicating-with-interactive-articles/

## Performance Guidance
Keep interactions smooth and maintainable:
- Avoid layout thrash in animation loops.
- Keep SVG updates bounded and incremental.
- Reuse DOM nodes for pooled visuals (particles/streaks).
- Clamp timer deltas to avoid jumps after tab inactivity.
- Keep runtime fully local/offline-capable.

Source: https://distill.pub/2020/communicating-with-interactive-articles/

## Preview Caveats (`file://` vs local server)
`file://` is acceptable for quick static checks, but local HTTP serving is recommended for reliable script/runtime behavior.

Recommended preview:
- `cd public`
- `python3 -m http.server 8011`
- open `http://127.0.0.1:8011/index.html`

Source: https://distill.pub/guide/

## Reuse, Licensing, and Attribution Checklist
Use Distill FAQ guidance for reuse:
- Distill text/diagrams are generally CC-BY unless noted otherwise.
- Distill interactive code is generally MIT unless noted otherwise.
- Third-party assets marked as external figures are not covered by blanket reuse.

How we attribute in this repo:
- Keep source URLs in docs for borrowed patterns.
- Record acknowledgements in `THIRD_PARTY_NOTICES.md`.
- Do not import third-party figures/code without explicit license compatibility.

Source: https://distill.pub/faq/

## Repo-Specific Workflow Rules
- Publish boundary: `public/**` only.
- Internal artifacts: `references/`, `prompts/`, `notes/`, `tools/`.
- Keep non-runtime files out of `public/`.
- Keep Bayesian model math authoritative in `public/js/rain/rain_model.js`.

Source: https://distill.pub/guide/

## References
- Distill Guide: https://distill.pub/guide/
- Distill FAQ: https://distill.pub/faq/
- Communicating with Interactive Articles: https://distill.pub/2020/communicating-with-interactive-articles/
