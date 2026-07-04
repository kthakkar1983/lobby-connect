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

  target.title = "Lobby Connect — deskphone";
  target.documentElement.className = document.documentElement.className;
  target.body.className = "bg-primary";
  target.body.style.margin = "0";

  const mount = target.createElement("div");
  target.body.appendChild(mount);
  return mount;
}
