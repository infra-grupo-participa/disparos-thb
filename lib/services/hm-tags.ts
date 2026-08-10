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
  cor: string | null;
  tipo: "livre" | "sistema";
  usos: number;
};

// `produto` recorta o CATÁLOGO ao board (10/08): o catálogo `cs.tags` é único para
// HM/Aurum/ETHB (todos com evento='HM'), então sem recorte o portal do Aurum listava
// tag que só existe no HM — e com a contagem de usos do HM inteiro.
//
// Regra: a tag entra se estiver em uso NESTE board (usos > 0) ou se for 'livre' e
// ainda não usada em lugar nenhum (tag recém-criada precisa aparecer para ser usada).
// Tag de sistema em uso só no OUTRO board fica de fora — é o vazamento.
export async function listarTagsHm(produto: "HM" | "AURUM" | "ETHB" = "HM"): Promise<TagCatalogo[]> {
  return query<TagCatalogo>(
    `with c as (
       select t.id, t.nome, t.cor, t.tipo,
              (select count(*)::int from cs.contatos_hm ch
                where ch.produto = $1 and t.nome = any(ch.tags)) as usos,
              (select count(*)::int from cs.contatos_hm ch2
                where t.nome = any(ch2.tags)) as usos_global
         from cs.tags t
        where t.evento = 'HM'
     )
     select id, nome, cor, tipo, usos from c
      where usos > 0 or (tipo = 'livre' and usos_global = 0)
      order by tipo desc, nome`,
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
  const r = await queryOne<{ id: string }>(
    `insert into cs.tags (evento, nome, cor, tipo, criado_por)
     values ('HM', $1, $2, 'livre', $3)
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

export async function recolorirTagHm(id: string, cor: string | null): Promise<boolean> {
  const r = await query(`update cs.tags set cor = $2 where id = $1 and evento = 'HM' returning id`, [id, cor]);
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
