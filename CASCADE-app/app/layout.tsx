import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CASCADE",
  description: "Multi-canvas infrastructure failure propagation platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className="h-full overflow-hidden" suppressHydrationWarning>{children}</body>
    </html>
  );
}
