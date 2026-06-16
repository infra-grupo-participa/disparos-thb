"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, PageHeader, cn, fieldClass } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/anim";
import { usePortal } from "@/app/_components/use-portal";
import { VereditoBanner } from "@/app/_components/disparo-email";

type Canal = "whatsapp" | "email";
type Template = {
  id: string;
  nome: string;
  unnichat_id: string;
  categoria: string | null;
  variaveis: number;
  preview: string | null;
  ativo: boolean;
  canal: Canal;
  ac_tag_id: string | null;
  ac_tag_nome?: string | null;
  veredito?: Veredito;
};
type StatusTag = "pronta" | "pausada" | "sem_automacao" | "desconhecido";
type Veredito = { status: StatusTag; automacao: string | null; multientry: boolean; pronto: boolean; rotulo: string; detalhe: string };
type Tag = { id: string; nome: string; veredito?: Veredito };

const vazio = { nome: "", unnichat_id: "", categoria: "", variaveis: 0, preview: "", ac_tag_id: "" };
const NOME_EXEMPLO = "Maria";

function montarPreview(texto: string): string {
  return texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) =>
    String(n) === "1" ? NOME_EXEMPLO : `exemplo ${n}`,
  );
}

export default function TemplatesPage() {
  const { evento } = usePortal();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [canal, setCanal] = useState<Canal>("whatsapp");
  const [form, setForm] = useState({ ...vazio });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [alternando, setAlternando] = useState<string | null>(null);

  // Tags do AC (para templates de e-mail). null = ainda não carregou; [] = não veio.
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [tagsErro, setTagsErro] = useState<string | null>(null);
  const [tagManual, setTagManual] = useState(false);

  async function carregar() {
    const r = await fetch(`/api/templates?evento=${evento}`);
    const d = await r.json();
    if (d.ok) setTemplates(d.templates);
  }
  useEffect(() => { carregar(); }, [evento]); // eslint-disable-line react-hooks/exhaustive-deps

  // Carrega as tags do AC só quando o operador entra no modo E-mail (sob demanda).
  useEffect(() => {
    if (canal !== "email" || tags !== null) return;
    fetch(`/api/email/tags`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setTags(d.tags);
        else { setTags([]); setTagsErro(d.reason || "Não foi possível listar as tags do AC."); setTagManual(true); }
      })
      .catch(() => { setTags([]); setTagsErro("Falha ao conectar no ActiveCampaign."); setTagManual(true); });
  }, [canal, tags]);

  function trocarCanal(c: Canal) {
    setCanal(c);
    setErro(null);
    setForm({ ...vazio });
  }

  function validar(): string | null {
    if (!form.nome.trim()) return "Dê um nome ao template para reconhecê-lo depois.";
    if (canal === "email") {
      if (!form.ac_tag_id.trim()) return "Escolha (ou informe) a tag do ActiveCampaign que dispara o e-mail.";
      return null;
    }
    if (!form.unnichat_id.trim()) return "Informe o ID do template (o número no fim da URL da Unnichat).";
    const v = Number(form.variaveis);
    if (!Number.isInteger(v) || v < 0 || v > 10) return "O nº de variáveis deve ser um número de 0 a 10.";
    if (v > 0 && !/\{\{\s*1\s*\}\}/.test(form.preview)) {
      return "Você indicou que há variável, mas não escreveu {{1}} no texto. Adicione {{1}} onde entra o primeiro nome.";
    }
    return null;
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const problema = validar();
    if (problema) { setErro(problema); return; }
    setErro(null);
    setSalvando(true);
    try {
      const corpo = canal === "email"
        ? { nome: form.nome, categoria: form.categoria, canal: "email", ac_tag_id: form.ac_tag_id, ac_tag_nome: tagNome ?? undefined }
        : { ...form, canal: "whatsapp", variaveis: Number(form.variaveis) };
      const r = await fetch(`/api/templates?evento=${evento}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const d = await r.json();
      if (!d.ok) { setErro(d.reason || "Não foi possível salvar. Tente novamente."); return; }
      setForm({ ...vazio });
      carregar();
    } catch {
      setErro("Falha de conexão. Verifique sua internet e tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(t: Template) {
    setAlternando(t.id);
    setTemplates((lista) => lista.map((x) => (x.id === t.id ? { ...x, ativo: !x.ativo } : x)));
    try {
      const r = await fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, ativo: !t.ativo }),
      });
      const d = await r.json();
      if (!d.ok) setTemplates((lista) => lista.map((x) => (x.id === t.id ? { ...x, ativo: t.ativo } : x)));
    } catch {
      setTemplates((lista) => lista.map((x) => (x.id === t.id ? { ...x, ativo: t.ativo } : x)));
    } finally {
      setAlternando(null);
    }
  }

  const vars = Number(form.variaveis) || 0;
  const faltaVar = vars > 0 && form.preview.length > 0 && !/\{\{\s*1\s*\}\}/.test(form.preview);
  const previewRender = useMemo(() => montarPreview(form.preview), [form.preview]);
  const tagSel = useMemo(
    () => tags?.find((t) => t.id === form.ac_tag_id) ?? null,
    [tags, form.ac_tag_id],
  );
  const tagNome = tagSel?.nome ?? null;

  return (
    <div>
      <PageHeader
        title="Templates"
        description="Mensagens de WhatsApp (Unnichat) e de e-mail (ActiveCampaign). Ative ou desative cada uma direto na lista."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_400px]">
        {/* ---- Coluna esquerda: lista ---- */}
        <Reveal className="space-y-3">
          {templates.length === 0 ? (
            <EmptyState
              title="Nenhum template ainda"
              description="Cadastre o primeiro usando o formulário ao lado."
            />
          ) : (
            templates.map((t) => (
              <Card key={t.id} className="js-reveal p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <CanalBadge canal={t.canal} />
                      <span className="font-medium text-slate-900 dark:text-slate-100">{t.nome}</span>
                      {t.categoria && (
                        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {t.categoria}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400 dark:text-slate-500">
                      {t.canal === "email" ? (
                        <>
                          <span className="font-mono">tag AC {t.ac_tag_nome ?? t.ac_tag_id ?? "—"}</span>
                          {t.veredito && <><span>·</span><VereditoChip v={t.veredito} /></>}
                        </>
                      ) : (
                        <>
                          <span className="font-mono">ID {t.unnichat_id}</span>
                          <span>·</span>
                          <span>{t.variaveis} {t.variaveis === 1 ? "variável" : "variáveis"}</span>
                        </>
                      )}
                    </div>
                    {t.preview && (
                      <p className="mt-2 max-w-md truncate text-sm text-slate-500 dark:text-slate-400">{t.preview}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => alternarAtivo(t)}
                    disabled={alternando === t.id}
                    title={t.ativo ? "Clique para desativar" : "Clique para ativar"}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition disabled:opacity-60",
                      t.ativo
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
                        : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700",
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", t.ativo ? "bg-emerald-600 dark:bg-emerald-400" : "bg-slate-400 dark:bg-slate-500")} />
                    {t.ativo ? "ativo" : "inativo"}
                  </button>
                </div>
              </Card>
            ))
          )}
        </Reveal>

        {/* ---- Coluna direita: formulário sticky ---- */}
        <Card className="p-5 lg:sticky lg:top-6">
          <h2 className="font-semibold text-slate-900 dark:text-slate-100">Novo template</h2>

          {/* Seletor de canal */}
          <div className="mt-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-800 dark:bg-slate-900">
            {([["whatsapp", "WhatsApp"], ["email", "E-mail"]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => trocarCanal(k)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition",
                  canal === k ? "bg-brand text-white shadow-sm" : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={salvar} className="mt-4 space-y-4">
            <Campo
              label="Nome do template"
              dica="Um apelido para você reconhecer. Ex.: “Convite Live HT”, “Lembrete de pagamento”."
              value={form.nome}
              onChange={(v) => setForm({ ...form, nome: v })}
            />

            {canal === "email" ? (
              <>
                {/* Explicação didática do que é um template de e-mail */}
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
                  Ao <strong>disparar</strong> este template, o sistema marca o contato com a <strong>tag</strong> escolhida
                  no ActiveCampaign. A <strong>automação</strong> ligada a essa tag é quem envia o e-mail. Você não precisa
                  montar o e-mail aqui — só apontar para a tag certa.
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Ação de e-mail (tag do ActiveCampaign)</label>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Escolha a tag que aciona a automação de envio. Cada template aponta para uma tag.
                  </p>

                  {tags === null ? (
                    <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">Carregando tags do ActiveCampaign…</p>
                  ) : !tagManual && tags.length > 0 ? (
                    <>
                      <select
                        value={form.ac_tag_id}
                        onChange={(e) => setForm({ ...form, ac_tag_id: e.target.value })}
                        className={cn(fieldClass, "mt-1.5")}
                      >
                        <option value="">Selecione a tag…</option>
                        {tags.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                      </select>
                      <button type="button" onClick={() => setTagManual(true)} className="mt-1.5 text-xs font-medium text-brand hover:underline dark:text-brand-300">
                        Não achou? Digitar o ID da tag
                      </button>
                    </>
                  ) : (
                    <>
                      {tagsErro && (
                        <p className="mt-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          {tagsErro} Cole o ID da tag manualmente (no AC: Contatos → Tags → a tag → o número na URL).
                        </p>
                      )}
                      <input
                        value={form.ac_tag_id}
                        onChange={(e) => setForm({ ...form, ac_tag_id: e.target.value })}
                        placeholder="ID numérico da tag no AC"
                        className={cn(fieldClass, "mt-1.5 font-mono")}
                      />
                      {tags.length > 0 && (
                        <button type="button" onClick={() => setTagManual(false)} className="mt-1.5 text-xs font-medium text-brand hover:underline dark:text-brand-300">
                          Voltar à lista de tags
                        </button>
                      )}
                    </>
                  )}
                  {tagNome && <p className="mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">Tag selecionada: {tagNome}</p>}
                  {tagSel?.veredito && <VereditoBanner v={tagSel.veredito} />}
                </div>

                <Campo
                  label="Categoria (opcional)"
                  dica="Para organizar. Ex.: “Aquecimento”, “Carrinho abandonado”."
                  value={form.categoria}
                  onChange={(v) => setForm({ ...form, categoria: v })}
                />
              </>
            ) : (
              <>
                <Campo
                  label="ID do template (Unnichat)"
                  dica="Abra o template no painel da Unnichat e copie o número no fim da URL (.../templates/edit/ESTE-NÚMERO)."
                  value={form.unnichat_id}
                  onChange={(v) => setForm({ ...form, unnichat_id: v })}
                  mono
                />

                <Campo
                  label="Categoria (opcional)"
                  dica="Como o template foi aprovado na Meta: MARKETING ou UTILITY."
                  value={form.categoria}
                  onChange={(v) => setForm({ ...form, categoria: v })}
                />

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Nº de variáveis no corpo</label>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    0 = texto fixo. 1 = a primeira variável recebe o primeiro nome do contato.
                  </p>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={form.variaveis}
                    onChange={(e) => setForm({ ...form, variaveis: Number(e.target.value) })}
                    className={cn(fieldClass, "mt-1.5")}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Preview do corpo da mensagem</label>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Cole aqui o texto do corpo; use {"{{1}}"} onde entra a variável (o primeiro nome).
                  </p>
                  <textarea
                    value={form.preview}
                    onChange={(e) => setForm({ ...form, preview: e.target.value })}
                    rows={4}
                    placeholder="Olá {{1}}, tudo bem? Passando para lembrar..."
                    className={cn(fieldClass, "mt-1.5 resize-y")}
                  />
                </div>

                <div>
                  <span className="block text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Como o contato verá</span>
                  <div className="mt-1.5 rounded-lg p-3" style={{ backgroundColor: "#ECE5DD" }}>
                    {form.preview.trim() ? (
                      <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-lg rounded-tr-sm px-3 py-2 text-sm text-slate-800 shadow-sm" style={{ backgroundColor: "#DCF8C6" }}>
                        {previewRender}
                      </div>
                    ) : (
                      <p className="py-4 text-center text-xs text-slate-500 dark:text-slate-600">O texto da mensagem aparecerá aqui conforme você digita.</p>
                    )}
                  </div>
                  {faltaVar && (
                    <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
                      Você indicou {vars} variável(eis), mas o texto não tem {"{{1}}"}. Adicione {"{{1}}"} onde entra o primeiro nome.
                    </p>
                  )}
                </div>
              </>
            )}

            {erro && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300">{erro}</p>
            )}

            <Button type="submit" disabled={salvando} className="w-full">
              {salvando ? "Salvando…" : `Cadastrar template de ${canal === "email" ? "e-mail" : "WhatsApp"}`}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function CanalBadge({ canal }: { canal: Canal }) {
  const email = canal === "email";
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset",
      email
        ? "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-500/30"
        : "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30",
    )}>
      {email ? "E-mail" : "WhatsApp"}
    </span>
  );
}

// Chip compacto do raio-x na lista: verde=pronta, vermelho=não envia, âmbar=verificando.
function VereditoChip({ v }: { v: Veredito }) {
  const cor = v.status === "pronta"
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
    : v.status === "desconhecido"
    ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
    : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium", cor)} title={v.detalhe}>
      <span className={cn("h-1 w-1 rounded-full", v.status === "pronta" ? "bg-emerald-500" : v.status === "desconhecido" ? "bg-amber-500" : "bg-rose-500")} />
      {v.rotulo}
    </span>
  );
}

function Campo({
  label, dica, value, onChange, mono,
}: {
  label: string; dica?: string; value: string; onChange: (v: string) => void; mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</label>
      {dica && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{dica}</p>}
      <input value={value} onChange={(e) => onChange(e.target.value)} className={cn(fieldClass, "mt-1.5", mono && "font-mono")} />
    </div>
  );
}
