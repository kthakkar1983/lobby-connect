// SVGO config for the committed brand assets in public/brand/.
// Illustrator's SVG export embeds a large private PGF metadata blob
// (<i:aipgf … zstd/base64>) plus editor namespaces — none of it renders.
// This strips that, folds <style> classes into presentation attributes
// (so the marks stay collision-free if ever inlined), keeps the viewBox,
// and drops the fixed width/height so the component owns sizing.
//
// Run after any re-export:  pnpm -F @lc/portal optimize:svg
export default {
  multipass: true,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          // Keep viewBox — the components scale the marks; without it they can't.
          removeViewBox: false,
        },
      },
    },
    // Fold .st0/.st1 class rules onto every matching element (not just unique ones)…
    { name: "inlineStyles", params: { onlyMatchedOnce: false } },
    // …then turn those inline styles into fill="" / stroke="" attributes.
    "convertStyleToAttrs",
    // Drop width/height; the <img> width/height (or CSS) controls render size.
    "removeDimensions",
  ],
};
