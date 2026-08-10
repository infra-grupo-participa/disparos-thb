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
//
// POR PRODUTO (10/08, pedido do Marcio): a régua era uma constante global, então o
// board do AURUM exibia os canais do HM (HT29, HT30, HT ATM…) — eventos que não têm
// nada a ver com ele. Cada portal agora lista só os SEUS canais. Ao criar um canal
// novo, cadastrá-lo aqui no produto certo; senão ele cai em "Outros canais" do
// dropdown e some da régua.
export type ProdutoBoard = "HM" | "AURUM" | "ETHB";

const CANAIS_POR_PRODUTO: Record<ProdutoBoard, readonly string[]> = {
  HM: [
    // As DUAS edições do pitch da entrada de R$697 (mesma oferta na Hotmart,
    // lives de 09/08 e 10/08). Quem separa uma da outra é a janela de compra —
    // ver migration 0167. Ficam lado a lado de propósito: a pergunta da operação
    // hoje é "qual das duas lives converteu mais?".
    "HT30 - 10-08",
    "HT30 - 09-08",
    "HT29 - 26-07",
    "Live Direto ao Ponto",
    "HT ATM",
    "HT28",
    "HM - Programa de Implementação",
    "Ex aluno Direto ao Ponto",
  ],
  // O Aurum nasceu no pitch do Encontro do Time Holding Brasil (São Paulo, 05/08) —
  // hoje é o único canal dele. Ver cs.hm_origem_por_oferta: qm4lu7py → 'ETHB SP'.
  AURUM: ["ETHB SP"],
  // ETHB ainda não tem canal próprio mapeado; régua vazia é melhor que régua errada.
  ETHB: [],
};

export function canaisFixosDo(produto: ProdutoBoard | null | undefined): readonly string[] {
  return CANAIS_POR_PRODUTO[produto ?? "HM"] ?? CANAIS_POR_PRODUTO.HM;
}

/** @deprecated use canaisFixosDo(produto) — mantido só para o board do HM legado. */
export const CANAIS_FIXOS = CANAIS_POR_PRODUTO.HM;

// O filtro de canal oferece TODOS os canais de venda (27/07): os fixos ficam no
// topo (grupo sem rótulo — o atalho do dia a dia) e o restante que a API devolve
// — HT26, Imersão POA, públicos como "Aluno THB"/"Lead novo" etc. — cai num grupo
// "Outros canais". A API (`d.canais`) já exclui Origem/Turma/Aurum, então aqui só
// chega o que é canal; duplicatas dos fixos são removidas. A régua acima segue
// mostrando apenas os fixos.
export function gruposCanal(todos: string[], produto?: ProdutoBoard | null): { label: string | null; itens: string[] }[] {
  const fixos = canaisFixosDo(produto);
  const outros = todos
    .filter((c) => !fixos.includes(c))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  const grupos: { label: string | null; itens: string[] }[] = fixos.length > 0 ? [{ label: null, itens: [...fixos] }] : [];
  if (outros.length > 0) grupos.push({ label: fixos.length > 0 ? "Outros canais" : null, itens: outros });
  return grupos;
}

type Props = {
  /** vendas por canal (tag → nº de cards), vindas da API */
  contagem: Record<string, number>;
  /** canais filtrando a tela agora (o filtro aceita vários — OU entre eles) */
  ativos: string[];
  onToggle: (canal: string) => void;
  /** board em que a régua está: define QUAIS canais aparecem (10/08) */
  produto?: ProdutoBoard | null;
};

export function HmCanaisFixos({ contagem, ativos, onToggle, produto }: Props) {
  const canais = canaisFixosDo(produto);
  // Produto sem canal mapeado (ETHB): não renderiza a régua — uma tira "canais:"
  // vazia só ocupa espaço e sugere que o filtro está quebrado.
  if (canais.length === 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-1 gap-y-1 px-1 text-[11px] leading-5">
      <span className="mr-0.5 font-medium text-slate-400 dark:text-slate-500">canais:</span>
      {canais.map((canal) => {
        const n = contagem[canal] ?? 0;
        const eleAtivo = ativos.includes(canal);
        return (
          <button
            key={canal}
            onClick={() => onToggle(canal)}
            title={`${canal} — ${n} venda(s); clique para ${eleAtivo ? "tirar do filtro" : "somar ao filtro"}`}
            className={cn(
              // alvo-toque: no celular a régua é a forma mais rápida de filtrar
              // o board, e um alvo de 20px de altura errava o dedo.
              "alvo-toque inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition",
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
