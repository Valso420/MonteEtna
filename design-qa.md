# Design QA — Monte Etna refinement

## Evidence

- User-reported desktop state: `C:\Users\mater\AppData\Local\Temp\codex-clipboard-86ac0dbe-67c2-4f18-aa3d-51caae21abd0.png` (1908 × 911 physical pixels, approximately 1526 × 699 CSS pixels at 125% display scaling).
- Refined desktop capture: `C:\Users\mater\AppData\Local\Temp\monte-etna-refined-desktop-1526x699.png`.
- Refined mobile capture: `C:\Users\mater\AppData\Local\Temp\monte-etna-refined-mobile-390x844.png`.
- Additional browser checks: 188 × 812, 320 × 568, 375 × 812, 390 × 844, 430 × 932, 768 × 1024, 901 × 800, 1024 × 768, 1366 × 768, 1440 × 900, 1526 × 699, and 1908 × 911 CSS pixels.
- State: dark landing page, static Spotify summary loaded, no hover or modal state.

## Findings

No actionable P0, P1, or P2 findings remain after the refinement pass.

- Desktop fold: the reported layout produced a 1000-pixel hero and pushed CTAs below the visible area. The refined short-desktop layout ends the hero at 651 pixels in the equivalent 1526 × 699 viewport; CTAs, metrics, and cover all finish before the fold.
- Hero wrapping: “El sonido” previously wrapped a second time and turned the intended four-line heading into five lines. Each intended line is now an explicit non-wrapping block, with four lines at every tested width.
- Typography: the compressed `Arial Narrow` system was removed. The wordmark and descriptor now share the local Segoe UI stack, Georgia is reserved for editorial content and metrics, and a local mono stack is limited to small metadata labels.
- Desktop composition: the cover was moved toward the conversion block, reducing the dead space between both hero columns without enlarging the text again.
- Scale: desktop H1 is capped at 84 pixels, short-desktop H1 at about 70 pixels, and mobile H1 follows a continuous 44.8–60 pixel curve from 320 to 430 pixels. Supporting copy and section headings were reduced accordingly.
- Mobile final action: a generic mobile `.actions` override previously removed all space between “Subí al circuito.” and its CTA group. The override now targets only the hero, while the final group retains 22–28 pixels of structural spacing. No overlap remained at 320, 375, 390, or 430 pixels.
- Responsive resilience: no horizontal overflow, clipped buttons, wrapped metrics, or final-title collisions remained in the standard viewport matrix. At a 188-pixel CSS viewport used to approximate 200% zoom reflow, the narrow fallback stacks metrics and preserves full content width.
- Accessibility: controls remain at least 52 pixels high, focus styles and skip link remain intact, reduced motion is preserved, and responsive changes do not alter DOM or keyboard order.
- Content and data: copy, external destinations, dynamic IDs, and repository-backed values are unchanged.

## Comparison History

### Pass 1 — blocked

- P1: desktop hero was cut off before the primary CTA and metrics.
- P1: “El sonido” created an unintended fifth line.
- P1: mobile final title visually overlapped the first CTA.
- P1: brand and descriptor used the rejected compressed display font.
- P2: type scale and vertical spacing were too large across the page.
- P2: the mobile H1 jumped abruptly above 380 pixels.
- P2: a 320-pixel body minimum prevented correct 200% zoom reflow.

### Fixes

- Added stable heading line wrappers and a lower, continuous responsive scale.
- Added a compact desktop-height treatment and reduced hero, cover, control, metric, section, and final-heading dimensions.
- Replaced the typography tokens with local sans, serif, and mono roles.
- Scoped the zero-margin rule to `.hero-actions` and restored a dedicated final CTA gap.
- Removed the body minimum width and added an extreme-narrow reflow treatment.

### Pass 2 — passed

- The equivalent user desktop viewport now shows the entire primary conversion block before the fold.
- Mobile captures show clear separation between the final title and CTA group.
- The complete responsive matrix has matching document and viewport widths and no interactive-element overflow.

## Verification

- [x] Viewport-only desktop capture at the reported effective size.
- [x] Full-page mobile capture at 390 × 844.
- [x] Responsive geometry and overflow matrix.
- [x] 200% zoom-equivalent narrow reflow.
- [x] Browser console and page-error checks.
- [x] HTTP and direct-file static summary fallback.
- [x] JavaScript syntax, generated-data validation, and diff check.

final result: passed
