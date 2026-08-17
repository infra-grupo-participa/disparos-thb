import { NextResponse } from "next/server";
import { query, queryOne } from "@/lib/db";
import { logger } from "@/lib/log";
import { mapearSocio, normalizarChave, type Mapeamento } from "@/lib/respondi-socios";

export const runtime = "nodejs";
const log = logger("hm-formularios");

// Webhook de recebimento das respostas do RESPONDI (ficha/entrevista do HM, e
// desde 0263 também o formulário de SÓCIOS). Casa o aluno por e-mail OU pelos
// últimos 6 dígitos do telefone (robusto a DDD/55/9) na esteira HM e grava as
// respostas em cs.formularios (aba "Formulários" da ficha). Idempotente (upsert
// por comprador+tipo). Sempre responde 200 (exceto segredo inválido) para o
// Respondi não retentar.

type Body = Record<string, unknown> & {
  secret?: string;
  tipo?: string;
  formulario?: string;
  email?: string;
  telefone?: string;
  phone?: string;
  whatsapp?: string;
  number?: string;
  respostas?: Record<string, unknown>;
  answers?: Record<string, unknown>;
  pontuacao?: number | string;
  score?: number | string;
};

// Campos de controle que não fazem parte das respostas do formulário.
const CONTROLE = new Set(["secret", "tipo", "formulario", "email", "telefone", "phone", "whatsapp", "number", "respostas", "answers", "pontuacao", "score"]);

// 0263: slugs conhecidos do formulário de sócios. Além deles, o FALLBACK
// ESTRUTURAL abaixo (pareceFormularioDeSocio) detecta o ramo mesmo com `tipo`
// inesperado — layout do Respondi mudar de nome não pode fazer o sócio
// desaparecer em silêncio.
const SLUGS_SOCIO = new Set(["hm_socio", "hm_socios", "hm_cadastro_de_socio", "hm_cadastro_socio", "hm_formulario_de_socio", "hm_formulario_de_socios"]);

function originOk(req: Request, body: Body): boolean {
  const secret = process.env.HM_WEBHOOK_SECRET || process.env.EVENTOS_SECRET || process.env.WEBHOOK_SECRET;
  if (!secret) return true; // sem segredo configurado → não bloqueia (dev)
  const recebido =
    req.headers.get("x-webhook-secret") ||
    new URL(req.url).searchParams.get("secret") ||
    (typeof body.secret === "string" ? body.secret : null);
  return recebido === secret;
}

function slugTipo(v: string | undefined): string {
  const base = String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) return "hm_formulario";
  return (base.startsWith("hm_") ? base : `hm_${base}`).slice(0, 40);
}

function paraNumero(v: number | string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// 0263, decisão 6 do Marcio: CPF vai MASCARADO no payload bruto do log — só os
// 3 últimos dígitos ficam visíveis (`********901`). O CPF íntegro mora em
// cs.hm_socios.cpf, que é o lugar estruturado dele; o log é só para depuração
// de layout, não precisa do documento inteiro.
//
// Achado 5 do review de 17/08 (decisão do dono): a MESMA máscara de dígitos
// vale também para CEP, número e complemento no payload de log/rastro
// (cs.webhook_log e cs.hm_socios_pendentes.payload) — endereço não precisa
// estar íntegro para diagnosticar MUDANÇA DE LAYOUT, só a CHAVE precisa
// aparecer. Cidade e estado ficam em claro (não identificam a residência e
// ajudam a depurar). Telefone segue sem máscara (o dono não pediu). O valor
// ÍNTEGRO continua indo normalmente para cs.hm_socios via
// fn_hm_socio_upsert — esta função só afeta log/rastro, nunca o dado real.
//
// ⚠️ Nota de borda (achado 5): valores com EXATAMENTE 3 dígitos (ex. número de
// casa "123") saem sem asterisco algum — a regra "preserva os 3 últimos" não
// deixa nada para mascarar. Aceito para número de endereço (a chave já denuncia
// o campo no log, que é o objetivo declarado acima) e é o comportamento que já
// existia para CPF. Reaproveitada tal qual — não criar uma segunda função de
// máscara só para este caso.
function mascararCpf(v: string): string {
  const digitos = v.replace(/\D/g, "");
  if (digitos.length === 0) return v;
  if (digitos.length < 3) return "*".repeat(digitos.length);
  return "*".repeat(digitos.length - 3) + digitos.slice(-3);
}

// Vocabulário de chave sensível para o log — CPF sempre; CEP/número/
// complemento por decisão do achado 5. NÃO inclui cidade/estado (ficam em
// claro) nem telefone (comportamento atual mantido). Testado por SEGMENTO
// (partes separadas por "_" após normalizar, mesmo padrão de
// lib/respondi-socios.ts) para não confundir "numero_de_telefone" com
// "numero" do endereço — aqui o telefone tem de continuar em claro.
const SEGMENTOS_SENSIVEIS = new Set(["cpf", "cep", "numero", "num", "complemento", "compl"]);
function chaveEhSensivelParaLog(chaveOriginal: string): boolean {
  const segmentos = normalizarChave(chaveOriginal).split("_");
  if (segmentos.some((s) => s === "telefone" || s === "whatsapp" || s === "celular" || s === "fone")) return false;
  return segmentos.some((s) => SEGMENTOS_SENSIVEIS.has(s));
}

// Achado 2 do review de 17/08: em payload no formato label/value (
// `{label:"CPF do sócio", value:"..."}`, `{pergunta:"...", resposta:"..."}` —
// mesmas variantes que o achatador de lib/respondi-socios.ts reconhece:
// label/pergunta/key/campo → value/resposta/valor), a chave literal do JSON é
// sempre "value"/"resposta"/etc, nunca o nome do campo — testar a CHAVE contra
// o vocabulário sensível não pega nada, e o CPF saía ÍNTEGRO no log. Correção:
// quando o item é um par rótulo/valor, testa o RÓTULO (label/pergunta/key/
// campo) contra o vocabulário sensível e, se bater, mascara o VALOR
// (value/resposta/valor) — reaproveitando a mesma `mascararCpf` (que só
// preserva os 3 últimos dígitos, serve para qualquer campo numérico sensível,
// não só CPF).
// Achado A do 2º ciclo do review: a máscara só tratava `string`, e valor
// NUMÉRICO atravessava íntegro (`{cpf: 39053344705}` saía inteiro no log). Não é
// caso exótico — o mapeador deste mesmo diff aceita número de propósito
// (`paraTexto` em lib/respondi-socios.ts converte number/boolean), então um CPF
// numérico vira sócio cadastrável E gravava CPF em claro em cs.webhook_log,
// cs.hm_socios_pendentes.payload e cs.formularios.respostas. A decisão do dono
// ("CPF mascarado em log/rastro") não tem exceção de tipo.
function ehValorMascaravel(v: unknown): v is string | number {
  return typeof v === "string" || typeof v === "number";
}

// Resíduo apontado no 3º ciclo: valor COMPOSTO em chave sensível
// (`{cpf:["390..."]}`, `{label:"CPF", value:[...]}`) atravessava em claro. O
// mapeador rejeita composto (`paraTexto` devolve null), então isso nunca vira
// sócio cadastrável — é escape só no log. Fechado porque custa uma linha:
// mascara os elementos primitivos de array sob chave/rótulo sensível.
function mascararValorSensivel(v: unknown): unknown {
  if (ehValorMascaravel(v)) return mascararCpf(String(v));
  if (Array.isArray(v)) return v.map((item) => (ehValorMascaravel(item) ? mascararCpf(String(item)) : item));
  return v;
}

function ehParRotuloValor(o: Record<string, unknown>): boolean {
  const temRotulo = "label" in o || "pergunta" in o || "key" in o || "campo" in o;
  const temValor = "value" in o || "resposta" in o || "valor" in o;
  return temRotulo && temValor;
}

// Aplica a máscara em qualquer chave do payload bruto que pareça sensível
// (mesmo vocabulário de sinônimos do mapeamento), sem alterar mais nada — o
// resto do payload precisa continuar legível para dar para investigar layout.
// Cobre tanto payload chave→valor direto quanto arrays de {label,value} (e
// variantes), inclusive aninhados dentro de `respostas`/`answers`.
function mascararPayloadParaLog(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        if (ehParRotuloValor(o)) {
          const rotulo = o.label ?? o.pergunta ?? o.key ?? o.campo;
          const chaveValor = "value" in o ? "value" : "resposta" in o ? "resposta" : "valor";
          const valorOriginal = o[chaveValor];
          const rotuloBate = typeof rotulo === "string" && chaveEhSensivelParaLog(rotulo);
          return {
            ...o,
            [chaveValor]: rotuloBate ? mascararValorSensivel(valorOriginal) : mascararPayloadParaLog(valorOriginal),
          };
        }
      }
      return mascararPayloadParaLog(item);
    });
  }
  if (payload && typeof payload === "object") {
    const saida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (chaveEhSensivelParaLog(k) && (ehValorMascaravel(v) || Array.isArray(v))) {
        saida[k] = mascararValorSensivel(v);
      } else {
        saida[k] = mascararPayloadParaLog(v);
      }
    }
    return saida;
  }
  return payload;
}

// 0263, fallback estrutural (2.2): mesmo que `tipo`/`formulario` não bata com
// nenhum slug conhecido, se o payload TEM CARA de formulário de sócio (titular +
// nome do sócio + CPF, depois do mapeamento tolerante), trata como sócio. Sem
// isso, um `tipo` inesperado cairia no fluxo genérico e o sócio nunca seria
// cadastrado — sem erro nenhum, o silêncio que a memória da operação já registrou
// em outros lugares ("dashboard que agrega abas quebra em silêncio").
function pareceFormularioDeSocio(m: Mapeamento): boolean {
  const temTitular = !!(m.campos.titularNome || m.campos.titularEmail);
  const temSocio = !!(m.campos.nome || m.campos.cpf);
  return temTitular && temSocio;
}

export async function GET() {
  return new Response("OK", { status: 200 });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!originOk(req, body)) {
    return NextResponse.json({ ok: false, reason: "invalid_secret" }, { status: 401 });
  }

  const tipo = slugTipo(body.tipo ?? body.formulario);
  const telDig = String(body.telefone ?? body.phone ?? body.whatsapp ?? body.number ?? "").replace(/\D/g, "");
  const u6 = telDig.length >= 6 ? telDig.slice(-6) : null;

  const mapeamento = mapearSocio(body);
  const slugBateu = SLUGS_SOCIO.has(tipo);
  const detectadoPorForma = !slugBateu && pareceFormularioDeSocio(mapeamento);
  const ehRamoSocio = slugBateu || detectadoPorForma;
  const origemLog = ehRamoSocio ? `respondi/${tipo}/socio` : `respondi/${tipo}`;

  // 2.1: log bruto ANTES de qualquer decisão — se algo estourar depois, o
  // payload já está salvo com resultado='recebido'. CPF mascarado (decisão 6).
  // `logId` é reaproveitado para complementar o resultado no fim (UPDATE por
  // id, não por heurística de telefone — telefone pode repetir ou faltar).
  let logId: string | null = null;
  try {
    const inserido = await queryOne<{ id: string }>(
      `insert into cs.webhook_log (origem, telefone_raw, telefone_norm, resultado, payload)
       values ($1, $2, $3, 'recebido', $4) returning id`,
      [origemLog, telDig || null, u6, JSON.stringify(mascararPayloadParaLog(body ?? {}))],
    );
    logId = inserido?.id ?? null;
  } catch (e) {
    log.error("falha ao gravar webhook_log", e);
  }

  async function complementarResultado(resultado: string) {
    if (!logId) return;
    try {
      await query(`update cs.webhook_log set resultado = $1 where id = $2`, [resultado, logId]);
    } catch (e) {
      log.error("falha ao complementar resultado do webhook_log", e);
    }
  }

  if (ehRamoSocio) {
    return await tratarFormularioDeSocio(body, tipo, mapeamento, complementarResultado, detectadoPorForma);
  }

  const email = String(body.email ?? "").trim().toLowerCase() || null;

  // Respostas: usa o objeto explícito ou tudo que não é campo de controle.
  const respostas =
    (body.respostas && typeof body.respostas === "object" && body.respostas) ||
    (body.answers && typeof body.answers === "object" && body.answers) ||
    Object.fromEntries(Object.entries(body).filter(([k]) => !CONTROLE.has(k)));
  const pontuacao = paraNumero(body.pontuacao ?? body.score);

  if (!email && !u6) {
    await complementarResultado("sem_identificacao");
    return NextResponse.json({ ok: false, reason: "email ou telefone obrigatório" }, { status: 200 });
  }

  // Casa na esteira HM por e-mail (prioritário) ou últimos 6 dígitos do telefone.
  const aluno = await queryOne<{ comprador_id: string }>(
    `select comprador_id from cs.contatos_hm_kanban
      where ($1::text is not null and lower(email) = $1)
         or ($2::text is not null and right(regexp_replace(coalesce(telefone,''), '[^0-9]', '', 'g'), 6) = $2)
      order by (case when $1::text is not null and lower(email) = $1 then 0 else 1 end)
      limit 1`,
    [email, u6],
  );

  if (!aluno) {
    await complementarResultado("aluno_nao_encontrado");
    log.info("respondi sem aluno HM correspondente", { tipo, email, u6 });
    return NextResponse.json({ ok: true, matched: false });
  }

  await query(
    `insert into cs.formularios (comprador_id, tipo, respostas, pontuacao, respondido_em)
     values ($1, $2, $3::jsonb, $4, now())
     on conflict (comprador_id, tipo)
     do update set respostas = excluded.respostas, pontuacao = excluded.pontuacao, respondido_em = now(), atualizado_em = now()`,
    [aluno.comprador_id, tipo, JSON.stringify(respostas ?? {}), pontuacao],
  );

  // Marca na timeline do card HM.
  await query(
    `insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
     select id, 'sistema', $2, 'respondi' from cs.contatos_hm where comprador_id = $1`,
    [aluno.comprador_id, `Respondeu o formulário (${tipo})`],
  );

  await complementarResultado("matched");
  return NextResponse.json({ ok: true, matched: true, tipo });
}

// ── O RAMO DE SÓCIOS ───────────────────────────────────────────────────────────
//
// Decisões do Marcio (16-17/08): (1) NÃO provisiona na base THB — só cadastra o
// sócio no board; (2) titular ambíguo/não encontrado vira pendência + alerta,
// nunca escolhe sozinho; (3) sócio substituído mantém o acesso na base THB, só
// sai do board; (5) grava também em cs.formularios; (6) CPF mascarado no log,
// íntegro em cs.hm_socios.cpf.
async function tratarFormularioDeSocio(
  body: Body,
  tipo: string,
  mapeamento: Mapeamento,
  complementarResultadoBase: (resultado: string) => Promise<void>,
  detectadoPorForma: boolean,
): Promise<NextResponse> {
  const { campos, usadas, naoMapeadas } = mapeamento;

  // Vocabulário do webhook_log: quando o `tipo`/`formulario` não bateu com
  // nenhum slug conhecido e foi o FORMATO do payload que entregou o ramo, o
  // resultado registrado é sempre `socio_por_forma_do_payload` — é o sinal de
  // que o Respondi mudou o rótulo do formulário, mais importante para quem lê
  // o log do que qual foi o desfecho específico daquele envio.
  const complementarResultado = detectadoPorForma
    ? (_: string) => complementarResultadoBase("socio_por_forma_do_payload")
    : complementarResultadoBase;

  // Segredo OBRIGATÓRIO neste ramo — mesmo sem HM_WEBHOOK_SECRET configurada
  // (decisão do Marcio: escrever dado de pessoa exige segredo, sem exceção de
  // dev). Os OUTROS formulários mantêm o comportamento antigo (`originOk` já
  // liberou a requisição antes de chegar aqui) — isto é adicional, só para
  // este ramo, e não escreve nada além do log já gravado como 'recebido'.
  const secret = process.env.HM_WEBHOOK_SECRET || process.env.EVENTOS_SECRET || process.env.WEBHOOK_SECRET;
  if (!secret) {
    await complementarResultado("socio_recusado_sem_segredo");
    return NextResponse.json({ ok: false, socio: true, reason: "segredo_nao_configurado" }, { status: 200 });
  }

  // O CPF pleno já tem lugar estruturado nesta tabela (coluna `socio_cpf`, ver
  // abrirPendencia abaixo) — o `payload` bruto guardado ao lado é só rastro de
  // depuração (mesmo papel do payload em cs.webhook_log), então recebe a MESMA
  // máscara de CPF (por regex na chave, não por nome fixo — cobre qualquer
  // rótulo que o Respondi use para o campo). `_mapeamento` documenta qual chave
  // alimentou qual campo, sem repetir o valor do CPF.
  const payloadComRastro = { ...(mascararPayloadParaLog(body) as Record<string, unknown>), _mapeamento: { usadas, naoMapeadas } };

  // Achado 1(c) do review de 17/08: mesmo com nome e CPF do sócio preenchidos,
  // se sobrou em `naoMapeadas` uma chave com CARA de dado de sócio (contém
  // "socio", ou é cpf/email/telefone QUALIFICADO — ex. "cpf_do_socio_2",
  // "socio_email_secundario" — que o mapeamento não conseguiu casar), é sinal
  // de que o Respondi mandou um campo do sócio que o mapeamento não reconheceu
  // e pode ter caído no campo errado (como o achado 1(a) provou: o herdeiro
  // silencioso do titular). Isso merece pendência para revisão humana mesmo
  // com nome/cpf presentes — não é o caso "sem_nome_e_sem_cpf" abaixo.
  const RE_VOCAB_SOCIO = /(^|_)socio(_|$)/;
  const RE_VOCAB_QUALIFICADO_SENSIVEL = /(^|_)(cpf|email|e_mail|telefone|whatsapp|celular|fone)(_|$)/;
  const chaveSobrouComVocabSocio = naoMapeadas.some((chaveOriginal) => {
    const norm = normalizarChave(chaveOriginal);
    return RE_VOCAB_SOCIO.test(norm) || RE_VOCAB_QUALIFICADO_SENSIVEL.test(norm);
  });

  // Achado B do 2º ciclo: o "sócio (sem nome) fantasma" nascia por uma fresta.
  // Payload com `nome` e `cpf` NUS: o `cpf` nu vai para o sócio, mas `nome` nu
  // não pertence a ninguém (o titular só tem os genéricos "titular"/"aluno"; o
  // sócio, só "socio") e sobra em `naoMapeadas` — e "nome" não casa nenhuma das
  // duas regex acima, então nada abria. O upsert então gravava "(sem nome)" com
  // CPF e jogava fora o nome REAL da pessoa. A guarda de baixo só cobre nome E
  // cpf ausentes ao mesmo tempo.
  const RE_VOCAB_NOME = /(^|_)nome(_|$)/;
  const nomeVazioComChaveDeNomeSobrando =
    campos.nome === null && naoMapeadas.some((c) => RE_VOCAB_NOME.test(normalizarChave(c)));

  async function abrirPendencia(motivo: string) {
    // Achado 6 (decisão do dono, 17/08): dedupe EM CÓDIGO, sem migration — a
    // trava correta seria um índice único parcial em
    // (motivo, titular_email, socio_cpf) where resolvido_em is null, mas isso
    // exige migration nova e esta correção não pode criar uma. Em vez disso,
    // antes de inserir verificamos se já existe pendência ABERTA
    // (resolvido_em is null) com o mesmo motivo e o mesmo par identificador —
    // usando `is not distinct from` para NULL não quebrar o casamento (dois
    // titulares "não encontrados" sem e-mail nenhum são o MESMO caso, não
    // casos distintos). Se existir, ATUALIZA payload/recebido_em em vez de
    // inserir de novo — reenvio do mesmo formulário não infla a fila.
    const existente = await queryOne<{ id: string }>(
      `select id from cs.hm_socios_pendentes
        where motivo = $1
          and resolvido_em is null
          and titular_email is not distinct from $2
          and socio_cpf is not distinct from $3
        order by recebido_em desc
        limit 1`,
      [motivo, campos.titularEmail, campos.cpf],
    );
    if (existente) {
      try {
        await query(
          `update cs.hm_socios_pendentes
              set payload = $2::jsonb, titular_nome = $3, socio_nome = $4, recebido_em = now()
            where id = $1`,
          [existente.id, JSON.stringify(payloadComRastro), campos.titularNome, campos.nome],
        );
      } catch (e) {
        // Fallback defensivo: se a role de app não tiver GRANT UPDATE nesta
        // tabela (não confirmado — GRANT explícito da 0201 só cobre
        // select/insert; UPDATE viria de `alter default privileges` da 0001,
        // que só herda se a mesma role executou as duas migrations), não
        // trava o webhook nem perde o dado — insere como pendência nova
        // (comportamento pré-achado-6). Loga para investigar o GRANT depois.
        log.error("dedupe de pendencia: UPDATE falhou (possível falta de GRANT), inserindo nova linha", e);
        await query(
          `insert into cs.hm_socios_pendentes (titular_nome, titular_email, socio_nome, socio_cpf, payload, motivo)
           values ($1, $2, $3, $4, $5::jsonb, $6)`,
          [campos.titularNome, campos.titularEmail, campos.nome, campos.cpf, JSON.stringify(payloadComRastro), motivo],
        );
      }
    } else {
      await query(
        `insert into cs.hm_socios_pendentes (titular_nome, titular_email, socio_nome, socio_cpf, payload, motivo)
         values ($1, $2, $3, $4, $5::jsonb, $6)`,
        [campos.titularNome, campos.titularEmail, campos.nome, campos.cpf, JSON.stringify(payloadComRastro), motivo],
      );
    }
    await query(`select cs.fn_hm_alerta_socio_sem_titular()`);
  }

  if (!campos.nome && !campos.cpf) {
    // Contramedida ao silêncio (2.3): sobrou coisa não mapeada e nem nome nem
    // CPF do sócio vieram — layout provavelmente mudou. Vira pendência, não um
    // sócio "sem nome" fantasma no board.
    if (naoMapeadas.length > 0) {
      await abrirPendencia("campos_nao_mapeados");
      await complementarResultado("socio_campos_nao_mapeados");
      return NextResponse.json({ ok: false, socio: true, reason: "campos_nao_mapeados" });
    }
    await complementarResultado("socio_sem_nome");
    return NextResponse.json({ ok: false, socio: true, reason: "sem_nome_e_sem_cpf" });
  }

  if (chaveSobrouComVocabSocio || nomeVazioComChaveDeNomeSobrando) {
    // Nome e CPF vieram, mas sobrou chave com cara de dado de sócio que o
    // mapeamento não conseguiu encaixar — não confia cegamente, manda para
    // revisão humana em vez de gravar um sócio possivelmente incompleto/errado.
    // Inclui o caso do achado B: só o CPF casou, o nome sobrou não mapeado — sem
    // isto o sócio nasceria "(sem nome)" e o nome real da pessoa seria perdido.
    await abrirPendencia("campos_nao_mapeados");
    await complementarResultado("socio_campos_nao_mapeados");
    return NextResponse.json({ ok: false, socio: true, reason: "campos_nao_mapeados" });
  }

  if (!campos.titularNome && !campos.titularEmail) {
    await abrirPendencia("titular_nao_encontrado");
    await complementarResultado("socio_sem_titular_informado");
    return NextResponse.json({ ok: true, socio: true, pendente: true, motivo: "titular_nao_encontrado" });
  }

  // Casamento do titular: SÓ no board HM (0187) — sem o filtro de produto, o
  // sócio vai parar no card de outro board. Mesmo padrão do cardDo() da rota
  // manual (app/api/hm/contato/[id]/socios/route.ts): NÃO usa
  // cs.contatos_hm_kanban, que não garante o filtro por produto.
  const emailTitular = campos.titularEmail?.toLowerCase() ?? null;
  const telDigTitular = String(body.telefone ?? "").replace(/\D/g, ""); // fallback: só se o payload trouxer telefone do titular explícito
  const u6Titular = telDigTitular.length >= 6 ? telDigTitular.slice(-6) : null;

  const cards = await query<{ id: string; comprador_id: string }>(
    `select ch.id, ch.comprador_id
       from cs.contatos_hm ch
       join public.compradores cp on cp.id = ch.comprador_id
      where ch.produto = 'HM'
        and (
          ($1::text is not null and lower(cp.email) = $1)
          or ($2::text is not null and right(regexp_replace(coalesce(cp.telefone,''), '[^0-9]', '', 'g'), 6) = $2)
        )`,
    [emailTitular, u6Titular],
  );

  if (cards.length === 0) {
    await abrirPendencia("titular_nao_encontrado");
    await complementarResultado("socio_pendente");
    return NextResponse.json({ ok: true, socio: true, pendente: true, motivo: "titular_nao_encontrado" });
  }

  if (cards.length > 1) {
    // Decisão 2 do Marcio: NUNCA escolher entre 2+ cards HM do mesmo titular —
    // mesmo padrão do cancelamento_ambiguo (0218).
    await abrirPendencia("titular_ambiguo");
    await complementarResultado("socio_pendente");
    return NextResponse.json({ ok: true, socio: true, pendente: true, motivo: "titular_ambiguo" });
  }

  const card = cards[0];

  const r = await queryOne<{ acao: string; substituiu: string | null }>(
    `select acao, substituiu from cs.fn_hm_socio_upsert(
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'respondi')`,
    [
      card.id, campos.nome ?? "(sem nome)", campos.cpf, campos.email, campos.telefone,
      campos.cep, campos.cidade, campos.estado, campos.bairro, campos.pais,
      campos.endereco, campos.numero, campos.complemento, campos.observacao, campos.respondiId,
    ],
  );
  const acao = r?.acao ?? "sem_mudanca";

  // Timeline SÓ quando algo realmente mudou — reenvio idêntico não polui a
  // ficha do titular.
  if (acao !== "sem_mudanca") {
    const texto =
      acao === "substituido" && r?.substituiu
        ? `Sócio trocado: ${r.substituiu} → ${campos.nome} (o anterior fica no histórico)`
        : acao === "inserido"
          ? `Sócio cadastrado pelo formulário: ${campos.nome}`
          : `Sócio ${campos.nome}: dados atualizados pelo formulário`;
    await query(
      `insert into cs.interacoes (contato_hm_id, tipo, descricao, autor)
       values ($1, 'sistema', $2, 'respondi')`,
      [card.id, texto],
    );
  }

  // Decisão 5: também grava em cs.formularios, como os demais — para a aba
  // "Formulários" da ficha não mentir. `tipo` = slug normalizado do Respondi.
  //
  // Achado 4 do review de 17/08: mesma lógica do ramo GENÉRICO (linhas ~162-165)
  // — usa o objeto explícito `body.respostas`/`body.answers` PRIMEIRO, e só cai
  // no fallback de "sobras filtradas por CONTROLE" se nenhum dos dois existir.
  // Sem isso, quando o Respondi manda as respostas do sócio ANINHADAS (formato
  // que o mapeador de lib/respondi-socios.ts suporta), `respostas`/`answers`
  // são removidos pelo filtro de CONTROLE e a aba "Formulários" grava só as
  // sobras (ex. só `id`/`data`) — quase vazia, mesmo com o sócio cadastrado
  // certo no board.
  //
  // Achado 3: passa pela MESMA máscara do log/rastro (mascararPayloadParaLog,
  // já corrigida pelo achado 2/5) — o comentário das linhas ~244-249 deste
  // arquivo já reconhece que o rastro de depuração recebe a MESMA máscara
  // aplicada em hm_socios_pendentes.payload; aqui era o ponto que faltava: sem
  // isso, `cpf_do_socio` (ou CEP/número/complemento) entrava ÍNTEGRO numa
  // segunda tabela exibida na aba "Formulários" da ficha, violando a decisão do
  // dono de que CPF pleno mora só em cs.hm_socios.cpf.
  const respostasSocioBrutas =
    (body.respostas && typeof body.respostas === "object" && body.respostas) ||
    (body.answers && typeof body.answers === "object" && body.answers) ||
    Object.fromEntries(Object.entries(body).filter(([k]) => !CONTROLE.has(k) && k !== "secret"));
  const respostasSocio = mascararPayloadParaLog(respostasSocioBrutas);
  await query(
    `insert into cs.formularios (comprador_id, tipo, respostas, pontuacao, respondido_em)
     values ($1, $2, $3::jsonb, null, now())
     on conflict (comprador_id, tipo)
     do update set respostas = excluded.respostas, respondido_em = now(), atualizado_em = now()`,
    [card.comprador_id, tipo, JSON.stringify(respostasSocio)],
  );

  // Decisão 1: NÃO chama provisionarSociosHm — dar acesso continua ato de
  // operação (botão "Enviar à base THB" já existe na ficha).
  await complementarResultado("socio_ok");
  return NextResponse.json({ ok: true, socio: true, acao });
}
