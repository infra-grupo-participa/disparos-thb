import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { query } from "@/lib/db";
import { logger } from "@/lib/log";
import { parseBody, HmLoteSchema } from "@/lib/validators";
import { addTagHm, moverEstagioHm, removeTagHm, setResponsavelHm, podeVerCardHm, cancelamentoBloqueado, HM_ESTAGIOS_CANCELAMENTO } from "@/lib/services/hm";
import { podeGerirAcesso } from "@/lib/papeis";

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
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  const operador = sessao.nome || "cs";
  const p = await parseBody(req, HmLoteSchema);
  if (!p.ok) return p.res;
  const b = p.data;
  // Trava dos cancelados: destino Reclamada/Reembolsado ou card já lá = só admin GP.
  const souGP = podeGerirAcesso(sessao.papel, sessao.equipe_tipo);
  const destinoCancel = !!b.estagio_chave && HM_ESTAGIOS_CANCELAMENTO.includes(b.estagio_chave);

  // Nome de cada um antes de começar: a falha é reportada pela pessoa
  // ("Fulano — falta a pesquisa"), não por um uuid que ninguém reconhece.
  const nomes = new Map(
    (
      await query<{ comprador_id: string; nome: string }>(
        `select comprador_id, nome from cs.contatos_hm_kanban where comprador_id = any($1::uuid[])`,
        [b.compradorIds],
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
    // Gating de equipe por item: o ator só aplica em card que ele vê (pool /
    // própria equipe / GP). Cards de outra equipe são pulados (não bloqueia o lote).
    if (!(await podeVerCardHm(sessao, compradorId))) {
      falhas.push({ compradorId, nome, motivo: "sem acesso a este card" });
      continue;
    }
    // Trava dos cancelados: card em Reclamada/Reembolsado (ou indo p/ lá) só admin GP.
    if (!souGP && (destinoCancel || (await cancelamentoBloqueado(sessao, compradorId)))) {
      falhas.push({ compradorId, nome, motivo: "cancelado — só admin do GP altera" });
      continue;
    }
    try {
      if (b.responsavel !== undefined) {
        await setResponsavelHm(compradorId, b.responsavel || null, operador);
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
        await query(
          `update cs.contatos_hm set ${sets.join(", ")}, atualizado_em = now() where comprador_id = $1`,
          [compradorId, ...vals],
        );
      }
      // A etapa por último: um lote "marca o checklist E move para Ativação
      // Realizada" só faz sentido se os itens contarem antes da trava.
      if (b.estagio_chave) {
        const r = await moverEstagioHm(compradorId, b.estagio_chave, operador);
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
