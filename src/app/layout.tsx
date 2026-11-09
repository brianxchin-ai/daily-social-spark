import type { Metadata } from "next";
import { Instrument_Serif, Inter_Tight } from "next/font/google";
import "./globals.css";

// Inter Tight stands in for Söhne (a licensed font) — bold, tight, Swiss.
const interTight = Inter_Tight({
  variable: "--font-inter-tight",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Daily Social Spark",
  description: "One substantiated short-form social opportunity likely to spread in the next 24–48 hours.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${interTight.variable} ${instrumentSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
