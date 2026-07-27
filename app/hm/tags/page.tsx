"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, cn, fieldClass, Spinner } from "@/app/_components/ui";
import { TagChip } from "@/app/_components/tags";
import { useMe } from "@/app/_components/use-me";
import { MarcaPortal } from "@/app/_components/marca";

// Gestão do catálogo de tags do HM (cs.tags, 0067). Criar é de todos; renomear,
// recolorir e excluir são de admin, porque propagam para TODOS os cards — o
// serviço troca catálogo e arrays num statement só. Tags de sistema (canais e
// públicos que as funções do banco escrevem por nome literal) não se renomeiam
// nem se excluem; as gerenciadas (Origem/Turma/Aurum) nem aparecem aqui.

type Tag = { id: string; nome: string; cor: string | null; tipo: "livre" | "sistema"; usos: number };

// Paleta fixa: cor livre demais vira arco-íris ilegível; 12 tons bastam.
const PALETA = [
  "#f97316", "#ef4444", "#ec4899", "#8b5cf6", "#6366f1", "#3b82f6",
  "#06b6d4", "#10b981", "#84cc16", "#eab308", "#f59e0b", "#64748b",
];

export default function HmTagsPage() {
  // Gestão do catálogo (renomear/recolorir/excluir propaga a TODOS os cards) é
  // do MASTER — admin de equipe comum não gere catálogo global. Criar é de todos.
  const { ehMaster } = useMe();
  const admin = ehMaster();
  const [tags, setTags] = useState<Tag[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [novoNome, setNovoNome] = useState("");
  const [novaCor, setNovaCor] = useState<string>(PALETA[0]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [corAberta, setCorAberta] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await fetch("/api/hm/tags");
      const d = await r.json();
      if (d.ok) setTags(d.tags);
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function criar() {
    const nome = novoNome.trim();
    if (nome.length < 2) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch("/api/hm/tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, cor: novaCor }),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) { setErro(d.reason || "não foi possível criar"); return; }
      setNovoNome("");
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/hm/tags/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) setErro(d.reason || "não foi possível alterar");
      await carregar();
    } finally {
      setSalvando(false);
      setCorAberta(null);
    }
  }

  async function excluir(t: Tag) {
    const aviso = t.usos > 0
      ? `Excluir a tag "${t.nome}"?\n\nEla será REMOVIDA dos ${t.usos} card(s) que a usam. Isso não tem desfazer.`
      : `Excluir a tag "${t.nome}"? Nenhum card a usa.`;
    if (!window.confirm(aviso)) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/hm/tags/${t.id}`, { method: "DELETE" });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) setErro(d.reason || "não foi possível excluir");
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  function renomear(t: Tag) {
    const novo = window.prompt(
      `Novo nome para "${t.nome}"${t.usos > 0 ? ` (será trocado nos ${t.usos} card(s) que a usam)` : ""}:`,
      t.nome,
    )?.trim();
    if (!novo || novo === t.nome) return;
    patch(t.id, { nome: novo });
  }

  const livres = tags.filter((t) => t.tipo === "livre");
  const sistema = tags.filter((t) => t.tipo === "sistema");

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/hm/kanban" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        Voltar à esteira
      </Link>

      <div className="mb-1 flex items-center gap-2.5">
        <MarcaPortal portal="hm" altura="h-7" comNome={false} />
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Tags · Holding Masters</h1>
      </div>
      <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
        Criar é de todos; renomear, recolorir e excluir propagam para todos os cards — por isso são do administrador do Grupo Participa.
      </p>

      {/* criar */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") criar(); }}
            placeholder="Nome da nova tag…"
            className={cn(fieldClass, "max-w-xs")}
          />
          <div className="flex items-center gap-1">
            {PALETA.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setNovaCor(c)}
                className={cn("h-5 w-5 rounded-full transition", novaCor === c && "ring-2 ring-slate-400 ring-offset-1 dark:ring-slate-300 dark:ring-offset-slate-900")}
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <Button variant="primary" size="sm" disabled={salvando || novoNome.trim().length < 2} onClick={criar}>
            Criar tag
          </Button>
          {novoNome.trim().length >= 2 && <TagChip tag={novoNome.trim()} cor={novaCor} />}
        </div>
        {erro && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{erro}</p>}
      </div>

      {carregando ? (
        <div className="flex items-center justify-center gap-3 py-16 text-slate-400"><Spinner className="h-5 w-5" /> Carregando…</div>
      ) : (
        <>
          <Secao titulo="Tags livres" vazio="Nenhuma tag livre ainda — crie a primeira acima ou direto no seletor da tabela.">
            {livres.map((t) => (
              <Linha key={t.id} t={t} admin={admin} salvando={salvando}
                corAberta={corAberta === t.id} onAbrirCor={() => setCorAberta(corAberta === t.id ? null : t.id)}
                onCor={(c) => patch(t.id, { cor: c })} onRenomear={() => renomear(t)} onExcluir={() => excluir(t)} />
            ))}
          </Secao>
          <Secao titulo="Tags de sistema" nota="Escritas pelas integrações (canal, público). Dá para recolorir; renomear/excluir não — as funções do banco gravam esses nomes.">
            {sistema.map((t) => (
              <Linha key={t.id} t={t} admin={admin} salvando={salvando}
                corAberta={corAberta === t.id} onAbrirCor={() => setCorAberta(corAberta === t.id ? null : t.id)}
                onCor={(c) => patch(t.id, { cor: c })} />
            ))}
          </Secao>
        </>
      )}
    </div>
  );
}

function Secao({ titulo, nota, vazio, children }: { titulo: string; nota?: string; vazio?: string; children: React.ReactNode }) {
  const temFilhos = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div className="mb-6">
      <h2 className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{titulo}</h2>
      {nota && <p className="mb-2 text-xs text-slate-400 dark:text-slate-500">{nota}</p>}
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {temFilhos ? children : <p className="px-3 py-3 text-sm text-slate-400 dark:text-slate-500">{vazio}</p>}
      </div>
    </div>
  );
}

function Linha({ t, admin, salvando, corAberta, onAbrirCor, onCor, onRenomear, onExcluir }: {
  t: Tag; admin: boolean; salvando: boolean;
  corAberta: boolean; onAbrirCor: () => void; onCor: (c: string) => void;
  onRenomear?: () => void; onExcluir?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2">
      <TagChip tag={t.nome} cor={t.cor} />
      <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">{t.usos} card(s)</span>
      <span className="flex-1" />
      {corAberta && admin && (
        <div className="flex items-center gap-1">
          {PALETA.map((c) => (
            <button key={c} type="button" disabled={salvando} onClick={() => onCor(c)}
              className={cn("h-4 w-4 rounded-full transition hover:scale-110", t.cor === c && "ring-2 ring-slate-400 ring-offset-1 dark:ring-offset-slate-900")}
              style={{ backgroundColor: c }} />
          ))}
        </div>
      )}
      {admin && (
        <button type="button" disabled={salvando} onClick={onAbrirCor}
          className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
          title="Trocar a cor">
          Cor
        </button>
      )}
      {admin && onRenomear && (
        <button type="button" disabled={salvando} onClick={onRenomear}
          className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800">
          Renomear
        </button>
      )}
      {admin && onExcluir && (
        <button type="button" disabled={salvando} onClick={onExcluir}
          className="rounded-md px-2 py-1 text-xs font-medium text-rose-500 transition hover:bg-rose-50 dark:hover:bg-rose-500/10">
          Excluir
        </button>
      )}
    </div>
  );
}
