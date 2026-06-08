"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  { href: "/contatos", label: "Contatos" },
  { href: "/disparar", label: "Disparar" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/templates", label: "Templates" },
];

export default function TopNav() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") return null;

  async function logout() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3">
        <span className="font-semibold text-brand">CS · Participa</span>
        <nav className="flex gap-1 text-sm">
          {LINKS.map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded px-3 py-1.5 transition ${
                  active ? "bg-brand text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={logout}
          className="ml-auto text-sm text-slate-500 hover:text-slate-800"
        >
          Sair
        </button>
      </div>
    </header>
  );
}
