import { NextResponse } from "next/server";
import { getSessao } from "@/lib/auth";
import { query } from "@/lib/db";
import { placarDoDia } from "@/lib/services/ligacao";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";

// GET /api/meu-dia?evento=HT — a fila de trabalho do operador e o placar dele.
//
// Três blocos, em ordem de urgência:
//   1. retornos — ele PROMETEU voltar a falar, e a hora chegou. É dívida.
//   2. esperando — o lead escreveu e ninguém respondeu (o relógio do FRT corre).
//   3. sem toque — quem está no funil e ninguém tocou há tempo demais.
//
// Só entra quem tem telefone e não pediu opt-out: listar quem não se pode
// contatar é fazer o operador perder tempo para descobrir isso no clique.
const LIMITE = 25;
const DIAS_SEM_TOQUE = 3;

type Fila = {
  comprador_id: string;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  estagio: string | null;
  quando: string | null;
  nota: string | null;
};

export async function GET(req: Request) {
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  const evento = eventoDe(req);
  const operador = sessao.nome || "cs";
  // "Meus" filtra as filas pelos leads sob responsabilidade do operador logado —
  // com vários SDRs, cada um vê a própria carteira e não colide no mesmo lead.
  // Sem o filtro (Todos), mostra a fila do portal inteiro (comportamento antigo).
  const meus = new URL(req.url).searchParams.get("meus") === "1";

  // 1) Retornos que ele agendou e já venceram (ou vencem hoje).
  const retornos = await query<Fila>(
    `select v.comprador_id, v.nome, v.telefone, v.email, e.nome as estagio,
            c.proxima_acao_em as quando, c.proxima_acao_nota as nota
       from cs.contatos c
       join cs.contatos_evento v on v.comprador_id = c.comprador_id and v.evento = $1
       left join cs.estagios e on e.id = c.estagio_id
      where c.proxima_acao_em is not null
        and c.proxima_acao_em < (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day') at time zone 'America/Sao_Paulo'
        and not c.opt_out
        and v.telefone is not null and v.telefone <> ''
        and (not $3::bool or c.responsavel = $4)
      order by c.proxima_acao_em asc
      limit $2`,
    [evento, LIMITE, meus, operador],
  );

  // 2) Quem escreveu e está esperando resposta.
  const esperando = await query<Fila>(
    `select v.comprador_id, v.nome, v.telefone, v.email, e.nome as estagio,
            c.aguardando_desde as quando, null::text as nota
       from cs.contatos c
       join cs.contatos_evento v on v.comprador_id = c.comprador_id and v.evento = $1
       left join cs.estagios e on e.id = c.estagio_id
      where c.inbox_status = 'pendente'
        and c.aguardando_desde is not null
        and not c.opt_out
        and (not $3::bool or c.responsavel = $4)
      order by c.aguardando_desde asc
      limit $2`,
    [evento, LIMITE, meus, operador],
  );

  // 3) Quem está no funil e ninguém toca há dias. Exclui os já listados acima
  //    (senão a mesma pessoa aparece em duas filas e o operador liga duas vezes).
  const semToque = await query<Fila>(
    `select v.comprador_id, v.nome, v.telefone, v.email, e.nome as estagio,
            c.ultimo_contato_em as quando, null::text as nota
       from cs.contatos c
       join cs.contatos_evento v on v.comprador_id = c.comprador_id and v.evento = $1
       left join cs.estagios e on e.id = c.estagio_id
      where not c.opt_out
        and v.telefone is not null and v.telefone <> ''
        and coalesce(e.is_final, false) = false
        and (c.ultimo_contato_em is null or c.ultimo_contato_em < now() - make_interval(days => $3))
        and c.proxima_acao_em is null
        and c.inbox_status is distinct from 'pendente'
        and (not $4::bool or c.responsavel = $5)
      order by c.ultimo_contato_em asc nulls first
      limit $2`,
    [evento, LIMITE, DIAS_SEM_TOQUE, meus, operador],
  );

  const placar = await placarDoDia(operador);

  return NextResponse.json({
    ok: true,
    operador,
    meus,
    placar,
    filas: { retornos, esperando, semToque },
    dias_sem_toque: DIAS_SEM_TOQUE,
  });
}
