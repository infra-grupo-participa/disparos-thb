import { query } from "@/lib/db";

// Registro de atividade por colaborador (A1). A captura já existe — cada linha
// de cs.interacoes é assinada por quem a fez (`autor`). Aqui está a LEITURA:
// quem fez o quê, em quanto card, no período. É a mesma trilha que a ficha
// mostra, agregada por pessoa em vez de por card.
//
// `autor` guarda tanto gente quanto atores do sistema (o webhook, o Make, o
// gatilho). O relatório é de GENTE: os atores automáticos ficam de fora por uma
// lista de exclusão — assim um colaborador novo aparece sozinho, sem precisar
// ser cadastrado em lugar nenhum.
const ATORES_SISTEMA = ["sistema", "make", "hotmart", "lead", "cs"];

export type AtividadeColaborador = {
  colaborador: string;
  total: number;
  movimentacoes: number;   // mudou card de etapa
  notas: number;           // escreveu nota na timeline
  disparos: number;        // disparou mensagem
  outras: number;          // responsável, tag, pagamento, cadastro… (tipo 'sistema' assinado)
  cards: number;           // cards distintos que tocou
  ultima: string | null;   // última atividade no período
};

export type Atividade = {
  de: string | null;
  ate: string | null;
  colaboradores: AtividadeColaborador[];
};

export async function atividadeHm(f: { de?: string | null; ate?: string | null }): Promise<Atividade> {
  const de = f.de || null;
  const ate = f.ate || null;

  const colaboradores = await query<AtividadeColaborador>(
    `select
        btrim(i.autor)                                                    as colaborador,
        count(*)::int                                                     as total,
        count(*) filter (where i.tipo = 'mudanca_estagio')::int           as movimentacoes,
        count(*) filter (where i.tipo = 'nota')::int                      as notas,
        count(*) filter (where i.tipo = 'disparo')::int                   as disparos,
        count(*) filter (where i.tipo not in ('mudanca_estagio','nota','disparo'))::int as outras,
        count(distinct i.contato_hm_id)::int                              as cards,
        max(i.criado_em)                                                  as ultima
       from cs.interacoes i
       join cs.contatos_hm ch on ch.id = i.contato_hm_id   -- só a esteira HM
      where i.autor is not null
        and btrim(lower(i.autor)) <> all($3::text[])
        and i.autor not ilike 'migration%'
        and ($1::timestamptz is null or i.criado_em >= $1)
        and ($2::timestamptz is null or i.criado_em <  $2)
      group by btrim(i.autor)
      order by count(*) desc, btrim(i.autor)`,
    [de, ate, ATORES_SISTEMA],
  );

  return { de, ate, colaboradores };
}
