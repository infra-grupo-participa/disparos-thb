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
import { TOM, type Tom } from "@/app/hm/_components/card-sinais";
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

// ===== Classificação (13/08) ==================================================
// Pedido do Marcio: "eles precisam bater o olho e entender as ações. Não pode
// ficar tendo que pensar pra tomar uma decisão." A lista plana mostrava
// `it.descricao` cru — a frase que a trigger do banco escreveu para o LOG, não
// para alguém ler rápido. Aqui a frase crua é CLASSIFICADA por um prefixo
// literal e conhecido (extraído das migrations que escrevem em cs.interacoes —
// 0075, 0076, 0181, 0028…) em um título curto + ícone + cor, e só então
// reescrita de forma mais direta.
//
// ⚠️ REGRA DE SEGURANÇA DO CLASSIFICADOR: cada transformação de texto abaixo
// (corpoDaNotificacao) só dispara quando o PREFIXO bate exatamente com um
// template real já visto em produção. Padrão que não bate cai no fallback
// "Atualização automática" com a frase ORIGINAL, sem edição — nunca finge
// reconhecer algo que não reconheceu. Não reformata valor em R$ (o to_char do
// banco já vem no formato certo; reformatar de novo no cliente é onde se perde
// separador de milhar/decimal sem perceber).
type TipoNotificacao =
  | "pagamento" | "estorno" | "boleto" | "cancelamento"
  | "formulario" | "entrada" | "aluno" | "etapa" | "outro";

type ClassificacaoTipo = { titulo: string; tom: Tom | "acao"; acao?: string; Icon: (p: { className?: string }) => JSX.Element };

const TOM_ACAO = "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300";

function classeToneChip(tom: Tom | "acao"): string {
  return tom === "acao" ? TOM_ACAO : TOM[tom];
}

// Ícones — mesmo traço (stroke 1.8, currentColor) do sino, um por categoria.
function IconMoeda({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5c0-1.1 1.1-2 2.5-2s2.5.7 2.5 1.8-1 1.5-2.5 1.9-2.5.9-2.5 2 1.1 1.8 2.5 1.8 2.5-.7 2.5-1.6" />
    </svg>
  );
}
function IconEstorno({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" />
    </svg>
  );
}
function IconBoleto({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}
function IconCancelado({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" />
    </svg>
  );
}
function IconFormulario({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4A8.6 8.6 0 0 1 4 18l-1 3 3-1a8.5 8.5 0 0 1-1.5-4.8A8.4 8.4 0 0 1 13 6.6a8.3 8.3 0 0 1 8 4.9Z" />
    </svg>
  );
}
function IconEntrada({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="8" r="3.2" /><path d="M4.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><path d="M18 8v5M15.5 10.5h5" />
    </svg>
  );
}
function IconAluno({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 3 7.5l9 4.5 9-4.5Z" /><path d="M7 10.2V15c0 1.7 2.2 3 5 3s5-1.3 5-3v-4.8" />
    </svg>
  );
}
function IconEtapa({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="6" height="16" rx="1.3" /><rect x="15" y="4" width="6" height="16" rx="1.3" />
      <path d="M10 12h4M12 9.5 14.5 12 12 14.5" />
    </svg>
  );
}
function IconGenerico({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

const CLASSIFICACAO: Record<TipoNotificacao, ClassificacaoTipo> = {
  pagamento: { titulo: "Pagamento recebido", tom: "positivo", Icon: IconMoeda },
  estorno: { titulo: "Pagamento estornado", tom: "bloqueio", acao: "Conferir o motivo com o financeiro.", Icon: IconEstorno },
  boleto: { titulo: "Boleto gerado — ainda não pago", tom: "atencao", acao: "Acompanhar se o pagamento cai.", Icon: IconBoleto },
  cancelamento: { titulo: "Cancelamento / reembolso", tom: "bloqueio", acao: "Conferir se precisa de contato de retenção.", Icon: IconCancelado },
  formulario: { titulo: "Respondeu formulário", tom: "acao", acao: "Dar sequência com a pessoa.", Icon: IconFormulario },
  entrada: { titulo: "Nova entrada na Jornada", tom: "positivo", Icon: IconEntrada },
  aluno: { titulo: "Acesso liberado na base", tom: "positivo", Icon: IconAluno },
  etapa: { titulo: "Aluno mudou de etapa", tom: "contexto", Icon: IconEtapa },
  outro: { titulo: "Atualização automática", tom: "neutro", Icon: IconGenerico },
};

// Ordem importa: "Movido para 'X'" só cai em "etapa" se X não for uma etapa de
// cancelamento — por isso o teste de cancelamento roda ANTES do de etapa.
function classificarTipo(descricao: string): TipoNotificacao {
  const d = descricao;
  if (/^Pagamento registrado:/i.test(d)) return "pagamento";
  if (/^Pagamento estornado:/i.test(d)) return "estorno";
  if (/^Boleto gerado/i.test(d)) return "boleto";
  if (
    /^Movido para "[^"]*(cancel|reembols)/i.test(d) ||
    /^(Cancelad|Assinatura cancelada|Reembolso\/cancelamento|Cancelamento (registrado|—|do))/i.test(d)
  ) return "cancelamento";
  if (/^Respondeu o formulário/i.test(d)) return "formulario";
  if (/^Entrou (na esteira|direto pela oferta)/i.test(d)) return "entrada";
  if (/^Aluno (criado|atualizado)/i.test(d)) return "aluno";
  if (/^Movido para "/i.test(d)) return "etapa";
  return "outro";
}

// Reescreve a frase crua em algo mais direto SÓ quando o prefixo bate
// literalmente com um template conhecido (comentário da regra de segurança
// acima). Fora isso, devolve o texto original sem tocar — nunca inventa.
function corpoDaNotificacao(descricao: string, tipo: TipoNotificacao): string {
  switch (tipo) {
    case "pagamento": {
      const m = /^Pagamento registrado:\s*(.+)$/i.exec(descricao);
      if (!m) return descricao;
      const resto = m[1]
        .replace(/—\s*SALDO QUITADO$/i, "· saldo quitado")
        .replace(/—\s*saldo restante/i, "· falta");
      return `Pagou ${resto}`;
    }
    case "estorno": {
      const m = /^Pagamento estornado:\s*(.+)$/i.exec(descricao);
      return m ? `Estorno de ${m[1]}` : descricao;
    }
    case "boleto": {
      const m = /^Boleto gerado \(ainda NÃO pago\)\s*—\s*(.+)$/i.exec(descricao);
      return m ? `Boleto de ${m[1]}` : descricao;
    }
    case "cancelamento":
    case "etapa": {
      const m = /^Movido para "([^"]+)"\s*(?:—\s*(.+))?$/.exec(descricao);
      if (!m) return descricao;
      return m[2] ? `Foi movido para "${m[1]}" — ${m[2]}` : `Foi movido para "${m[1]}".`;
    }
    case "formulario": {
      const m = /^Respondeu o formulário\s*\((.+)\)$/i.exec(descricao);
      return m ? `Respondeu o formulário de ${m[1]}.` : descricao;
    }
    case "entrada": {
      const m1 = /^Entrou na esteira HM \((.+)\)$/i.exec(descricao);
      if (m1) return `Entrou pela esteira: ${m1[1]}.`;
      const m2 = /^Entrou na esteira \((.+)\)$/i.exec(descricao);
      if (m2) return `Entrou na esteira: ${m2[1]}.`;
      return descricao;
    }
    default:
      return descricao;
  }
}

// Rótulo do grupo por dia — "o que aconteceu hoje" é a pergunta que o sino
// responde; agrupar por DIA mantém essa ordem cronológica lendo natural (como
// qualquer feed), enquanto ícone+cor por card já cobre a diferenciação por
// TIPO dentro do dia — duas dimensões, cada uma na estrutura que combina com
// ela (tempo em seções, categoria em cor).
function rotuloDia(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje); ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === hoje.toDateString()) return "Hoje";
  if (d.toDateString() === ontem.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}

// Agrupa preservando a ordem de chegada (a API já devolve desc por criado_em)
// — nunca reordena, só separa em seções visuais.
function gruposPorDia(itens: NotificacaoAutomacao[]): Array<[string, NotificacaoAutomacao[]]> {
  const mapa = new Map<string, NotificacaoAutomacao[]>();
  for (const it of itens) {
    const rotulo = rotuloDia(it.criado_em);
    const lista = mapa.get(rotulo);
    if (lista) lista.push(it); else mapa.set(rotulo, [it]);
  }
  return [...mapa.entries()];
}

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
        <div className="absolute right-0 top-full mt-2 w-96 max-w-[92vw] rounded-xl border border-slate-200 bg-white shadow-pop dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
            <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">O que mudou sozinho</p>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Automação mexeu nestes cards sem ninguém da equipe tocar. Se um sumiu da fila, foi por isso.
            </p>
          </div>
          <div className="max-h-[26rem] overflow-y-auto">
            {itens.length === 0 ? (
              <p className="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500">Nada mudou sozinho por aqui ainda.</p>
            ) : (
              // Agrupado por DIA (não por tipo): é a pergunta que o sino
              // responde — "o que aconteceu enquanto eu não estava olhando" —
              // e cada card já se diferencia por tipo via ícone+cor, então
              // agrupar por tipo quebraria a ordem cronológica sem ganhar
              // nada em clareza.
              gruposPorDia(itens).map(([dia, doDia]) => (
                <div key={dia}>
                  <p className="sticky top-0 border-b border-slate-100 bg-white/95 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 dark:text-slate-500">
                    {dia}
                  </p>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {doDia.map((it) => {
                      const descricao = it.descricao ?? "O sistema fez uma alteração nesta ficha";
                      const tipo = classificarTipo(descricao);
                      const cls = CLASSIFICACAO[tipo];
                      const corpo = corpoDaNotificacao(descricao, tipo);
                      const naoLida = new Date(it.criado_em).getTime() > ultimaLeitura;
                      const conteudo = (
                        <div className="flex gap-2.5">
                          <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", classeToneChip(cls.tom))}>
                            <cls.Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{cls.titulo}</p>
                              <span className="mt-0.5 shrink-0 text-[10px] text-slate-400 dark:text-slate-500">{fmtRelativo(it.criado_em)}</span>
                            </div>
                            <p className="mt-0.5 break-words text-xs text-slate-600 dark:text-slate-300">
                              {it.card_nome ? <span className="font-medium text-slate-700 dark:text-slate-200">{it.card_nome}</span> : null}
                              {it.card_nome ? " — " : ""}
                              {corpo}
                            </p>
                            {cls.acao && (
                              <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-teal-700 dark:text-teal-300">
                                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                                {cls.acao}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                      const href = it.comprador_id
                        ? `/${(it.produto ?? "HM").toLowerCase()}/kanban?card=${it.comprador_id}`
                        : null;
                      return (
                        <li key={it.id} className={cn(naoLida && "bg-brand/[0.04] dark:bg-brand-400/[0.06]")}>
                          {href ? (
                            <Link href={href} onClick={() => setAberto(false)} className="block px-3 py-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/60">
                              {conteudo}
                            </Link>
                          ) : (
                            <div className="px-3 py-2.5">{conteudo}</div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
