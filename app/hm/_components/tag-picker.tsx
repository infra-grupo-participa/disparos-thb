"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { cn } from "@/app/_components/ui";
import { TagChip } from "@/app/_components/tags";

// O seletor de tags (estilo Clint): um botão "+ Tag" que abre a busca; digitar
// filtra o catálogo, e um nome que não existe vira a linha "criar" — criar É
// digitar. As tags gerenciadas (Origem/Turma/Aurum) nem aparecem: são do
// sistema, e oferecê-las aqui seria convidar ao erro que o serviço recusa.
// `categoria`/`descricao` (dicionário de tags, 12/08): a cor já chega pronta —
// DERIVADA da categoria pelo backend — e a descrição vira tooltip na opção,
// para o operador bater o olho e entender o que a tag significa antes de
// aplicá-la, sem sair da busca. Ambos opcionais: telas antigas / API em voo
// continuam funcionando sem eles.
// `cor_efetiva` (0206) é a cor que se DESENHA — override da tag OU cor da
// categoria OU cinza neutro, já resolvida pelo backend. `cor` continua
// existindo (é o override cru), mas quem pinta pixel é sempre `cor_efetiva`
// com fallback para `cor` — telas antigas ou payload sem o campo novo não
// quebram, só perdem a herança de cor da categoria.
export type TagOpcao = { nome: string; cor: string | null; cor_efetiva?: string | null; tipo?: string; categoria?: string | null; descricao?: string | null };

const RE_TAG_GERENCIADA = /^(Origem|Turma|Aurum) /;

type Props = {
  opcoes: TagOpcao[];
  /** tags que o(s) card(s) já têm — saem da lista (atribuir de novo é no-op) */
  jaTem?: string[];
  onEscolher: (nome: string) => void;
  disabled?: boolean;
  rotulo?: string;
};

export function TagPicker({ opcoes, jaTem = [], onEscolher, disabled, rotulo = "Tag" }: Props) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const raiz = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!aberto) return;
    input.current?.focus();
    const clique = (e: MouseEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(false);
    };
    document.addEventListener("mousedown", clique);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", clique);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  const q = busca.trim();
  const filtradas = useMemo(() => {
    const base = opcoes.filter((o) => !jaTem.includes(o.nome) && !RE_TAG_GERENCIADA.test(o.nome));
    if (!q) return base;
    return base.filter((o) => o.nome.toLowerCase().includes(q.toLowerCase()));
  }, [opcoes, jaTem, q]);

  const existeExata = opcoes.some((o) => o.nome.toLowerCase() === q.toLowerCase());
  const podeCriar = q.length >= 2 && !existeExata && !RE_TAG_GERENCIADA.test(q);

  function escolher(nome: string) {
    onEscolher(nome);
    setBusca("");
    setAberto(false);
  }

  return (
    <div ref={raiz} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAberto((a) => !a)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-500 transition hover:border-brand hover:text-brand disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:border-brand-400 dark:hover:text-brand-300"
      >
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        {rotulo}
      </button>

      {aberto && (
        <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-lg border border-slate-200 bg-white shadow-pop dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 p-2 dark:border-slate-800">
            <input
              ref={input}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                // Enter escolhe a primeira da lista; sem resultado, cria.
                if (filtradas.length > 0) escolher(filtradas[0].nome);
                else if (podeCriar) escolher(q);
              }}
              placeholder="Buscar ou criar tag…"
              className="w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none placeholder:text-slate-400 focus:border-brand dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-brand-400"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtradas.map((o) => (
              <button
                key={o.nome}
                type="button"
                onClick={() => escolher(o.nome)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <TagChip tag={o.nome} mini cor={o.cor_efetiva ?? o.cor} titulo={o.descricao || (o.categoria ? `Categoria: ${o.categoria}` : undefined)} />
                {o.tipo === "sistema" && (
                  <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-slate-300 dark:text-slate-600">sistema</span>
                )}
              </button>
            ))}
            {filtradas.length === 0 && !podeCriar && (
              <p className="px-3 py-2 text-xs text-slate-400 dark:text-slate-500">
                {q ? "Nenhuma tag encontrada." : "Todas as tags já estão no card."}
              </p>
            )}
            {podeCriar && (
              <button
                type="button"
                onClick={() => escolher(q)}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm font-medium text-brand transition hover:bg-brand/5 dark:text-brand-300 dark:hover:bg-brand-400/10"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                Criar “{q}”
              </button>
            )}
          </div>
          <Link
            href="/hm/tags"
            className="block border-t border-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
          >
            Gerenciar tags →
          </Link>
        </div>
      )}
    </div>
  );
}
