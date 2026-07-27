import { query } from "@/lib/db";
import { relatorioHm, type FiltrosHm, type LinhaEsteira, type QuandoHm } from "@/lib/services/hm-relatorio";

// O financeiro do HM em duas leituras que precisam andar juntas:
//
//   1) a POSIÇÃO de cada aluno — pacote, recebido, saldo, parcelas, cancelamento.
//      Vem de relatorioHm: a MESMA função que alimenta o board e a tabela, para
//      que a planilha do financeiro nunca conte uma história diferente da tela.
//   2) o RAZÃO — cada pagamento que entrou, um por linha (cs.hm_pagamentos, 0075).
//      É com isto que se concilia: a posição diz "recebeu R$ 3.449,97"; o razão
//      diz de onde vieram os R$ 3.449,97.
//
// Os filtros são os do board (responsável, canal, turma): o financeiro exporta o
// que está vendo, e o razão sai só de quem passou pelo filtro.

export type PagamentoHm = {
  comprador_id: string;
  nome: string;
  email: string | null;
  categoria: string | null;
  valor: string | null;
  pago_em: QuandoHm;
  origem: string | null;
  transacao: string | null;
  oferta_codigo: string | null;
  metodo_pagamento: string | null;
  parcela: number | null;
  obs: string | null;
  autor: string | null;
};

export type RelatorioFinanceiroHm = {
  linhas: LinhaEsteira[];
  pagamentos: PagamentoHm[];
  filtros: FiltrosHm;
};

export async function relatorioFinanceiroHm(f: FiltrosHm): Promise<RelatorioFinanceiroHm> {
  // SEGURANÇA herdada de relatorioHm: com verTudo=false, cards em cancelamento
  // (Reclamada/Reembolsado) NÃO vêm em `linhas` — e como o razão abaixo sai dos
  // ids de `linhas`, os pagamentos deles também não. A aba "Cancelamentos" do
  // XLSX só existe para o master. Nunca consultar cs.hm_pagamentos por fora
  // desses ids: seria reabrir o vazamento com outra roupa.
  const r = await relatorioHm(f);
  const ids = r.linhas.map((l) => l.comprador_id);

  // Filtro que não pegou ninguém: sem `any($1)` de lista vazia, que o Postgres
  // aceita mas devolveria o razão inteiro se alguém trocasse o operador.
  if (ids.length === 0) return { linhas: [], pagamentos: [], filtros: f };

  const pagamentos = await query<PagamentoHm>(
    `select p.comprador_id, c.nome, c.email,
            p.categoria, p.valor, p.pago_em, p.origem,
            p.transacao, p.oferta_codigo, p.metodo_pagamento, p.parcela, p.obs, p.autor
       from cs.hm_pagamentos p
       join public.compradores c on c.id = p.comprador_id
      where p.comprador_id = any($1::uuid[])
      order by p.pago_em desc nulls last, c.nome`,
    [ids],
  );

  return { linhas: r.linhas, pagamentos, filtros: f };
}
