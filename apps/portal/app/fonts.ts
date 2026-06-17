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

/**
 * Display + label face — Raleway, a variable sans (wght 100–900, self-hosted woff2).
 * Replaces both Atelier (display serif) and Radon (label face): one family now covers
 * headings and all-caps labels (the latter via letter-spacing), so the system is three
 * fonts, not four. The variable file's default instance is Thin (100), so headings/labels
 * set weight >=500 at the usage site (Raleway runs light at small sizes).
 */
export const raleway = localFont({
  src: "./fonts/Raleway.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-raleway",
});

/** Attach to <html> so every --font-* var (and thus --font-sans/mono/display/label) resolves. */
export const fontVars = [
  outfit.variable,
  jetbrainsMono.variable,
  raleway.variable,
].join(" ");
