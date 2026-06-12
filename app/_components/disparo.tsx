"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { primeiroNome } from "@/lib/phone";
import { Button, Card, PageHeader, EmptyState, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { SaudeDisparo } from "@/app/_components/saude-disparo";

type Selecionado = { comprador_id: string; nome: string; telefone: string; edicao?: string | null };
type Template = { id: string; nome: string; unnichat_id: string; variaveis: number; preview: string | null; ativo: boolean };
type Progresso = {
  disparo: { status: string; fase: string; total_enviados: number; total_contatos_criados: number };
  resumo: { total: number; criados: number; enviados: number; erros: number };
  contatos: {
    id: string; comprador_id: string; nome: string | null; telefone: string;
    enviado: boolean; erro: string | null; contato_criado: boolean; erro_contato: string | null;
    status_meta: string | null; erro_meta_code: number | null;
  }[];
};

// Rótulo do status de entrega (Meta) com cor/título acessível.
function StatusEntrega({ status, code }: { status: string | null; code: number | null }) {
  if (!status) return <span className="text-slate-300 dark:text-slate-600">—</span>;
  if (status === "read") return <span className="font-medium text-blue-600 dark:text-blue-300" title="Lido">lido ✓✓</span>;
  if (status === "delivered") return <span className="font-medium text-emerald-600 dark:text-emerald-300" title="Entregue">entregue ✓✓</span>;
  if (status === "sent") return <span className="text-slate-500 dark:text-slate-400" title="Enviado ao WhatsApp (ainda não entregue)">enviado ✓</span>;
  if (status === "failed")
    return (
      <span className="font-medium text-rose-600 dark:text-rose-300" title={code === 130472 ? "Bloqueado pela Meta (número em experimento)" : `Falhou${code ? ` · código ${code}` : ""}`}>
        {code === 130472 ? "experimento Meta ✗" : "falhou ✗"}
      </span>
    );
  return <span className="text-slate-400 dark:text-slate-500">{status}</span>;
}

// Modal reutilizável do disparo — usado em Contatos e no Kanban (atalho rápido,
// sem trocar de página). Envolve <Disparo> num overlay; onClose deve limpar a
// seleção / recarregar a tela de origem conforme o caso.
export function DisparoModal({ selecao, onClose }: { selecao: Selecionado[]; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/50 p-4 backdrop-blur-sm sm:p-8"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-slate-100 p-4 shadow-pop dark:border-slate-800 dark:bg-slate-950 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Novo disparo</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Fechar"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <Disparo selecaoInicial={selecao} aoFechar={onClose} />
      </div>
    </div>
  );
}

export function Disparo({ selecaoInicial, aoFechar }: { selecaoInicial?: Selecionado[]; aoFechar?: () => void }) {
  const wrap = aoFechar ? "animate-fade-in" : "mx-auto max-w-3xl animate-fade-in";
  const [selecao, setSelecao] = useState<Selecionado[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [edicao, setEdicao] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [disparoId, setDisparoId] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (selecaoInicial?.length) setSelecao(selecaoInicial);
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => d.ok && setTemplates(d.templates.filter((t: Template) => t.ativo)))
      .catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // selecaoInicial é fixa ao montar (modal); rodar só na montagem é intencional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const template = templates.find((t) => t.id === templateId);
  const exemploNome = primeiroNome(selecao[0]?.nome) || "Maria";

  // Edições presentes na seleção. Se todas as escolhas forem da mesma edição,
  // pré-seleciona; com edições mistas, o operador decide como rotular a campanha.
  const edicoesPresentes = useMemo(
    () => [...new Set(selecao.map((s) => s.edicao).filter(Boolean) as string[])].sort(),
    [selecao],
  );
  useEffect(() => {
    if (edicoesPresentes.length === 1) setEdicao(edicoesPresentes[0]);
  }, [edicoesPresentes]);

  const preview = useMemo(() => {
    if (!template?.preview) return "";
    return template.preview.replace(/\{\{?\s*1\s*\}?\}|\{\{\s*nome\s*\}\}/gi, exemploNome);
  }, [template, exemploNome]);

  // À prova de variáveis: se o template declara variáveis mas o preview ainda
  // contém placeholders ({{...}}) não resolvidos, sinalizamos sem bloquear.
  const placeholdersRestantes = useMemo(
    () => (preview.match(/\{\{[^}]*\}\}/g) ?? []),
    [preview],
  );
  const temPlaceholderNaoResolvido = (template?.variaveis ?? 0) > 0 && placeholdersRestantes.length > 0;

  // Quantos contatos têm telefone (impacto real do disparo).
  const comTelefone = useMemo(
    () => selecao.filter((s) => (s.telefone ?? "").trim().length > 0).length,
    [selecao],
  );

  // Rótulo de edição derivado: edição escolhida, ou "mista" quando há várias.
  const edicaoLabel =
    edicao || (edicoesPresentes.length > 1 ? `${edicoesPresentes.length} edições` : "sem edição");

  async function disparar() {
    if (!templateId || selecao.length === 0) return;
    setEnviando(true);
    try {
      const r = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId, compradorIds: selecao.map((s) => s.comprador_id), edicao: edicao || undefined }),
      });
      const d = await r.json();
      if (!d.ok) { alert(d.reason || "Falha ao iniciar disparo"); setEnviando(false); setShowConfirm(false); return; }
      setDisparoId(d.disparoId);
      iniciarPolling(d.disparoId);
    } catch {
      setEnviando(false);
    }
  }

  function iniciarPolling(id: string) {
    const tick = async () => {
      const r = await fetch(`/api/disparos/${id}`);
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

  // Consulta o status de entrega real (Meta) de cada contato e recarrega o progresso.
  async function sincronizarStatus() {
    if (!disparoId) return;
    setSincronizando(true);
    try {
      await fetch(`/api/disparos/${disparoId}/status`, { method: "POST" });
      const r = await fetch(`/api/disparos/${disparoId}`);
      const d = await r.json();
      if (d.ok) setProgresso(d);
    } finally {
      setSincronizando(false);
    }
  }

  // Reenvio dos que falharam: recarrega a seleção só com os falhados e volta à
  // tela de configuração (mantém o template escolhido).
  function reenviarFalhas() {
    if (!progresso) return;
    const falhados = progresso.contatos.filter((c) => c.erro || c.erro_contato || c.status_meta === "failed");
    if (falhados.length === 0) return;
    if (pollRef.current) clearInterval(pollRef.current);
    setSelecao(falhados.map((c) => ({ comprador_id: c.comprador_id, nome: c.nome || c.telefone, telefone: c.telefone })));
    setDisparoId(null);
    setProgresso(null);
    setConfirmado(false);
    setShowConfirm(false);
    setEnviando(false);
  }

  // ---- Tela de progresso/resultado ----
  if (disparoId && progresso) {
    const { resumo, disparo } = progresso;
    const concluido = disparo.status === "concluido";
    const criandoContatos = disparo.fase === "criando_contatos";
    const pct = resumo.total
      ? Math.round(((criandoContatos ? resumo.criados : resumo.enviados + resumo.erros) / resumo.total) * 100)
      : 0;
    const titulo = concluido
      ? "Disparo concluído"
      : criandoContatos
        ? "Criando contatos na Unnichat…"
        : "Disparando…";
    return (
      <div className={wrap}>
        <PageHeader
          title={
            <span className="flex items-center gap-2">
              {!concluido && <Spinner className="text-brand" />}
              {titulo}
            </span>
          }
          description={
            criandoContatos
              ? `${resumo.criados} de ${resumo.total} contatos garantidos na Unnichat`
              : `${resumo.enviados} enviados · ${resumo.erros} erros · ${resumo.total} no total`
          }
        />

        {/* Indicador das 2 fases: garantir contatos → enviar */}
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition",
                criandoContatos
                  ? "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30"
                  : "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white",
                  criandoContatos ? "bg-blue-500" : "bg-emerald-500",
                )}
              >
                {criandoContatos ? "1" : "✓"}
              </span>
              Contatos · {resumo.criados}/{resumo.total}
            </span>
            <span className="text-slate-300 dark:text-slate-600" aria-hidden>→</span>
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition",
                !criandoContatos
                  ? "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:ring-blue-500/30"
                  : "bg-slate-50 text-slate-400 ring-slate-200 dark:bg-slate-800/60 dark:text-slate-500 dark:ring-slate-700",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white",
                  !criandoContatos ? "bg-blue-500" : "bg-slate-300",
                )}
              >
                2
              </span>
              Envios · {resumo.enviados}/{resumo.total}
            </span>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={cn("h-full rounded-full transition-all", criandoContatos ? "bg-blue-500" : "bg-brand")}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="w-12 text-right text-sm font-semibold tabular-nums text-slate-600 dark:text-slate-300">{pct}%</span>
          </div>
        </Card>

        <div className="mt-6 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Contatos</span>
          {!criandoContatos && (
            <Button variant="secondary" size="sm" onClick={sincronizarStatus} disabled={sincronizando}>
              {sincronizando && <Spinner className="h-3.5 w-3.5" />}
              {sincronizando ? "Consultando…" : "Atualizar status de entrega"}
            </Button>
          )}
        </div>

        <Card className="mt-2 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Contato</th>
                  <th className="px-4 py-2.5 font-semibold">Telefone</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold">Entrega</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {progresso.contatos.map((c) => (
                  <tr key={c.id} className="transition hover:bg-slate-50/60 dark:hover:bg-slate-800/60">
                    <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-200">{c.nome || "—"}</td>
                    <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{c.telefone}</td>
                    <td className="px-4 py-2.5">
                      {c.erro_contato ? <span className="text-rose-600 dark:text-rose-300" title={c.erro_contato}>erro ao criar</span>
                        : c.erro ? <span className="text-rose-600 dark:text-rose-300" title={c.erro}>erro no envio</span>
                        : c.enviado ? <span className="text-emerald-600 dark:text-emerald-300">enviado</span>
                        : c.contato_criado ? <span className={criandoContatos ? "text-blue-600 dark:text-blue-300" : "text-slate-400 dark:text-slate-500"}>{criandoContatos ? "criado ✓" : "aguardando envio…"}</span>
                        : <span className="text-slate-400 dark:text-slate-500">{criandoContatos ? "criando…" : "aguardando…"}</span>}
                    </td>
                    <td className="px-4 py-2.5"><StatusEntrega status={c.status_meta} code={c.erro_meta_code} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {concluido && (
          <div className="mt-6 flex flex-wrap gap-3">
            {resumo.erros > 0 && (
              <Button variant="primary" onClick={reenviarFalhas}>
                Reenviar para os {resumo.erros} que falharam
              </Button>
            )}
            {aoFechar ? (
              <Button variant={resumo.erros > 0 ? "secondary" : "primary"} onClick={aoFechar}>Concluir</Button>
            ) : (
              <>
                <Link href="/contatos">
                  <Button variant={resumo.erros > 0 ? "secondary" : "primary"}>Voltar aos contatos</Button>
                </Link>
                <Link href="/dashboard">
                  <Button variant="secondary">Ver métricas</Button>
                </Link>
              </>
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
          description="Vá em Contatos, selecione os destinatários e clique em “Disparar” para começar."
          action={
            <Link href="/contatos">
              <Button variant="primary">Ir para Contatos</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className={wrap}>
      <PageHeader
        title="Disparar template"
        description={`${selecao.length} contato(s) selecionado(s)`}
      />

      <div className="space-y-5">
        {/* Termômetro anti-ban — saúde do número antes de disparar */}
        <SaudeDisparo />

        {/* Template */}
        <Card className="p-5">
          <label htmlFor="template" className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Template</label>
          <select
            id="template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className={cn(fieldClass, "mt-2")}
          >
            <option value="">Selecione…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.nome} ({t.variaveis} var)</option>
            ))}
          </select>
          {templates.length === 0 && (
            <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
              Nenhum template ativo. Cadastre em <Link href="/templates" className="font-medium underline">Templates</Link>.
            </p>
          )}
        </Card>

        {/* Preview WhatsApp */}
        {template && (
          <Card className="p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Pré-visualização <span className="font-normal normal-case text-slate-400 dark:text-slate-500">(ex.: {exemploNome})</span>
            </div>
            {/* Bolha de chat estilo WhatsApp para o operador "ver o que o contato verá". */}
            <div className="mt-3 rounded-xl bg-[#ECE5DD] dark:bg-slate-800 p-4">
              <div className="relative max-w-[85%] rounded-2xl rounded-tl-sm bg-[#DCF8C6] dark:bg-emerald-900/40 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 shadow-sm">
                {preview ? (
                  <p className="whitespace-pre-wrap">
                    {placeholdersRestantes.length === 0
                      ? preview
                      : preview.split(/(\{\{[^}]*\}\})/g).map((parte, i) =>
                          /^\{\{[^}]*\}\}$/.test(parte) ? (
                            <span key={i} className="rounded bg-rose-100 dark:bg-rose-500/20 px-1 font-semibold text-rose-700 dark:text-rose-300">{parte}</span>
                          ) : (
                            <span key={i}>{parte}</span>
                          ),
                        )}
                  </p>
                ) : (
                  <span className="text-slate-400 dark:text-slate-500">Template sem preview cadastrado.</span>
                )}
                <span className="mt-1 block text-right text-[10px] text-slate-400 dark:text-slate-500">12:00</span>
              </div>
            </div>
            {temPlaceholderNaoResolvido && (
              <p className="mt-3 rounded-md bg-rose-50 dark:bg-rose-500/15 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300">
                ⚠ Variáveis não resolvidas: {placeholdersRestantes.join(", ")}. Os contatos receberão o texto exatamente como acima. Revise o template antes de disparar.
              </p>
            )}
          </Card>
        )}

        {/* Edição da campanha */}
        {edicoesPresentes.length > 0 && (
          <Card className="p-5">
            <label htmlFor="edicao" className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Edição da campanha</label>
            <select
              id="edicao"
              value={edicao}
              onChange={(e) => setEdicao(e.target.value)}
              className={cn(fieldClass, "mt-2")}
            >
              <option value="">Sem edição definida</option>
              {edicoesPresentes.map((ed) => <option key={ed} value={ed}>{ed}</option>)}
            </select>
            {edicoesPresentes.length > 1 && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                Seleção com {edicoesPresentes.length} edições diferentes. Escolha como rotular este disparo (ou deixe sem edição).
              </p>
            )}
          </Card>
        )}

        {/* Contatos selecionados */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-5 py-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Contatos selecionados</span>
            <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-slate-600 dark:text-slate-300">{selecao.length}</span>
          </div>
          <div className="max-h-48 overflow-auto text-sm">
            {selecao.map((s) => (
              <div key={s.comprador_id} className="flex justify-between border-b border-slate-50 dark:border-slate-800 px-5 py-2 last:border-0">
                <span className="text-slate-700 dark:text-slate-200">{s.nome}</span><span className="text-slate-400 dark:text-slate-500">{s.telefone}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Resumo de impacto: o que vai acontecer, em uma frase clara. */}
        {template && (
          <Card className="border-brand-200 dark:border-brand-400/30 bg-brand-50 dark:bg-brand-400/10 p-5 text-sm text-slate-700 dark:text-slate-200">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-400/20 text-brand-700 dark:text-brand-300" aria-hidden>
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4 20-7z" />
                </svg>
              </span>
              <div>
                <p>
                  Você vai enviar o template <strong>«{template.nome}»</strong> para{" "}
                  <strong>{selecao.length}</strong> contato(s) — edição <strong>{edicaoLabel}</strong>.
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {comTelefone} com telefone
                  {comTelefone < selecao.length && (
                    <span className="text-amber-600 dark:text-amber-400"> · {selecao.length - comTelefone} sem telefone (não receberão)</span>
                  )}
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Confirmação + ação */}
        <Card className="p-5">
          <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={confirmado}
              onChange={(e) => setConfirmado(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-brand focus:ring-brand"
            />
            Confirmo o envio para <strong>{selecao.length}</strong> contato(s).
          </label>

          <Button
            variant="primary"
            onClick={() => setShowConfirm(true)}
            disabled={!templateId || !confirmado || enviando}
            className="mt-4 w-full py-3 text-sm font-semibold"
          >
            {enviando && <Spinner className="text-white" />}
            {enviando ? "Iniciando…" : `Disparar para ${selecao.length} contato(s)`}
          </Button>
        </Card>
      </div>

      {/* Dupla confirmação: modal com template + contagem e ação rotulada pela ação real. */}
      {showConfirm && template && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-titulo"
          onClick={() => !enviando && setShowConfirm(false)}>
          <div
            className="w-full max-w-md animate-fade-in rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-pop"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-300" aria-hidden>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </span>
              <div className="min-w-0">
                <h2 id="confirm-titulo" className="text-lg font-semibold text-slate-900 dark:text-slate-100">Confirmar disparo</h2>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  Esta ação envia o template <strong>«{template.nome}»</strong> para{" "}
                  <strong>{selecao.length}</strong> contato(s) — edição <strong>{edicaoLabel}</strong>.
                  Não é possível desfazer após iniciar.
                </p>
              </div>
            </div>
            {temPlaceholderNaoResolvido && (
              <p className="mt-3 rounded-md bg-rose-50 dark:bg-rose-500/15 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300">
                ⚠ Há variáveis não resolvidas no preview ({placeholdersRestantes.join(", ")}).
              </p>
            )}
            {comTelefone < selecao.length && (
              <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                {selecao.length - comTelefone} contato(s) sem telefone não receberão a mensagem.
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setShowConfirm(false)} disabled={enviando}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={disparar} disabled={enviando}>
                {enviando && <Spinner className="text-white" />}
                {enviando ? "Enviando…" : `Enviar para ${selecao.length} contato(s)`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
