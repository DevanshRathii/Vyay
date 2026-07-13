import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const APP_URL = process.env.APP_URL ?? "https://vyay-five.vercel.app";
const DESCRIPTION =
  "Automatic expense tracking from your Gmail transaction emails — private, multi-tenant, built for India.";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: "Vyay", template: "%s · Vyay" },
  description: DESCRIPTION,
  applicationName: "Vyay",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Vyay" },
  icons: { icon: "/icon.svg", apple: "/icons/icon-192.png" },
  openGraph: {
    title: "Vyay",
    description: DESCRIPTION,
    url: APP_URL,
    siteName: "Vyay",
    type: "website",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "Vyay" }],
  },
  twitter: {
    card: "summary",
    title: "Vyay",
    description: DESCRIPTION,
    images: ["/icons/icon-512.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f8" },
    { media: "(prefers-color-scheme: dark)", color: "#19191d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
