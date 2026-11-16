import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { I18nProvider } from "@/lib/i18n";
import { LANG_COOKIE } from "@/lib/lang";
import { Fraunces, IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const serif = Fraunces({ subsets: ["latin"], variable: "--font-serif", weight: ["500", "600", "700"] });
const sans = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Bandha", template: "%s · Bandha" },
  description: "Catat harta, arus kas, dan portofolio Anda dalam satu tempat.",
};
export const viewport: Viewport = { themeColor: "#2A1A10" };

// Applies the saved theme before first paint to avoid a light/dark flash.
const themeScript = `try{var t=localStorage.getItem('bandha-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The language is kept in a cookie so the server renders the right language on first paint.
  const lang = (await cookies()).get(LANG_COOKIE)?.value === "en" ? "en" : "id";
  return (
    <html lang={lang} data-theme="light" suppressHydrationWarning className={`${serif.variable} ${sans.variable} ${mono.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><I18nProvider initial={lang}>{children}</I18nProvider></body>
    </html>
  );
}
