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

// Recorte por NÍVEL (quem pode ver a atividade de quem):
//   tudo     → master: todos os colaboradores.
//   equipe   → gestor: só os membros da PRÓPRIA equipe. A trilha é assinada por
//              NOME (i.autor é texto), então o recorte casa o autor contra os
//              nomes dos usuários da equipe. Gestor sem equipe (equipeId null)
//              não casa ninguém — vê lista vazia, nunca "todo mundo".
//   operador → só a própria linha.
export type EscopoAtividade =
  | { modo: "tudo" }
  | { modo: "equipe"; equipeId: string | null }
  | { modo: "operador"; nome: string };

export async function atividadeHm(
  f: { de?: string | null; ate?: string | null },
  escopo: EscopoAtividade = { modo: "tudo" },
): Promise<Atividade> {
  const de = f.de || null;
  const ate = f.ate || null;
  const modo = escopo.modo;
  const equipeId = escopo.modo === "equipe" ? escopo.equipeId : null;
  const nome = escopo.modo === "operador" ? escopo.nome : null;

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
        -- Recorte por nível: master tudo; gestor só a equipe dele (autor casa por
        -- nome com um usuário da equipe); operador só a própria linha.
        and ($4::text = 'tudo'
             or ($4 = 'equipe' and exists (
                   select 1 from cs.usuarios u
                    where u.equipe_id = $5::uuid
                      and lower(btrim(u.nome)) = lower(btrim(i.autor))))
             or ($4 = 'operador' and lower(btrim(i.autor)) = lower(btrim($6::text))))
      group by btrim(i.autor)
      order by count(*) desc, btrim(i.autor)`,
    [de, ate, ATORES_SISTEMA, modo, equipeId, nome],
  );

  return { de, ate, colaboradores };
}

// ===== Atividade nos portais genéricos (HT/SEM/CNHF) ========================
// O espelho de atividadeHm sobre a timeline dos GENÉRICOS: cs.interacoes
// assinada em contato_id → cs.contatos, filtrada pelo EVENTO do portal (a
// linha de cs.contatos é por evento — sem o filtro a atividade do CNHF vazaria
// para o painel do HT). Mesmo recorte por nível (EscopoAtividade) e mesma
// lista de exclusão de atores automáticos.
// Bucket extra `ligacoes`: nos genéricos o atendimento por telefone/WhatsApp
// manual entra como tipo 'ligacao' (lib/services/ligacao.ts) — no HM isso não
// existe e cai em `outras`.
export type AtividadeEventoColaborador = AtividadeColaborador & { ligacoes: number };

export type AtividadeEvento = {
  de: string | null;
  ate: string | null;
  colaboradores: AtividadeEventoColaborador[];
};

export async function atividadeEvento(
  evento: string,
  f: { de?: string | null; ate?: string | null },
  escopo: EscopoAtividade = { modo: "tudo" },
): Promise<AtividadeEvento> {
  const de = f.de || null;
  const ate = f.ate || null;
  const modo = escopo.modo;
  const equipeId = escopo.modo === "equipe" ? escopo.equipeId : null;
  const nome = escopo.modo === "operador" ? escopo.nome : null;

  const colaboradores = await query<AtividadeEventoColaborador>(
    `select
        btrim(i.autor)                                                    as colaborador,
        count(*)::int                                                     as total,
        count(*) filter (where i.tipo = 'mudanca_estagio')::int           as movimentacoes,
        count(*) filter (where i.tipo = 'nota')::int                      as notas,
        count(*) filter (where i.tipo = 'disparo')::int                   as disparos,
        count(*) filter (where i.tipo = 'ligacao')::int                   as ligacoes,
        count(*) filter (where i.tipo not in ('mudanca_estagio','nota','disparo','ligacao'))::int as outras,
        count(distinct i.contato_id)::int                                 as cards,
        max(i.criado_em)                                                  as ultima
       from cs.interacoes i
       join cs.contatos c on c.id = i.contato_id and c.evento = $7  -- só o portal
      where i.autor is not null
        and btrim(lower(i.autor)) <> all($3::text[])
        and i.autor not ilike 'migration%'
        and ($1::timestamptz is null or i.criado_em >= $1)
        and ($2::timestamptz is null or i.criado_em <  $2)
        -- Recorte por nível: master tudo; gestor só a equipe dele (autor casa
        -- por nome com um usuário da equipe); operador só a própria linha.
        and ($4::text = 'tudo'
             or ($4 = 'equipe' and exists (
                   select 1 from cs.usuarios u
                    where u.equipe_id = $5::uuid
                      and lower(btrim(u.nome)) = lower(btrim(i.autor))))
             or ($4 = 'operador' and lower(btrim(i.autor)) = lower(btrim($6::text))))
      group by btrim(i.autor)
      order by count(*) desc, btrim(i.autor)`,
    [de, ate, ATORES_SISTEMA, modo, equipeId, nome, evento],
  );

  return { de, ate, colaboradores };
}
