import { NextResponse } from "next/server";
import { isAuthed, getSessao, podeDisparar } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { eventoDe } from "@/lib/services/evento";
import { montarVeredito } from "@/lib/services/ac-automacoes";

export const runtime = "nodejs";

type LinhaTemplate = {
  id: string; nome: string; unnichat_id: string; categoria: string | null;
  variaveis: number; variaveis_map: unknown; preview: string | null; ativo: boolean;
  estagio_sugerido_id: number | null; canal: string; ac_tag_id: string | null;
  ac_tag_nome: string | null; estagio_sugerido_nome: string | null;
  modo: string; assunto: string | null; corpo_html: string | null;
  unnichat_tag_id: string | null; unnichat_tag_nome: string | null;
  auto_nome: string | null; auto_ativa: boolean | null; auto_multientry: boolean | null;
};

export async function GET(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  // ?canal=email lista só os templates de e-mail; sem o filtro, mantém o
  // comportamento legado (todos do evento — na prática, os de WhatsApp).
  const canal = new URL(req.url).searchParams.get("canal");
  // Para templates de e-mail, casa a tag (por nome) com a automação do AC
  // (raio-x) — prefere uma ATIVA. left join lateral tolera ac_tag_nome nulo e a
  // tabela de automações ausente (migration pendente → coalesce vazio).
  const linhas = await query<LinhaTemplate>(
    `select t.id, t.nome, t.unnichat_id, t.categoria, t.variaveis, t.variaveis_map, t.preview,
            t.ativo, t.estagio_sugerido_id, t.canal, t.ac_tag_id, t.ac_tag_nome, t.unnichat_tag_id, t.unnichat_tag_nome,
            t.modo, t.assunto, t.corpo_html,
            e.nome as estagio_sugerido_nome,
            auto.nome as auto_nome, auto.ativa as auto_ativa, auto.multientry as auto_multientry
       from cs.templates t
       left join cs.estagios e on e.id = t.estagio_sugerido_id
       left join lateral (
         select a.nome, a.ativa, a.multientry
           from cs.ac_automacoes a
          where t.ac_tag_nome is not null and a.trigger_tag = t.ac_tag_nome
          order by a.ativa desc
          limit 1
       ) auto on true
      where t.evento = $1 and ($2::text is null or t.canal = $2)
      order by t.ativo desc, t.criado_em desc`,
    [eventoDe(req), canal],
  ).catch(() =>
    // Fallback se cs.ac_automacoes ainda não existe: query sem o join lateral.
    query<LinhaTemplate>(
      `select t.id, t.nome, t.unnichat_id, t.categoria, t.variaveis, t.variaveis_map, t.preview,
              t.ativo, t.estagio_sugerido_id, t.canal, t.ac_tag_id, t.ac_tag_nome, t.unnichat_tag_id, t.unnichat_tag_nome,
              t.modo, t.assunto, t.corpo_html,
            t.modo, t.assunto, t.corpo_html,
              e.nome as estagio_sugerido_nome,
              null::text as auto_nome, null::boolean as auto_ativa, null::boolean as auto_multientry
         from cs.templates t
         left join cs.estagios e on e.id = t.estagio_sugerido_id
        where t.evento = $1 and ($2::text is null or t.canal = $2)
        order by t.ativo desc, t.criado_em desc`,
      [eventoDe(req), canal],
    ),
  );

  const templates = linhas.map((t) => {
    const { auto_nome, auto_ativa, auto_multientry, ...resto } = t;
    // O veredito da automação só existe no modo legado. A campanha direta não
    // depende de automação nenhuma — anexar um veredito aqui só confundiria.
    if (t.canal !== "email" || t.modo === "campanha") return resto;
    const auto = auto_nome ? { nome: auto_nome, ativa: !!auto_ativa, multientry: auto_multientry !== false } : null;
    return { ...resto, veredito: montarVeredito(t.ac_tag_nome, auto) };
  });
  return NextResponse.json({ ok: true, templates });
}

// Campos que o disparo sabe resolver numa variável de template. Espelha
// CAMPOS_VARIAVEL de lib/services/disparo.ts — mudou lá, muda aqui.
const CAMPOS_VARIAVEL = ["primeiro_nome", "nome", "edicao", "evento"];

export async function POST(req: Request) {
  // Cadastrar template é ato de disparo: quem escreve a mensagem que sai no
  // número da empresa é quem pode disparar. Antes, qualquer operador logado
  // criava template.
  const sessao = await getSessao();
  if (!sessao) return NextResponse.json({ ok: false }, { status: 401 });
  if (!podeDisparar(sessao.papel)) {
    return NextResponse.json({ ok: false, reason: "sem_permissao_disparo" }, { status: 403 });
  }

  const evento = eventoDe(req);
  const b = await req.json().catch(() => ({}));
  const { nome, unnichat_id, categoria, variaveis, preview, estagio_sugerido_id, ativo, ac_tag_id, ac_tag_nome, variaveis_map, assunto, corpo_html, corpo_texto, unnichat_tag_id, unnichat_tag_nome } = b as Record<string, unknown>;
  const canal = b.canal === "email" ? "email" : "whatsapp";
  // Modo do e-mail: 'campanha' escreve o corpo aqui e lança a campanha no AC;
  // 'tag' é o legado, que aplica uma tag e depende de automação lá dentro.
  const modo = canal === "email" && b.modo === "tag" ? "tag" : canal === "email" ? "campanha" : "tag";

  if (!nome) {
    return NextResponse.json({ ok: false, reason: "nome é obrigatório" }, { status: 400 });
  }
  if (canal === "email" && modo === "campanha") {
    if (!assunto || !String(assunto).trim()) {
      return NextResponse.json({ ok: false, reason: "o e-mail precisa de um assunto" }, { status: 400 });
    }
    if (!corpo_html || !String(corpo_html).trim()) {
      return NextResponse.json({ ok: false, reason: "o e-mail precisa de um corpo" }, { status: 400 });
    }
  }
  if (canal === "email" && modo === "tag" && !ac_tag_id) {
    return NextResponse.json({ ok: false, reason: "template de e-mail por automação exige ac_tag_id (tag do AC)" }, { status: 400 });
  }
  if (canal === "whatsapp" && !unnichat_id) {
    return NextResponse.json({ ok: false, reason: "nome e unnichat_id são obrigatórios" }, { status: 400 });
  }

  // Variáveis: um template com 2+ variáveis PRECISA dizer de onde cada uma sai,
  // em ordem. Sem isso a Meta rejeita o envio por contagem de parâmetros — e o
  // erro só apareceria contato a contato, no meio do disparo. Barra no cadastro.
  const nVars = Number.isFinite(Number(variaveis)) ? Number(variaveis) : 0;
  let mapa: string[] | null = null;
  if (canal === "whatsapp" && nVars > 0) {
    mapa = Array.isArray(variaveis_map) ? variaveis_map.map(String) : nVars === 1 ? ["primeiro_nome"] : null;
    if (!mapa || mapa.length !== nVars) {
      return NextResponse.json(
        { ok: false, reason: `o template declara ${nVars} variáveis: informe variaveis_map com ${nVars} campos, na ordem em que aparecem na mensagem` },
        { status: 400 },
      );
    }
    const desconhecida = mapa.find((c) => !CAMPOS_VARIAVEL.includes(c));
    if (desconhecida) {
      return NextResponse.json(
        { ok: false, reason: `variável desconhecida: "${desconhecida}". Disponíveis: ${CAMPOS_VARIAVEL.join(", ")}` },
        { status: 400 },
      );
    }
  }

  const row = await queryOne(
    `insert into cs.templates (nome, unnichat_id, categoria, variaveis, preview, estagio_sugerido_id, ativo, evento, canal, ac_tag_id, ac_tag_nome, variaveis_map, modo, assunto, corpo_html, corpo_texto, unnichat_tag_id, unnichat_tag_nome)
     values ($1,$2,$3,$4,$5,$6,coalesce($7,true),$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16,$17,$18)
     returning id`,
    [
      String(nome),
      unnichat_id ? String(unnichat_id) : "",
      categoria ? String(categoria) : null,
      nVars,
      preview ? String(preview) : null,
      estagio_sugerido_id ? Number(estagio_sugerido_id) : null,
      typeof ativo === "boolean" ? ativo : null,
      evento,
      canal,
      // Só o modo tag usa a tag; no modo campanha ela não significa nada.
      modo === "tag" && ac_tag_id ? String(ac_tag_id) : null,
      // Nome da tag (o gatilho do AC casa por nome). Quando o operador digita o
      // ID manualmente, o nome chega vazio e o cron backfilla depois.
      canal === "email" && modo === "tag" && ac_tag_nome ? String(ac_tag_nome) : null,
      mapa ? JSON.stringify(mapa) : null,
      modo,
      assunto ? String(assunto) : null,
      corpo_html ? String(corpo_html) : null,
      corpo_texto ? String(corpo_texto) : null,
      // Tag do Unnichat que o disparo carimba no contato (só WhatsApp).
      canal === "whatsapp" && unnichat_tag_id ? String(unnichat_tag_id) : null,
      canal === "whatsapp" && unnichat_tag_nome ? String(unnichat_tag_nome) : null,
    ],
  );
  return NextResponse.json({ ok: true, id: (row as { id: string } | null)?.id });
}

export async function PATCH(req: Request) {
  if (!isAuthed()) return NextResponse.json({ ok: false }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const { id, ativo } = b as Record<string, unknown>;

  if (!id || typeof ativo !== "boolean") {
    return NextResponse.json({ ok: false, reason: "id e ativo (boolean) são obrigatórios" }, { status: 400 });
  }

  const row = await queryOne(
    `update cs.templates set ativo = $2 where id = $1 returning id, ativo`,
    [String(id), ativo],
  );
  if (!row) {
    return NextResponse.json({ ok: false, reason: "template não encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, template: row });
}
