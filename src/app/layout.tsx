import type { Metadata, Viewport } from "next";
import { PwaRegistrar } from "@/components/pwa/pwa-registrar";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "Tareeqah",
  title: {
    default: "Tareeqah",
    template: "%s | Tareeqah",
  },
  description: "Masjid class registration and management portal",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Tareeqah",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icon", sizes: "512x512", type: "image/png" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#8ccbbd",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <PwaRegistrar />
        {children}
      </body>
    </html>
  );
}
