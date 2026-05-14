import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Beet",
  description: "A glanceable GitHub dashboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The inline script below sets data-theme on <html> before hydration,
    // so the attribute intentionally differs from the server markup.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Set data-theme synchronously before first paint so the theme
         *  doesn't flash while settings hydrate from the Tauri store. Reads
         *  the localStorage preference hint written by applyTheme(); a
         *  "system" or missing hint is resolved against the OS preference
         *  here, so data-theme is always a concrete light/dark value. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('beet.theme');var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var r=(t==='dark'||t==='light')?t:(d?'dark':'light');document.documentElement.setAttribute('data-theme',r);}catch(e){}})();",
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
