"use client";

// Peças de apresentação do Inbox: item da fila e bolha da conversa.
// Vivem FORA do InboxPage e são memoizadas por performance — a fila pode ter
// até 200 itens e o thread dezenas de bolhas; sem memo, qualquer estado do
// container (busca, tick de minuto, poll) re-renderizava tudo.

import { memo } from "react";
import { EdicaoBadge } from "@/app/_components/edicao-badge";
import { cn } from "@/app/_components/ui";

export type Conversa = {
  comprador_id: string; nome: string; telefone: string | null; edicao: string | null;
  estagio_nome: string | null; ultima_resposta_em: string | null; ultima_msg: string | null;
  ultima_de_cs: boolean | null; ultima_msg_em: string | null;
  inbox_status: string; aguardando_desde: string | null; opt_out: boolean; responsavel: string | null;
};

export type Mensagem = { id: string; de: "lead" | "cs"; origem?: "lead" | "template" | "equipe"; senderBy?: string | null; tipo: string; texto: string; data: string | null };

export type Janela = { aberta: boolean; ultimaEntrada: string | null; expiraEm: string | null };

// ---- Formatação compartilhada --------------------------------------------

export const fmtData = (iso: string | null) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
export const fmtHora = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
export function fmtMin(m: number | null | undefined) {
  if (m == null) return "—";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}
export function esperaMin(iso: string | null) {
  return iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0;
}
// Variante determinística para componentes memoizados: recebe o minuto atual
// como prop, então o "aguardando X min" avança a cada tick do relógio do pai
// (e o memo continua valendo entre os ticks).
function esperaDesde(iso: string | null, agoraMin: number) {
  return iso ? Math.max(0, agoraMin - Math.floor(new Date(iso).getTime() / 60000)) : 0;
}

// Link do WhatsApp (wa.me) — o comercial inicia a conversa direto, útil para
// leads de prospecção (ex.: Seminário) fora da janela de 24h da Unnichat.
export function waLink(tel: string | null): string | null {
  if (!tel) return null;
  let d = tel.replace(/\D/g, "");
  if (d.length < 8) return null;
  if (!d.startsWith("55")) d = "55" + d;
  return `https://wa.me/${d}`;
}

// Limpa os prefixos internos ("Respondeu:" do lead, "CS respondeu:" do CS) e,
// quando a última mensagem foi do operador, mostra "Você:" como no WhatsApp.
function previewMsg(c: Conversa): string {
  const txt = (c.ultima_msg || "").replace(/^(CS )?[Rr]espondeu:\s*/, "").trim();
  if (!txt) return "—";
  return c.ultima_de_cs ? `Você: ${txt}` : txt;
}

// ---- Avatar ---------------------------------------------------------------

const inicial = (nome: string) => (nome?.trim()?.[0] || "?").toUpperCase();
const AVATAR_CORES = [
  "bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300", "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300", "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300", "bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-300",
];
function corAvatar(nome: string) {
  let h = 0;
  for (let i = 0; i < (nome?.length || 0); i++) h = (h * 31 + nome.charCodeAt(i)) >>> 0;
  return AVATAR_CORES[h % AVATAR_CORES.length];
}
export function Avatar({ nome, size = "md" }: { nome: string; size?: "sm" | "md" }) {
  return <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", size === "sm" ? "h-9 w-9 text-sm" : "h-10 w-10 text-base", corAvatar(nome))}>{inicial(nome)}</span>;
}

// ---- Item da fila -----------------------------------------------------------

export const FilaItem = memo(function FilaItem({ c, ativo, slaMin, agoraMin, meuNome, onAbrir }: {
  c: Conversa;
  ativo: boolean;
  slaMin: number;
  agoraMin: number; // minuto atual — faz o "aguardando X min" avançar sem novo fetch
  meuNome: string;  // quem está atendendo — destaca quando o lead está COM OUTRO operador
  onAbrir: (c: Conversa) => void;
}) {
  const pend = c.inbox_status === "pendente";
  const espera = pend ? esperaDesde(c.aguardando_desde, agoraMin) : 0;
  const atrasado = espera > slaMin;
  const comOutro = !!c.responsavel && c.responsavel !== meuNome;
  return (
    <li data-conversa-id={c.comprador_id}>
      <button onClick={() => onAbrir(c)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-left transition", ativo ? "bg-brand-50 dark:bg-brand-400/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/60")}>
        <div className="relative">
          <Avatar nome={c.nome} />
          {pend && <span className={cn("absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-slate-900", atrasado ? "bg-rose-500" : "bg-amber-400")} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={cn("truncate font-semibold", ativo ? "text-brand-700 dark:text-brand-300" : "text-slate-800 dark:text-slate-200")}>{c.nome}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-slate-400 dark:text-slate-500">{fmtData(c.ultima_msg_em ?? c.ultima_resposta_em)}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between gap-2">
            <span className={cn("truncate text-xs", c.ultima_de_cs ? "text-slate-400 dark:text-slate-500" : "text-slate-500 dark:text-slate-400")}>{previewMsg(c)}</span>
            <EdicaoBadge edicao={c.edicao} className="shrink-0" />
          </div>
          {pend && (
            <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", atrasado ? "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300")}>
              aguardando {fmtMin(espera)}
            </span>
          )}
          {/* Quem está com o lead — evita dois operadores respondendo a mesma conversa. */}
          {c.responsavel && (
            <span
              title={comOutro ? `${c.responsavel} está atendendo este lead` : "Você está atendendo esta pessoa"}
              className={cn(
                "ml-1 mt-1 inline-flex max-w-[11rem] items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                comOutro ? "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
              )}
            >
              <svg className="h-2.5 w-2.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
              <span className="truncate">{comOutro ? `com ${c.responsavel}` : "com você"}</span>
            </span>
          )}
          {c.opt_out && <span className="ml-1 mt-1 inline-flex items-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">opt-out</span>}
        </div>
      </button>
    </li>
  );
});

// ---- Bolha da conversa ------------------------------------------------------

// Rótulo humano da origem da bolha — o operador distingue o que foi TEMPLATE
// (disparo/abertura) do que a equipe escreveu à mão no chat.
const ROTULO_ORIGEM: Record<string, string> = { template: "Template", equipe: "Equipe" };

export const Bolha = memo(function Bolha({ m }: { m: Mensagem }) {
  const cs = m.de === "cs";
  return (
    <div className={cn("flex", cs ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm", cs ? "rounded-br-sm bg-[#DCF8C6] dark:bg-emerald-900/40 dark:text-slate-100" : "rounded-bl-sm bg-white dark:bg-slate-700 dark:text-slate-100")}>
        {cs && m.origem && ROTULO_ORIGEM[m.origem] && (
          <span className={cn("mb-0.5 block text-[10px] font-semibold uppercase tracking-wide", m.origem === "template" ? "text-brand-500 dark:text-brand-300" : "text-slate-400 dark:text-slate-500")}>
            {ROTULO_ORIGEM[m.origem]}
          </span>
        )}
        <p className="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-200">{m.texto}</p>
        <span className="mt-1 block text-right text-[10px] tabular-nums text-slate-400 dark:text-slate-500">{fmtHora(m.data)}</span>
      </div>
    </div>
  );
});
