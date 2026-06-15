"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState, PageHeader, Spinner, cn, fieldClass } from "@/app/_components/ui";
import { PageFade } from "@/app/_components/anim";

type Canal = {
  id: string; evento_chave: string; evento_nome: string | null; nome: string;
  provider: string; base_url: string | null; numero: string | null; ativo: boolean;
  atualizado_em: string; api_key_mascarada: string;
};
type Evento = { chave: string; nome: string };

export default function CanaisPage() {
  const [canais, setCanais] = useState<Canal[]>([]);
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [souAdmin, setSouAdmin] = useState<boolean | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [novo, setNovo] = useState(false);
  const [editar, setEditar] = useState<Canal | null>(null);
  const [teste, setTeste] = useState<Record<string, { ok: boolean; msg: string; loading?: boolean }>>({});

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/canais");
      if (r.status === 403) { setSouAdmin(false); return; }
      const d = await r.json();
      if (d.ok) { setCanais(d.canais); setEventos(d.eventos); setSouAdmin(true); }
    } finally { setCarregando(false); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function patch(id: string, payload: Record<string, unknown>) {
    const r = await fetch(`/api/canais/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const d = await r.json();
    if (!d.ok) { alert("Não foi possível atualizar o canal."); return; }
    await carregar();
  }

  async function testar(id: string) {
    setTeste((t) => ({ ...t, [id]: { ok: false, msg: "", loading: true } }));
    try {
      const r = await fetch("/api/canais/testar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const d = await r.json();
      setTeste((t) => ({ ...t, [id]: { ok: !!d.ok, msg: d.detalhe || d.reason || (d.ok ? "OK" : "Falha") } }));
    } catch {
      setTeste((t) => ({ ...t, [id]: { ok: false, msg: "Falha de conexão ao testar." } }));
    }
  }

  if (souAdmin === false) {
    return <PageFade><EmptyState title="Acesso restrito" description="Apenas administradores gerenciam canais de disparo." /></PageFade>;
  }

  return (
    <PageFade>
      <PageHeader
        title="Canais de disparo"
        description="Credenciais da API de WhatsApp por evento. Troque a chave em segundos quando um número for queimado — sem deploy."
        actions={<Button onClick={() => setNovo(true)}>+ Novo canal</Button>}
      />

      {carregando && canais.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400"><Spinner /> Carregando…</div>
      ) : canais.length === 0 ? (
        <EmptyState
          title="Nenhum canal cadastrado"
          description="Enquanto não houver canal, o disparo usa a credencial padrão do ambiente (UNNICHAT_API_KEY). Cadastre um canal por evento para gerenciar aqui."
          action={<Button onClick={() => setNovo(true)}>+ Novo canal</Button>}
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Evento</th>
                  <th className="px-4 py-2.5 font-semibold">Canal</th>
                  <th className="px-4 py-2.5 font-semibold">Número</th>
                  <th className="px-4 py-2.5 font-semibold">Chave</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {canais.map((c) => (
                  <tr key={c.id} className={cn("transition", !c.ativo && "opacity-60")}>
                    <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{c.evento_nome || c.evento_chave}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{c.nome}<span className="ml-1.5 text-xs text-slate-400">{c.provider}</span></td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{c.numero || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500 dark:text-slate-400">{c.api_key_mascarada}</td>
                    <td className="px-4 py-3">
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                        c.ativo ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400")}>
                        <span className={cn("h-1.5 w-1.5 rounded-full", c.ativo ? "bg-emerald-500" : "bg-slate-400")} />
                        {c.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button variant="secondary" size="sm" onClick={() => testar(c.id)} disabled={teste[c.id]?.loading}>
                            {teste[c.id]?.loading ? "Testando…" : "Testar"}
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => setEditar(c)}>Editar / trocar chave</Button>
                          {!c.ativo && <Button variant="ghost" size="sm" onClick={() => patch(c.id, { ativo: true })}>Ativar</Button>}
                        </div>
                        {teste[c.id] && !teste[c.id].loading && (
                          <span className={cn("text-right text-xs", teste[c.id].ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
                            {teste[c.id].ok ? "✓ " : "✗ "}{teste[c.id].msg}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {novo && <ModalCanal eventos={eventos} onClose={() => setNovo(false)} onSalvo={() => { setNovo(false); carregar(); }} />}
      {editar && <ModalCanal canal={editar} eventos={eventos} onClose={() => setEditar(null)} onSalvo={() => { setEditar(null); carregar(); }} />}
    </PageFade>
  );
}

function ModalCanal({ canal, eventos, onClose, onSalvo }: { canal?: Canal; eventos: Evento[]; onClose: () => void; onSalvo: () => void }) {
  const edicao = !!canal;
  const [eventoChave, setEventoChave] = useState(canal?.evento_chave || eventos[0]?.chave || "");
  const [nome, setNome] = useState(canal?.nome || "");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(canal?.base_url || "");
  const [numero, setNumero] = useState(canal?.numero || "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testando, setTestando] = useState(false);

  async function testarChave() {
    if (!apiKey) { setErro("Digite a chave de API para testar."); return; }
    setErro(null);
    setTestando(true);
    setTeste(null);
    try {
      const r = await fetch("/api/canais/testar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, base_url: baseUrl || undefined }),
      });
      const d = await r.json();
      setTeste({ ok: !!d.ok, msg: d.detalhe || d.reason || (d.ok ? "OK" : "Falha") });
    } catch {
      setTeste({ ok: false, msg: "Falha de conexão ao testar." });
    } finally {
      setTestando(false);
    }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    if (!edicao && (!nome || !apiKey)) { setErro("Informe o nome e a chave de API."); return; }
    setSalvando(true);
    try {
      const url = edicao ? `/api/canais/${canal!.id}` : "/api/canais";
      const method = edicao ? "PATCH" : "POST";
      const body: Record<string, unknown> = edicao
        ? { nome, base_url: baseUrl, numero, ...(apiKey ? { api_key: apiKey } : {}) }
        : { evento_chave: eventoChave, nome, api_key: apiKey, base_url: baseUrl || undefined, numero: numero || undefined };
      const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.ok) { setErro("Não foi possível salvar o canal."); return; }
      onSalvo();
    } finally { setSalvando(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={salvar} className="w-full max-w-md animate-fade-in rounded-xl border border-slate-200 bg-white p-6 shadow-pop dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{edicao ? "Editar canal" : "Novo canal de disparo"}</h2>
        <div className="mt-4 space-y-3">
          {!edicao && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Evento</span>
              <select value={eventoChave} onChange={(e) => setEventoChave(e.target.value)} className={fieldClass}>
                {eventos.map((ev) => <option key={ev.chave} value={ev.chave}>{ev.nome}</option>)}
              </select>
            </label>
          )}
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do canal (ex.: Número principal)" className={fieldClass} />
          <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={edicao ? "Nova chave de API (deixe em branco para manter)" : "Chave de API (Unnichat)"} className={cn(fieldClass, "font-mono")} autoComplete="off" />
          <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Número do WhatsApp (opcional)" className={fieldClass} />
          <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Base URL (opcional — padrão Unnichat)" className={fieldClass} />
        </div>
        {erro && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{erro}</p>}
        {teste && (
          <p className={cn("mt-2 text-sm", teste.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>
            {teste.ok ? "✓ " : "✗ "}{teste.msg}
          </p>
        )}
        <div className="mt-5 flex justify-between gap-2">
          <Button type="button" variant="ghost" onClick={testarChave} disabled={testando || !apiKey}>
            {testando && <Spinner />}{testando ? "Testando…" : "Testar chave"}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={salvando}>{salvando && <Spinner className="text-white" />}{edicao ? "Salvar" : "Criar canal"}</Button>
          </div>
        </div>
      </form>
    </div>
  );
}
