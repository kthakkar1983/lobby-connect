import { Outfit, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";

export const outfit = Outfit({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-outfit",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

/** Display serif — headings across every surface. Single weight (400), like the design it replaces. */
export const atelier = localFont({
  src: "./fonts/Atelier-Regular.woff2",
  display: "swap",
  variable: "--font-atelier",
});

/**
 * Label face — all-caps UI labels. Radon ships a single outline; declaring it across the
 * 400–700 range lets `font-semibold` (600) labels use that outline directly instead of
 * faux-bolding it.
 */
export const radon = localFont({
  src: [{ path: "./fonts/Radon.woff2", weight: "400 700", style: "normal" }],
  display: "swap",
  variable: "--font-radon",
});

/** Attach to <html> so every --font-* var (and thus --font-sans/mono/display/label) resolves. */
export const fontVars = [
  outfit.variable,
  jetbrainsMono.variable,
  atelier.variable,
  radon.variable,
].join(" ");
