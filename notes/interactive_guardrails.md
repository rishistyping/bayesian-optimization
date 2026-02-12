# Interactive Guardrails

## Extending the Rain engine safely

- Keep `public/js/rain/rain_model.js` authoritative for Bayes math.
- Keep orchestration in `public/js/rain/rain_engine.js`; avoid duplicated state models.
- Prefer additive modules in `public/js/rain/*` with explicit init/update/destroy contracts.
- Keep runtime assets local and offline-capable (no CDN assumptions).

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
