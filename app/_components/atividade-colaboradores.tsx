"use client";

// Tabela de atividade por colaborador — o MESMO layout para /hm/atividade e
// para a tela genérica dos portais (/[portal]/atividade). Responde "quem fez o
// quê" no período: movimentações, notas, disparos e as demais ações assinadas.
// O que muda entre os consumidores é só o endpoint e a coluna "Ligações"
// (bucket que só os portais genéricos registram) — por isso o componente é um
// e a coluna é opcional. A lista já vem RECORTADA pelo nível de quem chama
// (master vê todos; gestor e operador veem a própria equipe — novo modelo
// 28/07, o operador acompanha as ações dos colegas) — a UI não filtra.
//
// Granularidade (Dia/Semana/Mês, pedido do Marcio): default DIÁRIA — é a
// visão que a operação olha todo dia. A API recebe `granularidade` e PODE
// devolver `porColuna` (o que cada operador fez em CADA estágio no período),
// `porAba` (comercial × ativação) e `serie` (o total do colaborador quebrado
// por bucket dia/semana/mês) — se o backend ainda não mandar algum dos campos,
// a parte correspondente simplesmente não aparece; não é erro, é degradação.
//
// A tabela PRINCIPAL muda com o toggle (12/08 — antes o toggle só afetava a
// linha expansível, e o efeito era imperceptível sem abrir cada colaborador):
//   dia    → uma linha por colaborador, agregado do período (comportamento
//            histórico — é a visão que a operação abre todo dia, não faria
//            sentido estourar em dezenas de linhas por bucket diário).
//   semana/mes → uma linha por (colaborador, bucket) usando a própria `serie`
//            que a API já devolve — a tabela PASSA a mostrar a quebra
//            temporal pedida, sem inventar uma segunda chamada. O cabeçalho
//            de cada colaborador vira um separador com o total do período,
//            para não perder a leitura "quem fez mais no total".

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Card, Spinner, cn, fieldCompactClass } from "@/app/_components/ui";
import { msgErroPermissao } from "@/app/_components/use-me";
import { GRANULARIDADES as GRANULARIDADE_VALORES, type Granularidade } from "@/lib/validators";

// Shape real de AtividadeColunaResumo (lib/services/hm-atividade.ts) — `estagio_nome`
// vem do LEFT JOIN com cs.estagios e pode ser null (estágio apagado/órfão).
export type PorColuna = { estagio_id: number; estagio_nome: string | null; estagio_chave: string | null; estagio_aba: string | null; total: number };
// Shape real de AtividadeAbaResumo — comercial × ativação (12/08). `estagio_aba`
// null = estágios legados sem aba definida; nunca é somado dentro das outras duas.
export type PorAba = { estagio_aba: string | null; total: number };
// Shape real de AtividadeAlunoResumo (lib/services/hm-atividade.ts/porAlunoNucleo)
// — TOP 8 alunos por colaborador no período, ordenado por nº de ações.
export type PorAluno = { contato_hm_id: string; aluno_nome: string; total: number; tipos_distintos: number; ultima: string };
export type LinhaAtividade = {
  colaborador: string;
  total: number; movimentacoes: number; notas: number; disparos: number; outras: number;
  ligacoes?: number; // só nos portais genéricos
  cards: number; ultima: string | null;
  // O que ELE fez em CADA coluna/estágio no período — opcional: só existe
  // quando a API já suporta a agregação (em voo no backend, 12/08).
  porColuna?: PorColuna[];
  // Quanto do trabalho dele caiu no Comercial vs. na Ativação no período —
  // só na esteira HM (os genéricos não têm aba). Ver hm-atividade.ts/porAbaNucleo.
  porAba?: PorAba[];
  // O que ele fez com CADA ALUNO no período — TOP 8 por nº de ações, só na
  // esteira HM. `porAlunoTotal` é quantos alunos distintos ele tocou no total
  // (para o "e mais X" quando excede o corte). Ver hm-atividade.ts/porAlunoNucleo.
  porAluno?: PorAluno[];
  porAlunoTotal?: number;
};

// Um bucket da série (AtividadePeriodo de lib/services/hm-atividade.ts) —
// mesma resposta, sem `colaborador`: aqui a série já chega agrupada por
// colaborador (ver `seriePorColaborador`), então o nome é redundante.
export type BucketSerie = { periodo: string; total: number; movimentacoes: number; notas: number; disparos: number; outras: number };

// `Granularidade` vem de lib/validators (fonte única dos 3 valores — era
// triplicada aqui, em hm-atividade.ts e em validators.ts). O rótulo pt-BR de
// cada valor é só desta tela, então fica local, mas a LISTA de valores válidos
// (o que pode existir) é importada — se um bucket novo entrar um dia, aparece
// aqui automaticamente e só falta o rótulo.
export type { Granularidade };
const RÓTULO_GRANULARIDADE: Record<Granularidade, string> = { dia: "Dia", semana: "Semana", mes: "Mês" };
const GRANULARIDADES: { id: Granularidade; label: string }[] =
  GRANULARIDADE_VALORES.map((id) => ({ id, label: RÓTULO_GRANULARIDADE[id] }));

// Rótulo do bucket conforme a granularidade ativa — `periodo` chega em ISO
// (date_trunc do Postgres); dia/mês em dd/mm(/aa), semana mostra o dia em que
// a semana começa (date_trunc('week', …) trunca pra segunda-feira).
function fmtBucket(periodo: string, g: Granularidade): string {
  const d = new Date(periodo);
  if (isNaN(d.getTime())) return periodo;
  if (g === "mes") return d.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
  if (g === "semana") return `semana de ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// Rótulo pt-BR da aba (cs.estagios.aba) — null vira "Sem aba" (os 23 estágios
// legados/órfãos do inventário, ex.: HT/SEM antigos que não migraram para o
// modelo de 2 abas do HM). Nunca omitido: esconder o "sem aba" faria a soma
// das duas abas divergir silenciosamente do total do colaborador.
function rotuloAba(aba: string | null): string {
  if (aba === "comercial") return "Comercial";
  if (aba === "ativacao") return "Ativação";
  return "Sem aba";
}

// dd/mm/aa sem hora para a coluna; a hora exata fica no title.
function fmt(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function haQuanto(v: string | null): string {
  if (!v) return "";
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const dias = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  if (dias < 30) return `há ${dias} dias`;
  return "";
}
// AAAA-MM-DD local de N dias atrás — para os inputs de data.
function isoDia(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function AtividadeColaboradores({
  endpoint,
  params,
  comLigacoes,
}: {
  endpoint: string; // "/api/hm/atividade" | "/api/atividade"
  params?: Record<string, string>; // ex.: { evento: "HT" }
  comLigacoes?: boolean;
}) {
  const [de, setDe] = useState(isoDia(-30));
  const [ate, setAte] = useState(isoDia(0));
  // Default DIÁRIA — pedido explícito do Marcio ("é a visão padrão").
  const [granularidade, setGranularidade] = useState<Granularidade>("dia");
  const [linhas, setLinhas] = useState<LinhaAtividade[]>([]);
  // Série crua devolvida pela API (D1) — total por (período, colaborador) no
  // bucket ativo. Ausente/vazia quando o backend não manda (rota genérica
  // pode não suportar ainda) — tratado como [] em todo lugar que consome.
  const [serie, setSerie] = useState<{ periodo: string; colaborador: string; total: number; movimentacoes: number; notas: number; disparos: number; outras: number }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Qual colaborador está com o "por coluna"/série aberto — um de cada vez,
  // como um acordeão, para a tabela não virar uma parede de números.
  const [expandido, setExpandido] = useState<string | null>(null);
  // Estável entre renders para o useCallback não repolar à toa.
  const paramsStr = JSON.stringify(params ?? {});

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const p = new URLSearchParams(JSON.parse(paramsStr) as Record<string, string>);
      if (de) p.set("de", de);
      // `ate` do input é inclusivo; a API é exclusiva — manda o dia seguinte.
      if (ate) {
        const d = new Date(ate + "T00:00:00");
        d.setDate(d.getDate() + 1);
        p.set("ate", d.toISOString().slice(0, 10));
      }
      p.set("granularidade", granularidade);
      // `endpoint` pode já trazer query (?produto=AURUM, 0164) — respeita isso em vez
      // de concatenar um segundo "?" e produzir uma URL inválida.
      const r = await fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}${p.toString()}`);
      // fetch não lança em 4xx/5xx — cheque `r.ok` explicitamente antes de confiar no JSON.
      if (!r.ok) {
        setLinhas([]);
        setErro(`O servidor respondeu com erro (${r.status}). Tente de novo em instantes.`);
        return;
      }
      const d = await r.json();
      if (d.ok) {
        setLinhas(d.colaboradores);
        setSerie(Array.isArray(d.serie) ? d.serie : []);
      } else {
        setLinhas([]);
        setSerie([]);
        setErro(msgErroPermissao(d.reason) ?? "Não foi possível carregar a atividade.");
      }
    } catch {
      setLinhas([]);
      setSerie([]);
      setErro("Falha de rede — tente atualizar.");
    } finally {
      setCarregando(false);
    }
  }, [de, ate, granularidade, endpoint, paramsStr]);

  useEffect(() => { carregar(); }, [carregar]);

  const totais = useMemo(() => linhas.reduce(
    (a, l) => ({
      total: a.total + l.total, movimentacoes: a.movimentacoes + l.movimentacoes,
      notas: a.notas + l.notas, disparos: a.disparos + l.disparos,
      ligacoes: a.ligacoes + (l.ligacoes ?? 0), outras: a.outras + l.outras,
    }),
    { total: 0, movimentacoes: 0, notas: 0, disparos: 0, ligacoes: 0, outras: 0 },
  ), [linhas]);

  // Série agrupada por colaborador — a API devolve uma linha por (período,
  // colaborador) solta; aqui vira "os buckets DESTE colaborador", já ordenada
  // por período (a query do backend já ordena, mas não custa garantir aqui:
  // é o que a linha expansível itera direto).
  const seriePorColaborador = useMemo(() => {
    const m = new Map<string, BucketSerie[]>();
    for (const s of serie) {
      const lista = m.get(s.colaborador) ?? [];
      lista.push({ periodo: s.periodo, total: s.total, movimentacoes: s.movimentacoes, notas: s.notas, disparos: s.disparos, outras: s.outras });
      m.set(s.colaborador, lista);
    }
    return m;
  }, [serie]);

  // Linhas VISÍVEIS na tabela principal (o toggle passa a mudar o corpo, não
  // só o acordeão — pedido do Marcio, 12/08). Em "dia" é o comportamento
  // histórico (uma linha por colaborador, agregado do período). Em
  // "semana"/"mes", cada colaborador vira um cabeçalho (`ehCabecalho`, com o
  // total do período) seguido de uma linha por bucket da própria `serie` —
  // sem chamada extra: o dado já veio junto no mesmo GET.
  type LinhaTabela =
    | { tipo: "colaborador"; l: LinhaAtividade; ehCabecalho: boolean }
    | { tipo: "bucket"; colaborador: string; b: BucketSerie };

  const linhasTabela = useMemo<LinhaTabela[]>(() => {
    if (granularidade === "dia") {
      return linhas.map((l) => ({ tipo: "colaborador" as const, l, ehCabecalho: false }));
    }
    const out: LinhaTabela[] = [];
    for (const l of linhas) {
      out.push({ tipo: "colaborador", l, ehCabecalho: true });
      const buckets = seriePorColaborador.get(l.colaborador) ?? [];
      for (const b of buckets) out.push({ tipo: "bucket", colaborador: l.colaborador, b });
    }
    return out;
  }, [linhas, granularidade, seriePorColaborador]);

  const atalhos: Array<{ label: string; de: number }> = [
    { label: "7 dias", de: -7 }, { label: "30 dias", de: -30 }, { label: "90 dias", de: -90 },
  ];

  return (
    <div>
      {/* Período */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/80">
          {atalhos.map((a) => {
            const ativo = de === isoDia(a.de) && ate === isoDia(0);
            return (
              <button
                key={a.label}
                onClick={() => { setDe(isoDia(a.de)); setAte(isoDia(0)); }}
                className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition",
                  ativo ? "bg-white text-slate-900 shadow-card dark:bg-slate-700 dark:text-slate-100"
                        : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200")}
              >
                {a.label}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          De <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className={fieldCompactClass} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          Até <input type="date" value={ate} max={isoDia(0)} onChange={(e) => setAte(e.target.value)} className={fieldCompactClass} />
        </label>

        {/* Granularidade Dia/Semana/Mês — muda como a API agrupa a mesma
            janela de datas acima; default DIA. */}
        <div className="ml-auto inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800/80" role="group" aria-label="Agrupar atividade por">
          {GRANULARIDADES.map((g) => (
            <button
              key={g.id}
              onClick={() => setGranularidade(g.id)}
              aria-pressed={granularidade === g.id}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium transition",
                granularidade === g.id ? "bg-white text-slate-900 shadow-card dark:bg-slate-700 dark:text-slate-100"
                      : "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200")}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {carregando ? (
          <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-400"><Spinner /> carregando…</div>
        ) : erro ? (
          <p className="p-10 text-center text-sm text-rose-600 dark:text-rose-400">{erro}</p>
        ) : linhas.length === 0 ? (
          <p className="p-10 text-center text-sm text-slate-400">Nenhuma atividade de colaborador neste período.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800 dark:text-slate-500">
                  {/* 12/08, pedido do Marcio: "são operadores que não conhecem
                      o sistema nem programação — a informação tem que ser
                      tratada para uma linguagem mais humana". "Movimentações",
                      "Disparos" e "Outras" eram o nome interno do bucket, não o
                      que a pessoa fez. Cada cabeçalho agora diz a AÇÃO, e o
                      `title` explica o que entra na conta — o número sozinho
                      não ensina ninguém a interpretá-lo. */}
                  <th className="px-4 py-2.5 font-medium">Quem</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="Tudo que a pessoa registrou no período somado">Tudo</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="Quantas vezes moveu um aluno de etapa na Jornada">Moveu de etapa</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="Anotações escritas na ficha do aluno">Anotou</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="Mensagens de campanha enviadas por esta pessoa">Mandou mensagem</th>
                  {comLigacoes && <th className="px-3 py-2.5 text-right font-medium" title="Atendimentos por telefone/WhatsApp registrados">Falou por telefone</th>}
                  <th className="px-3 py-2.5 text-right font-medium" title="Atribuir operador, marcar tag, registrar pagamento, cadastrar — o que não cabe nas colunas anteriores">Outras ações</th>
                  <th className="px-3 py-2.5 text-right font-medium" title="Quantos alunos diferentes a pessoa tocou no período">Alunos tocados</th>
                  <th className="px-4 py-2.5 text-right font-medium" title="Quando esta pessoa registrou alguma coisa pela última vez">Última vez</th>
                </tr>
              </thead>
              <tbody>
                {linhasTabela.map((linha, idx) => {
                  // Linha de BUCKET (semana/mês, uma por período dentro do
                  // colaborador) — sem acordeão, sem "Cards"/"Última" (a série
                  // não carrega esses dois: são atributos do card, não do bucket).
                  if (linha.tipo === "bucket") {
                    const { b } = linha;
                    return (
                      <tr key={`${linha.colaborador}-${b.periodo}`} className="border-b border-slate-100 bg-slate-50/40 last:border-0 dark:border-slate-800/60 dark:bg-slate-800/20">
                        <td className="px-4 py-1.5 pl-9 text-xs text-slate-500 dark:text-slate-400">{fmtBucket(b.periodo, granularidade)}</td>
                        <td className="px-3 py-1.5 text-right text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-200">{b.total}</td>
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{b.movimentacoes || "—"}</td>
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{b.notas || "—"}</td>
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{b.disparos || "—"}</td>
                        {comLigacoes && <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">—</td>}
                        <td className="px-3 py-1.5 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">{b.outras || "—"}</td>
                        <td className="px-3 py-1.5" />
                        <td className="px-4 py-1.5" />
                      </tr>
                    );
                  }

                  const { l, ehCabecalho } = linha;
                  // Cada bloco do painel expansível só abre quando a API já manda o
                  // campo correspondente — sem ele, a linha se comporta como sempre
                  // se comportou (sem regressão).
                  const temPorColuna = !!l.porColuna && l.porColuna.length > 0;
                  const temPorAba = !!l.porAba && l.porAba.length > 0;
                  // "O que aquele operador realizou com cada aluno no período"
                  // (pedido literal do Marcio, 12/08): TOP 8 alunos por nº de ações
                  // — ver hm-atividade.ts/porAlunoNucleo para o corte de volume.
                  const temPorAluno = !!l.porAluno && l.porAluno.length > 0;
                  const serieColaborador = seriePorColaborador.get(l.colaborador) ?? [];
                  // Em modo cabeçalho (semana/mês) a série já vira linhas próprias
                  // logo abaixo — repeti-la dentro do acordeão seria redundante.
                  const temSerie = !ehCabecalho && serieColaborador.length > 0;
                  // A linha abre se houver QUALQUER detalhe (coluna, aba, aluno ou
                  // série) — um colaborador pode ter só parte deles, dependendo do
                  // que a rota chamada suporta (D3-a/porAba/porAluno são só HM;
                  // serie é dos dois).
                  const temDetalhe = temPorColuna || temPorAba || temPorAluno || temSerie;
                  const aberto = temDetalhe && expandido === l.colaborador;
                  return (
                  <Fragment key={ehCabecalho ? `${l.colaborador}-cab` : l.colaborador}>
                    <tr
                      onClick={temDetalhe ? () => setExpandido(aberto ? null : l.colaborador) : undefined}
                      onKeyDown={temDetalhe ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpandido(aberto ? null : l.colaborador); } } : undefined}
                      tabIndex={temDetalhe ? 0 : undefined}
                      role={temDetalhe ? "button" : undefined}
                      aria-expanded={temDetalhe ? aberto : undefined}
                      className={cn(
                        "border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800/60 dark:hover:bg-slate-800/40",
                        // Cabeçalho de bucket (semana/mês): levemente destacado e com
                        // borda superior — separa visualmente do último bucket do
                        // colaborador anterior. É o subtotal do período, não uma
                        // linha do dia a dia.
                        ehCabecalho && "bg-slate-50/70 font-medium dark:bg-slate-800/30",
                        ehCabecalho && idx > 0 && "border-t border-slate-200 dark:border-slate-700",
                        temDetalhe && "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 focus-visible:ring-inset",
                      )}
                    >
                      <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">
                        <span className="inline-flex items-center gap-1.5">
                          {temDetalhe && (
                            <svg className={cn("h-3 w-3 shrink-0 text-slate-400 transition-transform", aberto && "rotate-90")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                          )}
                          {l.colaborador}
                          {ehCabecalho && <span className="text-[11px] font-normal text-slate-400 dark:text-slate-500">· total do período</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900 dark:text-white">{l.total}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{l.movimentacoes || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{l.notas || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{l.disparos || "—"}</td>
                      {comLigacoes && <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{l.ligacoes || "—"}</td>}
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{l.outras || "—"}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400">{l.cards}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-slate-500 dark:text-slate-400" title={l.ultima ?? ""}>
                        {fmt(l.ultima)}{haQuanto(l.ultima) && <span className="ml-1 text-[11px] text-slate-400">· {haQuanto(l.ultima)}</span>}
                      </td>
                    </tr>
                    {aberto && (
                      <tr className="border-b border-slate-100 bg-slate-50/70 dark:border-slate-800/60 dark:bg-slate-800/30">
                        <td colSpan={comLigacoes ? 9 : 8} className="px-4 py-3">
                          {temPorAba && (
                            <div className="mb-3">
                              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                {l.colaborador} — Comercial × Ativação no período
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {l.porAba!.map((pa) => (
                                  <span key={pa.estagio_aba ?? "sem-aba"} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-xs ring-1 ring-inset ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                                    {rotuloAba(pa.estagio_aba)}
                                    <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-100">{pa.total}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {temPorColuna && (
                            <div className={temSerie ? "mb-3" : undefined}>
                              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                O que {l.colaborador} fez em cada coluna no período
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {l.porColuna!.map((pc) => (
                                  <span key={pc.estagio_id} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-xs ring-1 ring-inset ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                                    {pc.estagio_nome ?? "Estágio removido"}
                                    <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-100">{pc.total}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {temPorAluno && (
                            <div className={temSerie ? "mb-3" : undefined}>
                              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                O que {l.colaborador} fez com cada aluno no período
                                {/* "e mais X": porAlunoTotal é quantos alunos DISTINTOS
                                    o colaborador tocou — a lista abaixo é só o TOP 8
                                    (ver hm-atividade.ts/porAlunoNucleo). */}
                                {typeof l.porAlunoTotal === "number" && l.porAlunoTotal > l.porAluno!.length && (
                                  <span className="ml-1 font-normal normal-case text-slate-400">
                                    (top {l.porAluno!.length} de {l.porAlunoTotal} alunos)
                                  </span>
                                )}
                              </p>
                              <ul className="divide-y divide-slate-100 overflow-hidden rounded-lg bg-white shadow-xs ring-1 ring-inset ring-slate-200 dark:divide-slate-800 dark:bg-slate-900 dark:ring-slate-700">
                                {l.porAluno!.map((pa) => (
                                  <li key={pa.contato_hm_id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs">
                                    <span className="truncate font-medium text-slate-700 dark:text-slate-200">{pa.aluno_nome}</span>
                                    <span className="flex shrink-0 items-center gap-2 text-slate-400 dark:text-slate-500">
                                      <span title={`${pa.tipos_distintos} tipo(s) de ação distintos`}>{pa.tipos_distintos} tipo(s)</span>
                                      <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-100">{pa.total} ação(ões)</span>
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {temSerie && (
                            <div>
                              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                {l.colaborador} por {granularidade === "dia" ? "dia" : granularidade === "semana" ? "semana" : "mês"}
                              </p>
                              <div className="flex flex-wrap gap-1.5">
                                {serieColaborador.map((b) => (
                                  <span key={b.periodo} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 shadow-xs ring-1 ring-inset ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
                                    {fmtBucket(b.periodo, granularidade)}
                                    <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-100">{b.total}</span>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 font-semibold dark:border-slate-700">
                  <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">{linhas.length} colaborador(es)</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-900 dark:text-white">{totais.total}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{totais.movimentacoes}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{totais.notas}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{totais.disparos}</td>
                  {comLigacoes && <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{totais.ligacoes}</td>}
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{totais.outras}</td>
                  <td className="px-3 py-2.5" />
                  <td className="px-4 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
