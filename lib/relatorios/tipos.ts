import type { Ator } from "@/lib/papeis";

// ============================================================================
// O CONTRATO dos relatórios — B0, escrito primeiro e CONGELADO (16/08/2026).
// O frontend (F5) importa só o `type` daqui; nenhum outro arquivo desta pasta muda a
// FORMA destes tipos sem passar por aqui de novo. Ver arquiteto-central-ativacao.md §4.3.
//
// A lei que sustenta o módulo inteiro (§4.1): nenhum relatório escreve SQL próprio — todo
// relatório monta a saída a partir de um serviço que JÁ existe (carteiraHm, atividadeHm...).
// Se um número não existe em serviço nenhum, o SERVIÇO ganha o campo; o relatório não faz
// a conta. Consequência: tela, XLSX e PDF saem da mesma função — divergir vira impossível
// por construção, que é o "não haver divergência de dados" que o João pediu.
// ============================================================================

export type Coluna = {
  chave: string;
  rotulo: string;
  tipo: "texto" | "dinheiro" | "data" | "numero" | "selo";
  /** De onde este número sai — view/tabela/serviço. Vai IMPRESSO na folha de fontes.
   *  Obrigatório: número sem origem rastreável não entra em relatório nenhum. */
  fonte: string;
};

export type Secao = {
  titulo: string;
  /** Uma frase em português antes da tabela. Tabela sem chamada é proibida. */
  chamada: string;
  colunas: Coluna[];
  linhas: Record<string, unknown>[];
  totais?: Record<string, unknown>;
};

export type ResultadoRelatorio = {
  titulo: string;
  subtitulo: string;
  destaques: { rotulo: string; valor: string; auxiliar?: string }[];
  secoes: Secao[];
  /** O que este relatório NÃO afirma. Array vazio é REPROVADO — todo relatório tem limite,
   *  e um relatório que não declara o próprio limite é o tipo de "papo de demissional" que
   *  o João quer evitar. `lib/protocolo.ts:emitirRelatorio` recusa gravar um resultado com
   *  `ressalvas` vazio. */
  ressalvas: string[];
  /** Uma linha por objeto de banco (view/tabela/serviço) que alimentou a folha. */
  fontes: string[];
};

export type ContextoRelatorio = {
  de: string | null;
  ate: string | null;
  produto: string | null;
  /** O escopo de visibilidade sai DAQUI — nunca de query string, nunca de body. Cada
   *  gerador aplica `escopoVisibilidade(sessao)` (ou equivalente) por dentro, do mesmo
   *  jeito que o resto do sistema faz. */
  sessao: Ator;
  /** Número já reservado (lib/protocolo.ts) antes de `gerar` rodar — carimbado na folha. */
  protocolo: string;
};

export type DefinicaoRelatorio = {
  id: string;
  nome: string;
  descricao: string;
  /** Quais parâmetros este relatório usa — a tela (F5) monta o formulário a partir daqui,
   *  sem lista de tipos hardcoded no front. */
  params: ("periodo" | "produto")[];
  /** Nível mínimo para GERAR este relatório. Ausente = qualquer nível autenticado no portal. */
  nivel?: "gestor" | "master";
  portais: ("HM" | "AURUM" | "ETHB")[];
  gerar(ctx: ContextoRelatorio): Promise<ResultadoRelatorio>;
};
