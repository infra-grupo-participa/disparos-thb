"use client";

import { cn } from "@/app/_components/ui";

// A régua dos canais de aquisição que o time acompanha AGORA — fixados por
// decisão da operação (14/07), com o total de vendas de cada um sempre à vista.
// O dropdown de canal continua existindo para o resto (HT26, HT27, públicos…);
// a régua é o atalho para a pergunta diária: "quanto veio de cada evento?".
//
// A contagem vem do servidor e é do canal INTEIRO (ignora o filtro ativo) — o
// número é o placar do canal, não o tamanho da fatia visível. Canal com zero
// continua na régua de propósito: "Ex aluno Direto ao Ponto" zerado é o aviso
// de que a migration 0066 ainda não recarimbou os cards.
// Ordem = do mais recente para o mais antigo: o canal da campanha em curso é o que
// a operação abre o dia perguntando, então fica na frente.
export const CANAIS_FIXOS = [
  "HT30 - 09-08",
  "HT29 - 26-07",
  "Live Direto ao Ponto",
  "HT ATM",
  "HT28",
  "HM - Programa de Implementação",
  "Ex aluno Direto ao Ponto",
] as const;

// O filtro de canal oferece TODOS os canais de venda (27/07): os fixos ficam no
// topo (grupo sem rótulo — o atalho do dia a dia) e o restante que a API devolve
// — HT26, Imersão POA, públicos como "Aluno THB"/"Lead novo" etc. — cai num grupo
// "Outros canais". A API (`d.canais`) já exclui Origem/Turma/Aurum, então aqui só
// chega o que é canal; duplicatas dos fixos são removidas. A régua acima segue
// mostrando apenas os fixos.
export function gruposCanal(todos: string[]): { label: string | null; itens: string[] }[] {
  const fixos = CANAIS_FIXOS as readonly string[];
  const outros = todos
    .filter((c) => !fixos.includes(c))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  const grupos: { label: string | null; itens: string[] }[] = [{ label: null, itens: [...CANAIS_FIXOS] }];
  if (outros.length > 0) grupos.push({ label: "Outros canais", itens: outros });
  return grupos;
}

type Props = {
  /** vendas por canal (tag → nº de cards), vindas da API */
  contagem: Record<string, number>;
  /** canais filtrando a tela agora (o filtro aceita vários — OU entre eles) */
  ativos: string[];
  onToggle: (canal: string) => void;
};

export function HmCanaisFixos({ contagem, ativos, onToggle }: Props) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-1 gap-y-1 px-1 text-[11px] leading-5">
      <span className="mr-0.5 font-medium text-slate-400 dark:text-slate-500">canais:</span>
      {CANAIS_FIXOS.map((canal) => {
        const n = contagem[canal] ?? 0;
        const eleAtivo = ativos.includes(canal);
        return (
          <button
            key={canal}
            onClick={() => onToggle(canal)}
            title={`${canal} — ${n} venda(s); clique para ${eleAtivo ? "tirar do filtro" : "somar ao filtro"}`}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium transition",
              eleAtivo
                ? "bg-brand/10 text-brand dark:bg-brand-400/15 dark:text-brand-300"
                : n > 0
                  ? "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  : "text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800",
            )}
          >
            {canal}
            <span className={cn("tabular-nums font-semibold", n === 0 ? "text-slate-300 dark:text-slate-600" : eleAtivo ? "" : "text-slate-500 dark:text-slate-400")}>{n}</span>
          </button>
        );
      })}
    </div>
  );
}
