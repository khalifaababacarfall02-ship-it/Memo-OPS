import type { Metadata, Viewport } from "next";
import { Newsreader, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";

// Same families as the prototype's Google Fonts link, self-hosted by next/font.
const fontUi = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-ui",
  display: "swap",
});
const fontText = Newsreader({
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  variable: "--font-text",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Mémo BoxHero",
  description: "Pas de mémo, pas de réunion.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${fontUi.variable} ${fontText.variable}`}>
      <body>{children}</body>
    </html>
  );
}
