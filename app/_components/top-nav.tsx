"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import ThemeToggle from "./theme-toggle";
import BuscaGlobal from "./busca-global";
import UserMenu from "./user-menu";
import { MarcaPortal } from "./marca";
import { usePortal, PORTAIS } from "./use-portal";
import { useMe } from "./use-me";

// Gating por NÍVEL (lib/papeis): `soMaster` esconde o link de quem não é o
// admin do Grupo Participa; `soGestor` esconde de quem não é gestor nem master.
// A rota já barra no servidor — isto é só para não oferecer uma porta que a
// pessoa não pode abrir.
type LinkDef = { sub: string; label: string; icon: string; soMaster?: boolean; soGestor?: boolean };

// Ícones (heroicons outline, 24x24).
const LINKS: LinkDef[] = [
  // Primeiro item de propósito: é a tela onde o operador começa o expediente.
  { sub: "/meu-dia", label: "Meu dia", icon: "M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" },
  { sub: "/kanban", label: "Jornada", icon: "M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6Zm0 9.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25Zm9.75-9.75A2.25 2.25 0 0 1 15.75 3.75H18A2.25 2.25 0 0 1 20.25 6v9.75A2.25 2.25 0 0 1 18 18h-2.25a2.25 2.25 0 0 1-2.25-2.25V6Z" },
  { sub: "/contatos", label: "Leads", icon: "M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" },
  { sub: "/inbox", label: "Inbox", icon: "M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 0 1 .778-.332 48.294 48.294 0 0 0 5.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z" },
  { sub: "/disparos", label: "Disparos", icon: "M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" },
  { sub: "/dashboard", label: "Dashboard", icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" },
  // Atividade por colaborador: com o novo modelo (28/07) o OPERADOR também vê
  // a atividade dos colegas de equipe — o link vale para todos os níveis.
  { sub: "/atividade", label: "Atividade", icon: "M22 12h-4l-3 9L9 3l-3 9H2" },
  { sub: "/templates", label: "Templates", icon: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" },
];

// Ícone pelo caminho, não pela posição na lista: buscar por índice quebrava em
// silêncio a cada item novo no menu.
const iconeDe = (sub: string) => LINKS.find((l) => l.sub === sub)?.icon ?? "";


// Navegação em 3 grupos (16/08, pedido do Marcio: "a nave está muito confusa
// [...] muito misturado"). Uma lista plana de 10 itens não tem hierarquia —
// obriga a ler os 10 para achar 1. Cada grupo responde a uma pergunta:
//   OPERAÇÃO — o que eu faço agora (o dia)
//   GESTÃO   — como estamos no período (a análise)
//   AJUSTES  — configuração, atrás do "Mais" (gestor+; a maioria dos itens é
//              master-only, mas o dropdown some inteiro só quando NENHUM item
//              sobra para o nível de quem está olhando)
// Nenhuma rota morre e nenhum redirect nasce aqui — só a posição no menu muda.
const OPERACAO_HM: LinkDef[] = [
  { sub: "/kanban", label: "Jornada", icon: iconeDe("/kanban") },
  { sub: "/agendamentos", label: "Agenda",
    icon: "M8 2v4M16 2v4M3.5 9.09h17M21 8.5V17c0 3-1.5 5-5 5H8c-3.5 0-5-2-5-5V8.5c0-3 1.5-5 5-5h8c3.5 0 5 2 5 5ZM11.995 13.7h.009M8.294 13.7h.01M8.294 16.7h.01" },
  { sub: "/atividade", label: "Atividade", icon: iconeDe("/atividade") },
  { sub: "/inbox", label: "Inbox", icon: iconeDe("/inbox") },
  { sub: "/disparos", label: "Disparos", icon: iconeDe("/disparos") },
];

const GESTAO_HM: LinkDef[] = [
  // Painel (16/08, NOVO): leitura de longo prazo — hoje não existe nenhuma
  // série no sistema. `AtividadeDesempenho` (o dinheiro por comercial) MUDA de
  // /atividade para cá — era a "carteira misturada com atividade do sistema".
  { sub: "/painel", label: "Painel",
    icon: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" },
  { sub: "/carteira", label: "Carteira",
    icon: "M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4h-4Z" },
  // Relatórios (16/08, NOVO): dropdown de tipos + período → folha imprimível.
  { sub: "/relatorios", label: "Relatórios",
    icon: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" },
];

const AJUSTES_HM: LinkDef[] = [
  { sub: "/equipes", label: "Equipes", soGestor: true,
    icon: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" },
  // Tags (16/08): já existia — vivia órfã, só alcançável de dentro do seletor
  // de tags de uma ficha (tag-picker.tsx). Ganha destino de topo.
  { sub: "/tags", label: "Tags",
    icon: "M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3ZM6 6.75h.008v.008H6V6.75Z" },
  // Ofertas (16/08, NOVO, master): catálogo comercial das ofertas Hotmart —
  // ainda sem tela; ver placeholder em app/hm/ofertas/page.tsx.
  { sub: "/ofertas", label: "Ofertas", soMaster: true,
    icon: "M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" },
  { sub: "/templates", label: "Templates", icon: iconeDe("/templates") },
  { sub: "/acessos", label: "Acessos", soMaster: true,
    icon: "M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3ZM9.5 12l1.8 1.8 3.7-3.7" },
];

// Botão do "?" da ajuda: mesmo tratamento dos links do menu, mas compacto.
function cnAjuda(ativo: boolean): string {
  return `alvo-toque flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
    ativo
      ? "bg-brand text-white shadow-card dark:bg-brand-500"
      : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
  }`;
}

function Icon({ d }: { d: string }) {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function linkClass(active: boolean): string {
  return `alvo-toque flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition sm:px-2.5 xl:gap-2 xl:px-2.5 ${
    active
      ? "bg-brand text-white shadow-card dark:bg-brand-500"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
  }`;
}

function NavLink({ l, base, portal, pathname }: { l: LinkDef; base: string; portal: string; pathname: string | null }) {
  const active = !!pathname && pathname.startsWith(`/${portal}${l.sub}`);
  return (
    <Link
      href={`${base}${l.sub}`}
      title={l.label}
      aria-label={l.label}
      aria-current={active ? "page" : undefined}
      className={linkClass(active)}
    >
      <Icon d={l.icon} />
      {/* Abaixo de md o rótulo some visualmente E do texto acessível
          (display:none tira da árvore de acessibilidade) — por isso o nome do
          link também vem do aria-label acima, não só deste texto. */}
      <span className="hidden md:block">{l.label}</span>
    </Link>
  );
}

// Separador visual entre os 3 grupos (Operação · Gestão · Ajustes) — decorativo,
// por isso `aria-hidden`: quem navega por teclado não perde um Tab parado nele.
function Separador() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 self-center bg-slate-200 dark:bg-slate-700" />;
}

function NavGroup({ label, itens, base, portal, pathname }: { label: string; itens: LinkDef[]; base: string; portal: string; pathname: string | null }) {
  if (itens.length === 0) return null;
  return (
    <div role="group" aria-label={label} className="flex shrink-0 items-center gap-0.5">
      {itens.map((l) => <NavLink key={l.sub} l={l} base={base} portal={portal} pathname={pathname} />)}
    </div>
  );
}

// Ícone genérico de "mais opções" (⋯), usado no botão do dropdown de Ajustes.
const ICONE_MAIS = "M5 13.5A1.5 1.5 0 1 0 5 10.5a1.5 1.5 0 0 0 0 3ZM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM19 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z";
// Ícone de barras (mesmo do item "Painel"), usado no botão do dropdown de Gestão.
const ICONE_GESTAO = GESTAO_HM[0].icon;

// Dropdown de grupo — usado tanto para GESTÃO quanto para AJUSTES (17/08: a
// 1440px, 5 itens de Operação + 3 de Gestão inline + o botão Mais não cabiam
// — "Mais" saía da viewport e virava invisível sem rolar, escondendo Ofertas/
// Acessos/Equipes de quem administra. Gestão também virou botão único: menos
// itens soltos no cabeçalho, nada desaparece da tela sem indicação.)
// Some INTEIRO quando não sobra item para o nível de quem olha. Mesmo padrão
// de clique-fora e Escape do UserMenu, para não inventar um segundo jeito de
// fechar dropdown no mesmo cabeçalho.
const LARGURA_PAINEL = 208; // w-52

function NavDropdown({
  label, texto, icon, itens, base, portal, pathname,
}: { label: string; texto: string; icon: string; itens: LinkDef[]; base: string; portal: string; pathname: string | null }) {
  const [aberto, setAberto] = useState(false);
  // Posição do painel em `fixed` (viewport), não `absolute` dentro do botão:
  // o botão vive num <nav overflow-x-auto> (a rolagem horizontal do menu no
  // mobile) — overflow-x diferente de visible faz o navegador tratar
  // overflow-y também como clipante (regra do CSS Overflow), então um painel
  // `absolute` ali dentro nunca pintava nem recebia clique, só existia no DOM.
  // Portal pro <body> tira o painel dessa caixa sem tocar no scroll do nav.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const painelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function fora(e: MouseEvent) {
      const alvo = e.target as Node;
      if (wrapRef.current?.contains(alvo)) return;
      if (painelRef.current?.contains(alvo)) return;
      setAberto(false);
    }
    function tecla(e: KeyboardEvent) { if (e.key === "Escape") setAberto(false); }
    // Fecha (em vez de tentar reposicionar) em resize/rolagem do nav — evita o
    // painel ficar "flutuando" fora do lugar depois que a página ou o próprio
    // menu horizontal se mexem.
    function fechar() { setAberto(false); }
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    window.addEventListener("resize", fechar);
    window.addEventListener("scroll", fechar, true);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("resize", fechar);
      window.removeEventListener("scroll", fechar, true);
    };
  }, []);

  // O painel mora no <body> via portal (ver comentário acima) — no DOM ele
  // fica DEPOIS de todo o cabeçalho, então Tab "solto" pularia os itens e ia
  // direto pro próximo botão do menu. Ao abrir, foco vai pro primeiro item; e
  // enquanto aberto, Tab/Shift+Tab ficam presos nos itens do próprio painel
  // (mesmo padrão de menu que um <select> nativo) — Escape sempre devolve o
  // foco pro botão que abriu.
  useEffect(() => {
    if (!aberto) return;
    const t = setTimeout(() => {
      painelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [aberto]);

  function teclaNoPainel(e: React.KeyboardEvent<HTMLDivElement>) {
    const itensEl = Array.from(painelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (itensEl.length === 0) return;
    const atual = itensEl.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") {
      e.preventDefault();
      setAberto(false);
      btnRef.current?.focus();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const prox = e.shiftKey ? (atual - 1 + itensEl.length) % itensEl.length : (atual + 1) % itensEl.length;
      itensEl[prox].focus();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const prox = e.key === "ArrowDown" ? (atual + 1) % itensEl.length : (atual - 1 + itensEl.length) % itensEl.length;
      itensEl[prox].focus();
      return;
    }
    if (e.key === "Home") { e.preventDefault(); itensEl[0].focus(); }
    if (e.key === "End") { e.preventDefault(); itensEl[itensEl.length - 1].focus(); }
  }

  function alternar() {
    setAberto((v) => {
      const abrindo = !v;
      if (abrindo && btnRef.current) {
        const r = btnRef.current.getBoundingClientRect();
        const left = Math.min(r.left, window.innerWidth - LARGURA_PAINEL - 8);
        setPos({ top: r.bottom + 6, left: Math.max(8, left) });
      }
      return abrindo;
    });
  }

  if (itens.length === 0) return null;
  const algumAtivo = itens.some((l) => !!pathname && pathname.startsWith(`/${portal}${l.sub}`));

  return (
    <div ref={wrapRef} className="relative shrink-0" role="group" aria-label={label}>
      <button
        ref={btnRef}
        type="button"
        onClick={alternar}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-label={`${texto} — abrir menu de ${label}`}
        className={linkClass(algumAtivo && !aberto)}
      >
        <Icon d={icon} />
        <span className="hidden md:block">{texto}</span>
        <svg className="hidden h-3.5 w-3.5 shrink-0 text-current opacity-60 md:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
      </button>

      {aberto && pos && typeof document !== "undefined" && createPortal(
        <div
          ref={painelRef}
          role="menu"
          aria-label={label}
          onKeyDown={teclaNoPainel}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: LARGURA_PAINEL }}
          className="z-50 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-pop dark:border-slate-700 dark:bg-slate-900"
        >
          {itens.map((l) => {
            const active = !!pathname && pathname.startsWith(`/${portal}${l.sub}`);
            return (
              <Link
                key={l.sub}
                href={`${base}${l.sub}`}
                role="menuitem"
                onClick={() => setAberto(false)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2.5 px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-brand/10 text-brand dark:bg-brand-400/10 dark:text-brand-300"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                }`}
              >
                <Icon d={l.icon} />
                {l.label}
              </Link>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

export default function TopNav() {
  const pathname = usePathname();
  const { portal, base, nome, cor } = usePortal();
  const { nivel } = useMe();

  // Marca do portal no <html> (a paleta `brand` do Tailwind lê daí — ver
  // globals.css). O script anti-flash do layout já acerta o primeiro paint;
  // este efeito cobre a navegação client-side entre portais. Fica ANTES do
  // early return de propósito: hook não pode ficar atrás de condicional.
  useEffect(() => {
    const el = document.documentElement;
    if (portal === "aurum") el.dataset.tema = "aurum";
    else delete el.dataset.tema;
  }, [portal]);

  // Sem cabeçalho na tela de seleção de portal, no login e na folha impressa
  // de relatório (F5): protocolo é destino de LEITURA, fora da navegação —
  // "sem menu, sem botão" (arquiteto-central-ativacao.md §F5).
  if (pathname === "/login" || pathname === "/" || pathname?.startsWith("/relatorio/")) return null;

  // Enquanto `nivel` é null (carregando), os links restritos ficam ocultos — a
  // navegação nasce fechada e abre conforme o direito de cada um.
  // Aurum e ETHB (0155) são a MESMA esteira do HM — usam a navegação do HM.
  const ehEsteiraHm = portal === "hm" || portal === "aurum" || portal === "ethb";
  const gate = (l: LinkDef) => (!l.soMaster || nivel === "master") && (!l.soGestor || nivel === "master" || nivel === "gestor");
  const operacao = (ehEsteiraHm ? OPERACAO_HM : LINKS).filter(gate);
  const gestao = ehEsteiraHm ? GESTAO_HM.filter(gate) : [];
  const ajustes = ehEsteiraHm ? AJUSTES_HM.filter(gate) : [];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/80 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-900/80">
      {/* min-w-0 no container e nos filhos que podem encolher: sem isso, a
          navegação com 6+ ícones empurrava a busca e o menu do usuário para
          fora da tela no celular — a página inteira ganhava rolagem lateral e
          o avatar ficava inalcançável. */}
      <div className="mx-auto flex min-w-0 max-w-7xl items-center gap-1.5 px-3 py-2.5 sm:gap-3 sm:px-6">
        {/* Marca do evento → home do portal atual. É ela que diz "você está no
            espaço do HM / do Seminário / do HT" antes de qualquer texto. */}
        {/* comNome=false + max-w: a sigla ao lado ("HM"/"AUR"/"ETHB") já diz o
            nome — no cabeçalho compacto, a marca só precisa ser reconhecível.
            Sem o teto de largura, a arte da Aurum (proporção 3.75:1, bem mais
            larga que a do HM) sozinha comia o espaço que sobrava para o "Mais"
            a 1440px — o dropdown de Ajustes saía da tela sem aviso nenhum. */}
        <Link href={`${base}/kanban`} title={nome} className="flex shrink-0 items-center">
          <MarcaPortal portal={portal} altura="h-8" comNome={false} className="max-w-[76px] object-contain" />
        </Link>

        {/* Seletor de portal — leva à tela de seleção (troca de espaço). A cor
            sozinha não diz qual portal é este (e exclui quem não distingue
            cor) — a sigla vai sempre junto, texto de verdade, não só no hover. */}
        <Link
          href="/"
          title="Trocar de portal"
          aria-label={`Trocar de portal — atual: ${nome}`}
          className="alvo-toque flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cor }} aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{PORTAIS[portal].sigla}</span>
          <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 15 5 5 5-5M7 9l5-5 5 5" /></svg>
        </Link>

        {/* A navegação é a única parte elástica do cabeçalho: ela rola na
            horizontal quando não cabe, em vez de espremer os vizinhos. */}
        {/* 11/08: com 8 itens a 1440px o último rótulo aparecia cortado ("Templat")
            e parecia defeito. O nav sempre rolou; faltava DIZER isso — a máscara
            esvanece a borda direita quando há mais conteúdo, e o padding menor
            entre lg e xl faz o menu inteiro caber na maioria dos monitores. */}
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rolagem-oculta [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]">
          {ehEsteiraHm ? (
            <>
              <NavGroup label="Operação" itens={operacao} base={base} portal={portal} pathname={pathname} />
              {gestao.length > 0 && (
                <>
                  <Separador />
                  <NavDropdown label="Gestão" texto="Gestão" icon={ICONE_GESTAO} itens={gestao} base={base} portal={portal} pathname={pathname} />
                </>
              )}
              {ajustes.length > 0 && (
                <>
                  <Separador />
                  <NavDropdown label="Ajustes" texto="Mais" icon={ICONE_MAIS} itens={ajustes} base={base} portal={portal} pathname={pathname} />
                </>
              )}
            </>
          ) : (
            operacao.map((l) => <NavLink key={l.sub} l={l} base={base} portal={portal} pathname={pathname} />)
          )}
        </nav>

        <BuscaGlobal />
        {/* Central de Ajuda — sempre visível, em qualquer portal e nível. */}
        <Link
          href={`${base}/ajuda`}
          title="Central de Ajuda"
          aria-label="Central de Ajuda"
          className={cnAjuda(pathname.startsWith(`${base}/ajuda`))}
        >
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.1 9a3 3 0 0 1 5.83 1c0 2-3 2.4-3 4" />
            <path d="M12 17.5h.01" />
          </svg>
        </Link>
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
