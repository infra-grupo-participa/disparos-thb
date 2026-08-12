import { query, queryOne } from "@/lib/db";

// O catálogo de tags do HM (cs.tags, migration 0067). A tag é cidadã: existe
// antes de ser usada, tem cor própria e dono. Renomear e excluir PROPAGAM para
// os cards na mesma transação (um statement com CTE — ou muda tudo, ou nada):
// um catálogo que diz "Recuperado" enquanto os cards dizem "Recuperar" seria
// pior do que não ter catálogo.
//
// tipo 'sistema' não se renomeia nem se exclui: funções do banco (fn_tag_hm_
// origem, fn_hm_janela_evento, sync HT ATM) gravam esses nomes LITERAIS — um
// rename aqui viraria órfão na próxima venda. As gerenciadas ("Origem/Turma/
// Aurum …") nem entram no catálogo (são espelho do campo turma).

const RE_TAG_GERENCIADA = /^(Origem|Turma|Aurum) /;

export type TagCatalogo = {
  id: string;
  nome: string;
  cor: string | null;          // override da tag (0206) — null = herda de tag_categoria
  cor_efetiva: string;         // a cor que o front DESENHA: override ?? cor da categoria ?? cinza neutro
  categoria: string | null;    // publico|canal|turma|origem_base|produto|operacional (0206) — null = tag antiga sem classificar
  categoria_rotulo: string | null;
  categoria_descricao: string | null; // cs.tag_categoria.descricao — o texto que explica a FAMÍLIA (legenda)
  descricao: string | null;
  tipo: "livre" | "sistema";
  usos: number;
};

// Cor de fallback para tag sem categoria (metadado incompleto — não deveria
// sobrar nenhuma depois da 0206, mas o front não pode quebrar se sobrar).
const COR_SEM_CATEGORIA = "#94a3b8";

// `produto` recorta o CATÁLOGO ao board (10/08): o catálogo `cs.tags` é único para
// HM/Aurum/ETHB (todos com evento='HM'), então sem recorte o portal do Aurum listava
// tag que só existe no HM — e com a contagem de usos do HM inteiro.
//
// Regra: a tag entra se estiver em uso NESTE board (usos > 0) ou se for 'livre' e
// ainda não usada em lugar nenhum (tag recém-criada precisa aparecer para ser usada).
// Tag de sistema em uso só no OUTRO board fica de fora — é o vazamento.
//
// OTIMIZAÇÃO (0206): a versão antiga rodava DUAS subqueries correlacionadas por
// LINHA de cs.tags — cada uma um seq scan em cs.contatos_hm (confirmado com
// EXPLAIN: 746 buffers / 38ms com 13 tags; o catálogo passou a ter ~71 depois
// do dicionário, o que teria multiplicado o custo). Agora é um `unnest`
// agregado UMA vez (CTE `usos`) com LEFT JOIN — 1 seq scan inteiro, não 2×N.
// Medido: 33 buffers / 5ms no mesmo catálogo (EXPLAIN ANALYZE, sem cronômetro
// de cliente — pooler Supavisor em modo transação).
export async function listarTagsHm(produto: "HM" | "AURUM" | "ETHB" = "HM"): Promise<TagCatalogo[]> {
  return query<TagCatalogo>(
    `with usos as (
       select t as nome,
              count(*) filter (where ch.produto = $1)::int as usos,
              count(*)::int                                as usos_global
         from cs.contatos_hm ch, unnest(ch.tags) t
        group by t
     )
     select tg.id, tg.nome, tg.cor, tg.tipo,
            tg.categoria, cat.rotulo as categoria_rotulo, cat.descricao as categoria_descricao, tg.descricao,
            coalesce(tg.cor, cat.cor, '${COR_SEM_CATEGORIA}') as cor_efetiva,
            coalesce(u.usos, 0) as usos
       from cs.tags tg
       left join cs.tag_categoria cat on cat.categoria = tg.categoria
       left join usos u on u.nome = tg.nome
      where tg.evento = 'HM'
        and (coalesce(u.usos, 0) > 0 or (tg.tipo = 'livre' and coalesce(u.usos_global, 0) = 0))
      order by tg.tipo desc, tg.nome`,
    [produto],
  );
}

export type CriarTagErro = "nome_gerenciado" | "ja_existe";

export async function criarTagHm(
  nome: string,
  cor: string | null,
  autor: string,
): Promise<{ ok: true; id: string } | { ok: false; reason: CriarTagErro }> {
  const n = nome.trim();
  if (RE_TAG_GERENCIADA.test(n)) return { ok: false, reason: "nome_gerenciado" };
  // categoria 'operacional' (0206) por padrão: toda tag criada à mão pelo
  // operador é, por definição, um marcador de rotina do time — não é gerada
  // por trigger/webhook (essas entram por SQL direto na migration, com a
  // categoria certa). `cor` explícita continua sendo o override de sempre;
  // sem ela, a tag herda o cinza de 'operacional' até alguém recolorir.
  const r = await queryOne<{ id: string }>(
    `insert into cs.tags (evento, nome, cor, tipo, categoria, criado_por)
     values ('HM', $1, $2, 'livre', 'operacional', $3)
     on conflict (evento, nome) do nothing
     returning id`,
    [n, cor, autor],
  );
  if (!r) return { ok: false, reason: "ja_existe" };
  return { ok: true, id: r.id };
}

// Renomeia a tag e a troca em TODOS os cards — um único statement (atômico).
// Só tipo 'livre'; devolve false se a tag não existe, é de sistema, ou o novo
// nome colide com outra tag do catálogo (a unique barra e nada muda).
export async function renomearTagHm(id: string, novoNome: string): Promise<boolean> {
  const n = novoNome.trim();
  if (!n || RE_TAG_GERENCIADA.test(n)) return false;
  const antiga = await queryOne<{ nome: string }>(
    `select nome from cs.tags where id = $1 and evento = 'HM' and tipo = 'livre'`,
    [id],
  );
  if (!antiga || antiga.nome === n) return false;
  const colide = await queryOne(`select 1 from cs.tags where evento = 'HM' and nome = $1`, [n]);
  if (colide) return false;
  await query(
    `with ren as (
       update cs.tags set nome = $2 where id = $1 and tipo = 'livre' returning 1
     )
     update cs.contatos_hm
        set tags = array_replace(tags, $3, $2)
      where exists (select 1 from ren) and $3 = any(tags)`,
    [id, n, antiga.nome],
  );
  return true;
}

// A cor default de uma tag agora vem de cs.tag_categoria (0206) — esta função
// escreve o OVERRIDE (cs.tags.cor). `cor = null` não é "sem cor": é "volta a
// herdar a cor da categoria" — listarTagsHm já resolve isso com
// coalesce(tg.cor, cat.cor, ...). Só recolore quem já tem categoria fazendo
// sentido pontual (ex.: uma tag de sistema que precisa se destacar do resto
// da família); a paleta em si (cs.tag_categoria) não é editável por aqui.
export async function recolorirTagHm(id: string, cor: string | null): Promise<boolean> {
  const r = await query(`update cs.tags set cor = $2 where id = $1 and evento = 'HM' returning id`, [id, cor]);
  return r.length > 0;
}

// Escreve a descrição (o que a tag SIGNIFICA, 0206). Mesmo padrão de
// recolorirTagHm: `descricao = null` é gesto válido (limpar uma explicação
// desatualizada), não erro — o service não distingue "limpar" de "nunca teve".
export async function descreverTagHm(id: string, descricao: string | null): Promise<boolean> {
  const r = await query(`update cs.tags set descricao = $2 where id = $1 and evento = 'HM' returning id`, [id, descricao]);
  return r.length > 0;
}

// Recategoriza a tag (0206) — a categoria decide a cor herdada (cat.cor em
// listarTagsHm) quando a tag não tem override próprio. Diferente de
// nome/exclusão, categoria é editável em QUALQUER tipo (inclusive 'sistema':
// uma tag gerada por trigger pode ter nascido classificada errado, e corrigir
// a família não mexe no NOME literal que as funções do banco comparam — só
// no metadado). category = null devolve a tag ao estado "sem categoria"
// (cor cai no cinza de fallback, COR_SEM_CATEGORIA em listarTagsHm).
export async function recategorizarTagHm(id: string, categoria: string | null): Promise<boolean> {
  const r = await query(`update cs.tags set categoria = $2 where id = $1 and evento = 'HM' returning id`, [id, categoria]);
  return r.length > 0;
}

// Exclui do catálogo e ARRANCA a tag de todos os cards — atômico, só 'livre'.
export async function excluirTagHm(id: string): Promise<boolean> {
  const r = await query<{ nome: string }>(
    `with del as (
       delete from cs.tags where id = $1 and evento = 'HM' and tipo = 'livre' returning nome
     )
     update cs.contatos_hm
        set tags = array_remove(tags, (select nome from del))
      where (select nome from del) = any(tags)
      returning (select nome from del) as nome`,
    [id],
  );
  if (r.length > 0) return true;
  // Nenhum card usava: o update acima não retorna linha mesmo tendo deletado.
  const aindaExiste = await queryOne(`select 1 from cs.tags where id = $1`, [id]);
  return !aindaExiste;
}
