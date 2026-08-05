"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, Card, EmptyState, Spinner, cn } from "@/app/_components/ui";
import { Kpi } from "@/app/_components/kpi";
import { Reveal } from "@/app/_components/anim";
import { MarcaPortal } from "@/app/_components/marca";
import { PORTAIS } from "@/lib/marcas";
import { useMe, msgErroPermissao } from "@/app/_components/use-me";
import { ehEstagioCancelamento } from "@/app/hm/_components/card-sinais";
import type { LinhaEsteira, QuandoHm } from "@/lib/services/hm-relatorio";
import { useProdutoHm } from "@/app/hm/_components/use-produto";

// "Meu dia" do HM — a fila pessoal que responde "por onde começo hoje?".
// Os portais genéricos já tinham a deles; o HM jogava o operador direto no
// kanban, e a pergunta ficava sem resposta. Lê a MESMA fonte da tabela
// (/api/hm/tabela → relatorioHm, recortada por equipe no servidor) e recorta
// no cliente as quatro filas do dia:
//   agenda de hoje · previsão de pagamento vencida · link enviado sem
//   pagamento · card parado há dias.
// Um lead aparece UMA vez, na fila mais urgente — fila é ordem de ataque,
// não relatório.

const DIAS_PARADO = 7; // o mesmo degrau vermelho do card do board e da tabela

function dt(v: QuandoHm): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}
function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function hora(v: QuandoHm): string {
  const d = dt(v);
  if (!d) return "";
  // 00:00 é o placeholder "dia marcado, horário a definir" (mesma leitura da Agenda).
  if (d.getHours() === 0 && d.getMinutes() === 0) return "horário a definir";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function fmtData(v: QuandoHm): string {
  const d = dt(v);
  return d ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—";
}
function ehHoje(v: QuandoHm): boolean {
  const d = dt(v);
  if (!d) return false;
  const h = new Date();
  return d.getFullYear() === h.getFullYear() && d.getMonth() === h.getMonth() && d.getDate() === h.getDate();
}
// O saldo que vale — a mesma regra da tabela: o perseguível primeiro.
function saldoDe(l: LinhaEsteira): number | null {
  return num(l.saldo_a_perseguir) ?? num(l.saldo_a_pagar);
}
function waLink(tel: string | null): string | null {
  if (!tel) return null;
  const d = tel.replace(/\D/g, "");
  if (d.length < 8) return null;
  return `https://wa.me/${d.startsWith("55") ? d : `55${d}`}`;
}

type ItemFila = {
  linha: LinhaEsteira;
  /** A linha de contexto sob o nome — por que este lead está nesta fila. */
  info: string;
};

export default function HmMeuDiaPage() {
  // Marca e nome vem do portal da URL (0155): a MESMA tela serve HM, Aurum e
  // ETHB. Fixo em "hm"/"Holding Masters", o board do Aurum se apresentava
  // com a identidade do Holding Masters.
  const { portal } = useProdutoHm();
  const { me, podeVerTudo } = useMe();
  const [linhas, setLinhas] = useState<LinhaEsteira[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [meus, setMeus] = useState(true);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const r = await fetch("/api/hm/tabela");
      const d = await r.json();
      if (d.ok) setLinhas(d.linhas);
      else setErro(msgErroPermissao(d.reason) ?? "Não foi possível carregar a sua fila. Tente de novo.");
    } catch {
      setErro("Sem conexão com o servidor. Verifique a rede e tente de novo.");
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  // "Meus" precisa da sessão (responsavel_id === me.id) — enquanto ela carrega,
  // a tela espera junto com os dados em vez de piscar a esteira inteira.
  const prontos = linhas !== null && (!meus || me !== null);

  const filas = useMemo(() => {
    if (!prontos || !linhas) return null;
    const base = meus && me ? linhas.filter((l) => l.responsavel_id === me.id) : linhas;
    const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0);
    const usados = new Set<string>();
    const pega = (cond: (l: LinhaEsteira) => boolean, info: (l: LinhaEsteira) => string) => {
      const out: ItemFila[] = [];
      for (const l of base) {
        if (usados.has(l.comprador_id)) continue;
        if (ehEstagioCancelamento(l.estagio_chave)) continue;
        if (!cond(l)) continue;
        usados.add(l.comprador_id);
        out.push({ linha: l, info: info(l) });
      }
      return out;
    };

    // 1) Compromissos de HOJE — reunião (Comercial) ou entrevista (Ativação).
    const agenda = pega(
      (l) => ehHoje(l.reuniao_em) || ehHoje(l.entrevista_em),
      (l) => {
        const partes: string[] = [];
        if (ehHoje(l.reuniao_em)) partes.push(`Reunião · ${hora(l.reuniao_em)}`);
        if (ehHoje(l.entrevista_em)) partes.push(`Entrevista · ${hora(l.entrevista_em)}`);
        return partes.join(" · ");
      },
    ).sort((a, b) => {
      const ta = Math.min(dt(a.linha.reuniao_em)?.getTime() ?? Infinity, dt(a.linha.entrevista_em)?.getTime() ?? Infinity);
      const tb = Math.min(dt(b.linha.reuniao_em)?.getTime() ?? Infinity, dt(b.linha.entrevista_em)?.getTime() ?? Infinity);
      return ta - tb;
    });

    // 2) Previsão de pagamento VENCIDA — a data combinada passou e o dinheiro
    //    não veio. É dívida com data marcada: comece por aqui a cobrança.
    const vencidas = pega(
      (l) => {
        const d = dt(l.pagamento_previsto_em);
        return !!d && d.getTime() < hoje0.getTime() && !l.quitado && !l.apto_ativacao;
      },
      (l) => {
        const s = saldoDe(l);
        return `previsto para ${fmtData(l.pagamento_previsto_em)}${s !== null ? ` · deve ${brl(s)}` : ""}`;
      },
    ).sort((a, b) => (dt(a.linha.pagamento_previsto_em)?.getTime() ?? 0) - (dt(b.linha.pagamento_previsto_em)?.getTime() ?? 0));

    // 3) Link do saldo enviado e nada de pagamento — recebeu a oferta e sumiu.
    const linkSem = pega(
      (l) => !!l.link_saldo_enviado_em && !l.quitado && !l.apto_ativacao,
      (l) => {
        const s = saldoDe(l);
        return `link enviado em ${fmtData(l.link_saldo_enviado_em)}${s !== null ? ` · deve ${brl(s)}` : ""}`;
      },
    ).sort((a, b) => (dt(a.linha.link_saldo_enviado_em)?.getTime() ?? 0) - (dt(b.linha.link_saldo_enviado_em)?.getTime() ?? 0));

    // 4) Parado há DIAS_PARADO+ na mesma etapa — é onde o lead esfria.
    const parados = pega(
      (l) => (l.dias_na_etapa ?? 0) >= DIAS_PARADO,
      (l) => `${l.dias_na_etapa} dia(s) em ${l.estagio_nome ?? "—"}`,
    ).sort((a, b) => (b.linha.dias_na_etapa ?? 0) - (a.linha.dias_na_etapa ?? 0));

    // O placar do dinheiro: quanto a MINHA carteira ainda tem a perseguir.
    const devendo = base.filter((l) => !l.quitado && !l.apto_ativacao && !ehEstagioCancelamento(l.estagio_chave));
    const totalPerseguir = devendo.reduce((acc, l) => acc + (saldoDe(l) ?? 0), 0);

    return { agenda, vencidas, linkSem, parados, totalPerseguir, totalCarteira: base.length };
  }, [prontos, linhas, meus, me]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal={portal} altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Meu dia · {PORTAIS[portal].nome}</h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            Por onde começar hoje: agenda, cobranças vencidas e quem está esfriando.
          </p>
        </div>
        {/* O mesmo alternador do Meu dia dos outros portais — mesmo gesto,
            mesmos rótulos: minha carteira × o que eu enxergo. */}
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
          <button
            onClick={() => setMeus(true)}
            className={cn("rounded-md px-3 py-1 text-xs font-medium transition", meus ? "bg-brand text-white dark:bg-brand-500" : "text-slate-500 hover:text-slate-800 dark:text-slate-400")}
          >
            Meus leads
          </button>
          <button
            onClick={() => setMeus(false)}
            className={cn("rounded-md px-3 py-1 text-xs font-medium transition", !meus ? "bg-brand text-white dark:bg-brand-500" : "text-slate-500 hover:text-slate-800 dark:text-slate-400")}
            title={podeVerTudo() ? "Todos os leads da esteira HM" : "Tudo o que você pode ver (o servidor recorta por equipe)"}
          >
            {podeVerTudo() ? "Todos do portal" : "Tudo que vejo"}
          </button>
        </div>
      </div>

      {erro ? (
        <EmptyState
          icon={
            <svg className="h-9 w-9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <path d="M12 9v4M12 17h.01" />
            </svg>
          }
          title="Não foi possível carregar a sua fila"
          description={erro}
          action={<Button variant="secondary" onClick={carregar}>Tentar de novo</Button>}
        />
      ) : !prontos || !filas ? (
        <div className="flex items-center justify-center gap-2 py-16 text-slate-400"><Spinner /> Carregando seu dia…</div>
      ) : (
        <>
          {/* O placar do dia: quantos esperam ação em cada frente. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi titulo="Na agenda hoje" valor={String(filas.agenda.length)} sub="reuniões e entrevistas" />
            <Kpi titulo="Cobrança vencida" valor={String(filas.vencidas.length)} sub="previsão passou sem pagamento" alerta={filas.vencidas.length > 0} />
            <Kpi titulo="Link enviado, sem pagar" valor={String(filas.linkSem.length)} sub="receberam a oferta e nada" />
            <Kpi titulo="Saldo a perseguir" valor={brl(filas.totalPerseguir)} sub={meus ? "da sua carteira" : "de tudo que você vê"} />
          </div>

          {filas.agenda.length === 0 && filas.vencidas.length === 0 && filas.linkSem.length === 0 && filas.parados.length === 0 ? (
            <div className="mt-6">
              <EmptyState
                title={meus && filas.totalCarteira === 0 ? "Sua carteira está vazia" : "Fila limpa"}
                description={
                  meus && filas.totalCarteira === 0
                    ? "Você ainda não tem cards sob sua responsabilidade. Assuma leads do pool na Jornada — os cards livres têm o selo “Pool · livre”."
                    : "Nada na agenda de hoje, nenhuma cobrança vencida e ninguém parado. Aproveite para avançar a esteira na Jornada."
                }
                action={
                  <Link href="/hm/kanban">
                    <Button variant="secondary">Abrir a Jornada</Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              <Fila
                titulo="Agenda de hoje"
                descricao="Reuniões e entrevistas marcadas para hoje — prepare-se antes de cada uma pela ficha."
                cor="blue"
                itens={filas.agenda}
              />
              <Fila
                titulo="Previsão de pagamento vencida"
                descricao="A data combinada passou e o pagamento não veio. É dívida com data marcada — cobre primeiro."
                cor="rose"
                itens={filas.vencidas}
              />
              <Fila
                titulo="Link do saldo enviado, sem pagamento"
                descricao="Receberam a oferta e não pagaram. Cada dia parado encolhe o crédito e esfria o acordo."
                cor="amber"
                itens={filas.linkSem}
              />
              <Fila
                titulo={`Parados há ${DIAS_PARADO}+ dias na etapa`}
                descricao="Ninguém mexeu nesses cards há mais de uma semana. É onde o lead esfria."
                cor="slate"
                itens={filas.parados}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

const COR: Record<string, string> = {
  blue: "bg-blue-500",
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  slate: "bg-slate-400",
};

// A mesma anatomia da fila do Meu dia genérico: cabeçalho com ponto de cor e
// contagem, itens com nome → ficha e a ação rápida à direita.
function Fila({ titulo, descricao, cor, itens }: {
  titulo: string;
  descricao: string;
  cor: string;
  itens: ItemFila[];
}) {
  if (itens.length === 0) return null;
  return (
    <Reveal>
      <Card className="js-reveal overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", COR[cor])} aria-hidden />
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{titulo}</h2>
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              {itens.length}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{descricao}</p>
        </div>

        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {itens.map(({ linha: l, info }) => {
            const wa = waLink(l.telefone);
            return (
              <li key={l.comprador_id} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Link
                      href={`/hm/contatos/${l.comprador_id}`}
                      className="truncate text-sm font-medium text-slate-800 hover:text-brand dark:text-slate-100 dark:hover:text-brand-300"
                    >
                      {l.nome}
                    </Link>
                    {/* A trava tem que aparecer ANTES do clique no WhatsApp. */}
                    {l.nao_contatar && (
                      <span
                        className="shrink-0 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
                        title={`Não entrar em contato${l.nao_contatar_motivo ? ` — ${l.nao_contatar_motivo}` : ""}`}
                      >
                        não contatar
                      </span>
                    )}
                    {l.revisar && (
                      <span
                        className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                        title={`Revisar antes de tratar${l.revisar_motivo ? ` — ${l.revisar_motivo}` : ""}`}
                      >
                        revisar
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">
                    {l.estagio_nome && <span className="text-slate-500 dark:text-slate-400">{l.estagio_nome}</span>}
                    {l.estagio_nome && " · "}
                    {info}
                    {l.responsavel ? ` · ${l.responsavel}` : " · sem operador"}
                  </p>
                </div>
                {wa && !l.nao_contatar && (
                  <a href={wa} target="_blank" rel="noreferrer" className="shrink-0">
                    <Button variant="secondary" className="h-8 px-3 text-xs">WhatsApp</Button>
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </Reveal>
  );
}
