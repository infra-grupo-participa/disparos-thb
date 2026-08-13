"use client";

// Sino de notificação de AUTOMAÇÃO — canto superior direito da esteira HM.
// Pedido literal do Marcio: "todas as ações que envolvem uma ação que não
// seja de um operador, e sim da automação, deve piscar e informar... para que
// não achem que os cards sumiram". A automação (Make, Hotmart, webhook, o
// próprio lead respondendo) mexe nos cards sem ninguém da operação tocar —
// sem um aviso, o card "sumiu da minha fila" parece bug.
//
// Fonte: GET /api/hm/notificacoes (novo, backend em paralelo). Já vem
// RECORTADO pela visibilidade do usuário (master/gestor/operador) — a UI não
// filtra de novo. Enquanto a rota não existir (404) ou não tiver o formato
// esperado, o sino cai em modo neutro (contador zerado, sem piscar) — nunca
// quebra a tela por causa de uma API em voo.
//
// Egress (regra dura do projeto, causa nº1 de custo): poll adaptativo com
// setTimeout encadeado — pausa para 60s quando a aba está oculta e nunca
// faz sync algum, só GET; erro entra em backoff exponencial. O MESMO desenho
// já usado em [portal]/inbox/page.tsx.
//
// "Lido" é local (localStorage, timestamp da última leitura) — abrir o sino
// não deve custar uma escrita no banco a cada clique; o servidor só devolve
// o que aconteceu, quem leu é problema do navegador de quem está vendo.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/app/_components/ui";
import { useProdutoHm } from "@/app/hm/_components/use-produto";
import { useMe } from "@/app/_components/use-me";

type NotificacaoAutomacao = {
  id: string;
  descricao: string | null;
  card_nome: string | null;
  comprador_id: string | null;
  produto: string | null; // HM | AURUM | ETHB — para montar o link do card certo
  autor: string | null; // sistema/make/hotmart/lead/cs — informativo, não exibido cru
  criado_em: string;
};

const POLL_ATIVO_MS = 25000;
const POLL_OCULTO_MS = 90000;
const POLL_MAX_MS = 5 * 60000;

// Chave do localStorage SUFIXADA por produto+usuário (12/08) — antes era global
// ("hm_notificacoes_lido_em"), então trocar de conta OU de portal (HM → Aurum)
// herdava o "lido" da sessão/board anterior: o sino nascia mudo mesmo com
// notificação nova do board que a pessoa nunca abriu. Sem `me.id` ainda
// carregando, cai numa chave neutra "anon" — não quebra, só não persiste
// entre sessões até o /api/me responder (é o pior caso: perde 1 poll de cache).
function chaveLido(produto: string, usuarioId: string | null): string {
  return `hm_notificacoes_lido_em::${produto}::${usuarioId ?? "anon"}`;
}
function lerUltimaLeitura(chave: string): number {
  if (typeof window === "undefined") return 0;
  const v = window.localStorage.getItem(chave);
  const n = v ? Number(v) : 0;
  return Number.isFinite(n) ? n : 0;
}
function gravarLeituraAgora(chave: string) {
  window.localStorage.setItem(chave, String(Date.now()));
}

function fmtRelativo(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h}h`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function HmNotificacoes() {
  // Produto do board ATUAL (HM/Aurum/ETHB, lido da URL) — o sino monta nos três
  // layouts (12/08); sem isto o fetch caía sempre no default "HM" e o Aurum via
  // o feed do HM inteiro. `me` só para sufixar a chave de "lido" por usuário.
  const { produto } = useProdutoHm();
  const { me } = useMe();
  const chave = chaveLido(produto, me?.id ?? null);

  const [itens, setItens] = useState<NotificacaoAutomacao[]>([]);
  const [suportado, setSuportado] = useState(true); // false só se a rota não existir de fato (404)
  const [aberto, setAberto] = useState(false);
  const [ultimaLeitura, setUltimaLeitura] = useState(0);
  const raiz = useRef<HTMLDivElement>(null);
  const falhasRef = useRef(0);

  useEffect(() => { setUltimaLeitura(lerUltimaLeitura(chave)); }, [chave]);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/hm/notificacoes?produto=${produto}`);
      // fetch não lança em 4xx/5xx — cheque r.ok explicitamente.
      if (r.status === 404) {
        // Rota ainda não existe (backend em voo, 12/08) — desliga o sino em
        // silêncio, sem virar um erro visível para o operador.
        setSuportado(false);
        return;
      }
      if (!r.ok) throw new Error(String(r.status));
      const d = await r.json();
      if (d.ok && Array.isArray(d.notificacoes)) {
        setItens(d.notificacoes);
        setSuportado(true);
      }
      falhasRef.current = 0;
    } catch {
      falhasRef.current += 1;
      // Falha de rede/servidor: não deixa a lista velha sumir, só não atualiza.
    }
  }, [produto]);

  // Poll adaptativo (setTimeout encadeado, não setInterval) — pausa/reduz com
  // a aba oculta e faz backoff exponencial em erro, o mesmo desenho do inbox.
  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const agendar = (ms: number) => {
      timer = setTimeout(() => { void ciclo(); }, ms + Math.random() * ms * 0.15);
    };
    const ciclo = async () => {
      if (!vivo) return;
      await carregar();
      if (!vivo) return;
      if (falhasRef.current > 0) {
        agendar(Math.min(POLL_ATIVO_MS * 2 ** falhasRef.current, POLL_MAX_MS));
      } else {
        agendar(document.hidden ? POLL_OCULTO_MS : POLL_ATIVO_MS);
      }
    };

    void ciclo();
    const aoMudarVisibilidade = () => {
      // Voltou a ficar visível: refetch imediato para o sino não ficar
      // atrasado depois de a aba passar minutos em segundo plano.
      if (!document.hidden) { clearTimeout(timer); void ciclo(); }
    };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      vivo = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [carregar]);

  // Fecha ao clicar fora / Escape — mesmo padrão do TagPicker.
  useEffect(() => {
    if (!aberto) return;
    const clique = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", clique);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", clique);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  if (!suportado) return null; // rota ainda não existe — não ocupa espaço nem confunde

  const naoLidas = itens.filter((it) => new Date(it.criado_em).getTime() > ultimaLeitura).length;
  const temNaoLida = naoLidas > 0;

  function alternar() {
    const abrindo = !aberto;
    setAberto(abrindo);
    if (abrindo) {
      gravarLeituraAgora(chave);
      setUltimaLeitura(Date.now());
    }
  }

  return (
    <div ref={raiz} className="fixed right-4 top-3 z-50 sm:right-6">
      <button
        type="button"
        onClick={alternar}
        aria-haspopup="true"
        aria-expanded={aberto}
        aria-label={temNaoLida ? `O que mudou sozinho — ${naoLidas} novidade(s) que você ainda não viu` : "O que mudou sozinho"}
        className={cn(
          "alvo-toque relative flex h-9 w-9 items-center justify-center rounded-full border shadow-card transition",
          temNaoLida
            ? "border-brand/40 bg-white text-brand dark:border-brand-400/40 dark:bg-slate-900 dark:text-brand-300"
            : "border-slate-200 bg-white text-slate-500 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:text-slate-200",
        )}
      >
        {/* Sino — "piscar" não é só cor: o ícone pulsa (motion-safe respeita
            prefers-reduced-motion) e o contador é anunciado por aria-live,
            então quem usa leitor de tela ou desativou animação ainda é avisado. */}
        <svg
          className={cn("h-[18px] w-[18px]", temNaoLida && "motion-safe:animate-pulse")}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
        >
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {temNaoLida && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white motion-safe:animate-pulse"
            aria-hidden="true"
          >
            {naoLidas > 9 ? "9+" : naoLidas}
          </span>
        )}
        {/* aria-live: o contador é anunciado sem depender da animação — cobre
            quem desativou movimento e quem usa leitor de tela. */}
        <span aria-live="polite" role="status" className="sr-only">
          {temNaoLida ? `${naoLidas} novidade${naoLidas > 1 ? "s" : ""} que você ainda não viu` : ""}
        </span>
      </button>

      {aberto && (
        <div className="absolute right-0 top-full mt-2 w-80 max-w-[90vw] rounded-xl border border-slate-200 bg-white shadow-pop dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">O que mudou sozinho</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Coisas que aconteceram sem ninguém da equipe mexer: pagamento que caiu na Hotmart, resposta que chegou, card que andou por uma regra do sistema. Se um card sumiu do lugar, foi aqui.
            </p>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {itens.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500">Nada mudou sozinho por aqui ainda.</p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {itens.map((it) => {
                  const linha = (
                    <>
                      <p className="text-sm text-slate-700 dark:text-slate-200">{it.descricao ?? "O sistema fez uma alteração neste card"}</p>
                      <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                        {it.card_nome ? `${it.card_nome} · ` : ""}{fmtRelativo(it.criado_em)}
                      </p>
                    </>
                  );
                  const href = it.comprador_id
                    ? `/${(it.produto ?? "HM").toLowerCase()}/kanban?card=${it.comprador_id}`
                    : null;
                  return (
                    <li key={it.id}>
                      {href ? (
                        <Link href={href} onClick={() => setAberto(false)} className="block px-3 py-2 transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
                          {linha}
                        </Link>
                      ) : (
                        <div className="px-3 py-2">{linha}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
