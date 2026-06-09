import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import TopNav from "./_components/top-nav";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "CS · Grupo Participa",
  description: "Workspace de Customer Success — Holding Total",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-screen font-sans">
        <TopNav />
        <main className="mx-auto max-w-7xl animate-fade-in px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </body>
    </html>
  );
}
