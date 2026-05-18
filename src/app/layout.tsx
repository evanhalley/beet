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
        {/* Set data-theme, --font-scale, data-accent and data-density
         *  synchronously before first paint so none of them flash while
         *  settings hydrate from the Tauri store. Reads localStorage hints
         *  written by applyTheme()/applyFontScale()/applyAccent()/applyDensity();
         *  a "system" or missing theme hint is resolved against the OS
         *  preference here, so data-theme is always a concrete light/dark
         *  value. Invalid/missing hints leave the corresponding attribute or
         *  variable unset, falling back to the CSS defaults (--font-scale=1,
         *  accent=beet, density=regular). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('beet.theme');var d=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var r=(t==='dark'||t==='light')?t:(d?'dark':'light');document.documentElement.setAttribute('data-theme',r);var f=localStorage.getItem('beet.fontScale');if(f==='0.9'||f==='1'||f==='1.15'||f==='1.3'){document.documentElement.style.setProperty('--font-scale',f);}var a=localStorage.getItem('beet.accent');if(a==='beet'||a==='ocean'||a==='forest'||a==='ink'){document.documentElement.setAttribute('data-accent',a);}var y=localStorage.getItem('beet.density');if(y==='compact'||y==='comfy'){document.documentElement.setAttribute('data-density',y);}}catch(e){}})();",
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
