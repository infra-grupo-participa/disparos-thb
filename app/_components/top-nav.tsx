"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import ThemeToggle from "./theme-toggle";
import BuscaGlobal from "./busca-global";
import UserMenu from "./user-menu";
import { MarcaPortal } from "./marca";
import { usePortal } from "./use-portal";

type LinkDef = { sub: string; label: string; icon: string };

// Ícones (heroicons outline, 24x24).
const LINKS: LinkDef[] = [
  { sub: "/kanban", label: "Jornada", icon: "M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25Zm9.75-9.75A2.25 2.25 0 0 1 15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v9.75A2.25 2.25 0 0 1 18 18h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Z" },
  { sub: "/contatos", label: "Contatos", icon: "M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" },
  { sub: "/inbox", label: "Inbox", icon: "M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" },
  { sub: "/dashboard", label: "Dashboard", icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" },
  { sub: "/templates", label: "Templates", icon: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" },
];

// Navegação reduzida do portal HM (módulo mais simples, sem inbox/dashboard).
const LINKS_HM: LinkDef[] = [
  { sub: "/kanban", label: "Jornada", icon: LINKS[0].icon },
  { sub: "/agendamentos", label: "Agendamentos", icon: "M8 2v4M16 2v4M3.5 9.09h17M21 8.5V17c0 3-1.5 5-5 5H8c-3.5 0-5-2-5-5V8.5c0-3 1.5-5 5-5h8c3.5 0 5 2 5 5ZM11.995 13.7h.009M8.294 13.7h.01M8.294 16.7h.01" },
  { sub: "/templates", label: "Templates", icon: LINKS[4].icon },
];

function Icon({ d }: { d: string }) {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default function TopNav() {
  const pathname = usePathname();
  const { portal, base, nome, cor } = usePortal();

  // Sem cabeçalho na tela de seleção de portal e no login.
  if (pathname === "/login" || pathname === "/") return null;

  const links = portal === "hm" ? LINKS_HM : LINKS;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/80">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 sm:px-6">
        {/* Marca do evento → home do portal atual. É ela que diz "você está no
            espaço do HM / do Seminário / do HT" antes de qualquer texto. */}
        <Link href={`${base}/kanban`} title={nome} className="flex shrink-0 items-center">
          <MarcaPortal portal={portal} altura="h-8" />
        </Link>

        {/* Seletor de portal — leva à tela de seleção (troca de espaço) */}
        <Link
          href="/"
          title="Trocar de portal"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cor }} />
          <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7 15 5 5 5-5M7 9l5-5 5 5" /></svg>
        </Link>

        <nav className="flex flex-1 items-center gap-0.5">
          {links.map((l) => {
            const href = `${base}${l.sub}`;
            const active = pathname.startsWith(`/${portal}${l.sub}`);
            return (
              <Link
                key={l.sub}
                href={href}
                className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "bg-brand text-white shadow-card dark:bg-brand-500"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                }`}
              >
                <Icon d={l.icon} />
                <span className="hidden md:block">{l.label}</span>
              </Link>
            );
          })}
        </nav>

        <BuscaGlobal />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
