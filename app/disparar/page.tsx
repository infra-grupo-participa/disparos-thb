"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { primeiroNome } from "@/lib/phone";

type Selecionado = { comprador_id: string; nome: string; telefone: string; edicao?: string | null };
type Template = { id: string; nome: string; unnichat_id: string; variaveis: number; preview: string | null; ativo: boolean };
type Progresso = {
  disparo: { status: string; fase: string; total_enviados: number; total_contatos_criados: number };
  resumo: { total: number; criados: number; enviados: number; erros: number };
  contatos: {
    id: string; nome: string | null; telefone: string;
    enviado: boolean; erro: string | null; contato_criado: boolean; erro_contato: string | null;
  }[];
};

export default function DispararPage() {
  const [selecao, setSelecao] = useState<Selecionado[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [edicao, setEdicao] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [disparoId, setDisparoId] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [enviando, setEnviando] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("cs_disparo_selecao");
      if (raw) setSelecao(JSON.parse(raw));
    } catch { /* noop */ }
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => d.ok && setTemplates(d.templates.filter((t: Template) => t.ativo)))
      .catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
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
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold">{titulo}</h1>

        {/* Indicador das 2 fases: garantir contatos → enviar */}
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-medium ${criandoContatos ? "bg-blue-100 text-blue-700" : "bg-emerald-100 text-emerald-700"}`}>
            1 · Contatos {resumo.criados}/{resumo.total}
          </span>
          <span className="text-slate-300">→</span>
          <span className={`rounded-full px-2 py-0.5 font-medium ${!criandoContatos ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-400"}`}>
            2 · Envios {resumo.enviados}/{resumo.total}
          </span>
        </div>

        <p className="mt-2 text-sm text-slate-500">
          {criandoContatos
            ? `${resumo.criados} de ${resumo.total} contatos garantidos na Unnichat`
            : `${resumo.enviados} enviados · ${resumo.erros} erros · ${resumo.total} no total`}
        </p>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
          <div className={`h-full transition-all ${criandoContatos ? "bg-blue-500" : "bg-brand"}`} style={{ width: `${pct}%` }} />
        </div>

        <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr><th className="px-3 py-2">Contato</th><th className="px-3 py-2">Telefone</th><th className="px-3 py-2">Status</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {progresso.contatos.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2">{c.nome || "—"}</td>
                  <td className="px-3 py-2 text-slate-500">{c.telefone}</td>
                  <td className="px-3 py-2">
                    {c.erro_contato ? <span className="text-red-600" title={c.erro_contato}>erro ao criar</span>
                      : c.erro ? <span className="text-red-600" title={c.erro}>erro no envio</span>
                      : c.enviado ? <span className="text-green-600">enviado</span>
                      : c.contato_criado ? <span className={criandoContatos ? "text-blue-600" : "text-slate-400"}>{criandoContatos ? "criado ✓" : "aguardando envio…"}</span>
                      : <span className="text-slate-400">{criandoContatos ? "criando…" : "aguardando…"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {concluido && (
          <div className="mt-6 flex gap-3">
            <Link href="/contatos" className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-light">Voltar aos contatos</Link>
            <Link href="/dashboard" className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Ver métricas</Link>
          </div>
        )}
      </div>
    );
  }

  // ---- Tela de configuração ----
  if (selecao.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
        Nenhum contato selecionado. Vá em <Link href="/contatos" className="text-brand underline">Contatos</Link>, selecione e clique em “Disparar”.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">Disparar template</h1>
      <p className="mt-1 text-sm text-slate-500">{selecao.length} contato(s) selecionado(s)</p>

      <label className="mt-6 block text-sm font-medium text-slate-700">Template</label>
      <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
        <option value="">Selecione…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>{t.nome} ({t.variaveis} var)</option>
        ))}
      </select>
      {templates.length === 0 && (
        <p className="mt-2 text-sm text-amber-600">
          Nenhum template ativo. Cadastre em <Link href="/templates" className="underline">Templates</Link>.
        </p>
      )}

      {template && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase text-slate-400">Pré-visualização (ex.: {exemploNome})</div>
          {/* Bolha de chat estilo WhatsApp para o operador "ver o que o contato verá". */}
          <div className="mt-3 rounded-lg bg-[#ECE5DD] p-4">
            <div className="relative max-w-[85%] rounded-2xl rounded-tl-sm bg-[#DCF8C6] px-3 py-2 text-sm text-slate-800 shadow-sm">
              {preview ? (
                <p className="whitespace-pre-wrap">
                  {placeholdersRestantes.length === 0
                    ? preview
                    : preview.split(/(\{\{[^}]*\}\})/g).map((parte, i) =>
                        /^\{\{[^}]*\}\}$/.test(parte) ? (
                          <span key={i} className="rounded bg-red-100 px-1 font-semibold text-red-700">{parte}</span>
                        ) : (
                          <span key={i}>{parte}</span>
                        ),
                      )}
                </p>
              ) : (
                <span className="text-slate-400">Template sem preview cadastrado.</span>
              )}
              <span className="mt-1 block text-right text-[10px] text-slate-400">12:00</span>
            </div>
          </div>
          {temPlaceholderNaoResolvido && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              ⚠ Variáveis não resolvidas: {placeholdersRestantes.join(", ")}. Os contatos receberão o texto exatamente como acima. Revise o template antes de disparar.
            </p>
          )}
        </div>
      )}

      {edicoesPresentes.length > 0 && (
        <>
          <label className="mt-4 block text-sm font-medium text-slate-700">Edição da campanha</label>
          <select value={edicao} onChange={(e) => setEdicao(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
            <option value="">Sem edição definida</option>
            {edicoesPresentes.map((ed) => <option key={ed} value={ed}>{ed}</option>)}
          </select>
          {edicoesPresentes.length > 1 && (
            <p className="mt-1 text-xs text-amber-600">
              Seleção com {edicoesPresentes.length} edições diferentes. Escolha como rotular este disparo (ou deixe sem edição).
            </p>
          )}
        </>
      )}

      <div className="mt-4 max-h-48 overflow-auto rounded-lg border border-slate-200 bg-white text-sm">
        {selecao.map((s) => (
          <div key={s.comprador_id} className="flex justify-between border-b border-slate-50 px-3 py-1.5 last:border-0">
            <span>{s.nome}</span><span className="text-slate-400">{s.telefone}</span>
          </div>
        ))}
      </div>

      {/* Resumo de impacto: o que vai acontecer, em uma frase clara. */}
      {template && (
        <div className="mt-5 rounded-lg border border-brand/30 bg-brand/5 p-4 text-sm text-slate-700">
          <p>
            Você vai enviar o template <strong>«{template.nome}»</strong> para{" "}
            <strong>{selecao.length}</strong> contato(s) — edição <strong>{edicaoLabel}</strong>.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {comTelefone} com telefone
            {comTelefone < selecao.length && (
              <span className="text-amber-600"> · {selecao.length - comTelefone} sem telefone (não receberão)</span>
            )}
          </p>
        </div>
      )}

      <label className="mt-5 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
        Confirmo o envio para <strong>{selecao.length}</strong> contato(s).
      </label>

      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        disabled={!templateId || !confirmado || enviando}
        className="mt-4 w-full rounded-lg bg-brand py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-50">
        {enviando ? "Iniciando…" : `Disparar para ${selecao.length} contato(s)`}
      </button>

      {/* Dupla confirmação: modal com template + contagem e ação rotulada pela ação real. */}
      {showConfirm && template && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-titulo"
          onClick={() => !enviando && setShowConfirm(false)}>
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}>
            <h2 id="confirm-titulo" className="text-lg font-semibold text-slate-900">Confirmar disparo</h2>
            <p className="mt-2 text-sm text-slate-600">
              Esta ação envia o template <strong>«{template.nome}»</strong> para{" "}
              <strong>{selecao.length}</strong> contato(s) — edição <strong>{edicaoLabel}</strong>.
              Não é possível desfazer após iniciar.
            </p>
            {temPlaceholderNaoResolvido && (
              <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                ⚠ Há variáveis não resolvidas no preview ({placeholdersRestantes.join(", ")}).
              </p>
            )}
            {comTelefone < selecao.length && (
              <p className="mt-3 text-xs text-amber-600">
                {selecao.length - comTelefone} contato(s) sem telefone não receberão a mensagem.
              </p>
            )}
            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                disabled={enviando}
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                Cancelar
              </button>
              <button
                type="button"
                onClick={disparar}
                disabled={enviando}
                className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50">
                {enviando ? "Enviando…" : `Enviar para ${selecao.length} contato(s)`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
