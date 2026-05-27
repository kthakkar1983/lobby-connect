import type { Metadata } from "next";
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
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
