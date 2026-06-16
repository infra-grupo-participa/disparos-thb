"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, EmptyState, PageHeader, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { usePortal } from "@/app/_components/use-portal";

type Selecionado = { comprador_id: string; nome: string; telefone?: string; edicao?: string | null };
type StatusTag = "pronta" | "pausada" | "sem_automacao" | "desconhecido";
type Veredito = { status: StatusTag; automacao: string | null; multientry: boolean; pronto: boolean; rotulo: string; detalhe: string };
type TemplateEmail = { id: string; nome: string; ac_tag_id: string | null; ativo: boolean; veredito?: Veredito };
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch(`/api/templates?evento=${evento}&canal=email`)
      .then((r) => r.json())
      .then((d) => d.ok && setTemplates(d.templates.filter((t: TemplateEmail) => t.ativo)))
      .catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [evento]);

  const template = templates.find((t) => t.id === templateId);
  // Bloqueio "às cegas": com veredito conhecido e não-pronto, trava o disparo
  // (o servidor também bloqueia — isto é só o feedback imediato).
  const bloqueado = !!template?.veredito && !template.veredito.pronto;

  async function disparar() {
    if (!templateId || selecao.length === 0) return;
    setEnviando(true);
    try {
      const r = await fetch(`/api/send-email?evento=${evento}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, compradorIds: selecao.map((s) => s.comprador_id) }),
      });
      const d = await r.json();
      if (!d.ok) { alert(d.reason || "Falha ao iniciar disparo de e-mail"); setEnviando(false); setShowConfirm(false); return; }
      setShowConfirm(false);
      setDisparoId(d.disparoId);
      iniciarPolling(d.disparoId);
    } catch {
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
          title="Nenhum contato selecionado"
          description="Vá em Contatos, selecione os destinatários e dispare por e-mail."
          action={<Link href={`${base}/contatos`}><Button variant="primary">Ir para Contatos</Button></Link>}
        />
      </div>
    );
  }

  return (
    <div className={wrap}>
      <PageHeader title="Disparar e-mail" description={`${selecao.length} contato(s) selecionado(s)`} />

      <div className="space-y-5">
        <Card className="p-5">
          <label htmlFor="tpl-email" className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Template de e-mail</label>
          <select id="tpl-email" value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={cn(fieldClass, "mt-2")}>
            <option value="">Selecione…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
          {templates.length === 0 && (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
              Nenhum template de e-mail ativo. Cadastre em <Link href={`${base}/templates`} className="font-medium underline">Templates</Link> (canal e-mail, com a tag do AC).
            </p>
          )}
          {template && (
            template.veredito
              ? <VereditoBanner v={template.veredito} />
              : <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Ao disparar, o sistema aplica a tag do AC nos contatos; a automação ligada à tag envia o e-mail.
                </p>
          )}
        </Card>

        <Card className="border-brand-200 dark:border-brand-400/30 bg-brand-50 dark:bg-brand-400/10 p-5 text-sm text-slate-700 dark:text-slate-200">
          <p>Você vai disparar o e-mail <strong>«{template?.nome ?? "—"}»</strong> para <strong>{selecao.length}</strong> contato(s).</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Contatos sem e-mail ou em opt-out são ignorados automaticamente no servidor.</p>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" onClick={() => !enviando && setShowConfirm(false)}>
          <div className="w-full max-w-md animate-fade-in rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Confirmar disparo de e-mail</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Esta ação aplica a tag do template <strong>«{template.nome}»</strong> em <strong>{selecao.length}</strong> contato(s), acionando o envio pela automação do AC. Não é possível desfazer após iniciar.
            </p>
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setShowConfirm(false)} disabled={enviando}>Cancelar</Button>
              <Button variant="danger" onClick={disparar} disabled={enviando}>
                {enviando && <Spinner className="text-white" />}
                {enviando ? "Enviando…" : `Disparar para ${selecao.length}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Selo + frase mastigada do "raio-x da automação": diz ao operador se a tag do
// template realmente envia (verde), está pausada/sem automação (vermelho) ou
// ainda não foi verificada (âmbar). Compartilha o vocabulário com a tela de
// Templates (ver app/[portal]/templates/page.tsx).
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
