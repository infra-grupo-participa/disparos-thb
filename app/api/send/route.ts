import { NextResponse } from "next/server";
import { podeDisparar } from "@/lib/auth";
import { guard } from "@/lib/guard";
import { escopoDisparo, paramsEscopo } from "@/lib/papeis";
import { sqlEscopo } from "@/lib/services/visibilidade";
import { query, queryOne } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { logger } from "@/lib/log";
import { parseBody, SendSchema } from "@/lib/validators";
import { processarDisparo } from "@/lib/services/disparo";
import { checarGuardaDisparo } from "@/lib/services/guardaDisparo";
import { getConfig } from "@/lib/services/config";
import { eventoDe } from "@/lib/services/evento";

export const runtime = "nodejs";
export const maxDuration = 300;
const log = logger("send");

// Cria a campanha (disparo + linhas) e delega o processamento ao serviço, que
// é idempotente e resiliente (retomável pelo cron). Bloqueia quem deu opt-out.
export async function POST(req: Request) {
  // Trava de papel: só admin e disparador podem efetuar disparos. Operador
  // comum opera o Kanban/contatos normalmente, mas não envia. Esta é a fonte
  // da verdade — a UI apenas espelha (esconde os botões).
  const evento = eventoDe(req);
  // Portal do evento resolvido contra a whitelist da conta (0145).
  const g = await guard({ portal: evento });
  if (!g.ok) return g.res;
  const sessao = g.sessao;
  // Operador (SDR) dispara nos eventos de ativação (SEM/CNHF); nos demais, só
  // admin/disparador. A regra é por evento — ver lib/papeis.
  if (!podeDisparar(sessao.papel, evento)) {
    return NextResponse.json({ ok: false, reason: "sem_permissao_disparo" }, { status: 403 });
  }

  const p = await parseBody(req, SendSchema);
  if (!p.ok) return p.res;
  const { templateId, compradorIds, forcar } = p.data;
  const edicao = p.data.edicao ? String(p.data.edicao) : null;

  const template = await queryOne<{ id: string }>(
    `select id from cs.templates where id = $1 and ativo`,
    [templateId],
  );
  if (!template) {
    return NextResponse.json({ ok: false, reason: "template inválido ou inativo" }, { status: 400 });
  }

  // HM vive num overlay isolado (cs.contatos_hm sobre `compradores`), fora de
  // cs.contatos_evento. Resolve os destinatários pela view do HM; os demais
  // eventos (HT/SEM) seguem por cs.contatos_evento. Os DOIS respeitam o opt-out
  // — e o HM respeita também o `nao_contatar`, a trava que o operador levanta no
  // card. Antes, o ramo HM não filtrava nenhum dos dois: quem pediu para não ser
  // contatado recebia mesmo assim.
  // Dedup temporal (anti-flood): não reenviar para quem já recebeu um disparo
  // deste evento dentro da janela (default 24h). Evita que dois operadores — ou
  // duas campanhas seguidas — martelem o mesmo número. 0 desativa.
  const dedupHoras = await getConfig<number>("disparo_dedup_horas", 24);

  // RECORTE de segurança: enviar mensagem é AÇÃO (28/07, leitura ≠ ação) — os
  // destinatários passam pelo escopo de AÇÃO, não pelo de leitura: o operador
  // VÊ os cards da equipe nos elegíveis, mas só dispara para o pool e para a
  // própria carteira. Vale nos DOIS ramos: o HM pela view do overlay, os
  // genéricos por cs.contatos_evento. Quem entra na seleção por fora do escopo
  // simplesmente não recebe (fica de fora do insert).
  // 11/08 (auditoria de segurança): escopoDISPARO, não escopoAcao. O gerente
  // distribuidor age em card de qualquer equipe, mas NÃO herda a base inteira
  // como destinatária de campanha — disparo segue o nível.
  const { verTudo, equipeId, usuarioId } = paramsEscopo(escopoDisparo(sessao));

  const ehHM = evento === "HM";
  const contatos = ehHM
    ? await query<{ comprador_id: string; telefone: string; edicao: string | null }>(
        `select v.comprador_id, v.telefone, null::text as edicao from cs.contatos_hm_kanban v
          where v.comprador_id = any($1::uuid[]) and v.telefone is not null and v.telefone <> ''
            and not coalesce(v.nao_contatar, false)
            and v.comprador_id not in (select comprador_id from cs.contatos where opt_out)
            -- poolRestrito (0265): card do HM sem operador não é mais pool —
            -- disparo para ele passa a exigir estar distribuído (ou ser quem
            -- podeVerTudo), mesma regra do board.
            and ${sqlEscopo({ rid: "v.responsavel_id", eq: "v.equipe_id", nome: "v.responsavel" }, { verTudo: 3, usuario: 4, equipe: 5 }, { poolRestrito: true })}
            and v.comprador_id not in (
              select dc.comprador_id from cs.disparo_contatos dc
                join cs.disparos d on d.id = dc.disparo_id
               where d.evento = 'HM' and dc.enviado and dc.enviado_em > now() - make_interval(hours => $2))`,
        [compradorIds, dedupHoras, verTudo, usuarioId, equipeId],
      )
    : await query<{ comprador_id: string; telefone: string; edicao: string | null }>(
        `select v.comprador_id, v.telefone, v.edicao from cs.contatos_evento v
          where v.evento = $2 and v.comprador_id = any($1::uuid[]) and v.telefone is not null and v.telefone <> ''
            and v.comprador_id not in (select comprador_id from cs.contatos where opt_out)
            and ${sqlEscopo({ rid: "v.responsavel_id", eq: "v.equipe_id", nome: "v.responsavel" }, { verTudo: 4, usuario: 5, equipe: 6 })}
            and v.comprador_id not in (
              select dc.comprador_id from cs.disparo_contatos dc
                join cs.disparos d on d.id = dc.disparo_id
               where d.evento = $2 and dc.enviado and dc.enviado_em > now() - make_interval(hours => $3))`,
        [compradorIds, evento, dedupHoras, verTudo, usuarioId, equipeId],
      );

  // Quantos ficaram de fora e por quê — o operador precisa saber que 12 dos 50
  // selecionados não vão receber, e não descobrir isso pelo total no fim.
  const pulados = (await queryOne<{ opt_out: number; nao_contatar: number }>(
    ehHM
      ? `select
           (select count(*) from cs.contatos where comprador_id = any($1::uuid[]) and opt_out)::int as opt_out,
           (select count(*) from cs.contatos_hm_kanban
             where comprador_id = any($1::uuid[]) and coalesce(nao_contatar, false))::int as nao_contatar`
      : `select
           (select count(*) from cs.contatos where comprador_id = any($1::uuid[]) and opt_out)::int as opt_out,
           0 as nao_contatar`,
    [compradorIds],
  )) ?? { opt_out: 0, nao_contatar: 0 };

  if (contatos.length === 0) {
    const barrados = pulados.opt_out + pulados.nao_contatar;
    return NextResponse.json({
      ok: false,
      reason: barrados > 0
        ? "todos os contatos selecionados estão bloqueados para contato (opt-out ou 'não contatar')"
        : "nenhum contato com telefone",
    }, { status: 400 });
  }

  // Guarda preventivo anti-ban: horário permitido + freio de segurança (saúde do
  // número na Meta) + limite de volume. Até aqui o painel só aconselhava; agora
  // barra. Admin pode passar por cima com `forcar` — e assume, porque o log
  // guarda quem forçou e o motivo.
  const guarda = await checarGuardaDisparo(evento, contatos.length);
  if (!guarda.liberado) {
    if (!forcar || sessao.papel !== "admin") {
      return NextResponse.json(
        {
          ...guarda,
          ok: false,
          reason: "disparo_bloqueado",
          podeForcar: sessao.papel === "admin",
        },
        { status: 409 },
      );
    }
    log.warn("guarda de disparo ignorado por decisão do admin", {
      evento, operador: sessao.nome, aEnviar: contatos.length, bloqueios: guarda.bloqueios,
    });
  }

  // Edição da campanha: a explícita, ou derivada quando todos são da mesma.
  let edicaoFinal = edicao;
  if (!edicaoFinal) {
    const distintas = [...new Set(contatos.map((c) => c.edicao).filter(Boolean))];
    if (distintas.length === 1) edicaoFinal = distintas[0] as string;
  }

  const disparo = await queryOne<{ id: string }>(
    `insert into cs.disparos (template_id, edicao_ht, status, operador, evento)
     values ($1, $2, 'em_andamento', $4, $3) returning id`,
    [templateId, edicaoFinal, evento, sessao.nome || "cs"],
  );
  const disparoId = disparo!.id;

  // Insert único (era uma query por contato). `on conflict do nothing` apoia-se
  // no unique de (disparo_id, comprador_id) criado em 0074: o mesmo contato não
  // entra duas vezes na mesma campanha, nem que venha repetido na seleção.
  await query(
    `insert into cs.disparo_contatos (disparo_id, comprador_id, telefone, enviado)
     select $1, c.comprador_id, c.telefone, false
       from unnest($2::uuid[], $3::text[]) as c(comprador_id, telefone)
     on conflict (disparo_id, comprador_id) where comprador_id is not null do nothing`,
    [disparoId, contatos.map((c) => c.comprador_id), contatos.map((c) => normalizePhone(c.telefone)!)],
  );

  // Processamento em background (servidor persistente). Se cair no meio, o cron
  // retoma — processarDisparo reivindica o disparo e só age sobre o que falta.
  void processarDisparo(disparoId).catch((e) => log.error("erro ao processar disparo", e, { disparoId }));

  return NextResponse.json({
    ok: true,
    disparoId,
    total: contatos.length,
    pulados_opt_out: pulados.opt_out,
    pulados_nao_contatar: pulados.nao_contatar,
  });
}
