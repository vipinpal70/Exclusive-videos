import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import { getSetting } from "@/lib/settings";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export async function generateMetadata(): Promise<Metadata> {
  const siteName = await getSetting("site_name").catch(() => "");
  return {
    title: siteName || "Mentorship",
    description: "Verify your Elefin account and receive exclusive mentorship videos on Telegram.",
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased" style={{ fontFamily: "var(--font-inter), ui-sans-serif, system-ui" }}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
