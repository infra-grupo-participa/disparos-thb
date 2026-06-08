"use client";

import { useEffect, useState } from "react";

type Template = {
  id: string;
  nome: string;
  unnichat_id: string;
  categoria: string | null;
  variaveis: number;
  preview: string | null;
  ativo: boolean;
};

const vazio = { nome: "", unnichat_id: "", categoria: "", variaveis: 0, preview: "" };

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState({ ...vazio });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    const r = await fetch("/api/templates");
    const d = await r.json();
    if (d.ok) setTemplates(d.templates);
  }
  useEffect(() => { carregar(); }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const r = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, variaveis: Number(form.variaveis) }),
      });
      const d = await r.json();
      if (!d.ok) { setErro(d.reason || "Erro ao salvar"); return; }
      setForm({ ...vazio });
      carregar();
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div>
        <h1 className="mb-4 text-xl font-semibold">Templates</h1>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Nome</th>
                <th className="px-3 py-2">ID Unnichat</th>
                <th className="px-3 py-2">Vars</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{t.nome}</div>
                    {t.preview && <div className="max-w-md truncate text-xs text-slate-400">{t.preview}</div>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500">{t.unnichat_id}</td>
                  <td className="px-3 py-2">{t.variaveis}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${t.ativo ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                      {t.ativo ? "ativo" : "inativo"}
                    </span>
                  </td>
                </tr>
              ))}
              {templates.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-slate-400">Nenhum template cadastrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <form onSubmit={salvar} className="h-fit rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-medium">Novo template</h2>
        <div className="space-y-3 text-sm">
          <Campo label="Nome" value={form.nome} onChange={(v) => setForm({ ...form, nome: v })} required />
          <Campo label="ID do template (Unnichat)" value={form.unnichat_id} onChange={(v) => setForm({ ...form, unnichat_id: v })} required />
          <Campo label="Categoria (MARKETING/UTILITY)" value={form.categoria} onChange={(v) => setForm({ ...form, categoria: v })} />
          <div>
            <label className="block text-slate-600">Nº de variáveis no corpo</label>
            <input type="number" min={0} max={10} value={form.variaveis}
              onChange={(e) => setForm({ ...form, variaveis: Number(e.target.value) })}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5" />
          </div>
          <div>
            <label className="block text-slate-600">Preview do corpo (use {"{{1}}"} para a variável)</label>
            <textarea value={form.preview} onChange={(e) => setForm({ ...form, preview: e.target.value })} rows={4}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5" />
          </div>
          {erro && <p className="text-red-600">{erro}</p>}
          <button type="submit" disabled={salvando}
            className="w-full rounded-lg bg-brand py-2 font-medium text-white hover:bg-brand-light disabled:opacity-60">
            {salvando ? "Salvando…" : "Cadastrar template"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Campo({ label, value, onChange, required }: { label: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div>
      <label className="block text-slate-600">{label}</label>
      <input value={value} required={required} onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-1.5" />
    </div>
  );
}
