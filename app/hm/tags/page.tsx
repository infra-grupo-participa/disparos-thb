"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, cn, fieldClass, Spinner } from "@/app/_components/ui";
import { TagChip } from "@/app/_components/tags";
import { useMe } from "@/app/_components/use-me";
import { MarcaPortal } from "@/app/_components/marca";
import { useFetchHm } from "@/app/hm/_components/api-produto";
import { useProdutoHm } from "@/app/hm/_components/use-produto";

// Gestão do catálogo de tags do HM (cs.tags, 0067) — agora um DICIONÁRIO.
// A dor original (pedido do Marcio): ninguém sabe o que cada tag SIGNIFICA —
// de que canal o aluno veio, qual a base dele no THB, a finalidade da marca.
// Antes a tela só listava nome+cor; agora agrupa por CATEGORIA (canal, base,
// operação…) e mostra a DESCRIÇÃO ao lado de cada tag. Criar é de todos;
// renomear, recolorir, categorizar/descrever e excluir são de admin, porque
// propagam para TODOS os cards.
//
// `categoria`, `descricao` e a cor DERIVADA da categoria são campos NOVOS que
// o backend está subindo em paralelo (12/08) — por isso são opcionais aqui: a
// tela funciona com ou sem eles, sem quebrar. Tag em uso sem categoria não
// desaparece — cai no grupo "Não catalogada" (destaque âmbar), porque sumir
// seria pior do que aparecer feio: escondia justamente a dívida que motivou
// o pedido ("precisa estar sempre em dia").

type Tag = {
  id: string; nome: string; cor: string | null; tipo: "livre" | "sistema"; usos: number;
  categoria?: string | null; categoria_rotulo?: string | null; descricao?: string | null;
  // categoria_descricao (12/08): o texto que explica a FAMÍLIA inteira (ex.: "de
  // que canal o aluno veio") — vem de cs.tag_categoria.descricao, é igual para
  // todas as tags da mesma categoria e alimenta a legenda no topo da tela.
  categoria_descricao?: string | null;
  // cor_efetiva (0206): a cor que o backend já resolveu — override da tag OU
  // cor da categoria OU cinza neutro. É ELA que se desenha; `cor` continua
  // existindo só como o override cru (para saber se há um override ativo).
  cor_efetiva?: string | null;
};

// As 6 categorias que o backend aceita no PATCH (whitelist) — precisa bater
// 1:1 com o `check` da migration 0206, senão o PATCH volta com erro de
// categoria inválida. Rótulo aqui é só o fallback: se `categoria_rotulo` vier
// no payload (cs.tag_categoria.rotulo), ele tem prioridade.
// Cor + descrição-padrão aqui batem 1:1 com a paleta fixa da migration 0206
// (cs.tag_categoria) — servem de FALLBACK para a legenda funcionar mesmo antes
// da API responder ou se uma categoria ainda não tiver nenhuma tag em uso (por
// isso não dá para tirar a cor só das tags carregadas: categoria "vazia" no
// board também precisa aparecer na legenda, ela é sobre o SIGNIFICADO, não sobre
// o que está em uso agora). Quando a API traz `categoria_descricao`, ela vence.
const CATEGORIAS: { valor: string; rotulo: string; cor: string; descricaoPadrao: string }[] = [
  { valor: "publico", rotulo: "Público", cor: "#10b981", descricaoPadrao: "Quem é a pessoa — aluno, lead, cliente VIP." },
  { valor: "canal", rotulo: "Canal", cor: "#3b82f6", descricaoPadrao: "Por onde o contato chegou até nós." },
  { valor: "turma", rotulo: "Turma", cor: "#7c3aed", descricaoPadrao: "De qual turma/edição a pessoa veio." },
  { valor: "origem_base", rotulo: "Origem/Base", cor: "#f59e0b", descricaoPadrao: "Qual a base dele no THB como um todo." },
  { valor: "produto", rotulo: "Produto", cor: "#06b6d4", descricaoPadrao: "A qual produto a tag se refere." },
  { valor: "operacional", rotulo: "Operacional", cor: "#64748b", descricaoPadrao: "Marcador de rotina do time — sem relação com canal/origem." },
];
const COR_NAO_CATALOGADA = "#94a3b8";

// Paleta fixa: cor livre demais vira arco-íris ilegível; 12 tons bastam.
// Usada só na CRIAÇÃO (antes de haver categoria) e no recolorir manual — a cor
// de exibição no dicionário é a do backend (derivada da categoria) quando ela vier.
const PALETA = [
  "#f97316", "#ef4444", "#ec4899", "#8b5cf6", "#6366f1", "#3b82f6",
  "#06b6d4", "#10b981", "#84cc16", "#eab308", "#f59e0b", "#64748b",
];

const SEM_CATEGORIA = "__sem_categoria__";

// Rótulo humano por chave de categoria — prioriza o rótulo oficial que o
// banco manda (cs.tag_categoria.rotulo); cai na lista local e, por último,
// capitaliza a chave crua se nada bater (categoria nova ainda não sincronizada).
function rotuloCategoria(chave: string, doBanco?: string | null): string {
  if (chave === SEM_CATEGORIA) return "Não catalogada";
  if (doBanco) return doBanco;
  const local = CATEGORIAS.find((c) => c.valor === chave);
  if (local) return local.rotulo;
  return chave.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function HmTagsPage() {
  // Gestão do catálogo (renomear/recolorir/categorizar/excluir propaga a TODOS
  // os cards) é do MASTER — admin de equipe comum não gere catálogo global.
  // Criar é de todos.
  const { ehMaster } = useMe();
  const admin = ehMaster();
  const fetchHm = useFetchHm(); // anexa ?produto= — o catálogo é recortado por board
  const { portal, base, nome: nomePortal } = useProdutoHm(); // marca, título e volta do portal atual
  const [tags, setTags] = useState<Tag[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState("");
  const [novaCor, setNovaCor] = useState<string>(PALETA[0]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [corAberta, setCorAberta] = useState<string | null>(null);
  // Descrição em edição (id da tag) — evita reabrir/perder foco a cada patch.
  const [descEditando, setDescEditando] = useState<string | null>(null);
  const [descRascunho, setDescRascunho] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroCarga(null);
    try {
      const r = await fetchHm("/api/hm/tags");
      // fetch não lança em 4xx/5xx — cheque r.ok antes de confiar no JSON.
      if (!r.ok) {
        setErroCarga(`O servidor respondeu com erro (${r.status}). Tente de novo em instantes.`);
        return;
      }
      const d = await r.json();
      if (d.ok) setTags(d.tags);
      else setErroCarga(d.reason || "Não foi possível carregar o dicionário de tags.");
    } catch {
      setErroCarga("Falha de rede — tente atualizar.");
    } finally {
      setCarregando(false);
    }
  }, [fetchHm]);
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

  function abrirDescricao(t: Tag) {
    setDescEditando(t.id);
    setDescRascunho(t.descricao ?? "");
  }
  async function salvarDescricao(t: Tag) {
    const v = descRascunho.trim();
    setDescEditando(null);
    if (v === (t.descricao ?? "")) return;
    await patch(t.id, { descricao: v || null });
  }

  // Agrupa por categoria — "Não catalogada" sempre por último e sempre visível
  // se houver alguma tag sem categoria (a dívida que motivou o pedido não some).
  const grupos = useMemo(() => {
    const mapa = new Map<string, Tag[]>();
    for (const t of tags) {
      const chave = t.categoria?.trim() || SEM_CATEGORIA;
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave)!.push(t);
    }
    const chaves = [...mapa.keys()].sort((a, b) => {
      if (a === SEM_CATEGORIA) return 1;
      if (b === SEM_CATEGORIA) return -1;
      return a.localeCompare(b, "pt-BR");
    });
    return chaves.map((chave) => {
      const tagsDoGrupo = mapa.get(chave)!.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
      // categoria_rotulo é igual para todas as tags do grupo — pega da primeira que tiver.
      const rotuloBanco = tagsDoGrupo.find((t) => t.categoria_rotulo)?.categoria_rotulo;
      return { chave, tags: tagsDoGrupo, rotuloBanco };
    });
  }, [tags]);

  // Descrição REAL de cada categoria (cs.tag_categoria.descricao, 12/08) — pega
  // da primeira tag carregada que já traga o campo. Usado na legenda no lugar
  // do texto padrão local sempre que o banco tiver a descrição oficial.
  const descricoesCategoria = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const t of tags) {
      if (t.categoria && t.categoria_descricao && !mapa.has(t.categoria)) mapa.set(t.categoria, t.categoria_descricao);
    }
    return mapa;
  }, [tags]);
  const legendaDescricao = useCallback((categoria: string) => descricoesCategoria.get(categoria), [descricoesCategoria]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`${base}/kanban`} className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        Voltar à esteira
      </Link>

      <div className="mb-1 flex items-center gap-2.5">
        <MarcaPortal portal={portal} altura="h-7" comNome={false} />
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Dicionário de tags · {nomePortal}</h1>
      </div>
      <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
        O que cada tag significa — de que canal o aluno veio, qual a base dele no THB, ou outra finalidade. Agrupadas por
        categoria, com a cor da categoria. Criar é de todos; renomear, recolorir, descrever e excluir propagam para todos
        os cards — por isso são do administrador do Grupo Participa.
      </p>

      {/* Legenda das 6 famílias — a queixa central do Marcio: "não sabemos o que
          significa cada tag". Cor sozinha nunca é o rótulo (a11y): cada swatch
          vem com o nome da família por extenso + a descrição do que ela indica. */}
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Legenda — o que cada cor indica
        </h2>
        <ul className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
          {CATEGORIAS.map((c) => (
            <li key={c.valor} className="flex items-start gap-2">
              <span aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: c.cor }} />
              <p className="text-xs text-slate-600 dark:text-slate-300">
                <span className="font-semibold text-slate-800 dark:text-slate-100">{c.rotulo}</span>
                {" — "}
                {legendaDescricao(c.valor) || c.descricaoPadrao}
              </p>
            </li>
          ))}
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: COR_NAO_CATALOGADA }} />
            <p className="text-xs text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-slate-100">Não catalogada</span>
              {" — "}tag em uso que ainda não recebeu categoria. Precisa ser classificada abaixo.
            </p>
          </li>
        </ul>
      </div>

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
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
          A tag nasce em &quot;Operacional&quot; (marcador de rotina do time) — troque a categoria abaixo se ela for de outra natureza.
        </p>
      </div>

      {carregando ? (
        <div className="flex items-center justify-center gap-3 py-16 text-slate-400"><Spinner className="h-5 w-5" /> Carregando…</div>
      ) : erroCarga ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-8 text-center text-sm text-rose-600 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400">{erroCarga}</p>
      ) : tags.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400 dark:border-slate-700 dark:text-slate-500">
          Nenhuma tag ainda — crie a primeira acima ou direto no seletor da tabela/board.
        </p>
      ) : (
        grupos.map((g) => (
          <Grupo
            key={g.chave}
            titulo={rotuloCategoria(g.chave, g.rotuloBanco)}
            naoCatalogada={g.chave === SEM_CATEGORIA}
          >
            {g.tags.map((t) => (
              <Linha
                key={t.id}
                t={t}
                admin={admin}
                salvando={salvando}
                corAberta={corAberta === t.id}
                onAbrirCor={() => setCorAberta(corAberta === t.id ? null : t.id)}
                onCor={(c) => patch(t.id, { cor: c })}
                onCategoria={(c) => patch(t.id, { categoria: c })}
                onRenomear={t.tipo === "livre" ? () => renomear(t) : undefined}
                onExcluir={t.tipo === "livre" ? () => excluir(t) : undefined}
                editandoDescricao={descEditando === t.id}
                descRascunho={descRascunho}
                onAbrirDescricao={() => abrirDescricao(t)}
                onDescRascunho={setDescRascunho}
                onSalvarDescricao={() => salvarDescricao(t)}
                onCancelarDescricao={() => setDescEditando(null)}
              />
            ))}
          </Grupo>
        ))
      )}
    </div>
  );
}

function Grupo({ titulo, naoCatalogada, children }: { titulo: string; naoCatalogada?: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h2 className={cn(
        "mb-1 flex items-center gap-1.5 text-sm font-semibold",
        naoCatalogada ? "text-amber-700 dark:text-amber-300" : "text-slate-700 dark:text-slate-200",
      )}>
        {naoCatalogada && (
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
        )}
        {titulo}
      </h2>
      {naoCatalogada && (
        <p className="mb-2 text-xs text-amber-600 dark:text-amber-400">
          Tags em uso que ainda não foram classificadas — não sumiram, mas ninguém sabe o que significam. Categorize-as abaixo.
        </p>
      )}
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
        {children}
      </div>
    </div>
  );
}

function Linha({
  t, admin, salvando, corAberta, onAbrirCor, onCor, onCategoria, onRenomear, onExcluir,
  editandoDescricao, descRascunho, onAbrirDescricao, onDescRascunho, onSalvarDescricao, onCancelarDescricao,
}: {
  t: Tag; admin: boolean; salvando: boolean;
  corAberta: boolean; onAbrirCor: () => void; onCor: (c: string) => void;
  onCategoria: (c: string | null) => void;
  onRenomear?: () => void; onExcluir?: () => void;
  editandoDescricao: boolean; descRascunho: string;
  onAbrirDescricao: () => void; onDescRascunho: (v: string) => void;
  onSalvarDescricao: () => void; onCancelarDescricao: () => void;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {/* cor_efetiva (0206): override da tag OU cor da categoria OU cinza
            neutro — o mesmo padrão das outras 4 telas. Renderizar `t.cor` cru
            deixava a maioria (tipo='sistema', cor=null) sem cor justamente
            aqui, na tela que existe para explicar a coloração. */}
        <TagChip tag={t.nome} cor={t.cor_efetiva ?? t.cor} titulo={t.descricao} />
        {t.tipo === "sistema" && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-slate-300 dark:text-slate-600">sistema</span>
        )}
        <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">{t.usos} card(s)</span>
        <span className="flex-1" />
        {admin && (
          <>
            <label className="sr-only" htmlFor={`cat-${t.id}`}>Categoria da tag {t.nome}</label>
            <select
              id={`cat-${t.id}`}
              disabled={salvando}
              value={t.categoria ?? SEM_CATEGORIA}
              onChange={(e) => onCategoria(e.target.value === SEM_CATEGORIA ? null : e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-xs text-slate-600 outline-none transition focus:border-brand focus:ring-1 focus:ring-brand disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:focus:border-brand-400"
              title="Categoria — decide a cor herdada da tag"
            >
              <option value={SEM_CATEGORIA}>Não catalogada</option>
              {CATEGORIAS.map((c) => (
                <option key={c.valor} value={c.valor}>{c.rotulo}</option>
              ))}
            </select>
          </>
        )}
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

      {/* Descrição — o coração do dicionário: o que a tag SIGNIFICA. Visível a
          todos (leitura); só o admin edita, porque a descrição é do catálogo,
          não do card. */}
      {editandoDescricao ? (
        <div className="mt-1.5 flex items-start gap-1.5">
          <label className="sr-only" htmlFor={`desc-${t.id}`}>Descrição da tag {t.nome}</label>
          <textarea
            id={`desc-${t.id}`}
            autoFocus
            value={descRascunho}
            onChange={(e) => onDescRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onCancelarDescricao();
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSalvarDescricao();
            }}
            rows={2}
            placeholder="O que esta tag significa — canal de origem, base no THB, finalidade…"
            className={cn(fieldClass, "text-xs")}
          />
          <div className="flex shrink-0 flex-col gap-1">
            <Button variant="primary" size="sm" onClick={onSalvarDescricao}>Salvar</Button>
            <Button variant="secondary" size="sm" onClick={onCancelarDescricao}>Cancelar</Button>
          </div>
        </div>
      ) : t.descricao ? (
        <p
          className={cn("mt-1 text-xs text-slate-500 dark:text-slate-400", admin && "cursor-pointer hover:text-slate-700 dark:hover:text-slate-200")}
          onClick={admin ? onAbrirDescricao : undefined}
          title={admin ? "Clique para editar a descrição" : undefined}
        >
          {t.descricao}
        </p>
      ) : admin ? (
        <button
          type="button"
          onClick={onAbrirDescricao}
          className="mt-1 text-xs font-medium text-amber-600 underline decoration-dotted underline-offset-2 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
        >
          Sem descrição — clique para explicar o que esta tag significa
        </button>
      ) : (
        <p className="mt-1 text-xs italic text-amber-600 dark:text-amber-400">Sem descrição cadastrada.</p>
      )}
    </div>
  );
}
