import { NextResponse } from "next/server";
import { guard } from "@/lib/guard";
import { produtoDaRequisicao } from "@/lib/produto-hm";
import { query } from "@/lib/db";
import { logger } from "@/lib/log";
import { parseBody, HmLoteSchema } from "@/lib/validators";
import { addTagHm, moverEstagioHm, removeTagHm, atribuirResponsavelHm, podeAgirCardHm, cancelamentoBloqueado, HM_ESTAGIOS_CANCELAMENTO, type DestinoAtribuicao } from "@/lib/services/hm";
import { ehMaster } from "@/lib/papeis";

export const runtime = "nodejs";

const log = logger("hm-lote");

type Falha = { compradorId: string; nome: string; motivo: string; faltando?: string[] };

// POST /api/hm/lote — ações em massa da tabela HM (espelha /api/kanban/lote, do HT).
// body: { compradorIds, responsavel?, estagio_chave?, ativ_*?, link_saldo_enviado? }
//
// A regra que define esta rota: ela ITERA chamando os serviços, um aluno por
// vez — nunca um `UPDATE ... WHERE id = ANY(...)`. É mais lento e é o certo:
// mover etapa em massa por update direto pularia a trava do checklist, o
// provisionamento do aluno na base THB, a liberação de acesso e a timeline —
// um lote que corrompe a base em escala. A resposta diz quem passou e quem não
// (`falhas`, com o `faltando` do checklist), para a tela mostrar nominalmente.
export async function POST(req: Request) {
  // ⚠️ 0187 — ESCRITA EM MASSA, cross-produto. O lote recebe `compradorIds` no body
  // e escrevia por `where comprador_id = $1` SEM filtro de produto: quem tem card no
  // HM e no Aurum (15 pessoas hoje) tinha os DOIS cards marcados de uma vez —
  // checklist de ativação e o carimbo `link_saldo_enviado_em`, que é o que sustenta
  // a cobrança. E `moverEstagioHm` sem produto cai no card do Aurum quando a pessoa
  // não tem card HM (20 cards hoje nessa situação).
  //
  // Agora o lote é MONO-PRODUTO: herda o board de quem chamou (?produto=), valida
  // ESSE portal e escopa todas as escritas nele.
  const produto = produtoDaRequisicao(req);
  const g = await guard({ portal: produto });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  const operador = sessao.nome || "cs";
  const p = await parseBody(req, HmLoteSchema);
  if (!p.ok) return p.res;
  const b = p.data;
  // Trava dos cancelados: destino Reclamada/Reembolsado ou card já lá = só MASTER.
  const souMaster = ehMaster(sessao);
  const destinoCancel = !!b.estagio_chave && HM_ESTAGIOS_CANCELAMENTO.includes(b.estagio_chave);

  // Nome de cada um antes de começar: a falha é reportada pela pessoa
  // ("Fulano — falta a pesquisa"), não por um uuid que ninguém reconhece.
  const nomes = new Map(
    (
      await query<{ comprador_id: string; nome: string }>(
        `select comprador_id, nome from cs.contatos_hm_kanban
          where comprador_id = any($1::uuid[]) and produto = $2`,
        [b.compradorIds, produto],
      )
    ).map((r) => [r.comprador_id, r.nome]),
  );

  // Checklist e link: os mesmos updates unitários do PATCH da ficha. Ficam fora
  // dos serviços porque não têm consequência além do campo — mas continuam um a
  // um, pelo mesmo motivo do resto do lote.
  const sets: string[] = [];
  const vals: unknown[] = [];
  const add = (col: string, v: unknown) => {
    vals.push(v);
    sets.push(`${col} = $${vals.length + 1}`);
  };
  if (b.ativ_searchie !== undefined) add("ativ_searchie", b.ativ_searchie);
  if (b.ativ_comunidade !== undefined) add("ativ_comunidade", b.ativ_comunidade);
  if (b.ativ_grupo !== undefined) add("ativ_grupo", b.ativ_grupo);
  if (b.ativ_pesquisa !== undefined) add("ativ_pesquisa", b.ativ_pesquisa);
  // O envio do link carimba a HORA (agora) — é a data que permite cobrar quem
  // recebeu e não pagou; desmarcar limpa o carimbo.
  if (b.link_saldo_enviado !== undefined) {
    sets.push(`link_saldo_enviado_em = ${b.link_saldo_enviado ? "now()" : "null"}`);
  }

  let aplicados = 0;
  const falhas: Falha[] = [];

  for (const compradorId of b.compradorIds) {
    const nome = nomes.get(compradorId);
    if (!nome) {
      falhas.push({ compradorId, nome: compradorId, motivo: "contato não encontrado" });
      continue;
    }
    // Gate de AÇÃO por item (28/07, leitura ≠ ação): o lote é ESCRITA — operador
    // só aplica no pool e nos cards DELE; o card do colega (que ele VÊ no board)
    // e o de outra equipe são pulados nominalmente (não bloqueiam o lote).
    const acao = await podeAgirCardHm(sessao, compradorId, produto);
    if (acao !== "ok") {
      falhas.push({ compradorId, nome, motivo: acao === "card_de_outro_operador" ? "card de outro operador" : "sem acesso a este card" });
      continue;
    }
    // Trava dos cancelados: card em Reclamada/Reembolsado (ou indo p/ lá) só master.
    if (!souMaster && (destinoCancel || (await cancelamentoBloqueado(sessao, compradorId)))) {
      falhas.push({ compradorId, nome, motivo: "cancelado — só admin do GP altera" });
      continue;
    }
    try {
      // Responsável em lote — caminho legado por NOME. MESMA regra do PATCH da
      // ficha (atribuirResponsavelHm): resolve o nome para um usuário ativo e
      // aplica a hierarquia; nome sem usuário só o master grava (texto livre).
      // A recusa é nominal (falhas), card a card — não derruba o lote inteiro.
      if (b.responsavel !== undefined) {
        const destino: DestinoAtribuicao = (b.responsavel ?? "").trim() === ""
          ? { tipo: "pool" }
          : { tipo: "nome", nome: (b.responsavel as string).trim() };
        const r = await atribuirResponsavelHm(sessao, compradorId, destino, operador);
        if (!r.ok) {
          const motivo =
            r.reason === "destino_fora_da_equipe" ? "destino fora da sua equipe"
            : r.reason === "destino_sem_portal" ? "destino sem acesso ao portal HM"
            : r.reason === "atribuicao_travada" ? "atribuição travada pelo admin"
            : r.reason === "sem_permissao_para_atribuir" ? "sem permissão para atribuir"
            : "contato não encontrado";
          falhas.push({ compradorId, nome, motivo });
          continue;
        }
      }
      // Tags: o serviço recusa as gerenciadas (turma/origem) — a falha volta
      // nominal, como tudo aqui. Quem já tem/não tem a tag conta como aplicado
      // (o estado pedido é o estado final; não há o que falhar).
      if (b.addTag) {
        const r = await addTagHm(compradorId, b.addTag, operador);
        if (!r.ok) {
          falhas.push({ compradorId, nome, motivo: r.reason === "tag_gerenciada" ? "tag gerenciada pelo sistema (turma/origem)" : "contato não encontrado" });
          continue;
        }
      }
      if (b.removeTag) {
        const r = await removeTagHm(compradorId, b.removeTag, operador);
        if (!r.ok) {
          falhas.push({ compradorId, nome, motivo: r.reason === "tag_gerenciada" ? "tag gerenciada pelo sistema (turma/origem)" : "contato não encontrado" });
          continue;
        }
      }
      if (sets.length) {
        // 0187: `and produto = ...` — sem ele este UPDATE atingia TODAS as linhas do
        // comprador, marcando o checklist do card do Aurum junto com o do HM.
        await query(
          `update cs.contatos_hm set ${sets.join(", ")}, atualizado_em = now()
            where comprador_id = $1 and produto = $${vals.length + 2}`,
          [compradorId, ...vals, produto],
        );
      }
      // A etapa por último: um lote "marca o checklist E move para Ativação
      // Realizada" só faz sentido se os itens contarem antes da trava.
      if (b.estagio_chave) {
        // 0187: 5º argumento — sem ele, quem não tem card HM tinha o card do
        // Aurum movido por um lote autorizado só para HM.
        const r = await moverEstagioHm(compradorId, b.estagio_chave, operador, undefined, produto);
        if (!r.ok) {
          falhas.push({
            compradorId,
            nome,
            motivo: r.reason === "checklist_incompleto" ? "checklist incompleto" : "etapa inválida",
            faltando: r.faltando,
          });
          continue;
        }
      }
      aplicados++;
    } catch (e) {
      log.error("falha ao aplicar ação em lote no card HM", e, { compradorId });
      falhas.push({ compradorId, nome, motivo: "erro ao aplicar — tente de novo" });
    }
  }

  return NextResponse.json({ ok: true, aplicados, falhas });
}
