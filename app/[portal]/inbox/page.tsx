"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EdicaoBadge } from "@/app/_components/edicao-badge";
import { Button, Card, EmptyState, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { PageFade } from "@/app/_components/anim";
import { usePortal } from "@/app/_components/use-portal";

type Conversa = {
  comprador_id: string; nome: string; telefone: string | null; edicao: string | null;
  estagio_nome: string | null; ultima_resposta_em: string | null; ultima_msg: string | null;
  ultima_de_cs: boolean | null; ultima_msg_em: string | null;
  inbox_status: string; aguardando_desde: string | null; opt_out: boolean; responsavel: string | null;
};

// Limpa os prefixos internos ("Respondeu:" do lead, "CS respondeu:" do CS) e,
// quando a última mensagem foi do operador, mostra "Você:" como no WhatsApp.
function previewMsg(c: Conversa): string {
  const txt = (c.ultima_msg || "").replace(/^(CS )?[Rr]espondeu:\s*/, "").trim();
  if (!txt) return "—";
  return c.ultima_de_cs ? `Você: ${txt}` : txt;
}
type Mensagem = { id: string; de: "lead" | "cs"; origem?: "lead" | "template" | "equipe"; senderBy?: string | null; tipo: string; texto: string; data: string | null };
// Rótulo humano da origem da bolha — o operador distingue o que foi TEMPLATE
// (disparo/abertura) do que a equipe escreveu à mão no chat.
const ROTULO_ORIGEM: Record<string, string> = { template: "Template", equipe: "Equipe" };
type Janela = { aberta: boolean; ultimaEntrada: string | null; expiraEm: string | null };
type TemplateItem = { id: string; nome: string; canal: string; ativo: boolean };
type Metricas = {
  kpis: { pendentes: number; total_atendimentos: number; atendidas_hoje: number; frt_medio: number | null; frt_hoje: number | null; sla_pct: number | null; maior_espera_min: number | null; sla_min: number };
  porAtendente: { atendente: string; atendimentos: number; frt_medio: number | null; sla_pct: number | null }[];
  porDia: { dia: string; qtd: number; frt: number | null }[];
};

const SNIPPETS_DEFAULT = [
  "Olá! Tudo bem? 😊 Aqui é o time do Holding Total.",
  "Que bom te ver por aqui! Como posso ajudar?",
  "O link do nosso grupo é: ",
  "Sua dúvida foi resolvida? Qualquer coisa é só chamar! 🙌",
];

const fmtData = (iso: string | null) => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
const fmtHora = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
function fmtMin(m: number | null | undefined) {
  if (m == null) return "—";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}
function esperaMin(iso: string | null) {
  return iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0;
}
const inicial = (nome: string) => (nome?.trim()?.[0] || "?").toUpperCase();
// Link do WhatsApp (wa.me) — o comercial inicia a conversa direto, útil para
// leads de prospecção (ex.: Seminário) fora da janela de 24h da Unnichat.
function waLink(tel: string | null): string | null {
  if (!tel) return null;
  let d = tel.replace(/\D/g, "");
  if (d.length < 8) return null;
  if (!d.startsWith("55")) d = "55" + d;
  return `https://wa.me/${d}`;
}
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
function Avatar({ nome, size = "md" }: { nome: string; size?: "sm" | "md" }) {
  return <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", size === "sm" ? "h-9 w-9 text-sm" : "h-10 w-10 text-base", corAvatar(nome))}>{inicial(nome)}</span>;
}

export default function InboxPage() {
  const { evento, nome } = usePortal();
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [pendentes, setPendentes] = useState(0);
  const [filtro, setFiltro] = useState<"pendente" | "" | "resolvido">("pendente");
  const [sel, setSel] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [carregandoMsg, setCarregandoMsg] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [atendente, setAtendente] = useState("");
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [showDesempenho, setShowDesempenho] = useState(false);
  const [snippets, setSnippets] = useState<string[]>(SNIPPETS_DEFAULT);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [modoDisparo, setModoDisparo] = useState<string | null>(null);
  const [janela, setJanela] = useState<Janela | null>(null);
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [tplSel, setTplSel] = useState("");
  const [enviandoTpl, setEnviandoTpl] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  // Marca da última mensagem já vista na conversa aberta — o polling compara com
  // esta para saber se chegou resposta nova (e só então recarrega o thread).
  const ultimaMsgRef = useRef<string | null>(null);
  const pendAntesRef = useRef<number>(0);

  // Templates de abertura (WhatsApp) do evento — o que reabre a janela de 24h.
  useEffect(() => {
    fetch(`/api/templates?evento=${evento}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setTemplates((d.templates as TemplateItem[]).filter((t) => t.ativo && t.canal !== "email")); })
      .catch(() => {});
  }, [evento]);

  useEffect(() => {
    try {
      setAtendente(localStorage.getItem("cs_atendente") || "");
      const s = localStorage.getItem("cs_snippets");
      if (s) setSnippets(JSON.parse(s));
    } catch { /* noop */ }
  }, []);
  function salvarAtendente(v: string) { setAtendente(v); try { localStorage.setItem("cs_atendente", v); } catch { /* noop */ } }

  const carregarConversas = useCallback(async () => {
    const qs = modoDisparo ? `&disparo=${modoDisparo}` : (filtro ? `&status=${filtro}` : "");
    const r = await fetch(`/api/inbox?evento=${evento}${qs}`);
    const d = await r.json();
    if (d.ok) { setConversas(d.conversas); setPendentes(d.pendentes ?? 0); }
  }, [filtro, evento, modoDisparo]);
  const carregarMetricas = useCallback(async () => {
    const r = await fetch(`/api/inbox/metricas?evento=${evento}`);
    const d = await r.json();
    if (d.ok) setMetricas(d);
  }, [evento]);

  useEffect(() => { carregarConversas(); }, [carregarConversas]);
  useEffect(() => { carregarMetricas(); }, [carregarMetricas]);

  // Deep-link vindo do Kanban (/inbox?c=comprador_id): abre todas as conversas e seleciona a do cliente.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const c = sp.get("c");
      if (c) { setDeepLink(c); setFiltro(""); }
      const disp = sp.get("disparo");
      if (disp) setModoDisparo(disp);
    } catch { /* noop */ }
  }, []);

  const abrir = useCallback(async (c: Conversa) => {
    setSel(c); setMensagens([]); setAviso(null); setJanela(null); setTplSel(""); setCarregandoMsg(true);
    ultimaMsgRef.current = c.ultima_msg_em; // sincroniza: abrir já traz o thread
    try {
      const r = await fetch(`/api/inbox/${c.comprador_id}`);
      const d = await r.json();
      if (d.ok) { setMensagens(d.mensagens); setAviso(d.aviso ?? null); setJanela(d.janela ?? null); }
    } finally { setCarregandoMsg(false); }
  }, []);

  // Recarrega SÓ as mensagens da conversa aberta, sem limpar a tela nem mostrar
  // spinner — é o refresh silencioso do polling quando o lead responde, para não
  // piscar a conversa a cada ciclo.
  const recarregarThread = useCallback(async (compradorId: string) => {
    try {
      const r = await fetch(`/api/inbox/${compradorId}`);
      const d = await r.json();
      if (d.ok) { setMensagens(d.mensagens); setAviso(d.aviso ?? null); setJanela(d.janela ?? null); }
    } catch { /* silencioso: é atualização de fundo */ }
  }, []);

  // Janela fechada (ou lead nunca respondeu): a única forma de (re)abrir a
  // conversa é um template aprovado. Reusa /api/send (cria contato + envia +
  // guarda anti-ban). Quando o lead responder ao template, a janela de 24h abre.
  async function enviarTemplateAbertura() {
    if (!sel || !tplSel) return;
    setEnviandoTpl(true);
    try {
      const r = await fetch(`/api/send?evento=${evento}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: tplSel, compradorIds: [sel.comprador_id] }),
      });
      const d = await r.json();
      if (d.ok) {
        setTplSel("");
        alert("Template de abertura enviado. Quando o lead responder, a conversa reabre e você poderá escrever livremente.");
        void carregarConversas();
      } else {
        alert(d.motivo || d.reason || "Não foi possível enviar o template de abertura.");
      }
    } catch {
      alert("Falha ao enviar o template. Tente novamente.");
    } finally {
      setEnviandoTpl(false);
    }
  }

  // Quando a lista carrega e há um deep-link pendente, seleciona a conversa-alvo.
  useEffect(() => {
    if (!deepLink || !conversas.length) return;
    const c = conversas.find((x) => x.comprador_id === deepLink);
    if (c) { abrir(c); setDeepLink(null); }
  }, [deepLink, conversas, abrir]);

  useEffect(() => { if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight; }, [mensagens]);

  // Tempo real (leve): a cada 12s repuxa a fila do banco. É isto que faz a
  // resposta do lead "aparecer sozinha" no inbox, sem F5 — desde que o webhook do
  // Unnichat esteja ligado (é ele quem grava a resposta que este polling lê).
  useEffect(() => {
    const t = setInterval(() => { void carregarConversas(); }, 12000);
    return () => clearInterval(t);
  }, [carregarConversas]);

  // Notificação discreta: o título da aba conta os pendentes (como o WhatsApp
  // Web), então o operador vê que chegou algo mesmo com a aba em segundo plano.
  useEffect(() => {
    document.title = pendentes > 0 ? `(${pendentes}) Inbox · ${nome}` : `Inbox · ${nome}`;
    return () => { document.title = nome; };
  }, [pendentes, nome]);

  // Toca um bip curto quando o nº de pendentes SOBE (resposta nova entrou na
  // fila). Gerado na hora (sem arquivo externo); silencioso se o browser bloquear.
  useEffect(() => {
    if (pendentes > pendAntesRef.current && pendAntesRef.current !== 0) {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880; gain.gain.value = 0.05;
        osc.start(); osc.stop(ctx.currentTime + 0.15);
      } catch { /* browser bloqueou áudio sem interação: tudo bem */ }
    }
    pendAntesRef.current = pendentes;
  }, [pendentes]);

  // Conversa aberta: se o polling trouxe uma mensagem nova do lead nela, recarrega
  // o thread silenciosamente para a bolha aparecer sem o operador clicar de novo.
  useEffect(() => {
    if (!sel) { ultimaMsgRef.current = null; return; }
    const atual = conversas.find((c) => c.comprador_id === sel.comprador_id);
    const marca = atual?.ultima_msg_em ?? null;
    if (marca && marca !== ultimaMsgRef.current) {
      if (ultimaMsgRef.current !== null && !atual?.ultima_de_cs) void recarregarThread(sel.comprador_id);
      ultimaMsgRef.current = marca;
    }
  }, [conversas, sel, recarregarThread]);

  async function enviar() {
    if (!sel || !texto.trim()) return;
    const txt = texto.trim();
    const tmpId = `tmp-${Date.now()}`;
    setEnviando(true);
    setTexto("");
    // Otimista: mostra a mensagem na hora, sem esperar o ida-e-volta à Unnichat.
    setMensagens((m) => [...m, { id: tmpId, de: "cs", tipo: "message", texto: txt, data: new Date().toISOString() }]);
    try {
      const r = await fetch(`/api/inbox/${sel.comprador_id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: txt, atendente: atendente || undefined }),
      });
      const d = await r.json();
      if (!d.ok) {
        // Reverte o otimista e devolve o texto ao campo.
        setMensagens((m) => m.filter((x) => x.id !== tmpId));
        setTexto(txt);
        alert(d.reason || "Falha ao enviar (a janela de 24h pode estar fechada).");
        return;
      }
      // Atualiza lista e métricas em segundo plano (banco, rápido) — não trava o input.
      void carregarConversas();
      void carregarMetricas();
    } catch {
      setMensagens((m) => m.filter((x) => x.id !== tmpId));
      setTexto(txt);
      alert("Falha ao enviar. Tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  async function resolver(c: Conversa, status: "resolvido" | "pendente") {
    await fetch(`/api/inbox/${c.comprador_id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    if (sel?.comprador_id === c.comprador_id) setSel({ ...sel, inbox_status: status });
    await carregarConversas();
    await carregarMetricas();
  }

  function addSnippet() {
    const t = window.prompt("Nova resposta rápida:");
    if (t && t.trim()) {
      const novo = [...snippets, t.trim()];
      setSnippets(novo);
      try { localStorage.setItem("cs_snippets", JSON.stringify(novo)); } catch { /* noop */ }
    }
  }

  const k = metricas?.kpis;

  return (
    <PageFade>
      {/* KPIs de desempenho do CS */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Inbox</h1>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400" title="A fila atualiza sozinha a cada poucos segundos">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          ao vivo
        </span>
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <span>Atendendo como</span>
          <input
            value={atendente}
            onChange={(e) => salvarAtendente(e.target.value)}
            placeholder="seu nome"
            className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-brand dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
        <Button variant="secondary" size="sm" onClick={() => setShowDesempenho(true)}>Desempenho</Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCS label="Pendentes agora" valor={k?.pendentes ?? pendentes} tom={(k?.pendentes ?? pendentes) > 0 ? "rose" : "emerald"}
          sub={k?.maior_espera_min != null ? `pior espera ${fmtMin(k.maior_espera_min)}` : "tudo em dia"} />
        <KpiCS label="1º contato (hoje)" valor={fmtMin(k?.frt_hoje)} tom="brand" sub={`média geral ${fmtMin(k?.frt_medio)}`} />
        <KpiCS label="Atendidas hoje" valor={k?.atendidas_hoje ?? 0} tom="sky" sub={`${k?.total_atendimentos ?? 0} no total`} />
        <KpiCS label={`Dentro do SLA (${k?.sla_min ?? 15}min)`} valor={k?.sla_pct != null ? `${k.sla_pct}%` : "—"} tom="emerald" sub="1º contato no prazo" />
      </div>

      {modoDisparo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 dark:border-brand-400/20 dark:bg-brand-400/5">
          <span className="text-sm text-brand-700 dark:text-brand-300">
            Mostrando os contatos deste disparo, na ordem em que a mensagem saiu — as respostas aparecem aqui conforme chegam.
          </span>
          <button
            onClick={() => { setModoDisparo(null); try { window.history.replaceState(null, "", window.location.pathname); } catch { /* noop */ } }}
            className="shrink-0 text-sm font-medium text-brand hover:underline dark:text-brand-300"
          >
            Ver toda a fila
          </button>
        </div>
      )}

      <Card className="grid h-[68vh] grid-cols-1 overflow-hidden p-0 lg:grid-cols-[340px_1fr]">
        {/* Fila */}
        <aside className="flex min-h-0 flex-col border-b border-slate-200 dark:border-slate-800 lg:border-b-0 lg:border-r">
          <div className="flex gap-1 border-b border-slate-100 p-2 dark:border-slate-800">
            {([["pendente", "Pendentes"], ["", "Todas"], ["resolvido", "Resolvidas"]] as const).map(([v, label]) => (
              <button
                key={label}
                onClick={() => setFiltro(v)}
                className={cn(
                  "flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition",
                  filtro === v ? "bg-brand text-white dark:bg-brand-500" : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800",
                )}
              >
                {label}{v === "pendente" && pendentes > 0 ? ` (${pendentes})` : ""}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {conversas.length === 0 ? (
              <div className="p-4"><EmptyState title="Nada por aqui" description={filtro === "pendente" ? "Nenhuma conversa aguardando resposta. 🎉" : "Quando um lead responder, aparece aqui."} /></div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {conversas.map((c) => {
                  const ativo = sel?.comprador_id === c.comprador_id;
                  const pend = c.inbox_status === "pendente";
                  const espera = pend ? esperaMin(c.aguardando_desde) : 0;
                  const atrasado = espera > (k?.sla_min ?? 15);
                  return (
                    <li key={c.comprador_id}>
                      <button onClick={() => abrir(c)} className={cn("flex w-full items-start gap-3 px-4 py-3 text-left transition", ativo ? "bg-brand-50 dark:bg-brand-400/10" : "hover:bg-slate-50 dark:hover:bg-slate-800/60")}>
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
                          {c.opt_out && <span className="ml-1 mt-1 inline-flex items-center rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">opt-out</span>}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Conversa */}
        <section className="flex min-h-0 flex-col">
          {!sel ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <EmptyState
                icon={<svg className="h-10 w-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 10h8M8 14h5M21 12a9 9 0 0 1-13.36 7.87L3 21l1.13-4.64A9 9 0 1 1 21 12Z" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                title="Selecione uma conversa"
                description="Escolha um contato na fila para ver o histórico e responder."
              />
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-3 dark:border-slate-800">
                <Avatar nome={sel.nome} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-semibold text-slate-900 dark:text-slate-100">{sel.nome}</span>
                    <EdicaoBadge edicao={sel.edicao} />
                    {sel.inbox_status === "pendente" && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">pendente</span>}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
                    {sel.telefone || "Sem telefone"}{sel.estagio_nome ? <span className="text-slate-300 dark:text-slate-600"> · {sel.estagio_nome}</span> : null}
                    {sel.inbox_status === "pendente" && sel.aguardando_desde ? <span className="text-rose-500 dark:text-rose-400"> · aguardando {fmtMin(esperaMin(sel.aguardando_desde))}</span> : null}
                  </p>
                </div>
                {waLink(sel.telefone) && (
                  <a
                    href={waLink(sel.telefone)!}
                    target="_blank"
                    rel="noreferrer"
                    title="Abrir conversa no WhatsApp"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-600"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.76.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2Z" /></svg>
                    WhatsApp
                  </a>
                )}
                {sel.inbox_status === "pendente"
                  ? <Button variant="secondary" size="sm" onClick={() => resolver(sel, "resolvido")}>Resolver</Button>
                  : <Button variant="ghost" size="sm" onClick={() => resolver(sel, "pendente")}>Reabrir</Button>}
              </header>

              <div ref={chatRef} className="min-h-0 flex-1 space-y-2 overflow-auto bg-[#ECE5DD] p-4 dark:bg-slate-800">
                {carregandoMsg && <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-600 dark:text-slate-300"><Spinner /> Carregando conversa…</div>}
                {aviso && <div className="mx-auto w-fit max-w-[85%] rounded-full bg-amber-50 px-3 py-1 text-center text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">{aviso}</div>}
                {mensagens.map((m) => {
                  const cs = m.de === "cs";
                  return (
                    <div key={m.id} className={cn("flex", cs ? "justify-end" : "justify-start")}>
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
                })}
                {!carregandoMsg && mensagens.length === 0 && !aviso && <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">Sem mensagens nesta conversa.</p>}
              </div>

              {janela && !janela.aberta ? (
                /* Janela de 24h fechada: o SDR só reabre com um template pronto. */
                <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <div className="flex items-start gap-2.5">
                    <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 9v4M12 17h.01" strokeLinecap="round" /></svg>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">Janela de conversa fechada</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-amber-700 dark:text-amber-300/90">
                        {janela.ultimaEntrada
                          ? "Passaram-se mais de 24h desde a última mensagem do lead."
                          : "Este lead ainda não iniciou uma conversa no WhatsApp."}{" "}
                        Você só pode começar a abordagem enviando um <strong>template pronto</strong>. Assim que o lead responder, a conversa reabre e você escreve livremente aqui.
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <select value={tplSel} onChange={(e) => setTplSel(e.target.value)} className={cn(fieldClass, "w-auto min-w-[220px]")}>
                          <option value="">Escolha um template de abertura…</option>
                          {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                        </select>
                        <Button onClick={enviarTemplateAbertura} disabled={enviandoTpl || !tplSel}>
                          {enviandoTpl ? (<><Spinner className="text-white" /> Enviando…</>) : "Enviar template"}
                        </Button>
                        {templates.length === 0 && (
                          <span className="text-xs text-amber-700 dark:text-amber-300">Nenhum template cadastrado — crie um em Templates.</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border-t border-slate-100 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
                  {/* Respostas rápidas */}
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {snippets.map((s, i) => (
                      <button key={i} onClick={() => setTexto((t) => (t ? t + " " : "") + s)} title={s}
                        className="max-w-[180px] truncate rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-600 transition hover:border-brand/30 hover:bg-brand/5 dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-400/30 dark:hover:bg-brand-400/10">
                        {s}
                      </button>
                    ))}
                    <button onClick={addSnippet} title="Adicionar resposta rápida" className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs text-slate-400 transition hover:text-slate-600 dark:border-slate-600 dark:hover:text-slate-300">+ atalho</button>
                  </div>
                  <div className="flex items-end gap-2">
                    <input
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
                      placeholder="Escreva uma resposta…"
                      className={cn(fieldClass, "flex-1")}
                    />
                    <Button onClick={enviar} disabled={enviando || !texto.trim()}>
                      {enviando ? (<><Spinner className="text-white" /> Enviando…</>) : "Enviar"}
                    </Button>
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                    <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    Janela aberta{janela?.expiraEm ? ` · fecha ${fmtData(janela.expiraEm)}` : ""} — você pode escrever livremente. Responder marca a conversa como resolvida.
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </Card>

      {showDesempenho && metricas && (
        <Desempenho metricas={metricas} onClose={() => setShowDesempenho(false)} />
      )}
    </PageFade>
  );
}

const KPI_TOM: Record<string, string> = {
  brand: "text-brand dark:text-brand-300", rose: "text-rose-600 dark:text-rose-400",
  emerald: "text-emerald-600 dark:text-emerald-400", sky: "text-sky-600 dark:text-sky-400",
};
function KpiCS({ label, valor, tom, sub }: { label: string; valor: string | number; tom: keyof typeof KPI_TOM; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", KPI_TOM[tom])}>{valor}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{sub}</div>}
    </Card>
  );
}

function Desempenho({ metricas, onClose }: { metricas: Metricas; onClose: () => void }) {
  const maxDia = Math.max(...metricas.porDia.map((d) => d.qtd), 1);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 pt-16 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-pop dark:border-slate-800 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Desempenho do atendimento</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Por atendente</h3>
        {metricas.porAtendente.length === 0 ? (
          <p className="py-3 text-sm text-slate-400 dark:text-slate-500">Ainda não há atendimentos registrados.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr><th className="px-3 py-2 font-semibold">Atendente</th><th className="px-3 py-2 font-semibold">Atendimentos</th><th className="px-3 py-2 font-semibold">1º contato médio</th><th className="px-3 py-2 font-semibold">SLA</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {metricas.porAtendente.map((a) => (
                  <tr key={a.atendente} className="text-slate-700 dark:text-slate-200">
                    <td className="px-3 py-2 font-medium">{a.atendente}</td>
                    <td className="px-3 py-2 tabular-nums">{a.atendimentos}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtMin(a.frt_medio)}</td>
                    <td className="px-3 py-2 tabular-nums">{a.sla_pct != null ? `${a.sla_pct}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Atendimentos por dia (14d)</h3>
        {metricas.porDia.length === 0 ? (
          <p className="py-3 text-sm text-slate-400 dark:text-slate-500">Sem dados ainda.</p>
        ) : (
          <div className="flex h-28 items-end gap-1.5">
            {metricas.porDia.map((d) => (
              <div key={d.dia} className="group flex flex-1 flex-col items-center justify-end" title={`${d.dia}: ${d.qtd} atend. · 1º contato ${fmtMin(d.frt)}`}>
                <div className="w-full rounded-t bg-brand/50 transition group-hover:bg-brand dark:bg-brand-400/50 dark:group-hover:bg-brand-400" style={{ height: `${Math.max((d.qtd / maxDia) * 100, 5)}%` }} />
                <span className="mt-1 text-[9px] tabular-nums text-slate-400 dark:text-slate-500">{d.dia}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
