"use client";

// Catálogo de ofertas (0255/0256/0257, B6/F6) — MASTER-ONLY.
//
// A tabela por trás (`public.hm_product_catalog`) é a que decide o que 242
// pessoas devem — mas as colunas que esta tela edita são só a VITRINE
// (nome comercial, valor de tabela, link, dono, papel, ativo). A RÉGUA
// financeira (pacote_cheio, entrada_condicao_fechada, entrada_do_programa,
// concede_trilha, categoria) não tem como esta tela tocar: o schema do PATCH
// nem aceita esses campos (HmOfertaPatchSchema) e a função de promoção só
// preenche coluna que já está vazia (coalesce). Por isso a régua aparece aqui
// só como LEITURA, ao lado da vitrine, para o master entender o que está
// vendo — nunca como campo editável.
//
// Import nunca escreve direto no catálogo: planilha → cs.oferta_planilha_staging
// (quarentena) → conferência nesta tela → promoção linha a linha, com
// confirmação. Sem tabela editável em massa, de propósito — é dinheiro.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarcaPortal } from "@/app/_components/marca";
import { Button, cn, EmptyState, fieldClass, fieldCompactClass, Spinner } from "@/app/_components/ui";
import { Atualizado, Callout, Selo, thClass, thNumClass, theadClass, tdClass, tdNumClass, TOM, type Tom } from "@/app/_components/ui-base";
import { msgErroCarregamento, msgErroPermissao, useMe } from "@/app/_components/use-me";
import { useProdutoHm } from "@/app/hm/_components/use-produto";

// ---------------------------------------------------------------------------
// Tipos (espelham lib/services/hm-ofertas.ts — redeclarados aqui de propósito:
// aquele arquivo importa lib/db, server-only, e não pode entrar no bundle do
// cliente).
// ---------------------------------------------------------------------------
type OfertaCatalogo = {
  offer_code: string;
  product_id: string | null;
  product_name: string | null;
  categoria: string | null;
  nome_comercial: string | null;
  valor_tabela: string | null;
  explicacao: string | null;
  link: string | null;
  produto_checkout: string | null;
  dono_email: string | null;
  recorrente: boolean;
  ativo: boolean;
  origem_do_dado: string;
  origem_ref: string | null;
  papel: string | null;
  pacote_cheio: string | null;
  entrada_condicao_fechada: boolean;
  entrada_do_programa: boolean;
  concede_trilha: boolean;
  atualizado_por: string | null;
  atualizado_em: string | null;
};

type LinhaStaging = {
  id: number;
  lote: string;
  linha_num: number;
  produto_txt: string | null;
  nome_txt: string | null;
  valor_txt: string | null;
  valor_num_planilha: string | null;
  explicacao_txt: string | null;
  nome_hotmart_txt: string | null;
  offer_code: string | null;
  link: string | null;
  produto_checkout: string | null;
  motivo_quarentena: string | null;
  importado_em: string;
  importado_por: string;
};

type ResultadoPromocao = { ok: boolean; offer_code: string | null; acao: string | null; motivo: string | null };

// ---------------------------------------------------------------------------
// Constantes / helpers
// ---------------------------------------------------------------------------
const PAPEL_OPCOES: { valor: string; rotulo: string }[] = [
  { valor: "entrada", rotulo: "Entrada" },
  { valor: "saldo", rotulo: "Saldo" },
  { valor: "pacote_cheio", rotulo: "Pacote cheio" },
  { valor: "renovacao", rotulo: "Renovação" },
  { valor: "ingresso", rotulo: "Ingresso" },
  { valor: "upgrade_ingresso", rotulo: "Upgrade de ingresso" },
  { valor: "transmissao", rotulo: "Transmissão" },
  { valor: "acordo_individual", rotulo: "Acordo individual" },
];
const ROTULO_PAPEL: Record<string, string> = Object.fromEntries(PAPEL_OPCOES.map((p) => [p.valor, p.rotulo]));

const ROTULO_ORIGEM: Record<string, string> = {
  webhook: "Detectada na compra",
  planilha: "Planilha",
  migration: "Migration",
  manual: "Editada na tela",
};

// De-para produto_checkout -> produto (cs.hm_produto_checkout_de_para, 0255).
// Só DESCRITIVO — a mesma regra do banco, para a tela filtrar/mostrar sem
// precisar de uma rota nova.
const PRODUTO_POR_CHECKOUT: Record<string, string> = {
  L97981750T: "HM",
  P84471811S: "AURUM",
  R101026783U: "ETHB",
  G106745288D: "FIRE",
  F84471622V: "TRANSMISSÃO",
};

function produtoDaOferta(o: { produto_checkout: string | null; product_name: string | null }): string {
  if (o.produto_checkout && PRODUTO_POR_CHECKOUT[o.produto_checkout]) return PRODUTO_POR_CHECKOUT[o.produto_checkout];
  const pn = (o.product_name ?? "").toLowerCase();
  if (pn.includes("aurum")) return "AURUM";
  if (pn.includes("holding masters") || pn.includes("holding - holding")) return "HM";
  if (pn.includes("time hb") || pn.includes("ethb") || pn.includes("encontro")) return "ETHB";
  return "—";
}

function paraNumero(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtBRL(v: string | number | null | undefined): string {
  const n = paraNumero(v);
  return n === null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Parser de CSV — sem dependência nova. Lida com aspas, vírgula/; dentro de
// campo e quebra de linha dentro de campo (a planilha real tem isso: a
// "Explicação" da Renata Bassi tem \n dentro do próprio campo).
// ---------------------------------------------------------------------------
function detectarDelimitador(texto: string): "," | ";" {
  const primeiraLinha = texto.split(/\r?\n/, 1)[0] ?? "";
  const nVirgula = (primeiraLinha.match(/,/g) ?? []).length;
  const nPontoVirgula = (primeiraLinha.match(/;/g) ?? []).length;
  return nPontoVirgula > nVirgula ? ";" : ",";
}

function parseCsv(texto: string, delim: string): string[][] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let dentroAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (dentroAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else { dentroAspas = false; }
      } else {
        campo += c;
      }
      continue;
    }
    if (c === '"') { dentroAspas = true; continue; }
    if (c === delim) { linha.push(campo); campo = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { linha.push(campo); linhas.push(linha); linha = []; campo = ""; continue; }
    campo += c;
  }
  if (campo.length > 0 || linha.length > 0) { linha.push(campo); linhas.push(linha); }
  return linhas.filter((l) => l.some((c) => c.trim() !== ""));
}

function normalizarCabecalho(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
}

type ChaveLinha = "produto_txt" | "nome_txt" | "valor_txt" | "explicacao_txt" | "nome_hotmart_txt" | "offer_code" | "link";

function mapearColuna(cabecalho: string): ChaveLinha | null {
  const h = normalizarCabecalho(cabecalho);
  if (h.includes("hotmart")) return "nome_hotmart_txt";
  if (h.includes("codigo")) return "offer_code";
  if (h.includes("link")) return "link";
  if (h.includes("explicac")) return "explicacao_txt";
  if (h.includes("valor")) return "valor_txt";
  if (h.includes("produto")) return "produto_txt";
  if (h.includes("nome")) return "nome_txt";
  return null;
}

type LinhaParaImportar = {
  linha_num: number;
  produto_txt?: string | null;
  nome_txt?: string | null;
  valor_txt?: string | null;
  explicacao_txt?: string | null;
  nome_hotmart_txt?: string | null;
  offer_code?: string | null;
  link?: string | null;
};

const LIMITES: Record<ChaveLinha, number> = {
  produto_txt: 400, nome_txt: 400, valor_txt: 200, explicacao_txt: 4000,
  nome_hotmart_txt: 4000, offer_code: 60, link: 500,
};

function processarCsv(texto: string): { linhas: LinhaParaImportar[]; erros: string[]; truncado: boolean } {
  const delim = detectarDelimitador(texto);
  const tabela = parseCsv(texto, delim);
  const erros: string[] = [];
  if (tabela.length < 2) {
    return { linhas: [], erros: ["Arquivo vazio ou sem linha de dado abaixo do cabeçalho."], truncado: false };
  }
  const cabecalho = tabela[0].map(mapearColuna);
  if (!cabecalho.some((c) => c === "nome_txt" || c === "produto_txt" || c === "offer_code")) {
    erros.push('Cabeçalho não reconhecido — a primeira linha precisa ter colunas como "Produto", "Nome", "Valor", "Código" ou "Link".');
    return { linhas: [], erros, truncado: false };
  }

  const linhas: LinhaParaImportar[] = [];
  for (let i = 1; i < tabela.length; i++) {
    const linhaNum = i + 1; // 1 = cabeçalho, igual à planilha original
    const l: LinhaParaImportar = { linha_num: linhaNum };
    tabela[i].forEach((valorCru, idx) => {
      const chave = cabecalho[idx];
      if (!chave) return;
      const v = valorCru.trim();
      if (!v) return;
      if (v.length > LIMITES[chave]) {
        erros.push(`Linha ${linhaNum}: campo "${chave}" tem ${v.length} caracteres (máx. ${LIMITES[chave]}).`);
        return;
      }
      l[chave] = v;
    });
    if (Object.keys(l).length > 1) linhas.push(l);
  }

  const truncado = linhas.length > 2000;
  return { linhas: truncado ? linhas.slice(0, 2000) : linhas, erros, truncado };
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
type Aba = "catalogo" | "importar";

export default function OfertasPage() {
  const { me, ehMaster } = useMe();
  const admin = ehMaster();
  const { portal, nome: nomePortal } = useProdutoHm();

  const [aba, setAba] = useState<Aba>("catalogo");

  // ----- Catálogo -----
  const [ofertas, setOfertas] = useState<OfertaCatalogo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erroCarregar, setErroCarregar] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [filtroProduto, setFiltroProduto] = useState("");
  const [filtroPapel, setFiltroPapel] = useState("");
  const [filtroOrigem, setFiltroOrigem] = useState("");
  const [filtroAtivo, setFiltroAtivo] = useState("");
  const [soSemValor, setSoSemValor] = useState(false);
  const [soSemProduto, setSoSemProduto] = useState(false);
  const [editando, setEditando] = useState<OfertaCatalogo | null>(null);

  const carregarOfertas = useCallback(async () => {
    setCarregando(true);
    setErroCarregar(null);
    try {
      const r = await fetch("/api/hm/ofertas");
      if (!r.ok) {
        let reason: string | null = null;
        try { reason = (await r.json())?.reason ?? null; } catch { /* corpo vazio */ }
        setErroCarregar(msgErroPermissao(reason) ?? msgErroCarregamento(r.status));
        return;
      }
      const d = await r.json();
      if (!d.ok) { setErroCarregar(d.reason ?? "Não foi possível carregar o catálogo."); return; }
      setOfertas(d.ofertas as OfertaCatalogo[]);
    } catch {
      setErroCarregar(msgErroCarregamento());
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { if (admin) carregarOfertas(); }, [admin, carregarOfertas]);

  const ofertasPorCodigo = useMemo(() => {
    const m = new Map<string, OfertaCatalogo>();
    for (const o of ofertas) m.set(o.offer_code, o);
    return m;
  }, [ofertas]);

  const produtosDisponiveis = useMemo(
    () => Array.from(new Set(ofertas.map(produtoDaOferta))).filter((p) => p !== "—").sort(),
    [ofertas],
  );

  const totalSemValor = useMemo(() => ofertas.filter((o) => !o.valor_tabela).length, [ofertas]);
  const totalSemProduto = useMemo(() => ofertas.filter((o) => !o.product_id).length, [ofertas]);

  const ofertasFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return ofertas.filter((o) => {
      if (q) {
        const alvo = `${o.offer_code} ${o.nome_comercial ?? ""} ${o.product_name ?? ""}`.toLowerCase();
        if (!alvo.includes(q)) return false;
      }
      if (filtroProduto && produtoDaOferta(o) !== filtroProduto) return false;
      if (filtroPapel && o.papel !== filtroPapel) return false;
      if (filtroOrigem && o.origem_do_dado !== filtroOrigem) return false;
      if (filtroAtivo === "true" && !o.ativo) return false;
      if (filtroAtivo === "false" && o.ativo) return false;
      if (soSemValor && o.valor_tabela) return false;
      if (soSemProduto && o.product_id) return false;
      return true;
    });
  }, [ofertas, busca, filtroProduto, filtroPapel, filtroOrigem, filtroAtivo, soSemValor, soSemProduto]);

  const filtrosAtivos = !!(busca || filtroProduto || filtroPapel || filtroOrigem || filtroAtivo || soSemValor || soSemProduto);
  function limparFiltros() {
    setBusca(""); setFiltroProduto(""); setFiltroPapel(""); setFiltroOrigem(""); setFiltroAtivo("");
    setSoSemValor(false); setSoSemProduto(false);
  }

  // ----- Importar -----
  const inputArquivoRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [linhasParaEnviar, setLinhasParaEnviar] = useState<LinhaParaImportar[]>([]);
  const [errosParse, setErrosParse] = useState<string[]>([]);
  const [truncadoParse, setTruncadoParse] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erroImportar, setErroImportar] = useState<string | null>(null);

  const [lote, setLote] = useState<string | null>(null);
  const [linhasLote, setLinhasLote] = useState<LinhaStaging[]>([]);
  const [carregandoLote, setCarregandoLote] = useState(false);
  const [resultados, setResultados] = useState<Record<number, ResultadoPromocao>>({});
  const [promovendo, setPromovendo] = useState<Set<number>>(new Set());

  function selecionarArquivo(f: File | null) {
    setArquivo(f);
    setLinhasParaEnviar([]);
    setErrosParse([]);
    setTruncadoParse(false);
    setErroImportar(null);
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setErrosParse(["Arquivo maior que 5 MB — planilha de ofertas não chega perto disso. Confira se é o arquivo certo."]);
      return;
    }
    const leitor = new FileReader();
    leitor.onload = () => {
      const texto = String(leitor.result ?? "");
      const { linhas, erros, truncado } = processarCsv(texto);
      setLinhasParaEnviar(linhas);
      setErrosParse(erros);
      setTruncadoParse(truncado);
    };
    leitor.onerror = () => setErrosParse(["Não foi possível ler o arquivo."]);
    leitor.readAsText(f, "utf-8");
  }

  async function importar() {
    if (!arquivo || linhasParaEnviar.length === 0) return;
    setEnviando(true);
    setErroImportar(null);
    try {
      const r = await fetch("/api/hm/ofertas/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arquivo: arquivo.name.slice(0, 200), linhas: linhasParaEnviar }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) {
        const detalhes = Array.isArray(d?.detalhes) ? d.detalhes.map((x: { campo: string; erro: string }) => `${x.campo}: ${x.erro}`).join(" · ") : null;
        setErroImportar(msgErroPermissao(d?.reason) ?? detalhes ?? d?.reason ?? msgErroCarregamento(r.status));
        return;
      }
      setLote(d.lote);
      setArquivo(null);
      setLinhasParaEnviar([]);
      if (inputArquivoRef.current) inputArquivoRef.current.value = "";
      await carregarLote(d.lote);
      await carregarOfertas();
    } catch {
      setErroImportar(msgErroCarregamento());
    } finally {
      setEnviando(false);
    }
  }

  const carregarLote = useCallback(async (l: string) => {
    setCarregandoLote(true);
    setResultados({});
    try {
      const r = await fetch(`/api/hm/ofertas/importacao/${encodeURIComponent(l)}`);
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { setLinhasLote([]); return; }
      setLinhasLote(d.linhas as LinhaStaging[]);
    } finally {
      setCarregandoLote(false);
    }
  }, []);

  async function promover(id: number, offerCode: string, jaExiste: boolean, valorPlanilha: number | null, valorBanco: number | null) {
    const aviso = jaExiste
      ? `Promover a linha "${offerCode}"?\n\nJá existe no catálogo — só os campos hoje VAZIOS serão preenchidos. Nada que já tem valor é sobrescrito.${
          valorPlanilha !== null && valorBanco !== null && Math.abs(valorPlanilha - valorBanco) > 0.01
            ? `\n\n⚠️ O valor da planilha (${fmtBRL(valorPlanilha)}) difere do valor já cadastrado (${fmtBRL(valorBanco)}). O valor cadastrado NÃO muda.`
            : ""
        }\n\nIsso não altera pacote_cheio, entrada_do_programa nem nenhuma régua financeira.`
      : `Promover a linha "${offerCode}"?\n\nVai criar uma oferta NOVA no catálogo, com origem "planilha".\n\nIsso não altera pacote_cheio, entrada_do_programa nem nenhuma régua financeira.`;
    if (!window.confirm(aviso)) return;

    setPromovendo((s) => new Set(s).add(id));
    try {
      const r = await fetch("/api/hm/ofertas/promover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staging_ids: [id] }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) {
        setResultados((rs) => ({ ...rs, [id]: { ok: false, offer_code: offerCode, acao: null, motivo: msgErroPermissao(d?.reason) ?? msgErroCarregamento(r.status) } }));
        return;
      }
      const resultado: ResultadoPromocao = d.resultados[0];
      setResultados((rs) => ({ ...rs, [id]: resultado }));
      if (resultado.ok) await carregarOfertas();
    } catch {
      setResultados((rs) => ({ ...rs, [id]: { ok: false, offer_code: offerCode, acao: null, motivo: msgErroCarregamento() } }));
    } finally {
      setPromovendo((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  const linhasClassificadas = useMemo(() => {
    return linhasLote.map((l) => {
      const emQuarentena = !!l.motivo_quarentena;
      const ofertaAtual = l.offer_code ? ofertasPorCodigo.get(l.offer_code) ?? null : null;
      const existeNoCatalogo = !!ofertaAtual;
      const valorPlanilha = paraNumero(l.valor_num_planilha);
      const valorBanco = paraNumero(ofertaAtual?.valor_tabela);
      const conflitoValor = existeNoCatalogo && valorPlanilha !== null && valorBanco !== null && Math.abs(valorPlanilha - valorBanco) > 0.01;
      return { l, emQuarentena, ofertaAtual, existeNoCatalogo, conflitoValor, valorPlanilha, valorBanco };
    });
  }, [linhasLote, ofertasPorCodigo]);

  const grupoQuarentena = linhasClassificadas.filter((x) => x.emQuarentena);
  const grupoCasou = linhasClassificadas.filter((x) => !x.emQuarentena && x.existeNoCatalogo);
  const grupoNovo = linhasClassificadas.filter((x) => !x.emQuarentena && !x.existeNoCatalogo);

  // ----- Guard -----
  if (me && !admin) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Consulta restrita</p>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Só o administrador do Grupo Participa consulta e edita o catálogo de ofertas.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal={portal} altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Ofertas · {nomePortal}
            </h1>
          </div>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            O catálogo é <strong>do Grupo Participa inteiro</strong> — HM, Aurum e ETHB no mesmo lugar, não só deste
            portal. Valor de tabela e link são vitrine para a operação citar ao aluno; não mudam o que ninguém deve.
          </p>
        </div>
      </div>

      <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800" role="tablist" aria-label="Seções de Ofertas">
        <button
          role="tab"
          aria-selected={aba === "catalogo"}
          onClick={() => setAba("catalogo")}
          className={cn(
            "alvo-toque rounded-t-lg px-3.5 py-2 text-sm font-medium transition",
            aba === "catalogo"
              ? "border-b-2 border-brand text-brand dark:text-brand-400"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
          )}
        >
          Catálogo
        </button>
        <button
          role="tab"
          aria-selected={aba === "importar"}
          onClick={() => setAba("importar")}
          className={cn(
            "alvo-toque rounded-t-lg px-3.5 py-2 text-sm font-medium transition",
            aba === "importar"
              ? "border-b-2 border-brand text-brand dark:text-brand-400"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200",
          )}
        >
          Importar planilha
        </button>
      </div>

      {aba === "catalogo" ? (
        <div role="tabpanel">
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Placar rotulo="No catálogo" valor={ofertas.length} />
            <Placar
              rotulo="Sem valor de tabela"
              valor={totalSemValor}
              tom={totalSemValor > 0 ? "atencao" : undefined}
              dica="valor_tabela nulo — a operação não tem preço de vitrine para citar"
            />
            <Placar
              rotulo="Sem produto (product_id)"
              valor={totalSemProduto}
              tom={totalSemProduto > 0 ? "atencao" : undefined}
              dica="product_id nulo — a oferta não casa com o roteamento de produto da Hotmart"
            />
            <Placar rotulo="Nesta busca" valor={ofertasFiltradas.length} />
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="ofertas-busca">Buscar por nome, código ou produto</label>
            <input
              id="ofertas-busca"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por nome, código ou produto…"
              className={cn(fieldClass, "max-w-xs")}
            />
            <label className="sr-only" htmlFor="ofertas-filtro-produto">Produto</label>
            <select id="ofertas-filtro-produto" value={filtroProduto} onChange={(e) => setFiltroProduto(e.target.value)} className={fieldCompactClass}>
              <option value="">Todos os produtos</option>
              {produtosDisponiveis.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <label className="sr-only" htmlFor="ofertas-filtro-papel">Papel</label>
            <select id="ofertas-filtro-papel" value={filtroPapel} onChange={(e) => setFiltroPapel(e.target.value)} className={fieldCompactClass}>
              <option value="">Todos os papéis</option>
              <option value="__nulo__" disabled>— não classificado —</option>
              {PAPEL_OPCOES.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
            </select>
            <label className="sr-only" htmlFor="ofertas-filtro-origem">Origem do dado</label>
            <select id="ofertas-filtro-origem" value={filtroOrigem} onChange={(e) => setFiltroOrigem(e.target.value)} className={fieldCompactClass}>
              <option value="">Qualquer origem</option>
              {Object.entries(ROTULO_ORIGEM).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </select>
            <label className="sr-only" htmlFor="ofertas-filtro-situacao">Situação</label>
            <select id="ofertas-filtro-situacao" value={filtroAtivo} onChange={(e) => setFiltroAtivo(e.target.value)} className={fieldCompactClass}>
              <option value="">Ativas e inativas</option>
              <option value="true">Só ativas</option>
              <option value="false">Só inativas</option>
            </select>
            <button
              type="button"
              onClick={() => setSoSemValor((v) => !v)}
              aria-pressed={soSemValor}
              className={cn(
                "alvo-toque rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                soSemValor ? TOM.atencao : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400",
              )}
            >
              Sem valor de tabela
            </button>
            <button
              type="button"
              onClick={() => setSoSemProduto((v) => !v)}
              aria-pressed={soSemProduto}
              className={cn(
                "alvo-toque rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                soSemProduto ? TOM.atencao : "bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400",
              )}
            >
              Sem product_id
            </button>
            {filtrosAtivos && (
              <button onClick={limparFiltros} className="rounded-lg px-2.5 py-1.5 text-sm text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
                Limpar
              </button>
            )}
            <button onClick={carregarOfertas} className="ml-auto rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800">
              Recarregar
            </button>
            {carregando && <Spinner className="h-4 w-4 text-slate-400" />}
          </div>

          {erroCarregar && <Callout tom="bloqueio" titulo="Não foi possível carregar o catálogo" className="mb-3">{erroCarregar}</Callout>}

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full text-sm">
              <thead>
                <tr className={theadClass}>
                  <th className={thClass}>Oferta</th>
                  <th className={thClass}>Produto</th>
                  <th className={thClass}>Papel</th>
                  <th className={thNumClass}>Valor de tabela</th>
                  <th className={thClass}>Link</th>
                  <th className={thClass}>Origem</th>
                  <th className={thClass}>Situação</th>
                  <th className={thClass}>Atualizado</th>
                  <th className={thClass}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {ofertasFiltradas.length === 0 && !carregando ? (
                  <tr><td colSpan={9} className="px-3 py-10 text-center text-sm text-slate-400">Nenhuma oferta com esses filtros.</td></tr>
                ) : (
                  ofertasFiltradas.map((o) => (
                    <tr key={o.offer_code} className="border-b border-slate-100 last:border-0 dark:border-slate-800/70">
                      <td className={tdClass}>
                        <p className="font-medium text-slate-800 dark:text-slate-100">{o.nome_comercial ?? o.product_name ?? "— sem nome comercial —"}</p>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">{o.offer_code}</p>
                      </td>
                      <td className={cn(tdClass, !o.product_id && "bg-amber-50/60 dark:bg-amber-500/5")}>
                        {produtoDaOferta(o)}
                        {!o.product_id && <Selo tom="atencao" className="ml-1.5">sem product_id</Selo>}
                      </td>
                      <td className={tdClass}>
                        {o.papel ? <Selo tom="contexto">{ROTULO_PAPEL[o.papel] ?? o.papel}</Selo> : <span className="text-[11px] text-slate-400 dark:text-slate-500">não classificado</span>}
                      </td>
                      <td className={cn(tdNumClass, !o.valor_tabela && "bg-amber-50/60 dark:bg-amber-500/5")}>
                        {o.valor_tabela ? fmtBRL(o.valor_tabela) : <Selo tom="atencao">sem valor</Selo>}
                      </td>
                      <td className={tdClass}>
                        {o.link ? (
                          <a href={o.link} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline dark:text-brand-400">
                            Abrir ↗
                          </a>
                        ) : <span className="text-[11px] text-slate-400 dark:text-slate-500">—</span>}
                      </td>
                      <td className={tdClass}><Selo tom="neutro">{ROTULO_ORIGEM[o.origem_do_dado] ?? o.origem_do_dado}</Selo></td>
                      <td className={tdClass}>
                        <Selo tom={o.ativo ? "positivo" : "bloqueio"}>{o.ativo ? "ativa" : "inativa"}</Selo>
                      </td>
                      <td className={tdClass}>
                        <Atualizado em={o.atualizado_em} />
                        {o.atualizado_por && <p className="text-[10px] text-slate-400 dark:text-slate-500">por {o.atualizado_por}</p>}
                      </td>
                      <td className={tdClass}>
                        <Button size="sm" variant="secondary" onClick={() => setEditando(o)}>Editar</Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div role="tabpanel">
          <Callout tom="contexto" titulo="A planilha nunca entra direto no catálogo" className="mb-4">
            Toda importação cai em quarentena (<code>cs.oferta_planilha_staging</code>). Você confere linha a linha
            abaixo e só então promove — uma por uma, com confirmação.
          </Callout>

          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <label htmlFor="ofertas-arquivo" className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Arquivo (.csv, exportado do Excel/Sheets em UTF-8)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="ofertas-arquivo"
                ref={inputArquivoRef}
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => selecionarArquivo(e.target.files?.[0] ?? null)}
                className="alvo-toque text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-300 dark:file:bg-slate-800 dark:file:text-slate-200"
              />
              <Button onClick={importar} disabled={!arquivo || linhasParaEnviar.length === 0 || enviando}>
                {enviando && <Spinner className="text-white" />}
                Importar planilha
              </Button>
            </div>
            {arquivo && errosParse.length === 0 && (
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {linhasParaEnviar.length} linha(s) reconhecida(s){truncadoParse ? " (só as 2.000 primeiras serão enviadas)" : ""}.
              </p>
            )}
            {errosParse.length > 0 && (
              <Callout tom="bloqueio" titulo="Não dá para importar este arquivo" className="mt-2">
                <ul className="list-disc space-y-0.5 pl-4">
                  {errosParse.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
                </ul>
                {errosParse.length > 10 && <p className="mt-1">e mais {errosParse.length - 10}…</p>}
              </Callout>
            )}
            {erroImportar && <Callout tom="bloqueio" titulo="A importação falhou" className="mt-2">{erroImportar}</Callout>}
          </div>

          {carregandoLote && (
            <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400"><Spinner className="h-4 w-4" /> Carregando o lote…</div>
          )}

          {lote && !carregandoLote && linhasLote.length > 0 && (
            <div aria-live="polite">
              <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
                Lote <code className="text-xs">{lote}</code> — {linhasLote.length} linha(s), {grupoQuarentena.length} em quarentena.
              </p>

              <GrupoConferencia
                titulo="Já no catálogo — promover só preenche o que está vazio"
                tomVazio="Nenhuma linha desta importação já existe no catálogo."
                itens={grupoCasou}
                resultados={resultados}
                promovendo={promovendo}
                onPromover={promover}
              />
              <GrupoConferencia
                titulo="Código novo — promover cria a oferta"
                tomVazio="Nenhuma linha nova nesta importação."
                itens={grupoNovo}
                resultados={resultados}
                promovendo={promovendo}
                onPromover={promover}
              />

              <SectionQuarentena itens={grupoQuarentena} />
            </div>
          )}

          {lote && !carregandoLote && linhasLote.length === 0 && (
            <EmptyState title="Lote sem linhas" description="A importação não trouxe nenhuma linha reconhecível." />
          )}
        </div>
      )}

      {editando && (
        <EditarOfertaModal
          key={editando.offer_code}
          oferta={editando}
          onClose={() => setEditando(null)}
          onSaved={() => { setEditando(null); carregarOfertas(); }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Placar (KPI simples, mesmo padrão de app/hm/acessos/page.tsx)
// ---------------------------------------------------------------------------
function Placar({ rotulo, valor, tom, dica }: { rotulo: string; valor: number; tom?: Tom; dica?: string }) {
  return (
    <div title={dica} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{rotulo}</p>
      <p className={cn("mt-0.5 text-2xl font-semibold tabular-nums", tom ? TOM[tom].split(" ").find((c) => c.startsWith("text-")) ?? "text-slate-800 dark:text-slate-100" : "text-slate-800 dark:text-slate-100")}>
        {valor}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grupo de conferência (casou / código novo)
// ---------------------------------------------------------------------------
type ItemClassificado = {
  l: LinhaStaging;
  emQuarentena: boolean;
  ofertaAtual: OfertaCatalogo | null;
  existeNoCatalogo: boolean;
  conflitoValor: boolean;
  valorPlanilha: number | null;
  valorBanco: number | null;
};

function GrupoConferencia({
  titulo, tomVazio, itens, resultados, promovendo, onPromover,
}: {
  titulo: string;
  tomVazio: string;
  itens: ItemClassificado[];
  resultados: Record<number, ResultadoPromocao>;
  promovendo: Set<number>;
  onPromover: (id: number, offerCode: string, jaExiste: boolean, valorPlanilha: number | null, valorBanco: number | null) => void;
}) {
  return (
    <div className="mb-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {titulo} ({itens.length})
      </h2>
      {itens.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">{tomVazio}</p>
      ) : (
        <div className="space-y-2">
          {itens.map((item) => (
            <LinhaConferencia
              key={item.l.id}
              item={item}
              resultado={resultados[item.l.id]}
              promovendo={promovendo.has(item.l.id)}
              onPromover={onPromover}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LinhaConferencia({
  item, resultado, promovendo, onPromover,
}: {
  item: ItemClassificado;
  resultado: ResultadoPromocao | undefined;
  promovendo: boolean;
  onPromover: (id: number, offerCode: string, jaExiste: boolean, valorPlanilha: number | null, valorBanco: number | null) => void;
}) {
  const { l, ofertaAtual, existeNoCatalogo, conflitoValor, valorPlanilha, valorBanco } = item;
  const codigo = l.offer_code ?? "(sem código)";
  const promovida = resultado?.ok === true;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-slate-800 dark:text-slate-100">{codigo}</p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">linha {l.linha_num} do arquivo</p>
        </div>
        <div className="flex items-center gap-2">
          {conflitoValor && <Selo tom="atencao">valor diverge do catálogo</Selo>}
          {promovida ? (
            <Selo tom="positivo">{resultado?.acao === "ja_promovido" ? "já promovida antes" : resultado?.acao === "inserido" ? "criada no catálogo" : "campos vazios preenchidos"}</Selo>
          ) : (
            <Button size="sm" onClick={() => onPromover(l.id, codigo, existeNoCatalogo, valorPlanilha, valorBanco)} disabled={promovendo || !l.offer_code}>
              {promovendo && <Spinner className="text-white" />}
              Promover esta linha
            </Button>
          )}
        </div>
      </div>

      {resultado && !resultado.ok && (
        <Callout tom="bloqueio" titulo="Não foi possível promover" className="mt-2">{resultado.motivo}</Callout>
      )}

      <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">A planilha diz</p>
          <CampoComparado rotulo="Produto/Nome" valor={l.produto_txt ?? l.nome_txt} />
          <CampoComparado rotulo="Valor" valor={l.valor_txt ? `${l.valor_txt} (lido como ${fmtBRL(l.valor_num_planilha)})` : null} />
          <CampoComparado rotulo="Explicação" valor={l.explicacao_txt} />
          <CampoComparado rotulo="Nome na Hotmart" valor={l.nome_hotmart_txt} />
          <CampoComparado rotulo="Link" valor={l.link} />
        </div>
        <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">O banco tem hoje</p>
          {existeNoCatalogo && ofertaAtual ? (
            <>
              <CampoComparado rotulo="Nome comercial" valor={ofertaAtual.nome_comercial} />
              <CampoComparado rotulo="Valor de tabela" valor={ofertaAtual.valor_tabela ? fmtBRL(ofertaAtual.valor_tabela) : null} destaque={conflitoValor} />
              <CampoComparado rotulo="Explicação" valor={ofertaAtual.explicacao} />
              <CampoComparado rotulo="Link" valor={ofertaAtual.link} />
              <CampoComparado rotulo="Situação" valor={ofertaAtual.ativo ? "ativa" : "inativa"} />
            </>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">— oferta nova, ainda não existe no catálogo —</p>
          )}
        </div>
      </div>
    </div>
  );
}

function CampoComparado({ rotulo, valor, destaque }: { rotulo: string; valor: string | null | undefined; destaque?: boolean }) {
  return (
    <p className="mb-1 text-xs text-slate-600 last:mb-0 dark:text-slate-300">
      <span className="text-slate-400 dark:text-slate-500">{rotulo}: </span>
      <span className={destaque ? "font-semibold text-amber-700 dark:text-amber-300" : undefined}>{valor || "—"}</span>
    </p>
  );
}

function SectionQuarentena({ itens }: { itens: ItemClassificado[] }) {
  if (itens.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        Quarentena — revisão humana ({itens.length})
      </h2>
      <div className="space-y-2">
        {itens.map(({ l }) => (
          <div key={l.id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
            <p className="font-medium text-slate-800 dark:text-slate-100">
              {l.offer_code ?? "(sem código)"} <span className="font-normal text-slate-400 dark:text-slate-500">— linha {l.linha_num}</span>
            </p>
            <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{l.motivo_quarentena}</p>
            <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              Não promove sozinha. Para resolver: reimporte um lote novo com o dado corrigido, ou edite o catálogo
              diretamente na aba Catálogo (se a oferta já existir lá).
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal de edição — só colunas descritivas (a régua financeira aparece como
// leitura, nunca como campo).
// ---------------------------------------------------------------------------
function EditarOfertaModal({
  oferta, onClose, onSaved,
}: {
  oferta: OfertaCatalogo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [nomeComercial, setNomeComercial] = useState(oferta.nome_comercial ?? "");
  const [valorTabela, setValorTabela] = useState(oferta.valor_tabela ?? "");
  const [explicacao, setExplicacao] = useState(oferta.explicacao ?? "");
  const [link, setLink] = useState(oferta.link ?? "");
  const [produtoCheckout, setProdutoCheckout] = useState(oferta.produto_checkout ?? "");
  const [donoEmail, setDonoEmail] = useState(oferta.dono_email ?? "");
  const [recorrente, setRecorrente] = useState(oferta.recorrente);
  const [ativo, setAtivo] = useState(oferta.ativo);
  const [papel, setPapel] = useState(oferta.papel ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const primeiroCampoRef = useRef<HTMLInputElement>(null);

  useEffect(() => { primeiroCampoRef.current?.focus(); }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function salvar() {
    setErro(null);
    if (link.trim() && !link.trim().startsWith("https://")) { setErro("O link precisa começar com https://"); return; }
    if (valorTabela !== "" && !(Number(valorTabela) > 0)) { setErro("O valor de tabela precisa ser maior que zero."); return; }
    if (donoEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(donoEmail.trim())) { setErro("E-mail do dono inválido."); return; }

    if (oferta.ativo && !ativo) {
      if (!window.confirm(`Desativar "${nomeComercial || oferta.offer_code}"?\n\nEla deixa de contar como oferta ativa para a operação. Isso não desfaz nenhuma venda já feita.`)) return;
    }

    setSalvando(true);
    try {
      const patch = {
        nome_comercial: nomeComercial.trim() || null,
        valor_tabela: valorTabela === "" ? null : Number(valorTabela),
        explicacao: explicacao.trim() || null,
        link: link.trim() || null,
        produto_checkout: produtoCheckout.trim() || null,
        dono_email: donoEmail.trim() || null,
        recorrente,
        ativo,
        papel: papel || null,
      };
      const r = await fetch("/api/hm/ofertas", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offer_code: oferta.offer_code, patch }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d?.ok) { setErro(msgErroPermissao(d?.reason) ?? d?.reason ?? msgErroCarregamento(r.status)); return; }
      onSaved();
    } catch {
      setErro(msgErroCarregamento());
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="titulo-editar-oferta"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-pop dark:border-slate-800 dark:bg-slate-900"
      >
        <h2 id="titulo-editar-oferta" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          Editar oferta {oferta.offer_code}
        </h2>

        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-400">
          <p className="font-semibold text-slate-600 dark:text-slate-300">Régua financeira (só leitura — não muda aqui)</p>
          <p className="mt-1">
            Pacote cheio: {fmtBRL(oferta.pacote_cheio)} · Condição fechada: {oferta.entrada_condicao_fechada ? "sim" : "não"} ·
            {" "}Entrada do programa: {oferta.entrada_do_programa ? "sim" : "não"} · Concede trilha: {oferta.concede_trilha ? "sim" : "não"}
          </p>
          <p className="mt-1">Produto (Hotmart): {oferta.product_name ?? "—"} · product_id: {oferta.product_id ?? <span className="font-semibold text-amber-700 dark:text-amber-300">ausente</span>}</p>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label htmlFor="ed-nome" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Nome comercial</label>
            <input ref={primeiroCampoRef} id="ed-nome" value={nomeComercial} onChange={(e) => setNomeComercial(e.target.value)} className={fieldClass} maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ed-valor" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Valor de tabela (R$)</label>
              <input id="ed-valor" type="number" min="0.01" step="0.01" value={valorTabela} onChange={(e) => setValorTabela(e.target.value)} className={fieldClass} placeholder="sem valor" />
            </div>
            <div>
              <label htmlFor="ed-papel" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Papel</label>
              <select id="ed-papel" value={papel} onChange={(e) => setPapel(e.target.value)} className={fieldClass}>
                <option value="">— não classificado —</option>
                {PAPEL_OPCOES.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="ed-explicacao" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Explicação</label>
            <textarea id="ed-explicacao" value={explicacao} onChange={(e) => setExplicacao(e.target.value)} className={cn(fieldClass, "min-h-16")} maxLength={2000} />
          </div>
          <div>
            <label htmlFor="ed-link" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Link de checkout</label>
            <input id="ed-link" value={link} onChange={(e) => setLink(e.target.value)} className={fieldClass} placeholder="https://pay.hotmart.com/…" maxLength={500} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="ed-checkout" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Produto do checkout (URL)</label>
              <input id="ed-checkout" value={produtoCheckout} onChange={(e) => setProdutoCheckout(e.target.value)} className={fieldClass} maxLength={60} placeholder="ex.: L97981750T" />
            </div>
            <div>
              <label htmlFor="ed-dono" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">Dono (e-mail, oferta individual)</label>
              <input id="ed-dono" type="email" value={donoEmail} onChange={(e) => setDonoEmail(e.target.value)} className={fieldClass} />
            </div>
          </div>
          <div className="flex items-center gap-4 pt-1">
            <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={recorrente} onChange={(e) => setRecorrente(e.target.checked)} className="alvo-toque h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30" />
              Recorrente (assinatura)
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} className="alvo-toque h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand/30" />
              Oferta ativa
            </label>
          </div>
        </div>

        {erro && <Callout tom="bloqueio" className="mt-3">{erro}</Callout>}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando}>
            {salvando && <Spinner className="text-white" />}
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
