"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button, Card, EmptyState, PageHeader, Spinner, cn } from "@/app/_components/ui";
import { Portal } from "@/app/_components/portal";
import { usePortal } from "@/app/_components/use-portal";

type Selecionado = { comprador_id: string; nome: string; telefone?: string; edicao?: string | null };
type StatusTag = "pronta" | "pausada" | "sem_automacao" | "desconhecido";
type Veredito = { status: StatusTag; automacao: string | null; multientry: boolean; pronto: boolean; rotulo: string; detalhe: string };
type Modo = "campanha" | "tag";
type TemplateEmail = {
  id: string; nome: string; ac_tag_id: string | null; ativo: boolean;
  modo: Modo; assunto: string | null; veredito?: Veredito;
};
type Progresso = {
  disparo: { status: string; total_contatos: number; total_enviados: number; total_erros: number };
  resumo: { total: number; enviados: number; erros: number };
  contatos: { id: string; comprador_id: string | null; nome: string | null; email: string; enviado: boolean; erro: string | null }[];
};

// Disparo de E-MAIL (ActiveCampaign). Espelho enxuto de <Disparo> (WhatsApp): o
// operador escolhe um template de e-mail (que aponta para uma tag do AC) e o
// sistema aplica a tag nos contatos selecionados, acionando a automação. O
// e-mail de cada contato é resolvido no servidor (cs.contatos_evento).
export function DisparoEmail({ selecaoInicial, aoFechar }: { selecaoInicial?: Selecionado[]; aoFechar?: () => void }) {
  const { evento, base } = usePortal();
  const wrap = aoFechar ? "animate-fade-in" : "mx-auto max-w-3xl animate-fade-in";
  const [selecao] = useState<Selecionado[]>(selecaoInicial ?? []);
  const [templates, setTemplates] = useState<TemplateEmail[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [disparoId, setDisparoId] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`/api/templates?evento=${evento}&canal=email`)
      .then((r) => r.json())
      .then((d) => d.ok && setTemplates(d.templates.filter((t: TemplateEmail) => t.ativo)))
      .catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [evento]);

  const template = templates.find((t) => t.id === templateId);
  // Bloqueio "às cegas": só existe no modo legado (tag), onde o e-mail depende de
  // uma automação montada no AC. A campanha direta não depende de nada lá dentro
  // — o corpo é nosso — então nunca bloqueia por veredito.
  const bloqueado = !!template?.veredito && !template.veredito.pronto;
  // Quantos templates realmente disparam. Campanha direta está sempre pronta.
  const prontos = templates.filter((t) => t.modo === "campanha" || t.veredito?.pronto).length;

  async function disparar() {
    if (!templateId || selecao.length === 0) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/send-email?evento=${evento}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, compradorIds: selecao.map((s) => s.comprador_id) }),
      });
      const d = await r.json();
      if (!d.ok) {
        // O remetente não configurado é o tropeço mais provável na estreia da
        // campanha direta: mostra o caminho, em vez de um alert genérico.
        setErro(d.motivo || d.reason || "Falha ao iniciar disparo de e-mail");
        setEnviando(false);
        return;
      }
      setShowConfirm(false);
      setDisparoId(d.disparoId);
      iniciarPolling(d.disparoId);
    } catch {
      setErro("Falha de conexão ao iniciar o disparo.");
      setEnviando(false);
    }
  }

  function iniciarPolling(id: string) {
    const tick = async () => {
      const r = await fetch(`/api/email/disparos/${id}`);
      const d = await r.json();
      if (d.ok) {
        setProgresso(d);
        if (d.disparo.status === "concluido") {
          if (pollRef.current) clearInterval(pollRef.current);
          setEnviando(false);
        }
      }
    };
    tick();
    pollRef.current = setInterval(tick, 1500);
  }

  // ---- Tela de progresso/resultado ----
  if (disparoId && progresso) {
    const { resumo, disparo } = progresso;
    const concluido = disparo.status === "concluido";
    const pct = resumo.total ? Math.round(((resumo.enviados + resumo.erros) / resumo.total) * 100) : 0;
    return (
      <div className={wrap}>
        <PageHeader
          title={<span className="flex items-center gap-2">{!concluido && <Spinner className="text-brand" />}{concluido ? "Disparo de e-mail concluído" : "Disparando e-mails…"}</span>}
          description={`${resumo.enviados} enviados · ${resumo.erros} erros · ${resumo.total} no total`}
        />
        <Card className="p-5">
          <div className="flex items-center gap-3">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="w-12 text-right text-sm font-semibold tabular-nums text-slate-600 dark:text-slate-300">{pct}%</span>
          </div>
        </Card>

        <Card className="mt-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Contato</th>
                  <th className="px-4 py-2.5 font-semibold">E-mail</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {progresso.contatos.map((c) => (
                  <tr key={c.id} className="transition hover:bg-slate-50/60 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">{c.nome || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{c.email}</td>
                    <td className="px-4 py-2.5">
                      {c.erro ? <span className="text-rose-600 dark:text-rose-300" title={c.erro}>erro</span>
                        : c.enviado ? <span className="text-emerald-600 dark:text-emerald-300">disparado ✓</span>
                        : <span className="text-slate-400 dark:text-slate-500">aguardando…</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {concluido && (
          <div className="mt-6 flex flex-wrap gap-3">
            {aoFechar ? (
              <Button variant="primary" onClick={aoFechar}>Concluir</Button>
            ) : (
              <Link href={`${base}/dashboard`}><Button variant="primary">Ver métricas de e-mail</Button></Link>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---- Tela de configuração ----
  if (selecao.length === 0) {
    return (
      <div className={wrap}>
        <EmptyState
          title="Nenhum lead selecionado"
          description="Vá em Leads, selecione os destinatários e dispare por e-mail."
          action={<Link href={`${base}/contatos`}><Button variant="primary">Ir para Leads</Button></Link>}
        />
      </div>
    );
  }

  return (
    <div className={wrap}>
      <PageHeader title="Disparar e-mail" description={`${selecao.length} lead(s) selecionado(s)`} />

      <div className="space-y-5">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">Template de e-mail</span>
            {templates.length > 0 && (
              <span className={cn("text-[11px] font-medium", prontos > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                {prontos} de {templates.length} {prontos === 1 ? "pronto" : "prontos"} p/ disparar
              </span>
            )}
          </div>

          {templates.length === 0 ? (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
              Nenhum template de e-mail ativo. Cadastre em <Link href={`${base}/templates`} className="font-medium underline">Templates</Link> — escolha o canal E-mail e escreva o assunto e o corpo.
            </p>
          ) : (
            <div className="mt-3 space-y-2" role="radiogroup" aria-label="Template de e-mail">
              {templates.map((t) => {
                // A campanha direta é sempre "pronta": o corpo do e-mail está
                // aqui e não depende de automação nenhuma no AC.
                const campanha = t.modo === "campanha";
                const st: StatusTag = campanha ? "pronta" : (t.veredito?.status ?? "desconhecido");
                const e = ESTILO_LINHA[st];
                const pronto = campanha || !!t.veredito?.pronto;
                const sel = templateId === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    onClick={() => setTemplateId(t.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition",
                      sel
                        ? "border-brand bg-brand-50/60 ring-1 ring-brand/40 dark:border-brand-400/50 dark:bg-brand-400/10"
                        : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700",
                      !pronto && "opacity-75",
                    )}
                  >
                    <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white", e.dot)} aria-hidden="true">
                      {e.icone}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-800 dark:text-slate-100">{t.nome}</span>
                      <span className={cn("block truncate text-[11px]", e.txt)}>
                        {campanha
                          ? `Assunto: ${t.assunto || "—"}`
                          : `${t.veredito?.rotulo ?? "Verificando…"}${t.veredito?.automacao ? ` · ${t.veredito.automacao}` : ""}`}
                      </span>
                    </span>
                    {sel && <span className="h-2 w-2 shrink-0 rounded-full bg-brand dark:bg-brand-400" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Detalhe do veredito do selecionado (sobretudo quando bloqueado). */}
          {template?.veredito && <VereditoBanner v={template.veredito} />}
          {template?.modo === "campanha" && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              Ao disparar, o sistema cria a mensagem no ActiveCampaign e lança a campanha para os contatos
              selecionados. Nenhuma automação é necessária.
            </p>
          )}
        </Card>

        <Card className="border-brand-200 dark:border-brand-400/30 bg-brand-50 dark:bg-brand-400/10 p-5 text-sm text-slate-700 dark:text-slate-200">
          <p>Você vai disparar o e-mail <strong>«{template?.nome ?? "—"}»</strong> para <strong>{selecao.length}</strong> contato(s).</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Contatos sem e-mail, em opt-out ou com endereço morto (hard bounce) são ignorados automaticamente no servidor.
          </p>
        </Card>

        <Card className="p-5">
          <label className={cn("flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200", bloqueado && "opacity-50")}>
            <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} disabled={bloqueado} className="h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-brand focus:ring-brand" />
            Confirmo o disparo de e-mail para <strong>{selecao.length}</strong> contato(s).
          </label>
          <Button variant="primary" onClick={() => setShowConfirm(true)} disabled={!templateId || !confirmado || enviando || bloqueado} className="mt-4 w-full py-3 text-sm font-semibold">
            {enviando && <Spinner className="text-white" />}
            {enviando ? "Iniciando…" : bloqueado ? "Disparo bloqueado — veja o aviso acima" : `Disparar e-mail para ${selecao.length} contato(s)`}
          </Button>
        </Card>
      </div>

      {showConfirm && template && template.veredito?.pronto !== false && (
        <Portal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !enviando && setShowConfirm(false)}>
          <div className="w-full max-w-md animate-fade-in rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Confirmar disparo de e-mail</h2>
            {template.modo === "campanha" ? (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Esta ação lança a campanha <strong>«{template.nome}»</strong> no ActiveCampaign para{" "}
                <strong>{selecao.length}</strong> contato(s), com o assunto <strong>«{template.assunto}»</strong>.
                Depois de lançada, não é possível desfazer.
              </p>
            ) : (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                Esta ação aplica a tag do template <strong>«{template.nome}»</strong> em <strong>{selecao.length}</strong> contato(s), acionando o envio pela automação do AC. Não é possível desfazer após iniciar.
              </p>
            )}
            {erro && (
              <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300">
                {erro}
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setShowConfirm(false)} disabled={enviando}>Cancelar</Button>
              <Button variant="danger" onClick={disparar} disabled={enviando}>
                {enviando && <Spinner className="text-white" />}
                {enviando ? "Enviando…" : `Disparar para ${selecao.length}`}
              </Button>
            </div>
          </div>
        </div>
        </Portal>
      )}
    </div>
  );
}

// Selo + frase mastigada do "raio-x da automação": diz ao operador se a tag do
// template realmente envia (verde), está pausada/sem automação (vermelho) ou
// ainda não foi verificada (âmbar). Compartilha o vocabulário com a tela de
// Templates (ver app/[portal]/templates/page.tsx).
// Selo compacto por linha da lista de templates: cor + ícone do status, para o
// operador bater o olho e ver quais disparos estão prontos (✓), bloqueados (✗/⏸)
// ou ainda em verificação (?) — sem precisar selecionar um a um.
const ESTILO_LINHA: Record<StatusTag, { dot: string; txt: string; icone: ReactNode }> = {
  pronta: {
    dot: "bg-emerald-500", txt: "text-emerald-600 dark:text-emerald-400",
    icone: <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>,
  },
  pausada: {
    dot: "bg-rose-500", txt: "text-rose-600 dark:text-rose-400",
    icone: <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>,
  },
  sem_automacao: {
    dot: "bg-rose-500", txt: "text-rose-600 dark:text-rose-400",
    icone: <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>,
  },
  desconhecido: {
    dot: "bg-amber-500", txt: "text-amber-600 dark:text-amber-400",
    icone: <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></svg>,
  },
};

const ESTILO_VEREDITO: Record<StatusTag, { card: string; ponto: string; rotulo: string }> = {
  pronta: {
    card: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200",
    ponto: "bg-emerald-500", rotulo: "text-emerald-700 dark:text-emerald-300",
  },
  pausada: {
    card: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200",
    ponto: "bg-rose-500", rotulo: "text-rose-700 dark:text-rose-300",
  },
  sem_automacao: {
    card: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200",
    ponto: "bg-rose-500", rotulo: "text-rose-700 dark:text-rose-300",
  },
  desconhecido: {
    card: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
    ponto: "bg-amber-500", rotulo: "text-amber-700 dark:text-amber-300",
  },
};

export function VereditoBanner({ v }: { v: Veredito }) {
  const e = ESTILO_VEREDITO[v.status];
  return (
    <div className={cn("mt-3 rounded-lg border px-3 py-2.5 text-xs", e.card)}>
      <p className={cn("flex items-center gap-1.5 font-semibold", e.rotulo)}>
        <span className={cn("h-1.5 w-1.5 rounded-full", e.ponto)} />
        {v.rotulo}
      </p>
      <p className="mt-1 leading-relaxed">{v.detalhe}</p>
    </div>
  );
}
