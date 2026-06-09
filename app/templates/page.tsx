"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, EmptyState, PageHeader, cn, fieldClass } from "@/app/_components/ui";

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
const NOME_EXEMPLO = "Maria";

// Substitui {{1}} (e outras variáveis) por nomes de exemplo para o preview ao vivo.
function montarPreview(texto: string): string {
  return texto.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) =>
    String(n) === "1" ? NOME_EXEMPLO : `exemplo ${n}`,
  );
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState({ ...vazio });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [alternando, setAlternando] = useState<string | null>(null);

  async function carregar() {
    const r = await fetch("/api/templates");
    const d = await r.json();
    if (d.ok) setTemplates(d.templates);
  }
  useEffect(() => { carregar(); }, []);

  // Validação amigável antes de enviar.
  function validar(): string | null {
    if (!form.nome.trim()) return "Dê um nome ao template para reconhecê-lo depois.";
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
      const r = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, variaveis: Number(form.variaveis) }),
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
    // Atualização otimista para resposta imediata na lista.
    setTemplates((lista) => lista.map((x) => (x.id === t.id ? { ...x, ativo: !x.ativo } : x)));
    try {
      const r = await fetch("/api/templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, ativo: !t.ativo }),
      });
      const d = await r.json();
      if (!d.ok) {
        // Reverte se falhar.
        setTemplates((lista) => lista.map((x) => (x.id === t.id ? { ...x, ativo: t.ativo } : x)));
      }
    } catch {
      setTemplates((lista) => lista.map((x) => (x.id === t.id ? { ...x, ativo: t.ativo } : x)));
    } finally {
      setAlternando(null);
    }
  }

  const vars = Number(form.variaveis) || 0;
  const faltaVar = vars > 0 && form.preview.length > 0 && !/\{\{\s*1\s*\}\}/.test(form.preview);
  const previewRender = useMemo(() => montarPreview(form.preview), [form.preview]);

  return (
    <div>
      <PageHeader
        title="Templates"
        description="Mensagens aprovadas pela Meta e cadastradas na Unnichat. Ative ou desative cada uma direto na lista."
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_400px]">
        {/* ---- Coluna esquerda: lista ---- */}
        <div className="space-y-3">
          {templates.length === 0 ? (
            <EmptyState
              title="Nenhum template ainda"
              description="Cadastre o primeiro usando o formulário ao lado, registrando uma mensagem aprovada na Unnichat."
            />
          ) : (
            templates.map((t) => (
              <Card key={t.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-slate-900">{t.nome}</span>
                      {t.categoria && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                          {t.categoria}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400">
                      <span className="font-mono">ID {t.unnichat_id}</span>
                      <span>·</span>
                      <span>
                        {t.variaveis} {t.variaveis === 1 ? "variável" : "variáveis"}
                      </span>
                    </div>
                    {t.preview && (
                      <p className="mt-2 max-w-md truncate text-sm text-slate-500">{t.preview}</p>
                    )}
                  </div>

                  {/* Toggle/pill clicável ativo/inativo (mantém PATCH otimista). */}
                  <button
                    type="button"
                    onClick={() => alternarAtivo(t)}
                    disabled={alternando === t.id}
                    title={t.ativo ? "Clique para desativar" : "Clique para ativar"}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition disabled:opacity-60",
                      t.ativo
                        ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                        : "bg-slate-100 text-slate-500 hover:bg-slate-200",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        t.ativo ? "bg-emerald-600" : "bg-slate-400",
                      )}
                    />
                    {t.ativo ? "ativo" : "inativo"}
                  </button>
                </div>
              </Card>
            ))
          )}
        </div>

        {/* ---- Coluna direita: formulário sticky ---- */}
        <Card className="p-5 lg:sticky lg:top-6">
          <h2 className="font-semibold text-slate-900">Novo template</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Cadastro manual: crie o template na Unnichat e copie as informações para cá.
          </p>

          <form onSubmit={salvar} className="mt-4 space-y-4">
            <Campo
              label="Nome do template"
              dica="Um apelido para você reconhecer. Ex.: “Boas-vindas”, “Lembrete de consulta”."
              value={form.nome}
              onChange={(v) => setForm({ ...form, nome: v })}
            />

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
              <label className="block text-sm font-medium text-slate-700">Nº de variáveis no corpo</label>
              <p className="mt-0.5 text-xs text-slate-500">
                0 = texto fixo, igual para todos. 1 = a primeira variável recebe o primeiro nome do contato.
                Use o mesmo número de variáveis que existe no template aprovado.
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
              <label className="block text-sm font-medium text-slate-700">Preview do corpo da mensagem</label>
              <p className="mt-0.5 text-xs text-slate-500">
                Cole aqui o texto do corpo da mensagem; use {"{{1}}"} onde entra a variável (o primeiro nome).
              </p>
              <textarea
                value={form.preview}
                onChange={(e) => setForm({ ...form, preview: e.target.value })}
                rows={4}
                placeholder="Olá {{1}}, tudo bem? Passando para lembrar..."
                className={cn(fieldClass, "mt-1.5 resize-y")}
              />
            </div>

            {/* Preview ao vivo em bolha tipo WhatsApp */}
            <div>
              <span className="block text-xs font-medium uppercase tracking-wide text-slate-400">
                Como o contato verá
              </span>
              <div className="mt-1.5 rounded-lg p-3" style={{ backgroundColor: "#ECE5DD" }}>
                {form.preview.trim() ? (
                  <div
                    className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-lg rounded-tr-sm px-3 py-2 text-sm text-slate-800 shadow-sm"
                    style={{ backgroundColor: "#DCF8C6" }}
                  >
                    {previewRender}
                  </div>
                ) : (
                  <p className="py-4 text-center text-xs text-slate-500">
                    O texto da mensagem aparecerá aqui conforme você digita.
                  </p>
                )}
              </div>
              {faltaVar && (
                <p className="mt-1.5 text-xs text-amber-600">
                  Você indicou {vars} variável(eis), mas o texto não tem {"{{1}}"}. Adicione {"{{1}}"} onde entra o
                  primeiro nome.
                </p>
              )}
              {form.preview.trim() && (
                <p className="mt-1.5 text-xs text-slate-400">Exemplo usando o nome “{NOME_EXEMPLO}”.</p>
              )}
            </div>

            {erro && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{erro}</p>
            )}

            <Button type="submit" disabled={salvando} className="w-full">
              {salvando ? "Salvando…" : "Cadastrar template"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

function Campo({
  label,
  dica,
  value,
  onChange,
  mono,
}: {
  label: string;
  dica?: string;
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      {dica && <p className="mt-0.5 text-xs text-slate-500">{dica}</p>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(fieldClass, "mt-1.5", mono && "font-mono")}
      />
    </div>
  );
}
