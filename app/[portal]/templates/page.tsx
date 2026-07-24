"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, EmptyState, PageHeader, cn, fieldClass } from "@/app/_components/ui";
import { Reveal } from "@/app/_components/anim";
import { usePortal } from "@/app/_components/use-portal";
import { VereditoBanner } from "@/app/_components/disparo-email";

type Canal = "whatsapp" | "email";
// Como o e-mail sai. 'campanha': o corpo é escrito aqui e o disparo lança a
// campanha no AC — sem automação. 'tag': o legado, que marca o contato e depende
// de uma automação montada no AC para o e-mail realmente sair.
type Modo = "campanha" | "tag";
type Template = {
  id: string;
  nome: string;
  unnichat_id: string;
  categoria: string | null;
  variaveis: number;
  preview: string | null;
  ativo: boolean;
  canal: Canal;
  modo: Modo;
  assunto: string | null;
  corpo_html: string | null;
  ac_tag_id: string | null;
  ac_tag_nome?: string | null;
  veredito?: Veredito;
};
type StatusTag = "pronta" | "pausada" | "sem_automacao" | "desconhecido";
type Veredito = { status: StatusTag; automacao: string | null; multientry: boolean; pronto: boolean; rotulo: string; detalhe: string };
type Tag = { id: string; nome: string; veredito?: Veredito };

const vazio = { nome: "", unnichat_id: "", categoria: "", variaveis: 0, preview: "", ac_tag_id: "", assunto: "", corpo_html: "" };

// Agrupa as tags do dropdown pelo veredito da automação, para o operador ver
// quais DISPARAM antes de selecionar. As "prontas" vêm primeiro; cada option
// ganha um símbolo (select nativo não aceita cor por item, então usamos texto).
const TAG_GRUPO: Record<StatusTag, { label: string; prefixo: string }> = {
  pronta: { label: "✓ Com automação ativa — dispara e-mail", prefixo: "✓" },
  sem_automacao: { label: "⛔ Sem automação — NÃO envia e-mail", prefixo: "⛔" },
  pausada: { label: "⏸ Automação pausada — não envia agora", prefixo: "⏸" },
  desconhecido: { label: "❓ Verificando automação…", prefixo: "❓" },
};
const TAG_ORDEM: StatusTag[] = ["pronta", "sem_automacao", "pausada", "desconhecido"];

function agruparTags(tags: Tag[]) {
  const porStatus = new Map<StatusTag, Tag[]>();
  for (const t of tags) {
    const st = t.veredito?.status ?? "desconhecido";
    const arr = porStatus.get(st) ?? [];
    arr.push(t);
    porStatus.set(st, arr);
  }
  return TAG_ORDEM
    .filter((st) => (porStatus.get(st)?.length ?? 0) > 0)
    .map((st) => ({ chave: st, label: TAG_GRUPO[st].label, prefixo: TAG_GRUPO[st].prefixo, tags: porStatus.get(st)! }));
}
const NOME_EXEMPLO = "Maria";

function montarPreview(texto: string): string {
  return texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) =>
    String(n) === "1" ? NOME_EXEMPLO : `exemplo ${n}`,
  );
}

// O corpo do e-mail é HTML escrito pelo próprio operador, e o preview o renderiza.
// Tirar script/iframe e handlers `on*` antes de injetar é higiene básica: o HTML
// pode ter vindo colado de qualquer lugar, e nada aqui precisa executar código.
function sanitizar(html: string): string {
  return html
    .replace(/<\s*(script|iframe|object|embed|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|style)\b[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

export default function TemplatesPage() {
  const { evento } = usePortal();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [canal, setCanal] = useState<Canal>("whatsapp");
  // Escrever o e-mail aqui é o caminho padrão. A automação por tag continua
  // disponível para quem já tem réguas montadas no AC.
  const [modo, setModo] = useState<Modo>("campanha");
  const [form, setForm] = useState({ ...vazio });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [alternando, setAlternando] = useState<string | null>(null);

  // Tags do AC (para templates de e-mail). null = ainda não carregou; [] = não veio.
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [tagsErro, setTagsErro] = useState<string | null>(null);
  const [tagManual, setTagManual] = useState(false);

  // "Enviar teste para o meu WhatsApp": o SDR vê a mensagem chegar antes de disparar.
  const [meTelefone, setMeTelefone] = useState<string | null>(null);
  const [testeAlvo, setTesteAlvo] = useState<Template | null>(null);
  const [telTeste, setTelTeste] = useState("");
  const [enviandoTeste, setEnviandoTeste] = useState(false);

  // Guia de primeiro uso + auto-save do rascunho (o SDR não perde o que digitou).
  const [guiaAberto, setGuiaAberto] = useState(false);
  const [rascunhoSalvo, setRascunhoSalvo] = useState(false);
  const rascunhoKey = `cs_template_rascunho_${evento}`;
  const restaurado = useRef(false);
  function fecharGuia() { setGuiaAberto(false); try { localStorage.setItem("cs_guia_templates_off", "1"); } catch { /* noop */ } }

  async function carregar() {
    const r = await fetch(`/api/templates?evento=${evento}`);
    const d = await r.json();
    if (d.ok) setTemplates(d.templates);
  }
  useEffect(() => { carregar(); }, [evento]); // eslint-disable-line react-hooks/exhaustive-deps

  // Número do operador (para pré-preencher o teste). Salvo no 1º teste.
  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => { if (d.ok) setMeTelefone(d.usuario.telefone || null); }).catch(() => {});
  }, []);

  // Guia de primeiro uso: aparece até o SDR fechar.
  useEffect(() => {
    try { setGuiaAberto(localStorage.getItem("cs_guia_templates_off") !== "1"); } catch { /* noop */ }
  }, []);

  // Auto-save: restaura o rascunho ao abrir / trocar de evento.
  useEffect(() => {
    restaurado.current = false;
    try {
      const raw = localStorage.getItem(rascunhoKey);
      if (raw) {
        const d = JSON.parse(raw);
        if (d.form) setForm({ ...vazio, ...d.form });
        if (d.canal) setCanal(d.canal);
        if (d.modo) setModo(d.modo);
      }
    } catch { /* noop */ }
    restaurado.current = true;
  }, [rascunhoKey]);

  // Auto-save: guarda a cada alteração; some quando o form esvazia (após salvar).
  useEffect(() => {
    if (!restaurado.current) return;
    try {
      const vazioForm = !form.nome && !form.unnichat_id && !form.preview && !form.assunto && !form.corpo_html && !form.ac_tag_id && !form.categoria;
      if (vazioForm) { localStorage.removeItem(rascunhoKey); setRascunhoSalvo(false); }
      else { localStorage.setItem(rascunhoKey, JSON.stringify({ form, canal, modo })); setRascunhoSalvo(true); }
    } catch { /* noop */ }
  }, [form, canal, modo, rascunhoKey]);

  function abrirTeste(t: Template) { setTesteAlvo(t); setTelTeste(meTelefone || ""); }
  async function enviarTeste() {
    if (!testeAlvo) return;
    setEnviandoTeste(true);
    try {
      const r = await fetch(`/api/templates/teste?evento=${evento}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: testeAlvo.id, telefone: telTeste.trim() || undefined }),
      });
      const d = await r.json();
      if (d.ok) { setMeTelefone(d.telefone); setTesteAlvo(null); alert("Teste enviado! Confira seu WhatsApp em instantes."); }
      else alert(d.motivo || d.reason || "Não foi possível enviar o teste.");
    } catch {
      alert("Falha ao enviar o teste. Tente de novo.");
    } finally {
      setEnviandoTeste(false);
    }
  }

  // Carrega as tags do AC só quando forem necessárias — ou seja, no modo legado.
  // Escrever o e-mail aqui não depende de tag nenhuma.
  useEffect(() => {
    if (canal !== "email" || modo !== "tag" || tags !== null) return;
    fetch(`/api/email/tags`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setTags(d.tags);
        else { setTags([]); setTagsErro(d.reason || "Não foi possível listar as tags do AC."); setTagManual(true); }
      })
      .catch(() => { setTags([]); setTagsErro("Falha ao conectar no ActiveCampaign."); setTagManual(true); });
  }, [canal, modo, tags]);

  function trocarCanal(c: Canal) {
    setCanal(c);
    setErro(null);
    setForm({ ...vazio });
  }

  function trocarModo(m: Modo) {
    setModo(m);
    setErro(null);
    setForm({ ...vazio });
  }

  function validar(): string | null {
    if (!form.nome.trim()) return "Dê um nome ao template para reconhecê-lo depois.";
    if (canal === "email") {
      if (modo === "campanha") {
        if (!form.assunto.trim()) return "Escreva o assunto do e-mail — é a primeira coisa que a pessoa lê.";
        if (!form.corpo_html.trim()) return "Escreva o corpo do e-mail.";
        return null;
      }
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
        ? modo === "campanha"
          ? {
              nome: form.nome, categoria: form.categoria, canal: "email", modo: "campanha",
              assunto: form.assunto, corpo_html: form.corpo_html,
            }
          : {
              nome: form.nome, categoria: form.categoria, canal: "email", modo: "tag",
              ac_tag_id: form.ac_tag_id, ac_tag_nome: tagNome ?? undefined,
            }
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

  // Preview do e-mail: troca a tag de personalização do AC pelo nome de exemplo,
  // do mesmo jeito que o AC fará no envio.
  const previewEmailAssunto = useMemo(
    () => form.assunto.replace(/%FIRSTNAME%/gi, NOME_EXEMPLO),
    [form.assunto],
  );
  const previewEmailCorpo = useMemo(
    () => sanitizar(form.corpo_html.replace(/%FIRSTNAME%/gi, NOME_EXEMPLO)),
    [form.corpo_html],
  );
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

      {guiaAberto && (
        <div className="mb-5 rounded-xl border border-brand/20 bg-brand/5 p-4 dark:border-brand-400/20 dark:bg-brand-400/5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-brand-700 dark:text-brand-300">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
                Como funciona — passo a passo
              </h3>
              <ol className="mt-2 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                <li><strong className="text-brand-700 dark:text-brand-300">1.</strong> Cadastre o template ao lado: cole o <strong>ID da Unnichat</strong> (do template já aprovado na Meta) e escreva o preview do texto.</li>
                <li><strong className="text-brand-700 dark:text-brand-300">2.</strong> Clique em <strong>Testar</strong> no card para receber a mensagem no <strong>seu próprio WhatsApp</strong> e conferir como fica.</li>
                <li><strong className="text-brand-700 dark:text-brand-300">3.</strong> Deixe o template <strong>ativo</strong> (a bolinha verde).</li>
                <li><strong className="text-brand-700 dark:text-brand-300">4.</strong> No <strong>Kanban</strong> você dispara para os leads; no <strong>Inbox</strong>, quando a janela de 24h fechar, um template reabre a conversa.</li>
              </ol>
            </div>
            <button onClick={fecharGuia} title="Não mostrar mais este guia" className="shrink-0 rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}

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
                        t.modo === "campanha" ? (
                          <>
                            <span className="rounded bg-sky-50 px-1.5 py-0.5 font-medium text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
                              campanha direta
                            </span>
                            <span>·</span>
                            <span className="truncate">{t.assunto || "sem assunto"}</span>
                          </>
                        ) : (
                          <>
                            <span className="font-mono">tag AC {t.ac_tag_nome ?? t.ac_tag_id ?? "—"}</span>
                            {t.veredito && <><span>·</span><VereditoChip v={t.veredito} /></>}
                          </>
                        )
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

                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <button
                      type="button"
                      onClick={() => alternarAtivo(t)}
                      disabled={alternando === t.id}
                      title={t.ativo ? "Clique para desativar" : "Clique para ativar"}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition disabled:opacity-60",
                        t.ativo
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700",
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", t.ativo ? "bg-emerald-600 dark:bg-emerald-400" : "bg-slate-400 dark:bg-slate-500")} />
                      {t.ativo ? "ativo" : "inativo"}
                    </button>
                    {t.canal === "whatsapp" && (
                      <button
                        type="button"
                        onClick={() => abrirTeste(t)}
                        title="Enviar este template para o seu próprio WhatsApp"
                        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-brand ring-1 ring-inset ring-brand/30 transition hover:bg-brand/10 dark:text-brand-300 dark:ring-brand-400/30"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z M22 2 11 13" /></svg>
                        Testar
                      </button>
                    )}
                  </div>
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

          {/* Como o e-mail sai. Escrever aqui é o caminho normal; a automação por
              tag fica para quem já tem régua montada no AC. */}
          {canal === "email" && (
            <div className="mt-3 space-y-1.5">
              {([
                ["campanha", "Escrever o e-mail aqui", "O sistema cria a mensagem e lança a campanha no AC."],
                ["tag", "Usar automação do AC (por tag)", "O e-mail já está montado numa automação lá dentro."],
              ] as const).map(([k, titulo, desc]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => trocarModo(k)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition",
                    modo === k
                      ? "border-brand bg-brand/5 dark:border-brand-300 dark:bg-brand/10"
                      : "border-slate-200 hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700",
                  )}
                >
                  <span className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
                    modo === k ? "border-brand bg-brand dark:border-brand-300 dark:bg-brand-300" : "border-slate-300 dark:border-slate-600",
                  )}>
                    {modo === k && <span className="h-1.5 w-1.5 rounded-full bg-white dark:bg-slate-900" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{titulo}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">{desc}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <form onSubmit={salvar} className="mt-4 space-y-4">
            <Campo
              label="Nome do template"
              dica="Um apelido para você reconhecer. Ex.: “Convite Live HT”, “Lembrete de pagamento”."
              value={form.nome}
              onChange={(v) => setForm({ ...form, nome: v })}
            />

            {canal === "email" && modo === "campanha" ? (
              <>
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
                  Escreva o e-mail aqui. Ao disparar, o sistema cria a mensagem no ActiveCampaign e
                  lança a campanha para os contatos que você selecionar — <strong>sem depender de automação</strong>.
                  Use <code className="rounded bg-sky-100 px-1 dark:bg-sky-500/20">%FIRSTNAME%</code> onde entra o primeiro nome.
                </div>

                <Campo
                  label="Assunto do e-mail"
                  dica="É a primeira coisa que a pessoa lê na caixa de entrada — o que decide se ela abre."
                  value={form.assunto}
                  onChange={(v) => setForm({ ...form, assunto: v })}
                />

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-200">Corpo do e-mail</label>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Aceita HTML. Quebras de linha viram parágrafos automaticamente.
                  </p>
                  <textarea
                    value={form.corpo_html}
                    onChange={(e) => setForm({ ...form, corpo_html: e.target.value })}
                    rows={10}
                    placeholder={"Olá %FIRSTNAME%,\n\nPassando para lembrar que..."}
                    className={cn(fieldClass, "mt-1.5 resize-y")}
                  />
                </div>

                <div>
                  <span className="block text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Como o contato verá</span>
                  <div className="mt-1.5 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    {form.assunto.trim() || form.corpo_html.trim() ? (
                      <>
                        <p className="border-b border-slate-100 pb-2 text-sm font-semibold text-slate-900 dark:border-slate-800 dark:text-slate-100">
                          {form.assunto.trim() ? previewEmailAssunto : <span className="text-slate-400 dark:text-slate-600">(sem assunto)</span>}
                        </p>
                        <div
                          className="prose-sm mt-2 max-w-none whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300"
                          dangerouslySetInnerHTML={{ __html: previewEmailCorpo }}
                        />
                      </>
                    ) : (
                      <p className="py-4 text-center text-xs text-slate-500 dark:text-slate-600">O e-mail aparecerá aqui conforme você escreve.</p>
                    )}
                  </div>
                </div>

                <Campo
                  label="Categoria (opcional)"
                  dica="Para organizar. Ex.: “Aquecimento”, “Carrinho abandonado”."
                  value={form.categoria}
                  onChange={(v) => setForm({ ...form, categoria: v })}
                />
              </>
            ) : canal === "email" ? (
              <>
                {/* Modo legado: o e-mail vive numa automação do AC. */}
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  Neste modo o sistema apenas <strong>marca o contato com a tag</strong> escolhida. Quem envia o e-mail é a
                  <strong> automação</strong> ligada a essa tag no ActiveCampaign — ela precisa existir e estar ativa,
                  senão nada sai.
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
                        {agruparTags(tags).map((g) => (
                          <optgroup key={g.chave} label={g.label}>
                            {g.tags.map((t) => (
                              <option key={t.id} value={t.id}>{g.prefixo} {t.nome}</option>
                            ))}
                          </optgroup>
                        ))}
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
            {rascunhoSalvo && (
              <p className="flex items-center justify-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                <svg className="h-3 w-3 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                Rascunho salvo automaticamente — você pode sair e voltar.
              </p>
            )}
          </form>
        </Card>
      </div>

      {/* Modal: enviar teste para o WhatsApp do operador */}
      {testeAlvo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={() => setTesteAlvo(null)}>
          <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-pop dark:border-slate-800 dark:bg-slate-900" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">Testar no seu WhatsApp</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Enviamos <strong className="text-slate-700 dark:text-slate-200">{testeAlvo.nome}</strong> para o seu número, para você ver como o contato vai receber — antes de disparar para os leads.
            </p>
            {testeAlvo.preview && (
              <div className="mt-3 rounded-lg p-2.5" style={{ backgroundColor: "#ECE5DD" }}>
                <div className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-lg rounded-tr-sm px-3 py-2 text-sm text-slate-800 shadow-sm" style={{ backgroundColor: "#DCF8C6" }}>
                  {montarPreview(testeAlvo.preview)}
                </div>
              </div>
            )}
            <label className="mt-4 block text-sm font-medium text-slate-700 dark:text-slate-200">Seu número de WhatsApp</label>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Com DDD. Guardamos para os próximos testes.</p>
            <input
              value={telTeste}
              onChange={(e) => setTelTeste(e.target.value)}
              placeholder="21 99999-8888"
              className={cn(fieldClass, "mt-1.5")}
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setTesteAlvo(null)}>Cancelar</Button>
              <Button onClick={enviarTeste} disabled={enviandoTeste || !telTeste.trim()}>
                {enviandoTeste ? "Enviando…" : "Enviar teste"}
              </Button>
            </div>
          </div>
        </div>
      )}
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
