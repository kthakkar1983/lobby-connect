// Prepare a just-opened Document-PiP window so React can portal into it with
// the portal's normal Tailwind classes working.
//
// The PiP window starts as a bare same-origin document with no styles. Copying
// the parent's stylesheets (inlined, with a <link> fallback for any sheet whose
// CSSOM is unreadable) carries over the whole token layer + compiled Tailwind.
// next/font exposes its font variables via classes on <html>, so those classes
// are mirrored too.

export function preparePipDocument(target: Document): HTMLElement {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const css = Array.from(sheet.cssRules)
        .map((rule) => rule.cssText)
        .join("\n");
      const style = target.createElement("style");
      style.textContent = css;
      target.head.appendChild(style);
    } catch {
      if (sheet.href) {
        const link = target.createElement("link");
        link.rel = "stylesheet";
        link.href = sheet.href;
        target.head.appendChild(link);
      }
    }
  }

  target.title = "Lobby Connect deskphone";
  target.documentElement.className = document.documentElement.className;
  target.body.className = "bg-primary";
  target.body.style.margin = "0";

  // Fill the window height so the tile's `h-full` root stretches to the whole
  // PiP window instead of collapsing to its content height — which left the
  // browser's white canvas showing below it (the "white block"). With the chain
  // at 100%, the navy body fills the window and, on video, the object-cover
  // guest feed grows to fill the face above the controls.
  target.documentElement.style.height = "100%";
  target.body.style.height = "100%";

  const mount = target.createElement("div");
  mount.style.height = "100%";
  target.body.appendChild(mount);
  return mount;
}
