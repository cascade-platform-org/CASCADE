import type { Metadata, Viewport } from "next";
import "./globals.css";

const description =
  "Multi-canvas infrastructure failure propagation platform — model interdependent services and analyse how failures cascade across their Elements.";

export const metadata: Metadata = {
  // The public origin absolute metadata URLs (og:image, twitter:image) are
  // built from. `||` rather than `??`: the deploy passes this as a build arg
  // that is an empty string when unset, and `new URL("")` throws.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  ),
  title: {
    default: "CASCADE",
    template: "%s · CASCADE",
  },
  description,
  applicationName: "CASCADE",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "CASCADE",
    description,
    siteName: "CASCADE",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "CASCADE" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "CASCADE",
    description,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1220" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className="h-full overflow-hidden" suppressHydrationWarning>{children}</body>
    </html>
  );
}
