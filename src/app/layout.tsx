import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Spectral } from "next/font/google";
import "./globals.css";

/*
  Three faces, three jobs.

  Spectral carries the document voice - an institutional serif with real
  texture, the register of policy and land records rather than of a product
  landing page.

  IBM Plex Sans is the body: drawn for technical documentation, characterful
  without being loud.

  IBM Plex Mono sets every figure. Numbers are the content of this product, so
  they get tabular figures and a slashed zero, and columns of temperatures
  align on the decimal.
*/

const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Thermal Due Diligence",
  description:
    "Every building in America is designed using a temperature from the airport. We tell you what it actually is at your address.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${spectral.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
