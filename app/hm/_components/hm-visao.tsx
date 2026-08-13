"use client";

import Link from "next/link";
import { cn } from "@/app/_components/ui";
import { useProdutoHm } from "@/app/hm/_components/use-produto";

// O alternador Kanban ⇄ Tabela. As duas telas são leituras da MESMA esteira —
// o board responde "onde cada um está", a tabela responde "o que está
// acontecendo com todos ao mesmo tempo". Trocar de leitura não pode custar o
// contexto: os filtros que estão valendo viajam na querystring.
export type FiltrosVisaoHm = { responsavel?: string[]; canal?: string[]; turma?: string[] };

// `sub` é o segmento — a rota completa nasce de `${base}${sub}`, com `base`
// vindo de useProdutoHm(). Antes a rota era literal `/hm/*`: quem estava em
// /aurum/* ou /ethb/* clicava e caía no portal HM (e levava expulsão se não
// tivesse HM na whitelist — ver app/hm/layout.tsx).
const VISOES = [
  { id: "kanban", label: "Kanban", sub: "/kanban" },
  { id: "tabela", label: "Tabela", sub: "/tabela" },
  { id: "reunioes", label: "Reuniões", sub: "/reunioes" },
  { id: "atividade", label: "Atividade", sub: "/atividade" },
  // Equipes — aparece para master e gestor (via podeConfig = podeDistribuir()):
  // o master gere; o gestor só VÊ a própria equipe. Operador não tem a aba.
  { id: "equipes", label: "Equipes", sub: "/equipes" },
] as const;

export function HmVisao({ atual, filtros, podeConfig }: { atual: "kanban" | "tabela" | "atividade" | "reunioes" | "equipes"; filtros: FiltrosVisaoHm; podeConfig?: boolean }) {
  const { base } = useProdutoHm();
  // Filtro multi-valor = parâmetro repetido (?canal=A&canal=B) — o formato que
  // as rotas leem com getAll.
  const params = new URLSearchParams();
  for (const v of filtros.responsavel ?? []) params.append("responsavel", v);
  for (const v of filtros.canal ?? []) params.append("canal", v);
  for (const v of filtros.turma ?? []) params.append("turma", v);
  const qs = params.toString();

  return (
    // 11/08: as cinco abas somam ~494px e a tela do celular tem 390 — como a
    // tira não tinha scroller próprio, quem estourava era a PÁGINA: o board
    // inteiro passava a rolar de lado e a última aba ficava inalcançável.
    // Agora a tira rola sozinha (o traço some por `rolagem-oculta`, como no
    // cabeçalho e na régua de canais) e a página fica quieta. Verificado no
    // Chromium a 390px: scrollWidth da página volta a 390.
    // 13/08 — `flex-1` fazia a tira DISPUTAR a linha com "+ Cadastrar",
    // "Esteira .xlsx", "Financeiro .xlsx" e "Disparo inteligente". No celular
    // ela era espremida a ~60px: aparecia só o ícone do Kanban e um pedaço da
    // palavra, e o operador não tinha como saber que Tabela, Reuniões,
    // Atividade e Equipes estavam ali dentro, atrás de um scroll horizontal de
    // 60px. Visto na captura do Chromium a 390px — a bateria não acusa, porque
    // não é erro nem estouro: é o botão sumindo de vista.
    //
    // `basis-full` no celular dá LINHA PRÓPRIA à tira (ela rola sozinha se
    // precisar); do `sm` para cima volta ao comportamento antigo, onde sobra
    // largura e a disputa não existe.
    <div className="rolagem-oculta -mx-1 min-w-0 max-w-full basis-full overflow-x-auto px-1 sm:basis-auto sm:flex-none">
      <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/80">
      {VISOES.filter((v) => v.id !== "equipes" || podeConfig).map((v) => {
        const ativa = v.id === atual;
        const cls = cn(
          "alvo-toque flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition",
          ativa
            ? "bg-white text-slate-900 shadow-card dark:bg-slate-700 dark:text-slate-100"
            : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
        );
        const icone =
          v.id === "kanban" ? (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="14" rx="1.5" /><rect x="14" y="3" width="7" height="9" rx="1.5" /></svg>
          ) : v.id === "tabela" ? (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
          ) : v.id === "reunioes" ? (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
          ) : v.id === "equipes" ? (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          ) : (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18" /><path d="M7 14l3-3 3 3 5-6" /></svg>
          );
        // A visão ativa não é um link para si mesma — é onde a pessoa já está.
        return ativa ? (
          <span key={v.id} className={cls} aria-current="page">
            {icone}
            {v.label}
          </span>
        ) : (
          <Link key={v.id} href={qs ? `${base}${v.sub}?${qs}` : `${base}${v.sub}`} className={cls}>
            {icone}
            {v.label}
          </Link>
        );
      })}
      </div>
    </div>
  );
}
