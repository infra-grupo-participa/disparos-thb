"use client";

import { useEffect, useState } from "react";
import { MarcaPortal } from "@/app/_components/marca";
import { HmVisao } from "@/app/hm/_components/hm-visao";
import { useProdutoHm } from "@/app/hm/_components/use-produto";
import { useMe } from "@/app/_components/use-me";
import { AtividadeColaboradores } from "@/app/_components/atividade-colaboradores";
import { Card, Spinner, cn } from "@/app/_components/ui";

// Registro de atividade por colaborador (A1). Responde "quem fez o quê" na
// esteira HM no período — movimentações, notas, disparos e as demais ações
// assinadas (responsável, tag, pagamento, cadastro). A captura é a timeline;
// esta tela é a leitura agregada por pessoa. A tabela em si é compartilhada
// com a tela genérica dos portais (atividade-colaboradores).

export default function HmAtividadePage() {
  // podeDistribuir → a aba "Equipes" do alternador aparece para master e gestor.
  const { podeDistribuir } = useMe();
  const { produto, portal, nome: nomePortal } = useProdutoHm(); // board, marca e título

  // O board vai no endpoint (0164): sem `?produto=`, a Atividade do Aurum
  // mostrava o movimento do HM — esta tela não usa o useFetchHm.
  const endpoint = produto === "HM" ? "/api/hm/atividade" : `/api/hm/atividade?produto=${produto}`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <MarcaPortal portal={portal} altura="h-7" comNome={false} />
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">Atividade · {nomePortal}</h1>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            O que cada colaborador fez na esteira — movimentações, notas, disparos e as demais ações assinadas.
          </p>
        </div>
        <HmVisao atual="atividade" filtros={{}} />
      </div>

      {/* O dinheiro fechado por comercial (o "carro-chefe", pedido do Marcio em
          12/08) MUDOU DE CASA em 16/08 (F3): estava misturado aqui com registro
          de atividade operacional — é justamente a queixa "a nave está confusa,
          misturada com atividades do sistema". Agora vive só no Painel
          (rota /painel do portal), ao lado dos outros KPIs de gestão do período. */}

      {/* Diferenciação visual de desempenho (pedido do Marcio, 12/08): "preciso
          que tenha uma diferenciação visual pra gente entender quem tá
          trabalhando direito, quem tá fazendo as paradas". A tabela de baixo
          conta AÇÕES; este painel responde a outra pergunta — como cada um
          está indo. Janela fixa de 7 dias (o retrato de "essa semana"),
          independente do período que a tabela abaixo está mostrando. */}
      <PainelDesempenho endpoint={endpoint} />

      <AtividadeColaboradores endpoint={endpoint} />
    </div>
  );
}

// ===== Painel de desempenho ==================================================
// Usa os MESMOS dados de /api/hm/atividade (nenhum endpoint novo) — só lê
// campos que a tabela de baixo ainda não mostra: `falhas` (mensagens que não
// saíram) e `agendamentos` (reunião/entrevista marcada x cumprida x remarcada).
// Cor é sempre FUNÇÃO DO VALOR, nunca constante — e sem base suficiente o selo
// diz "sem dados", nunca inventa um número (ver disparos-brain/Validar UI no
// Chromium: um SLA 0% já foi pintado de verde por engano).
type ColaboradorDesempenho = {
  colaborador: string;
  total: number;
  disparos: number;
  falhas?: number;
  ultima: string | null;
  agendamentos?: { realizados: number; nao_compareceu: number; remarcados: number; em_aberto: number };
};

function isoDiasAtras(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function isoAmanha(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function PainelDesempenho({ endpoint }: { endpoint: string }) {
  const [linhas, setLinhas] = useState<ColaboradorDesempenho[] | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setLinhas(null);
    setErro(false);
    const p = new URLSearchParams({ de: isoDiasAtras(7), ate: isoAmanha(), granularidade: "dia" });
    fetch(`${endpoint}${endpoint.includes("?") ? "&" : "?"}${p.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => { if (!cancelado) setLinhas(d.ok ? d.colaboradores : []); })
      .catch(() => { if (!cancelado) setErro(true); });
    return () => { cancelado = true; };
  }, [endpoint]);

  // Sem dado nenhum ainda vindo do servidor — não é erro, a tabela de baixo já
  // avisa se a permissão faltar; aqui só não mostra nada em vez de duplicar aviso.
  if (erro) return null;

  return (
    <Card className="mb-3 p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Como cada um está indo essa semana</h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Últimos 7 dias. Sem termo técnico — só o que aconteceu: quem segue ativo, quem prometeu reunião e cumpriu, e onde uma mensagem não saiu.
        </p>
      </div>

      {linhas === null ? (
        <div className="flex items-center gap-2 py-6 text-sm text-slate-400"><Spinner /> carregando…</div>
      ) : linhas.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-400">Ninguém registrou atividade nos últimos 7 dias.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {linhas.map((l) => <CartaoColaborador key={l.colaborador} l={l} />)}
        </div>
      )}
    </Card>
  );
}

function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Selo de ritmo — cor SEMPRE função de quantos dias faz desde a última ação
// (nunca um tom fixo). "Sem atividade" quando não há base nenhuma no período.
function seloRitmo(ultima: string | null): { rotulo: string; tom: string; ponto: string } {
  const dias = diasDesde(ultima);
  if (dias === null) return { rotulo: "Sem atividade", tom: "text-slate-500 dark:text-slate-400", ponto: "bg-slate-300 dark:bg-slate-600" };
  if (dias <= 1) return { rotulo: "Em dia", tom: "text-emerald-700 dark:text-emerald-300", ponto: "bg-emerald-500" };
  if (dias <= 3) return { rotulo: "Esfriando", tom: "text-amber-700 dark:text-amber-300", ponto: "bg-amber-500" };
  return { rotulo: `Parado há ${dias} dias`, tom: "text-rose-700 dark:text-rose-300", ponto: "bg-rose-500" };
}

// Cumprimento de agendamento — "o que a gente promete e o que a gente propõe a
// fazer" (pedido literal do Marcio). Sem base (menos de 3 marcações resolvidas
// no período) o selo diz "sem dados", nunca calcula uma % que o volume não sustenta.
const BASE_MINIMA_AGENDAMENTOS = 3;
function seloAgendamentos(ag?: { realizados: number; nao_compareceu: number; remarcados: number; em_aberto: number }): { texto: string; tom: string } | null {
  if (!ag) return null;
  const resolvidos = ag.realizados + ag.nao_compareceu + ag.remarcados;
  if (resolvidos === 0 && ag.em_aberto === 0) return null; // ninguém marcou nada — não é indicador de ninguém
  if (resolvidos < BASE_MINIMA_AGENDAMENTOS) {
    return { texto: ag.em_aberto > 0 ? `${ag.em_aberto} marcado(s), ainda sem dado suficiente` : "Sem dado suficiente ainda", tom: "text-slate-500 dark:text-slate-400" };
  }
  const pct = Math.round((ag.realizados / resolvidos) * 100);
  const tom = pct >= 70 ? "text-emerald-700 dark:text-emerald-300" : pct >= 40 ? "text-amber-700 dark:text-amber-300" : "text-rose-700 dark:text-rose-300";
  return { texto: `Cumpriu ${ag.realizados} de ${resolvidos} compromissos marcados (${pct}%)`, tom };
}

function CartaoColaborador({ l }: { l: ColaboradorDesempenho }) {
  const ritmo = seloRitmo(l.ultima);
  const ag = seloAgendamentos(l.agendamentos);
  const falhas = l.falhas ?? 0;
  const tentativasDeEnvio = l.disparos + falhas;

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-800/30">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{l.colaborador}</span>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold", ritmo.tom)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", ritmo.ponto)} aria-hidden="true" />
          {ritmo.rotulo}
        </span>
      </div>

      <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
        {ag && <li className={ag.tom}>{ag.texto}</li>}
        {tentativasDeEnvio > 0 && (
          falhas > 0
            ? <li className="text-rose-700 dark:text-rose-300">{falhas} mensagem(ns) não saíram, de {tentativasDeEnvio} enviadas</li>
            : <li className="text-emerald-700 dark:text-emerald-300">Nenhuma mensagem falhou ({l.disparos} enviadas)</li>
        )}
        {!ag && tentativasDeEnvio === 0 && (
          <li className="text-slate-400 dark:text-slate-500">Sem envio nem compromisso marcado essa semana</li>
        )}
      </ul>
    </div>
  );
}
