import { query, queryOne } from "@/lib/db";
import { getCanal } from "@/lib/services/canais";
import { listarAutomacoes, buscarTag } from "@/lib/activecampaign";
import { logger } from "@/lib/log";

// "Raio-x da automação": mantém em cs.ac_automacoes o cableamento tag → automação
// do ActiveCampaign, para o sistema dizer ao operador — ao escolher a tag e ao
// disparar — se a tag REALMENTE envia e-mail. Ver migration 0027.
const log = logger("ac-automacoes");

// ===== Veredito (texto mastigado pro operador) =============================
export type StatusTag = "pronta" | "pausada" | "sem_automacao" | "desconhecido";

export type Veredito = {
  status: StatusTag;
  automacao: string | null;  // nome da automação que envia (quando há)
  multientry: boolean;       // false = contato entra só uma vez
  pronto: boolean;           // true só quando 'pronta' (libera o disparo)
  rotulo: string;            // selo curto
  detalhe: string;           // frase explicativa pro operador
};

// Linha mínima de automação para compor o veredito (a "melhor" candidata da tag).
export type AutoMatch = { nome: string; ativa: boolean; multientry: boolean } | null;

// Monta o veredito a partir do nome da tag e da automação casada (ou null).
// tagNome=null → ainda não sabemos o nome da tag (não diagnosticável).
export function montarVeredito(tagNome: string | null, auto: AutoMatch): Veredito {
  if (!tagNome) {
    return {
      status: "desconhecido", automacao: null, multientry: true, pronto: false,
      rotulo: "Verificando…",
      detalhe: "Ainda não foi possível verificar a automação desta tag no ActiveCampaign. Aguarde a sincronização.",
    };
  }
  if (!auto) {
    return {
      status: "sem_automacao", automacao: null, multientry: true, pronto: false,
      rotulo: "Tag sem automação",
      detalhe: `Nenhuma automação do ActiveCampaign é disparada pela tag «${tagNome}». Aplicar esta tag NÃO envia e-mail. Escolha outra tag ou crie/ligue uma automação a ela no AC.`,
    };
  }
  if (!auto.ativa) {
    return {
      status: "pausada", automacao: auto.nome, multientry: auto.multientry, pronto: false,
      rotulo: "Automação pausada",
      detalhe: `A tag «${tagNome}» aciona a automação «${auto.nome}», mas ela está DESATIVADA no AC. Reative-a no ActiveCampaign antes de disparar — senão o e-mail não sai.`,
    };
  }
  const aviso = auto.multientry ? "" : " Atenção: ela está configurada para o contato entrar SÓ UMA VEZ — reenviar para quem já entrou não dispara de novo.";
  return {
    status: "pronta", automacao: auto.nome, multientry: auto.multientry, pronto: true,
    rotulo: "Pronta para disparar",
    detalhe: `A tag «${tagNome}» aciona a automação «${auto.nome}», que está ATIVA. Os contatos vão receber o e-mail.${aviso}`,
  };
}

// Escolhe a "melhor" automação para uma tag a partir das linhas em cache:
// prefere uma ATIVA; se não houver, fica com a primeira (pausada).
function melhor(linhas: AutoMatch[]): AutoMatch {
  const ativa = linhas.find((l) => l?.ativa);
  return ativa ?? linhas[0] ?? null;
}

// ===== Diagnóstico por NOME de tag (lê o cache) ============================
export async function diagnosticarTagNome(tagNome: string | null): Promise<Veredito> {
  if (!tagNome) return montarVeredito(null, null);
  const linhas = await query<{ nome: string; ativa: boolean; multientry: boolean }>(
    `select nome, ativa, multientry from cs.ac_automacoes where trigger_tag = $1`,
    [tagNome],
  ).catch(() => [] as { nome: string; ativa: boolean; multientry: boolean }[]);
  return montarVeredito(tagNome, melhor(linhas));
}

// Diagnóstico de UM template (usado no bloqueio do disparo). Resolve o nome da
// tag — usa o cache do template e, se faltar, busca no AC e persiste (self-heal).
export async function diagnosticarTemplate(
  templateId: string,
  evento = "HT",
): Promise<Veredito & { tagNome: string | null }> {
  const t = await queryOne<{ ac_tag_id: string | null; ac_tag_nome: string | null }>(
    `select ac_tag_id, ac_tag_nome from cs.templates where id = $1 and canal = 'email'`,
    [templateId],
  );
  if (!t) return { ...montarVeredito(null, null), tagNome: null };

  let tagNome = t.ac_tag_nome;
  if (!tagNome && t.ac_tag_id) {
    const canal = await getCanal(evento, "activecampaign");
    const r = await buscarTag(t.ac_tag_id, canal).catch(() => ({ ok: false } as { ok: boolean; nome?: string }));
    if (r.ok && r.nome) {
      tagNome = r.nome;
      await query(`update cs.templates set ac_tag_nome = $2 where id = $1`, [templateId, tagNome]).catch(() => {});
    }
  }

  // Cache vazio (nunca sincronizou) → sincroniza uma vez para não bloquear à toa.
  if (tagNome) {
    const tem = await queryOne<{ n: number }>(`select count(*)::int n from cs.ac_automacoes`).catch(() => ({ n: 0 }));
    if ((tem?.n ?? 0) === 0) await sincronizarAutomacoes(evento, 0).catch(() => {});
  }

  return { ...(await diagnosticarTagNome(tagNome)), tagNome };
}

// ===== Sincronização (cron) ================================================
// Varre as automações do AC e regrava o cableamento. Guarda de frescor: se o
// cache já foi atualizado há menos de `maxIdadeMin`, não bate no AC de novo
// (automações mudam raramente; o varrer é caro). maxIdadeMin=0 força.
export async function sincronizarAutomacoes(evento = "HT", maxIdadeMin = 30): Promise<{ ok: boolean; automacoes: number; gatilhos: number; pulado?: boolean }> {
  if (maxIdadeMin > 0) {
    const fresco = await queryOne<{ recente: boolean }>(
      `select (max(sincronizado_em) > now() - make_interval(mins => $1)) as recente from cs.ac_automacoes`,
      [maxIdadeMin],
    ).catch(() => null);
    if (fresco?.recente) return { ok: true, automacoes: 0, gatilhos: 0, pulado: true };
  }

  const canal = await getCanal(evento, "activecampaign");
  const r = await listarAutomacoes(canal);
  if (!r.ok) {
    log.error("falha ao listar automações do AC", null, { erro: r.erro });
    return { ok: false, automacoes: 0, gatilhos: 0 };
  }

  let gatilhos = 0;
  const vistos: Array<[string, string]> = []; // (automation_id, trigger_tag — '' = sem gatilho de tag)
  for (const a of r.automacoes) {
    // Uma linha por (automação, tag de gatilho). Sem gatilho de tag → linha com
    // trigger_tag '' (mantém o panorama, mas não casa com tag nenhuma).
    const tags = a.triggerTags.length ? a.triggerTags : [""];
    for (const tag of tags) {
      await query(
        `insert into cs.ac_automacoes (ac_automation_id, nome, status, ativa, trigger_tag, multientry, entrou, sincronizado_em)
         values ($1,$2,$3,$4,$5,$6,$7, now())
         on conflict (ac_automation_id, trigger_tag) do update set
           nome = excluded.nome, status = excluded.status, ativa = excluded.ativa,
           multientry = excluded.multientry, entrou = excluded.entrou, sincronizado_em = now()`,
        [a.id, a.nome, a.status, a.ativa, tag, a.multientry, a.entrou],
      );
      if (tag) gatilhos++;
      vistos.push([a.id, tag]);
    }
  }

  // Remove cableamentos que sumiram no AC (gatilho removido / automação apagada).
  if (vistos.length) {
    await query(
      `delete from cs.ac_automacoes a
        where not exists (
          select 1 from unnest($1::text[], $2::text[]) as v(aid, tag)
           where v.aid = a.ac_automation_id and v.tag = a.trigger_tag
        )`,
      [vistos.map((v) => v[0]), vistos.map((v) => v[1])],
    ).catch((e) => log.error("falha ao limpar automações obsoletas", e));
  }

  await backfillNomesTagTemplates(evento).catch((e) => log.error("falha no backfill de nomes de tag", e));

  log.info("automações do AC sincronizadas", { automacoes: r.automacoes.length, gatilhos });
  return { ok: true, automacoes: r.automacoes.length, gatilhos };
}

// Preenche cs.templates.ac_tag_nome para templates de e-mail que têm a tag (id)
// mas ainda não têm o nome (criados antes do raio-x). Resolve no AC e persiste.
async function backfillNomesTagTemplates(evento: string): Promise<void> {
  const pendentes = await query<{ id: string; ac_tag_id: string }>(
    `select id, ac_tag_id from cs.templates
      where canal = 'email' and ac_tag_id is not null and ac_tag_nome is null`,
  );
  if (!pendentes.length) return;
  const canal = await getCanal(evento, "activecampaign");
  for (const t of pendentes) {
    const r = await buscarTag(t.ac_tag_id, canal);
    if (r.ok && r.nome) {
      await query(`update cs.templates set ac_tag_nome = $2 where id = $1`, [t.id, r.nome]);
    }
  }
}
