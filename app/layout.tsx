import "./globals.css";
import type { Metadata } from "next";
import TopNav from "./_components/top-nav";
import { Toaster } from "./_components/toast";

export const metadata: Metadata = {
  title: "CS · Grupo Participa",
  description: "Workspace de Customer Success — Holding Total",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Aplica o tema salvo ANTES do paint para evitar flash de tema errado. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('tema');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
        {/* Inter carregada pelo navegador (não no build) — evita falha de build em ambientes de rede restrita. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Carregada via <link> de propósito (next/font falha no build da Hostinger). */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen font-sans">
        <TopNav />
        <main className="mx-auto max-w-7xl animate-fade-in px-4 py-6 sm:px-6 lg:py-8">{children}</main>
        {/* Confirmações do sistema (toast) — um único ponto de montagem. */}
        <Toaster />
      </body>
    </html>
  );
}
