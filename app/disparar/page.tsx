"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { primeiroNome } from "@/lib/phone";

type Selecionado = { comprador_id: string; nome: string; telefone: string; edicao?: string | null };
type Template = { id: string; nome: string; unnichat_id: string; variaveis: number; preview: string | null; ativo: boolean };
type Progresso = {
  disparo: { status: string; total_enviados: number };
  resumo: { total: number; enviados: number; erros: number };
  contatos: { id: string; nome: string | null; telefone: string; enviado: boolean; erro: string | null }[];
};

export default function DispararPage() {
  const [selecao, setSelecao] = useState<Selecionado[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [edicao, setEdicao] = useState("");
  const [confirmado, setConfirmado] = useState(false);
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
      if (!d.ok) { alert(d.reason || "Falha ao iniciar disparo"); setEnviando(false); return; }
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
    const pct = resumo.total ? Math.round(((resumo.enviados + resumo.erros) / resumo.total) * 100) : 0;
    const concluido = disparo.status === "concluido";
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold">{concluido ? "Disparo concluído" : "Disparando…"}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {resumo.enviados} enviados · {resumo.erros} erros · {resumo.total} no total
        </p>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
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
                    {c.erro ? <span className="text-red-600" title={c.erro}>erro</span>
                      : c.enviado ? <span className="text-green-600">enviado</span>
                      : <span className="text-slate-400">aguardando…</span>}
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
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{preview || <span className="text-slate-400">Template sem preview cadastrado.</span>}</p>
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

      <label className="mt-5 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} />
        Confirmo o envio para <strong>{selecao.length}</strong> contato(s).
      </label>

      <button onClick={disparar} disabled={!templateId || !confirmado || enviando}
        className="mt-4 w-full rounded-lg bg-brand py-2.5 text-sm font-medium text-white hover:bg-brand-light disabled:opacity-50">
        {enviando ? "Iniciando…" : `Disparar para ${selecao.length} contato(s)`}
      </button>
    </div>
  );
}
