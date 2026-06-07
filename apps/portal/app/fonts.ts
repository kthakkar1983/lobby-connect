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

export const solitude = localFont({
  src: "./fonts/Solitude.woff2",
  display: "swap",
  variable: "--font-solitude",
});

export const vonique = localFont({
  src: "./fonts/Vonique43.woff2",
  display: "swap",
  variable: "--font-vonique",
});

/** Attach to <html> so every --font-* var (and thus --font-sans/mono/display/label) resolves. */
export const fontVars = [
  outfit.variable,
  jetbrainsMono.variable,
  solitude.variable,
  vonique.variable,
].join(" ");
