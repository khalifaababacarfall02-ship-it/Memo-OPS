import type { Metadata, Viewport } from "next";
import { Schibsted_Grotesk } from "next/font/google";
import localFont from "next/font/local";
import { ToastProvider } from "@/components/shell/Toast";
import { getLang } from "@/lib/i18n";
import "./globals.css";

// Same families as the prototype's Google Fonts link, self-hosted by next/font.
const fontUi = Schibsted_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-ui",
  display: "swap",
});
// Newsreader exactly as the prototype loaded it (Google Fonts: 400 and 500 with the
// optical-size axis, italic 400): bold text in the examples is the browser's bold
// of 500, not a 700 face, so lines wrap as in the design. The files are Google's
// variable fonts limited to those weights, Latin + Latin Extended (OFL, see
// fonts/Newsreader-OFL.txt).
const fontText = localFont({
  src: [
    { path: "./fonts/Newsreader-Variable.woff2", weight: "400 500", style: "normal" },
    { path: "./fonts/Newsreader-Italic-Variable.woff2", weight: "400", style: "italic" },
  ],
  variable: "--font-text",
  display: "swap",
});

export const metadata: Metadata = {
  // Pages set their own title ("Les mémos · Mémo BoxHero", the memo title…).
  title: { default: "Mémo BoxHero", template: "%s · Mémo BoxHero" },
  description: "Pas de mémo, pas de réunion. · No memo, no meeting.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const lang = await getLang();
  return (
    <html lang={lang} className={`${fontUi.variable} ${fontText.variable}`}>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
