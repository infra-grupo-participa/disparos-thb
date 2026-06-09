import "./globals.css";
import type { Metadata } from "next";
import TopNav from "./_components/top-nav";

export const metadata: Metadata = {
  title: "CS · Grupo Participa",
  description: "Workspace de Customer Success — Holding Total",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        {/* Inter carregada pelo navegador (não no build) — evita falha de build em ambientes de rede restrita. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen font-sans">
        <TopNav />
        <main className="mx-auto max-w-7xl animate-fade-in px-4 py-6 sm:px-6 lg:py-8">{children}</main>
      </body>
    </html>
  );
}
