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
        description="Credenciais de WhatsApp (Unnichat) e de e-mail (ActiveCampaign), por evento. Troque a chave em segundos quando um número for queimado — sem deploy."
        actions={<Button onClick={() => setNovo(true)}>+ Novo canal</Button>}
      />

      {canais.length > 0 && (
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          <strong className="font-semibold text-slate-600 dark:text-slate-300">Inativo</strong> = o evento não dispara por este canal (cai na credencial padrão do ambiente, se houver, ou falha).
        </p>
      )}

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
                          <Button variant="secondary" size="sm" className="alvo-toque" aria-label={`Testar canal ${c.nome}`} onClick={() => testar(c.id)} disabled={teste[c.id]?.loading}>
                            {teste[c.id]?.loading ? "Testando…" : "Testar"}
                          </Button>
                          <Button variant="secondary" size="sm" className="alvo-toque" aria-label={`Editar ou trocar chave do canal ${c.nome}`} onClick={() => setEditar(c)}>Editar / trocar chave</Button>
                          {!c.ativo && <Button variant="ghost" size="sm" className="alvo-toque" aria-label={`Ativar canal ${c.nome}`} onClick={() => patch(c.id, { ativo: true })}>Ativar</Button>}
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

      <RemetenteEmail />

      {novo && <ModalCanal eventos={eventos} onClose={() => setNovo(false)} onSalvo={() => { setNovo(false); carregar(); }} />}
      {editar && <ModalCanal canal={editar} eventos={eventos} onClose={() => setEditar(null)} onSalvo={() => { setEditar(null); carregar(); }} />}
    </PageFade>
  );
}

type Remetente = {
  nome: string; email: string; url: string; lembrete: string;
  endereco: string; cidade: string; estado: string; cep: string; pais: string;
};
const REMETENTE_VAZIO: Remetente = {
  nome: "", email: "", url: "", lembrete: "", endereco: "", cidade: "", estado: "", cep: "", pais: "Brasil",
};

// Quem assina o e-mail. Sem isto, o disparo por campanha não sai — e não é
// capricho do sistema: o ActiveCampaign exige o endereço físico e a frase que
// lembra a pessoa de por que ela está recebendo (é a lei anti-spam). Configura-se
// uma vez; vale para todos os disparos de e-mail.
function RemetenteEmail() {
  const [r, setR] = useState<Remetente>(REMETENTE_VAZIO);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((x) => x.json())
      .then((d) => {
        if (d.ok && d.config?.email_remetente) {
          setR({ ...REMETENTE_VAZIO, ...(d.config.email_remetente as Partial<Remetente>) });
        }
      })
      .catch(() => {})
      .finally(() => setCarregando(false));
  }, []);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    const faltando = (["nome", "email", "url", "lembrete", "endereco", "cidade"] as const).filter((k) => !r[k].trim());
    if (faltando.length) {
      setErro("Preencha nome, e-mail, site, lembrete, endereço e cidade — o ActiveCampaign recusa o envio sem eles.");
      return;
    }
    setSalvando(true);
    setSalvo(false);
    try {
      const res = await fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chave: "email_remetente", valor: r }),
      });
      const d = await res.json();
      if (!d.ok) { setErro("Não foi possível salvar o remetente."); return; }
      setSalvo(true);
    } finally { setSalvando(false); }
  }

  const campo = (k: keyof Remetente, rotulo: string, dica?: string) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{rotulo}</span>
      <input value={r[k]} onChange={(e) => { setR({ ...r, [k]: e.target.value }); setSalvo(false); }} className={fieldClass} />
      {dica && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{dica}</span>}
    </label>
  );

  return (
    <Card className="mt-8 p-6">
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">Remetente do e-mail</h2>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
        Quem assina os e-mails disparados. O ActiveCampaign exige o endereço físico e a frase de lembrete —
        é exigência da lei anti-spam, e sem isso a campanha não é aceita.
      </p>

      {carregando ? (
        <div className="flex items-center gap-2 py-6 text-slate-400"><Spinner /> Carregando…</div>
      ) : (
        <form onSubmit={salvar} className="mt-4 grid gap-3 sm:grid-cols-2">
          {campo("nome", "Nome do remetente", "Aparece como o autor do e-mail.")}
          {campo("email", "E-mail do remetente", "Precisa ser um domínio verificado no AC.")}
          {campo("url", "Site", "Ex.: https://grupoparticipa.com.br")}
          {campo("endereco", "Endereço")}
          {campo("cidade", "Cidade")}
          {campo("estado", "Estado (opcional)")}
          {campo("cep", "CEP (opcional)")}
          {campo("pais", "País")}
          <div className="sm:col-span-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Frase de lembrete</span>
              <textarea
                value={r.lembrete}
                onChange={(e) => { setR({ ...r, lembrete: e.target.value }); setSalvo(false); }}
                rows={2}
                placeholder="Você está recebendo este e-mail porque se inscreveu num evento do Grupo Participa."
                className={cn(fieldClass, "resize-y")}
              />
              <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                Vai no rodapé, explicando à pessoa por que ela recebeu o e-mail.
              </span>
            </label>
          </div>

          <div className="flex items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={salvando}>{salvando && <Spinner className="text-white" />}Salvar remetente</Button>
            {salvo && <span className="text-sm text-emerald-600 dark:text-emerald-400">✓ Remetente salvo</span>}
            {erro && <span className="text-sm text-rose-600 dark:text-rose-400">{erro}</span>}
          </div>
        </form>
      )}
    </Card>
  );
}

function ModalCanal({ canal, eventos, onClose, onSalvo }: { canal?: Canal; eventos: Evento[]; onClose: () => void; onSalvo: () => void }) {
  const edicao = !!canal;
  const [eventoChave, setEventoChave] = useState(canal?.evento_chave || eventos[0]?.chave || "");
  // O provider decide QUAL API o canal fala. Ele sempre existiu no banco, mas a
  // tela não o expunha — então um canal de e-mail só nascia por SQL.
  const [provider, setProvider] = useState(canal?.provider || "unnichat");
  const [nome, setNome] = useState(canal?.nome || "");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(canal?.base_url || "");
  const [numero, setNumero] = useState(canal?.numero || "");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testando, setTestando] = useState(false);

  const ehEmail = provider === "activecampaign";

  async function testarChave() {
    if (!apiKey) { setErro("Digite a chave de API para testar."); return; }
    setErro(null);
    setTestando(true);
    setTeste(null);
    try {
      const r = await fetch("/api/canais/testar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: apiKey, base_url: baseUrl || undefined, provider }),
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
    // O AC não tem base padrão: cada conta tem a sua (https://sua-conta.api-us1.com).
    if (!edicao && ehEmail && !baseUrl.trim()) {
      setErro("O ActiveCampaign exige a URL da sua conta (ex.: https://suaconta.api-us1.com).");
      return;
    }
    setSalvando(true);
    try {
      const url = edicao ? `/api/canais/${canal!.id}` : "/api/canais";
      const method = edicao ? "PATCH" : "POST";
      const body: Record<string, unknown> = edicao
        ? { nome, base_url: baseUrl, numero, ...(apiKey ? { api_key: apiKey } : {}) }
        : { evento_chave: eventoChave, provider, nome, api_key: apiKey, base_url: baseUrl || undefined, numero: numero || undefined };
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
            <>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Evento</span>
                <select value={eventoChave} onChange={(e) => setEventoChave(e.target.value)} className={fieldClass}>
                  {eventos.map((ev) => <option key={ev.chave} value={ev.chave}>{ev.nome}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Canal</span>
                <select value={provider} onChange={(e) => setProvider(e.target.value)} className={fieldClass}>
                  <option value="unnichat">WhatsApp (Unnichat)</option>
                  <option value="activecampaign">E-mail (ActiveCampaign)</option>
                </select>
              </label>
            </>
          )}
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={ehEmail ? "Nome do canal (ex.: Conta principal de e-mail)" : "Nome do canal (ex.: Número principal)"} className={fieldClass} />
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={edicao ? "Nova chave de API (deixe em branco para manter)" : ehEmail ? "Chave de API (ActiveCampaign)" : "Chave de API (Unnichat)"}
            className={cn(fieldClass, "font-mono")}
            autoComplete="off"
          />
          {edicao && apiKey && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              A troca é imediata: a partir de salvar, os próximos disparos deste canal já usam esta chave nova — se ela estiver errada, o disparo para.
            </p>
          )}
          {!ehEmail && (
            <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="Número do WhatsApp (opcional)" className={fieldClass} />
          )}
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={ehEmail ? "URL da conta (ex.: https://suaconta.api-us1.com)" : "Base URL (opcional — padrão Unnichat)"}
            className={fieldClass}
          />
          {ehEmail && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No AC: Settings → Developer. Copie a <strong>URL</strong> e a <strong>Key</strong>.
            </p>
          )}
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
