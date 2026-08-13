"use client";

import { useEffect, useState } from "react";
import { MarcaPortal } from "@/app/_components/marca";
import { AtividadeColaboradores } from "@/app/_components/atividade-colaboradores";
import { usePortal } from "@/app/_components/use-portal";
import { Card, Spinner, cn } from "@/app/_components/ui";

// Atividade por colaborador nos portais genéricos (HT/SEM/CNHF) — o requisito
// da tarefa HT30: "operador faz tudo pelo próprio sistema + visão de todas as
// ações do operador". Mesma leitura do /hm/atividade (componente compartilhado),
// consumindo /api/atividade, que soma o bucket "Ligações" (atendimentos por
// telefone registrados pelo time). O RECORTE é do servidor: master vê todos;
// gestor E operador veem a própria equipe (novo modelo 28/07 — o operador
// acompanha as ações dos colegas) — a tela mostra o que vier.

export default function AtividadePage() {
  const { portal, evento, nome, ehHT } = usePortal();

  return (
    <div>
      <div className="mb-3">
        <div className="flex items-center gap-2.5">
          <MarcaPortal portal={portal} altura="h-7" comNome={false} />
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {ehHT ? "Atividade" : `Atividade · ${nome}`}
          </h1>
        </div>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          O que cada colaborador fez no portal — movimentações, notas, disparos, ligações e demais
          ações assinadas. A lista respeita o seu nível: quem é de uma equipe vê a equipe inteira;
          o administrador do Grupo Participa vê todas.
        </p>
      </div>

      {/* Diferenciação visual de desempenho (pedido do Marcio, 12/08) — mesmo
          painel do /hm/atividade, só sem agendamentos (conceito exclusivo da
          esteira HM). Janela fixa de 7 dias, independente do período de baixo. */}
      <PainelDesempenho evento={evento} />

      <AtividadeColaboradores endpoint="/api/atividade" params={{ evento }} comLigacoes />
    </div>
  );
}

// ===== Painel de desempenho ==================================================
// Mesmos dados de /api/atividade (nenhum endpoint novo) — só lê `falhas`
// (mensagens que não saíram), que a tabela de baixo ainda não mostra. Cor é
// sempre função do valor, nunca constante; sem base o selo diz "sem dados".
type ColaboradorDesempenho = { colaborador: string; disparos: number; falhas?: number; ultima: string | null };

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

function PainelDesempenho({ evento }: { evento: string }) {
  const [linhas, setLinhas] = useState<ColaboradorDesempenho[] | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let cancelado = false;
    setLinhas(null);
    setErro(false);
    const p = new URLSearchParams({ evento, de: isoDiasAtras(7), ate: isoAmanha(), granularidade: "dia" });
    fetch(`/api/atividade?${p.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => { if (!cancelado) setLinhas(d.ok ? d.colaboradores : []); })
      .catch(() => { if (!cancelado) setErro(true); });
    return () => { cancelado = true; };
  }, [evento]);

  if (erro) return null;

  return (
    <Card className="mb-3 p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Como cada um está indo essa semana</h2>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
          Últimos 7 dias. Sem termo técnico — só o que aconteceu: quem segue ativo e onde uma mensagem não saiu.
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

function seloRitmo(ultima: string | null): { rotulo: string; tom: string; ponto: string } {
  const dias = diasDesde(ultima);
  if (dias === null) return { rotulo: "Sem atividade", tom: "text-slate-500 dark:text-slate-400", ponto: "bg-slate-300 dark:bg-slate-600" };
  if (dias <= 1) return { rotulo: "Em dia", tom: "text-emerald-700 dark:text-emerald-300", ponto: "bg-emerald-500" };
  if (dias <= 3) return { rotulo: "Esfriando", tom: "text-amber-700 dark:text-amber-300", ponto: "bg-amber-500" };
  return { rotulo: `Parado há ${dias} dias`, tom: "text-rose-700 dark:text-rose-300", ponto: "bg-rose-500" };
}

function CartaoColaborador({ l }: { l: ColaboradorDesempenho }) {
  const ritmo = seloRitmo(l.ultima);
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
        {tentativasDeEnvio > 0 ? (
          falhas > 0
            ? <li className="text-rose-700 dark:text-rose-300">{falhas} mensagem(ns) não saíram, de {tentativasDeEnvio} enviadas</li>
            : <li className="text-emerald-700 dark:text-emerald-300">Nenhuma mensagem falhou ({l.disparos} enviadas)</li>
        ) : (
          <li className="text-slate-400 dark:text-slate-500">Sem envio essa semana</li>
        )}
      </ul>
    </div>
  );
}
