# Interactive Guardrails

## Extending the Rain engine safely

- Keep `public/js/rain/rain_model.js` authoritative for Bayes math.
- Keep orchestration in `public/js/rain/rain_engine.js`; avoid duplicated state models.
- Prefer additive modules in `public/js/rain/*` with explicit init/update/destroy contracts.
- Keep runtime assets local and offline-capable (no CDN assumptions).
- For multi-step updates, keep each evidence step explicit:
  - stage 1 posterior and stage 2 posterior should both be visible/readable,
  - decision logic should always consume the final posterior.

## Chapter module boundaries

- Chapter-specific logic should stay page-local:
  - Chapter 8 modules under `public/js/rain/*`
  - Chapter 3 modules under `public/js/epzero/*`
- Shared article chrome/theme behavior remains in `public/js/hider.js` and `public/css/styles.css`.
- Do not couple chapter engines directly; navigation is static links between pages.

## Accessibility checklist

- All interactive controls must be keyboard reachable.
- Use clear labels (`aria-label` when visible text is insufficient).
- Preserve visible focus styles.
- Preserve polite, non-spammy live-region announcements.
- Respect `prefers-reduced-motion` in all animated modules.

## Performance checklist

- Avoid layout thrash in render loops.
- Reuse pooled DOM nodes for particles/drops/streaks where possible.
- Clamp timer delta values to avoid tab-resume jumps.
- Keep animation counts bounded and configurable.
- Avoid unnecessary full re-renders during slider drag; use frame throttling.

## Publish-boundary checklist

- Runtime files only under `public/**`.
- Internal artifacts stay in `references/`, `prompts/`, `notes/`, `tools/`.
- Validate references in `public/index.html` before merging.
