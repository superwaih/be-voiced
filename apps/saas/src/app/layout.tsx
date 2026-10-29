import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Soundbite", template: "%s · Soundbite" },
  description: "Upload a recording, read what was said, ask it questions and caption it.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#320B35" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

/**
 * Sets the theme before the first paint.
 *
 * React cannot do this: the markup is sent from the server, which has no idea what this person
 * chose, so a light frame would flash before hydration corrected it. Reading the saved setting in a
 * blocking inline script is the one thing that avoids that.
 */
const THEME_SCRIPT = `
try {
  var saved = JSON.parse(localStorage.getItem("bv.settings") || "{}").theme || "dark";
  var dark = saved === "dark" || (saved === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
} catch (e) {
  document.documentElement.dataset.theme = "dark";
}
`.trim();

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${manrope.variable} ${plexMono.variable} font-sans`}>{children}</body>
    </html>
  );
}
