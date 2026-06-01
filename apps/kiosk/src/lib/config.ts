const TOKEN_KEY = "lc_kiosk_token";

/** Read the config token from ?t=… (persisting to localStorage) or localStorage. */
export function getKioskToken(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("t");
  if (fromUrl) {
    localStorage.setItem(TOKEN_KEY, fromUrl);
    url.searchParams.delete("t");
    window.history.replaceState({}, "", url.toString());
    return fromUrl;
  }
  return localStorage.getItem(TOKEN_KEY);
}

export function getPortalApiBase(): string {
  const base = import.meta.env.VITE_PORTAL_API_URL;
  if (!base) throw new Error("Missing VITE_PORTAL_API_URL (see apps/kiosk/.env.example).");
  return base.replace(/\/$/, "");
}
