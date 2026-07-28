"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, cn, fieldClass } from "@/app/_components/ui";
import { toast } from "@/app/_components/toast";

// Registro de ATENDIMENTO do operador — ligação, WhatsApp ou presencial.
// Depois que o Atende Simples saiu, este é o único caminho de escrita: nada mais
// chega por webhook de discador. O histórico do discador continua aparecendo
// aqui, no mesmo lugar, junto com o que o operador registra.
//
// O modal é usado em dois lugares (a ficha do contato e a tela "Meu dia") e os
// dois gravam pelo MESMO endpoint — nada de dois caminhos para o mesmo dado.

export type Atendimento = {
  id: string;
  telefone: string;
  canal: string;
  operador: string | null;
  resultado: string | null;
  duracaoSeg: number | null;
  anotacao: string | null;
  retornoEm: string | null;
  urlGravacao: string | null;
  status: string;
  criadoEm: string;
};

export type CanalAtendimento = "ligacao" | "whatsapp" | "presencial" | "outro";

const CANAIS: { v: CanalAtendimento; label: string; icone: string }[] = [
  { v: "ligacao", label: "Ligação", icone: "📞" },
  { v: "whatsapp", label: "WhatsApp", icone: "💬" },
  { v: "presencial", label: "Presencial", icone: "🤝" },
];

// O valor gravado é o mesmo em todo canal ('atendeu' = houve conversa); só o
// rótulo muda, porque ninguém "atende" um WhatsApp — responde. Um dado, a
// linguagem certa em cada contexto.
const RESULTADOS: { v: string; label: Record<CanalAtendimento, string>; tom: string }[] = [
  {
    v: "atendeu",
    label: { ligacao: "Atendeu", whatsapp: "Respondeu", presencial: "Compareceu", outro: "Falou" },
    tom: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
  },
  {
    v: "nao_atendeu",
    label: { ligacao: "Não atendeu", whatsapp: "Sem resposta", presencial: "Não compareceu", outro: "Não falou" },
    tom: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  },
  {
    v: "caixa_postal",
    label: { ligacao: "Caixa postal", whatsapp: "Caixa postal", presencial: "Caixa postal", outro: "Caixa postal" },
    tom: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30",
  },
  {
    v: "ocupado",
    label: { ligacao: "Ocupado", whatsapp: "Ocupado", presencial: "Ocupado", outro: "Ocupado" },
    tom: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:ring-violet-500/30",
  },
  {
    v: "numero_errado",
    label: { ligacao: "Número errado", whatsapp: "Número errado", presencial: "Número errado", outro: "Número errado" },
    tom: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  },
];

// Resultados que só existem no histórico do discador — exibição apenas.
const TOM_EXTRA: Record<string, string> = {
  abandonou: "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-500/30",
  recusada: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
  falhou: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30",
};
const LABEL_EXTRA: Record<string, string> = { abandonou: "Abandonada", recusada: "Recusada", falhou: "Falhou" };

export function rotuloDe(resultado: string, canal: string): string {
  const r = RESULTADOS.find((x) => x.v === resultado);
  if (r) return r.label[(canal as CanalAtendimento) ?? "ligacao"] ?? r.label.ligacao;
  return LABEL_EXTRA[resultado] ?? resultado;
}
function tomDe(resultado: string): string {
  return RESULTADOS.find((x) => x.v === resultado)?.tom ?? TOM_EXTRA[resultado] ?? "bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700";
}
const iconeCanal = (c: string) => CANAIS.find((x) => x.v === c)?.icone ?? "•";

const telLink = (t: string) => `tel:${(t || "").replace(/[^0-9+]/g, "")}`;
const zapLink = (t: string) => `https://wa.me/${(t || "").replace(/\D/g, "")}`;

function relativo(iso: string | null) {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min}min`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}
// Date → valor de <input type="datetime-local"> no fuso LOCAL do operador
// (toISOString converteria para UTC e o retorno cairia na hora errada).
function paraInputLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
// Atalhos do "agendar retorno" — os três retornos que o operador mais marca,
// sem abrir o seletor de data.
const ATALHOS_RETORNO: { label: string; quando: () => Date }[] = [
  { label: "+30min", quando: () => new Date(Date.now() + 30 * 60_000) },
  { label: "+1h", quando: () => new Date(Date.now() + 60 * 60_000) },
  {
    label: "Amanhã 9h",
    quando: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; },
  },
];

const PhoneIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" /></svg>
);

// ---- Histórico + botão, na ficha do contato --------------------------------
export function CardLigacoes({ compradorId, telefone, onRegistrado, somenteLeitura }: {
  compradorId: string; telefone: string | null; onRegistrado?: () => void;
  // Ficha de lead de OUTRO operador (28/07): a lista de atendimentos é leitura
  // (o ponto é ver as ações dos colegas); registrar é agir — o botão some.
  somenteLeitura?: boolean;
}) {
  const [itens, setItens] = useState<Atendimento[]>([]);
  const [aberto, setAberto] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/ligacoes?comprador_id=${compradorId}`);
    const d = await r.json();
    if (d.ok) setItens(d.ligacoes);
  }, [compradorId]);
  useEffect(() => { carregar(); }, [carregar]);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Atendimentos</h2>
        {!somenteLeitura && (
          <Button variant="primary" className="h-8 gap-1.5 px-3 text-xs" onClick={() => setAberto(true)} disabled={!telefone}>
            <PhoneIcon className="h-3.5 w-3.5" /> Registrar
          </Button>
        )}
      </div>
      {!telefone && <p className="mt-2 text-xs text-rose-500 dark:text-rose-400">Sem telefone cadastrado.</p>}

      <div className="mt-3 space-y-2">
        {itens.map((l) => (
          <div key={l.id} className="flex items-start gap-2 rounded-lg border border-slate-100 p-2 text-xs dark:border-slate-800">
            <span className="mt-0.5 shrink-0" aria-hidden>{iconeCanal(l.canal)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                {l.resultado
                  ? <span className={cn("rounded-full px-1.5 py-0.5 font-medium ring-1 ring-inset", tomDe(l.resultado))}>{rotuloDe(l.resultado, l.canal)}</span>
                  : <span className="rounded-full bg-slate-100 px-1.5 py-0.5 font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">{l.status === "iniciada" ? "Em andamento" : "—"}</span>}
                {l.duracaoSeg ? <span className="text-slate-400">{Math.max(1, Math.round(l.duracaoSeg / 60))}min</span> : null}
                {l.urlGravacao && <a href={l.urlGravacao} target="_blank" rel="noreferrer" className="text-brand hover:underline dark:text-brand-300">áudio</a>}
                <span className="ml-auto text-slate-400">{relativo(l.criadoEm)}</span>
              </div>
              {l.anotacao && <p className="mt-0.5 text-slate-600 dark:text-slate-300">{l.anotacao}</p>}
              <p className="mt-0.5 text-[11px] text-slate-400">{l.operador || "—"}{l.retornoEm ? ` · retorno ${new Date(l.retornoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}</p>
            </div>
          </div>
        ))}
        {itens.length === 0 && <p className="py-2 text-center text-xs text-slate-400 dark:text-slate-500">Nenhum atendimento ainda.</p>}
      </div>

      {aberto && telefone && (
        <RegistrarAtendimento
          compradorId={compradorId}
          nome={null}
          telefone={telefone}
          onClose={() => setAberto(false)}
          onSalvo={() => { setAberto(false); carregar(); onRegistrado?.(); }}
        />
      )}
    </Card>
  );
}

// ---- O registro em si ------------------------------------------------------
// Rápido de propósito: o resultado sai num número (1 a 5), Enter salva, Esc
// fecha. Registrar não pode custar mais que o atendimento em si — se custar, o
// operador deixa de registrar, e aí o painel mente.
export function RegistrarAtendimento({
  compradorId, nome, telefone, canalInicial = "ligacao", onClose, onSalvo,
}: {
  compradorId: string;
  nome: string | null;
  telefone: string;
  canalInicial?: CanalAtendimento;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [canal, setCanal] = useState<CanalAtendimento>(canalInicial);
  const [resultado, setResultado] = useState("atendeu");
  const [duracao, setDuracao] = useState("");
  const [anotacao, setAnotacao] = useState("");
  const [retorno, setRetorno] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const salvarRef = useRef<() => void>(() => {});

  const salvar = useCallback(async () => {
    if (salvando) return;
    setErro(null);
    // Duração digitada na mão: valida antes de gravar — negativo ou não-número
    // viraria métrica lixo em silêncio.
    const durMin = duracao.trim() ? parseFloat(duracao.replace(",", ".")) : null;
    if (durMin !== null && (!Number.isFinite(durMin) || durMin < 0)) {
      setErro("Duração inválida — use minutos, ex: 3 ou 2,5.");
      return;
    }
    setSalvando(true);
    const body: Record<string, unknown> = { compradorId, telefone, canal, resultado };
    if (durMin !== null) body.duracaoSeg = Math.round(durMin * 60);
    if (anotacao.trim()) body.anotacao = anotacao.trim();
    if (retorno) body.retornoEm = new Date(retorno).toISOString();
    try {
      const r = await fetch("/api/ligacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!d.ok) { setErro(d.reason || "Não foi possível salvar."); setSalvando(false); return; }
      // Confirmação visível ANTES de fechar — sem ela o operador ficava na
      // dúvida se gravou e registrava duas vezes.
      toast(retorno ? "Atendimento registrado · retorno agendado" : "Atendimento registrado");
      onSalvo();
    } catch {
      setErro("Falha de conexão.");
      setSalvando(false);
    }
  }, [salvando, compradorId, telefone, canal, resultado, duracao, anotacao, retorno, onSalvo]);

  salvarRef.current = salvar;

  // Atalhos: número escolhe o resultado, Enter salva, Esc fecha. Dentro do
  // textarea, Enter é quebra de linha — só Ctrl+Enter salva, senão o operador
  // perde a anotação no meio da frase.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement | null;
      const digitando = alvo?.tagName === "TEXTAREA" || alvo?.tagName === "INPUT";

      if (e.key === "Escape") { onClose(); return; }
      if (e.key === "Enter" && (!digitando || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        salvarRef.current();
        return;
      }
      if (!digitando && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        setResultado(RESULTADOS[Number(e.key) - 1].v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            Registrar atendimento{nome ? <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">{nome}</span> : null}
          </h3>
          <button onClick={onClose} aria-label="Fechar" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </div>

        {/* Canal */}
        <div className="mt-3 inline-flex w-full rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-900/60">
          {CANAIS.map((c) => (
            <button
              key={c.v}
              type="button"
              onClick={() => setCanal(c.v)}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition",
                canal === c.v ? "bg-white shadow-sm text-slate-800 dark:bg-slate-800 dark:text-slate-100" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
              )}
            >
              {c.icone} {c.label}
            </button>
          ))}
        </div>

        {/* Abrir o canal escolhido, sem sair da tela */}
        {canal === "ligacao" ? (
          <a href={telLink(telefone)} className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700">
            <PhoneIcon className="h-4 w-4" /> Discar {telefone}
          </a>
        ) : canal === "whatsapp" ? (
          <a href={zapLink(telefone)} target="_blank" rel="noreferrer" className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700">
            💬 Abrir conversa
          </a>
        ) : null}

        <label className="mt-4 block text-xs font-medium text-slate-500 dark:text-slate-400">
          Resultado <span className="text-slate-400 dark:text-slate-600">· teclas 1 a 5</span>
        </label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {RESULTADOS.map((r, i) => (
            <button
              key={r.v}
              type="button"
              onClick={() => setResultado(r.v)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition",
                resultado === r.v ? r.tom : "bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700",
              )}
            >
              <span className="mr-1 opacity-50">{i + 1}</span>{r.label[canal]}
            </button>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Duração (min)</label>
            <input value={duracao} onChange={(e) => setDuracao(e.target.value)} inputMode="decimal" placeholder="ex: 3" className={cn(fieldClass, "mt-1")} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400">Agendar retorno</label>
            <input type="datetime-local" value={retorno} onChange={(e) => setRetorno(e.target.value)} className={cn(fieldClass, "mt-1")} />
          </div>
        </div>

        {/* Atalhos de retorno — type="button" para não disparar o Enter-salva. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {ATALHOS_RETORNO.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={() => setRetorno(paraInputLocal(a.quando()))}
              className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500 transition hover:border-brand/30 hover:bg-brand/5 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:border-brand-400/30 dark:hover:bg-brand-400/10 dark:hover:text-slate-200"
            >
              {a.label}
            </button>
          ))}
          {retorno && (
            <button
              type="button"
              onClick={() => setRetorno("")}
              className="rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-400 transition hover:text-rose-500 dark:text-slate-500 dark:hover:text-rose-400"
            >
              limpar
            </button>
          )}
        </div>

        <label className="mt-3 block text-xs font-medium text-slate-500 dark:text-slate-400">Anotação</label>
        <textarea value={anotacao} onChange={(e) => setAnotacao(e.target.value)} rows={3} placeholder="Como foi a conversa, próximo passo…" className={cn(fieldClass, "mt-1 resize-none")} />

        {erro && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{erro}</p>}

        <div className="mt-4 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" className="flex-1" onClick={salvar} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar (Enter)"}
          </Button>
        </div>
      </div>
    </div>
  );
}
