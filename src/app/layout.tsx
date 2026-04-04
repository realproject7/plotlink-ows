import type { Metadata, Viewport } from "next";
import { Lora, Inter, Geist_Mono } from "next/font/google";
import { Providers } from "./providers";
import { NavBar } from "../components/NavBar";
import { Footer } from "../components/Footer";
import { FarcasterMiniApp } from "../components/FarcasterMiniApp";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const appName = "PlotLink";
const appDescription =
  "Tokenise your story from day 1. Publish plots, drive trading, earn royalties from every trade — powered by the market, not a platform.";
const themeColor = "#E8DFD0";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: appName,
  description: appDescription,
  icons: {
    icon: [
      { url: "/favicon.png" },
      { url: "/plotlink-logo-symbol.svg", type: "image/svg+xml" },
    ],
    apple: { url: "/icon.png", sizes: "180x180" },
  },
  manifest: "/manifest.json",
  openGraph: {
    title: appName,
    description: appDescription,
    url: appUrl,
    siteName: appName,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: appName,
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: appName,
    description: appDescription,
    images: ["/og-image.png"],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: appName,
  },
  themeColor,
  other: {
    "base:app_id": "69c257e93c2c56b9bbd2f62a",
    // Farcaster Mini App embed meta tag for social sharing preview
    // Note: embed-image.png is 1200x800 (3:2 ratio) per Farcaster requirements
    "fc:miniapp": JSON.stringify({
      version: "1",
      imageUrl: `${appUrl}/embed-image.png`,
      button: {
        title: "Open PlotLink",
        action: {
          type: "launch_frame",
          name: appName,
          url: appUrl,
          splashImageUrl: `${appUrl}/splash.png`,
          splashBackgroundColor: themeColor,
        },
      },
    }),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${lora.variable} ${inter.variable} ${geistMono.variable} antialiased`}>
        <Providers>
          <FarcasterMiniApp />
          <NavBar />
          <div className="pt-11 min-h-screen">{children}</div>
          <Footer />
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}
