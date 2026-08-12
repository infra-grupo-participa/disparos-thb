"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EdicaoBadge } from "@/app/_components/edicao-badge";
import { Button, Card, EmptyState, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { PageFade } from "@/app/_components/anim";
import { usePortal } from "@/app/_components/use-portal";
import { useMe } from "@/app/_components/use-me";
import { RegistrarAtendimento } from "@/app/_components/ligacao";
import { toast } from "@/app/_components/toast";
import { InboxComposer } from "@/app/_components/inbox-composer";
import { casaBusca } from "@/lib/busca";
import {
  Avatar, Bolha, FilaItem, esperaMin, fmtMin, waLink,
  type Conversa, type Janela, type Mensagem,
} from "@/app/_components/inbox-itens";

type TemplateItem = { id: string; nome: string; canal: string; ativo: boolean };
type Metricas = {
  kpis: { pendentes: number; total_atendimentos: number; atendidas_hoje: number; frt_medio: number | null; frt_hoje: number | null; sla_pct: number | null; maior_espera_min: number | null; sla_min: number };
  porAtendente: { atendente: string; atendimentos: number; frt_medio: number | null; sla_pct: number | null }[];
  porDia: { dia: string; qtd: number; frt: number | null }[];
};
// Última versão vista de cada thread — voltar a uma conversa mostra na hora o
// que já se conhece (stale) e revalida em fundo, sem spinner nem tela vazia.
type ThreadCache = { mensagens: Mensagem[]; aviso: string | null; janela: Janela | null };

export default function InboxPage() {
  const { evento, nome } = usePortal();
  const { me } = useMe();
  // O HM vive num overlay isolado (cs.contatos_hm) e tem rotas de inbox próprias
  // (/api/hm/inbox*). Os demais portais usam as genéricas. A tela é a MESMA — só o
  // prefixo dos endpoints de inbox muda. Templates/send já tratam evento por si.
  const inboxBase = evento === "HM" ? "/api/hm/inbox" : "/api/inbox";
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [pendentes, setPendentes] = useState(0);
  const [filtro, setFiltro] = useState<"pendente" | "" | "resolvido">("pendente");
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState<Conversa | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [carregandoMsg, setCarregandoMsg] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [atendente, setAtendente] = useState("");
  // Usuários ativos para o "Atendendo como" — seleção, nunca texto livre: nome
  // digitado errado sumia das métricas por atendente.
  const [usuarios, setUsuarios] = useState<string[]>([]);
  // Modal de registro de atendimento DENTRO da conversa — o gesto mais repetido
  // do dia não pode exigir voltar ao kanban para achar a pessoa de novo.
  const [registrando, setRegistrando] = useState(false);
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [showDesempenho, setShowDesempenho] = useState(false);
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

  // ---- Guardas de corrida ---------------------------------------------------
  // O GET do thread passa pelo Unnichat (latência variável): clicando em A e
  // logo em B, a resposta de A pode chegar DEPOIS e pintar a conversa errada.
  // Cada abrir() incrementa a sequência e aborta o fetch anterior; respostas de
  // sequência velha são descartadas. O mesmo vale entre dois carregarConversas
  // (troca de filtro × tick do poll) via filaSeqRef.
  const abrirSeqRef = useRef(0);
  const threadAbortRef = useRef<AbortController | null>(null);
  const selIdRef = useRef<string | null>(null);
  const threadCacheRef = useRef(new Map<string, ThreadCache>());
  const filaSeqRef = useRef(0);
  const filaJsonRef = useRef("");
  // O operador está no fim do chat? Atualizado no onScroll (ref: não re-renderiza).
  const nearBottomRef = useRef(true);
  const threadKeyRef = useRef<string | null>(null);
  const falhasPollRef = useRef(0);
  const pollMontouRef = useRef(false);

  // Relógio de minuto: faz "aguardando X min" avançar na fila/header sem fetch.
  // Um re-render por minuto é barato — FilaItem/Bolha são memoizados.
  const [agoraMin, setAgoraMin] = useState(() => Math.floor(Date.now() / 60000));
  useEffect(() => {
    const t = setInterval(() => setAgoraMin(Math.floor(Date.now() / 60000)), 30000);
    return () => clearInterval(t);
  }, []);

  // Templates de abertura (WhatsApp) do evento — o que reabre a janela de 24h.
  useEffect(() => {
    fetch(`/api/templates?evento=${evento}`)
      .then((r) => r.json())
      .then((d) => { if (d.ok) setTemplates((d.templates as TemplateItem[]).filter((t) => t.ativo && t.canal !== "email")); })
      .catch(() => {});
  }, [evento]);

  // "Atendendo como" nasce do usuário LOGADO (antes era texto livre em
  // localStorage: nome abreviado ou errado sumia das métricas). Atender em nome
  // de outra pessoa continua possível — trocando no select, e só até recarregar:
  // a cada sessão o padrão volta a ser quem está logado.
  useEffect(() => { if (me) setAtendente((atual) => atual || me.nome); }, [me]);
  useEffect(() => {
    fetch("/api/usuarios")
      .then((r) => r.json())
      .then((d) => { if (d.ok) setUsuarios((d.usuarios as { nome: string; ativo: boolean }[]).filter((u) => u.ativo).map((u) => u.nome)); })
      .catch(() => { /* sem lista, o select fica só com o próprio usuário */ });
  }, []);

  const carregarConversas = useCallback(async () => {
    const seq = ++filaSeqRef.current;
    const qs = modoDisparo ? `&disparo=${modoDisparo}` : (filtro ? `&status=${filtro}` : "");
    const r = await fetch(`${inboxBase}?evento=${evento}${qs}`);
    const d = await r.json();
    if (seq !== filaSeqRef.current) return; // resposta velha (filtro trocou ou outro tick já passou)
    if (d.ok) {
      // Só troca o array se algo de fato mudou — senão o poll de 12s
      // re-renderizava a fila inteira à toa, mesmo sem novidade.
      const json = JSON.stringify(d.conversas);
      if (json !== filaJsonRef.current) {
        filaJsonRef.current = json;
        setConversas(d.conversas);
      }
      setPendentes(d.pendentes ?? 0);
    }
  }, [filtro, evento, modoDisparo, inboxBase]);
  const carregarMetricas = useCallback(async () => {
    // Métricas de atendimento ainda não existem para o HM (overlay próprio) — adiado.
    if (evento === "HM") { setMetricas(null); return; }
    const r = await fetch(`/api/inbox/metricas?evento=${evento}`);
    const d = await r.json();
    if (d.ok) setMetricas(d);
  }, [evento]);

  useEffect(() => { void carregarMetricas().catch(() => {}); }, [carregarMetricas]);

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
    const seq = ++abrirSeqRef.current;
    threadAbortRef.current?.abort();
    const ctrl = new AbortController();
    threadAbortRef.current = ctrl;
    selIdRef.current = c.comprador_id;
    nearBottomRef.current = true;
    setSel(c); setTplSel("");
    ultimaMsgRef.current = c.ultima_msg_em; // sincroniza: abrir já traz o thread
    const cache = threadCacheRef.current.get(c.comprador_id);
    if (cache) {
      // Conversa já vista: pinta na hora com a última versão e revalida em fundo.
      setMensagens(cache.mensagens); setAviso(cache.aviso); setJanela(cache.janela);
      setCarregandoMsg(false);
    } else {
      setMensagens([]); setAviso(null); setJanela(null);
      setCarregandoMsg(true);
    }
    try {
      const r = await fetch(`${inboxBase}/${c.comprador_id}?evento=${evento}`, { signal: ctrl.signal });
      const d = await r.json();
      if (seq !== abrirSeqRef.current) return; // chegou tarde: outra conversa já foi aberta
      if (d.ok) {
        const fresco: ThreadCache = { mensagens: d.mensagens, aviso: d.aviso ?? null, janela: d.janela ?? null };
        threadCacheRef.current.set(c.comprador_id, fresco);
        setMensagens(fresco.mensagens); setAviso(fresco.aviso); setJanela(fresco.janela);
      }
    } catch { /* abort (troca de conversa) ou rede — o poll recupera depois */ }
    finally { if (seq === abrirSeqRef.current) setCarregandoMsg(false); }
  }, [inboxBase, evento]);

  // Recarrega SÓ as mensagens da conversa aberta, sem limpar a tela nem mostrar
  // spinner — é o refresh silencioso do polling quando o lead responde, para não
  // piscar a conversa a cada ciclo.
  const recarregarThread = useCallback(async (compradorId: string) => {
    const seq = abrirSeqRef.current;
    try {
      const r = await fetch(`${inboxBase}/${compradorId}?evento=${evento}`);
      const d = await r.json();
      // Descarta se o operador trocou de conversa enquanto a resposta viajava.
      if (seq !== abrirSeqRef.current || selIdRef.current !== compradorId) return;
      if (d.ok) {
        const fresco: ThreadCache = { mensagens: d.mensagens, aviso: d.aviso ?? null, janela: d.janela ?? null };
        threadCacheRef.current.set(compradorId, fresco);
        setMensagens(fresco.mensagens); setAviso(fresco.aviso); setJanela(fresco.janela);
      }
    } catch { /* silencioso: é atualização de fundo */ }
  }, [inboxBase, evento]);

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
        toast("Template de abertura enviado — quando o lead responder, a conversa reabre.");
        void carregarConversas().catch(() => {});
      } else {
        toast(d.motivo || d.reason || "Não foi possível enviar o template de abertura.", "erro");
      }
    } catch {
      toast("Falha ao enviar o template. Tente novamente.", "erro");
    } finally {
      setEnviandoTpl(false);
    }
  }

  // Quando a lista carrega e há um deep-link pendente, seleciona a conversa-alvo.
  useEffect(() => {
    if (!deepLink || !conversas.length) return;
    const c = conversas.find((x) => x.comprador_id === deepLink);
    if (c) { void abrir(c); setDeepLink(null); }
  }, [deepLink, conversas, abrir]);

  // Auto-scroll educado: só arrasta para o fim quando (a) trocou de conversa,
  // (b) o próprio operador acabou de enviar (bolha otimista tmp-*), ou (c) ele
  // JÁ estava no fim. Quem rolou para cima lendo o histórico fica onde está.
  useEffect(() => {
    const el = chatRef.current;
    if (!el) return;
    const chave = sel?.comprador_id ?? null;
    const trocouConversa = threadKeyRef.current !== chave;
    threadKeyRef.current = chave;
    const ultima = mensagens[mensagens.length - 1];
    const acabeiDeEnviar = !!ultima && ultima.id.startsWith("tmp-");
    if (trocouConversa || acabeiDeEnviar || nearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [mensagens, sel]);

  // Poll adaptativo (setTimeout encadeado, não setInterval):
  // - aba VISÍVEL: a cada ~12s puxa a fila e pede ao servidor o sync do Unnichat
  //   (é isto que faz a resposta do lead "aparecer sozinha");
  // - aba em SEGUNDO PLANO: cai para 1 GET/min só da fila (mantém o contador do
  //   título e o bip) e NÃO faz sync — uma aba esquecida à noite custa ~90% menos;
  // - voltou o foco: refetch imediato;
  // - erro: backoff exponencial (24s→48s→96s, teto 2min) com jitter para dez
  //   operadores não martelarem o servidor em uníssono.
  useEffect(() => {
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const agendar = (ms: number) => {
      timer = setTimeout(() => { void ciclo(); }, ms + Math.random() * ms * 0.15);
    };

    const ciclo = async () => {
      if (!vivo) return;
      try {
        if (document.hidden) {
          await carregarConversas();
          falhasPollRef.current = 0;
          agendar(60000);
          return;
        }
        await carregarConversas();
        const r = await fetch(`/api/inbox/sync?evento=${evento}`, { method: "POST" });
        const d = await r.json();
        // Se o sync trouxe algo novo, recarrega a fila para a conversa subir na hora.
        if (d.ok && d.novas > 0) await carregarConversas();
        falhasPollRef.current = 0;
        agendar(12000);
      } catch {
        falhasPollRef.current += 1;
        agendar(Math.min(12000 * 2 ** falhasPollRef.current, 120000));
      }
    };

    if (!pollMontouRef.current) {
      // Primeira entrada na tela: ciclo completo (fila + sync) já de cara.
      pollMontouRef.current = true;
      void ciclo();
    } else {
      // Troca de filtro/evento: só a fila — antes cada troca disparava DOIS GET
      // (efeito próprio + puxar() imediato do poll) e mais um POST de sync.
      void carregarConversas().catch(() => {});
      agendar(12000);
    }

    const aoMudarVisibilidade = () => {
      if (!document.hidden) { clearTimeout(timer); void ciclo(); }
    };
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      vivo = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [carregarConversas, evento]);

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
    if (!sel) { ultimaMsgRef.current = null; selIdRef.current = null; return; }
    const atual = conversas.find((c) => c.comprador_id === sel.comprador_id);
    const marca = atual?.ultima_msg_em ?? null;
    if (marca && marca !== ultimaMsgRef.current) {
      if (ultimaMsgRef.current !== null && !atual?.ultima_de_cs) void recarregarThread(sel.comprador_id);
      ultimaMsgRef.current = marca;
    }
  }, [conversas, sel, recarregarThread]);

  // A janela de 24h pode EXPIRAR com a conversa aberta — sem isto o input
  // seguia liberado até o envio falhar. Um timer local vira a chave na hora
  // certa e o composer dá lugar ao banner de template.
  useEffect(() => {
    if (!janela?.aberta || !janela.expiraEm) return;
    const ms = new Date(janela.expiraEm).getTime() - Date.now();
    const fechar = () => setJanela((j) => (j ? { ...j, aberta: false } : j));
    if (ms <= 0) { fechar(); return; }
    const t = setTimeout(fechar, Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [janela]);

  // Envio da resposta — otimista: a bolha aparece na hora; se o servidor recusar,
  // some e o composer decide se devolve o texto (só quando o campo está vazio).
  const enviarMensagem = useCallback(async (txt: string): Promise<boolean> => {
    if (!sel) return false;
    const tmpId = `tmp-${Date.now()}`;
    const bolha: Mensagem = { id: tmpId, de: "cs", tipo: "message", texto: txt, data: new Date().toISOString() };
    setMensagens((m) => [...m, bolha]);
    try {
      const r = await fetch(`${inboxBase}/${sel.comprador_id}?evento=${evento}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: txt, atendente: atendente || undefined }),
      });
      const d = await r.json();
      if (!d.ok) {
        setMensagens((m) => m.filter((x) => x.id !== tmpId));
        toast(d.reason || "Falha ao enviar (a janela de 24h pode estar fechada).", "erro");
        return false;
      }
      // Mantém o cache do thread coerente até a próxima revalidação.
      const cache = threadCacheRef.current.get(sel.comprador_id);
      if (cache) threadCacheRef.current.set(sel.comprador_id, { ...cache, mensagens: [...cache.mensagens, bolha] });
      // Atualiza lista e métricas em segundo plano (banco, rápido) — não trava o input.
      void carregarConversas().catch(() => {});
      void carregarMetricas().catch(() => {});
      return true;
    } catch {
      setMensagens((m) => m.filter((x) => x.id !== tmpId));
      toast("Falha ao enviar. Tente novamente.", "erro");
      return false;
    }
  }, [sel, inboxBase, evento, atendente, carregarConversas, carregarMetricas]);

  // Resolver/reabrir otimista: a tela muda na hora, o servidor confirma em fundo —
  // antes o botão esperava fila + métricas para liberar.
  const resolver = useCallback(async (c: Conversa, status: "resolvido" | "pendente") => {
    setSel((s) => (s && s.comprador_id === c.comprador_id ? { ...s, inbox_status: status } : s));
    setConversas((ls) => ls.map((x) => (x.comprador_id === c.comprador_id ? { ...x, inbox_status: status } : x)));
    setPendentes((p) => (status === "resolvido" ? Math.max(0, p - 1) : p + 1));
    filaJsonRef.current = ""; // força o próximo fetch da fila a aplicar a verdade do servidor
    try {
      const r = await fetch(`${inboxBase}/${c.comprador_id}?evento=${evento}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      if (!r.ok) throw new Error();
    } catch {
      toast("Não foi possível atualizar o status — recarregando a fila.", "erro");
    } finally {
      void carregarConversas().catch(() => {});
      void carregarMetricas().catch(() => {});
    }
  }, [inboxBase, evento, carregarConversas, carregarMetricas]);

  // Busca client-side na fila: achar 1 lead entre 200 sem scroll manual.
  const visiveis = useMemo(() => {
    // Regras em lib/busca.ts — o que muda aqui é que acento deixou de importar
    // ("joao" acha "João"); o mínimo de 2 dígitos do telefone fica como era,
    // porque numa fila curta faz sentido e foi escolha desta tela.
    const q = busca.trim();
    if (!q) return conversas;
    return conversas.filter((c) => casaBusca(q, { texto: [c.nome], numero: [c.telefone], minDigitos: 2 }));
  }, [conversas, busca]);

  // Teclado: ↑/↓ navegam a fila, E resolve a conversa aberta. Ignora quando o
  // foco está num campo — digitar nunca dispara atalho.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const tag = alvo?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || alvo?.isContentEditable) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (!visiveis.length) return;
        e.preventDefault();
        const i = visiveis.findIndex((c) => c.comprador_id === sel?.comprador_id);
        const prox = i === -1
          ? (e.key === "ArrowDown" ? 0 : visiveis.length - 1)
          : Math.min(Math.max(i + (e.key === "ArrowDown" ? 1 : -1), 0), visiveis.length - 1);
        if (prox === i) return;
        const c = visiveis[prox];
        void abrir(c);
        requestAnimationFrame(() => {
          document.querySelector(`[data-conversa-id="${c.comprador_id}"]`)?.scrollIntoView({ block: "nearest" });
        });
      } else if ((e.key === "e" || e.key === "E") && !e.ctrlKey && !e.metaKey && !e.altKey && sel && sel.inbox_status === "pendente") {
        e.preventDefault();
        void resolver(sel, "resolvido");
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [visiveis, sel, abrir, resolver]);

  const k = metricas?.kpis;
  const slaMin = k?.sla_min ?? 15;

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
          <label htmlFor="inbox-atendente">Atendendo como</label>
          <select
            id="inbox-atendente"
            value={atendente}
            onChange={(e) => setAtendente(e.target.value)}
            title={me && atendente && atendente !== me.nome ? `Atendendo em nome de ${atendente} — você está logado como ${me.nome}` : "Quem assina as respostas nas métricas de atendimento"}
            className="max-w-[11rem] rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            {/* União: lista de ativos + o logado (se a lista falhar, ele sempre existe). */}
            {[...new Set([...(me ? [me.nome] : []), ...usuarios, ...(atendente ? [atendente] : [])])].map((n) => (
              <option key={n} value={n}>{me && n === me.nome ? `${n} (você)` : n}</option>
            ))}
          </select>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setShowDesempenho(true)}>Desempenho</Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* "Pendentes agora" vem da PRÓPRIA fila (poll de segundos) — as métricas
            só carregam no mount e ficavam defasadas o dia todo. */}
        <KpiCS label="Pendentes agora" valor={pendentes} tom={pendentes > 0 ? "rose" : "emerald"}
          sub={k?.maior_espera_min != null ? `pior espera ${fmtMin(k.maior_espera_min)}` : "tudo em dia"} />
        <KpiCS label="1º contato (hoje)" valor={fmtMin(k?.frt_hoje)} tom="brand" sub={`média geral ${fmtMin(k?.frt_medio)}`} />
        <KpiCS label="Atendidas hoje" valor={k?.atendidas_hoje ?? 0} tom="sky" sub={`${k?.total_atendimentos ?? 0} no total`} />
        {/* 11/08: o tom era `emerald` fixo — 0% de SLA aparecia em VERDE, ou
            seja, a cor dizia "tudo bem" no pior cenário possível. Agora ela
            segue o número: >=80% verde, >=50% âmbar, abaixo disso vermelho. */}
        <KpiCS
          label={`Dentro do SLA (${slaMin}min)`}
          valor={k?.sla_pct != null ? `${k.sla_pct}%` : "—"}
          tom={k?.sla_pct == null ? "slate" : k.sla_pct >= 80 ? "emerald" : k.sla_pct >= 50 ? "amber" : "rose"}
          sub="1º contato no prazo"
        />
      </div>

      {modoDisparo && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2 dark:border-brand-400/20 dark:bg-brand-400/5">
          <span className="text-sm text-brand-700 dark:text-brand-300">
            Mostrando os leads deste disparo, na ordem em que a mensagem saiu — as respostas aparecem aqui conforme chegam.
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

          {/* Busca na fila — filtra o que já está carregado, sem ida ao servidor. */}
          <div className="border-b border-slate-100 px-2 py-1.5 dark:border-slate-800">
            <div className="relative">
              <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") { setBusca(""); e.currentTarget.blur(); }
                  if (e.key === "Enter" && visiveis.length) { void abrir(visiveis[0]); e.currentTarget.blur(); }
                }}
                placeholder="Buscar nome ou telefone…"
                aria-label="Buscar conversa por nome ou telefone"
                className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-xs text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/10 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-400 dark:focus:ring-brand-400/15"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {visiveis.length === 0 ? (
              <div className="p-4">
                {conversas.length > 0 && busca.trim() ? (
                  <EmptyState title="Nenhum resultado" description={`Nenhuma conversa combina com “${busca.trim()}” nesta aba.`} />
                ) : (
                  <EmptyState title="Nada por aqui" description={filtro === "pendente" ? "Nenhuma conversa aguardando resposta. 🎉" : "Quando um lead responder, aparece aqui."} />
                )}
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {visiveis.map((c) => (
                  <FilaItem
                    key={c.comprador_id}
                    c={c}
                    ativo={sel?.comprador_id === c.comprador_id}
                    slaMin={slaMin}
                    agoraMin={agoraMin}
                    meuNome={atendente || me?.nome || ""}
                    onAbrir={abrir}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="hidden border-t border-slate-100 px-3 py-1.5 text-center text-[10px] text-slate-400 dark:border-slate-800 dark:text-slate-500 lg:block">
            <kbd className="rounded border border-slate-200 px-1 dark:border-slate-700">↑</kbd> <kbd className="rounded border border-slate-200 px-1 dark:border-slate-700">↓</kbd> navegam a fila · <kbd className="rounded border border-slate-200 px-1 dark:border-slate-700">E</kbd> resolve a conversa aberta
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
                {/* Registrar atendimento SEM sair da conversa — antes eram três
                    telas (inbox → kanban → ficha) para o gesto mais repetido do
                    dia, e na prática ninguém registrava. */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setRegistrando(true)}
                  disabled={!sel.telefone}
                  title={sel.telefone ? "Registrar o atendimento desta conversa" : "Contato sem telefone — não dá para registrar atendimento"}
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" /></svg>
                  Registrar
                </Button>
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
                  ? <Button variant="secondary" size="sm" onClick={() => void resolver(sel, "resolvido")} title="Marcar como resolvida (tecla E)">Resolver</Button>
                  : <Button variant="ghost" size="sm" onClick={() => void resolver(sel, "pendente")}>Reabrir</Button>}
              </header>

              <div
                ref={chatRef}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  // Margem de tolerância: "perto do fim" conta como no fim.
                  nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                }}
                className="min-h-0 flex-1 space-y-2 overflow-auto bg-[#ECE5DD] p-4 dark:bg-slate-800"
              >
                {carregandoMsg && <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-600 dark:text-slate-300"><Spinner /> Carregando conversa…</div>}
                {aviso && <div className="mx-auto w-fit max-w-[85%] rounded-full bg-amber-50 px-3 py-1 text-center text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30">{aviso}</div>}
                {mensagens.map((m) => <Bolha key={m.id} m={m} />)}
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
                /* key = comprador: trocar de conversa zera o campo e refaz o autoFocus. */
                <InboxComposer key={sel.comprador_id} onEnviar={enviarMensagem} expiraEm={janela?.expiraEm ?? null} />
              )}
            </>
          )}
        </section>
      </Card>

      {showDesempenho && metricas && (
        <Desempenho metricas={metricas} onClose={() => setShowDesempenho(false)} />
      )}

      {/* O MESMO modal do meu-dia e da ficha — um endpoint, um caminho de escrita.
          Canal já vem como WhatsApp: a conversa aconteceu aqui. */}
      {registrando && sel?.telefone && (
        <RegistrarAtendimento
          compradorId={sel.comprador_id}
          nome={sel.nome}
          telefone={sel.telefone}
          canalInicial="whatsapp"
          onClose={() => setRegistrando(false)}
          onSalvo={() => { setRegistrando(false); void carregarMetricas().catch(() => {}); }}
        />
      )}
    </PageFade>
  );
}

const KPI_TOM: Record<string, string> = {
  brand: "text-brand dark:text-brand-300", rose: "text-rose-600 dark:text-rose-400",
  emerald: "text-emerald-600 dark:text-emerald-400", sky: "text-sky-600 dark:text-sky-400",
  // 11/08: faltavam o meio-termo e o neutro — sem eles, um indicador ruim só
  // tinha "verde" para exibir, que foi o caso do SLA em 0%.
  amber: "text-amber-600 dark:text-amber-400", slate: "text-slate-500 dark:text-slate-400",
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

        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Por operador</h3>
        {metricas.porAtendente.length === 0 ? (
          <p className="py-3 text-sm text-slate-400 dark:text-slate-500">Ainda não há atendimentos registrados.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr><th className="px-3 py-2 font-semibold">Operador</th><th className="px-3 py-2 font-semibold">Atendimentos</th><th className="px-3 py-2 font-semibold">1º contato médio</th><th className="px-3 py-2 font-semibold">SLA</th></tr>
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
