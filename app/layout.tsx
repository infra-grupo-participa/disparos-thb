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
      <body>
        <TopNav />
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
