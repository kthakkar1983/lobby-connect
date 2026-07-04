// Document Picture-in-Picture API (Chromium 116+, desktop only) — not yet in
// TypeScript's lib.dom, so declared here. Only the surface the duty tile uses.
// https://developer.chrome.com/docs/web-platform/document-picture-in-picture

interface DocumentPictureInPictureOptions {
  width?: number;
  height?: number;
  disallowReturnToOpener?: boolean;
  preferInitialWindowPlacement?: boolean;
}

interface DocumentPictureInPicture extends EventTarget {
  readonly window: Window | null;
  requestWindow(options?: DocumentPictureInPictureOptions): Promise<Window>;
}

interface Window {
  readonly documentPictureInPicture?: DocumentPictureInPicture;
}
