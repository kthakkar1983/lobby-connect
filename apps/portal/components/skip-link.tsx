/**
 * Skip-to-content link (WCAG 2.4.1, Level A). Visually hidden until focused,
 * then surfaces as the first stop in the tab order so keyboard users can jump
 * past the header/nav. Targets the layout's <main id="main">.
 */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-50 rounded-button bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-3"
    >
      Skip to content
    </a>
  );
}
