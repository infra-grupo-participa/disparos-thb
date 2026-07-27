"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, EmptyState, PageHeader, Spinner, cn } from "@/app/_components/ui";
import { Kpi } from "@/app/_components/kpi";
import { Reveal } from "@/app/_components/anim";
import { usePortal } from "@/app/_components/use-portal";
import { useMe } from "@/app/_components/use-me";
import { RegistrarAtendimento } from "@/app/_components/ligacao";

// "Meu dia" — a tela do operador. Três perguntas, nesta ordem:
//   quem eu prometi retornar? · quem está esperando? · quem ninguém tocou?
// E, ao lado, o placar do que ELE já fez hoje. O registro fica a um clique de
// cada nome: se registrar custar caro, ninguém registra, e o painel passa a
// mentir sobre o trabalho que foi feito.

type Item = {
  comprador_id: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  estagio: string | null;
  quando: string | null;
  nota: string | null;
};
type Placar = { total: number; atendidos: number; tempoSeg: number; retornos: number };
type Dados = {
  operador: string;
  placar: Placar;
  filas: { retornos: Item[]; esperando: Item[]; semToque: Item[] };
  dias_sem_toque: number;
};

const fmt = (n: number) => n.toLocaleString("pt-BR");
function dur(seg: number) {
  if (!seg) return "0min";
  const m = Math.round(seg / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}` : `${m}min`;
}
function quando(iso: string | null): string {
  if (!iso) return "nunca";
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.round(ms / 60000);
  if (min < 0) return `em ${Math.abs(min) < 60 ? `${Math.abs(min)}min` : `${Math.round(Math.abs(min) / 60)}h`}`;
  if (min < 60) return `há ${min}min`;
  if (min < 1440) return `há ${Math.round(min / 60)}h`;
  return `há ${Math.round(min / 1440)}d`;
}

export default function MeuDiaPage() {
  const { evento, base } = usePortal();
  const { podeVerTudo } = useMe();
  const [d, setD] = useState<Dados | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [alvo, setAlvo] = useState<Item | null>(null);
  const [meus, setMeus] = useState(true);
  const [pegando, setPegando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/meu-dia?evento=${evento}&meus=${meus ? 1 : 0}`);
      const j = await r.json();
      if (j.ok) setD(j);
    } finally {
      setCarregando(false);
    }
  }, [evento, meus]);
  useEffect(() => { carregar(); }, [carregar]);

  // "Pegar próximos" — o SDR puxa para si os leads sem dono mais quentes e a fila
  // já reabastece com o filtro "Meus" ligado.
  async function pegarLeads() {
    setPegando(true);
    try {
      const r = await fetch(`/api/kanban/pegar-leads?evento=${evento}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantos: 20 }),
      });
      const j = await r.json();
      if (j.ok) {
        setMeus(true);
        await carregar();
        alert(j.pegos > 0 ? `${j.pegos} lead(s) atribuído(s) a você.` : "Nenhum lead sem dono disponível agora.");
      }
    } finally {
      setPegando(false);
    }
  }

  if (carregando) {
    return <div className="flex items-center justify-center gap-2 py-16 text-slate-400"><Spinner /> Carregando seu dia…</div>;
  }
  if (!d) {
    return <EmptyState title="Não foi possível carregar" description="Recarregue a página." />;
  }

  const { placar, filas } = d;
  const nada = filas.retornos.length === 0 && filas.esperando.length === 0 && filas.semToque.length === 0;

  return (
    <div>
      <PageHeader
        title="Meu dia"
        description={`Sua fila de trabalho e o que você já fez hoje, ${d.operador}.`}
      />

      {/* Foco da fila (minha carteira × portal inteiro) + reabastecer a carteira. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
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
            title={podeVerTudo() ? "Todos os leads deste portal" : "Tudo o que você pode ver neste portal (o servidor recorta por equipe)"}
          >
            {/* Só o MASTER vê o portal inteiro — para os demais o rótulo não
                promete "todos": o servidor recorta pela equipe/carteira. */}
            {podeVerTudo() ? "Todos do portal" : "Tudo que vejo"}
          </button>
        </div>
        <Button variant="secondary" className="h-8 px-3 text-xs" onClick={pegarLeads} disabled={pegando}>
          {pegando ? "Pegando…" : "Pegar próximos 20 para mim"}
        </Button>
      </div>

      {/* O placar: o resultado do próprio trabalho, de volta para quem o fez. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi titulo="Atendimentos hoje" valor={fmt(placar.total)} sub="registrados por você" />
        <Kpi titulo="Conversas de verdade" valor={fmt(placar.atendidos)} sub={placar.total ? `${Math.round((placar.atendidos / placar.total) * 100)}% dos toques` : "—"} />
        <Kpi titulo="Tempo falado" valor={dur(placar.tempoSeg)} sub="somando as durações" />
        <Kpi titulo="Retornos agendados" valor={fmt(placar.retornos)} sub="compromissos que você marcou" />
      </div>

      {nada ? (
        <div className="mt-6">
          <EmptyState
            title={meus ? "Sua carteira está vazia" : "Fila vazia"}
            description={
              meus
                ? "Você ainda não tem leads sob sua responsabilidade nesta fila. Clique em “Pegar próximos 20 para mim” para começar a trabalhar."
                : "Nenhum retorno vencendo, ninguém esperando resposta e todo mundo do funil recebeu um toque recente. Bom trabalho."
            }
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <Fila
            titulo="Você prometeu retornar"
            descricao="Retornos que você agendou e já venceram. É dívida — comece por aqui."
            cor="rose"
            itens={filas.retornos}
            base={base}
            onRegistrar={setAlvo}
            mostrarNota
          />
          <Fila
            titulo="Esperando resposta"
            descricao="Escreveram e ninguém respondeu ainda. Cada minuto conta no tempo de resposta."
            cor="amber"
            itens={filas.esperando}
            base={base}
            onRegistrar={setAlvo}
          />
          <Fila
            titulo={`Sem toque há mais de ${d.dias_sem_toque} dias`}
            descricao="Estão no funil e ninguém falou com eles. É onde o lead esfria."
            cor="slate"
            itens={filas.semToque}
            base={base}
            onRegistrar={setAlvo}
          />
        </div>
      )}

      {alvo?.telefone && (
        <RegistrarAtendimento
          compradorId={alvo.comprador_id}
          nome={alvo.nome}
          telefone={alvo.telefone}
          onClose={() => setAlvo(null)}
          onSalvo={() => { setAlvo(null); carregar(); }}
        />
      )}
    </div>
  );
}

const COR: Record<string, string> = {
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  slate: "bg-slate-400",
};

function Fila({
  titulo, descricao, cor, itens, base, onRegistrar, mostrarNota,
}: {
  titulo: string;
  descricao: string;
  cor: string;
  itens: Item[];
  base: string;
  onRegistrar: (i: Item) => void;
  mostrarNota?: boolean;
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
          {itens.map((i) => (
            <li key={i.comprador_id} className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
              <div className="min-w-0 flex-1">
                <Link
                  href={`${base}/contatos/${i.comprador_id}`}
                  className="block truncate text-sm font-medium text-slate-800 hover:text-brand dark:text-slate-100 dark:hover:text-brand-300"
                >
                  {i.nome || i.telefone || "—"}
                </Link>
                <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">
                  {i.estagio && <span className="text-slate-500 dark:text-slate-400">{i.estagio}</span>}
                  {i.estagio && " · "}
                  {quando(i.quando)}
                  {mostrarNota && i.nota ? ` · ${i.nota}` : ""}
                </p>
              </div>
              <Button
                variant="secondary"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={() => onRegistrar(i)}
                disabled={!i.telefone}
                title={i.telefone ? "Registrar atendimento" : "Contato sem telefone"}
              >
                Registrar
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </Reveal>
  );
}
