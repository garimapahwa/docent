import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { DocentAnalytics } from "./analytics";
import { AUTH_ENABLED } from "@/lib/auth-config";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: "Docent",
  description: "Turn any Solana transaction into an animated explainer video.",
};

/** Applies a saved theme choice before the first paint, so dark mode doesn't flash white. */
const THEME_SCRIPT = `try{var t=localStorage.getItem("docent-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme script sets data-theme before React loads, so the server markup can differ.
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen font-sans antialiased">
        {/* Accounts are optional: without Clerk's keys Docent runs fully open, no sign-in. */}
        {AUTH_ENABLED ? <ClerkProvider appearance={{ variables: { colorPrimary: "#9945FF" } }}>{children}</ClerkProvider> : children}
        <DocentAnalytics />
      </body>
    </html>
  );
}
