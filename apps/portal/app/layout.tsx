import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import { fontVars } from "./fonts";
import "./globals.css";

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
      </body>
    </html>
  );
}
