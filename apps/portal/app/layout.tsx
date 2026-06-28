import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { fontVars } from "./fonts";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#0F2D4B",
};

export const metadata: Metadata = {
  title: "Lobby Connect",
  description: "After-hours front desk for hotels.",
};

export default function RootLayout({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <html lang="en" className={fontVars}>
      <body>
        {children}
        <Toaster />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
