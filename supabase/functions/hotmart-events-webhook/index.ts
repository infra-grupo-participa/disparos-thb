import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HOTMART_HOTTOK = Deno.env.get("HOTMART_HOTTOK") ?? "";

// Credenciais da API da Hotmart (painel → Ferramentas → Credenciais de API).
// Usadas só para descobrir o NOME REAL do comprador quando o checkout manda lixo
// no buyer.name (ver resolveNomeComprador). Ausentes = enriquecimento desligado,
// o webhook segue funcionando como antes.
const HOTMART_CLIENT_ID = Deno.env.get("HOTMART_CLIENT_ID") ?? "";
const HOTMART_CLIENT_SECRET = Deno.env.get("HOTMART_CLIENT_SECRET") ?? "";
const HOTMART_BASIC = Deno.env.get("HOTMART_BASIC") ?? "";

// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são injetados automaticamente em toda
// Edge Function do Supabase. service_role é interno/confiável aqui (não é a
// credencial do app, que é scoped) — usado só para persistir a compra.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Slack member ID da Isabela Teixeira (formato U0XXXXXXX). Marcada nas compras
// de HT cuja cidade seja Porto Alegre ou cujo telefone tenha DDD 51.
// Pode ser sobrescrito via secret SLACK_USER_ISABELA; cai no ID fixo se ausente.
const SLACK_USER_ISABELA = Deno.env.get("SLACK_USER_ISABELA") || "U0APMG0BUBZ";

const SLACK_WEBHOOKS: Record<string, string> = {
  HT:      Deno.env.get("SLACK_WEBHOOK_EVENTS_HT")      ?? "",
  HM:      Deno.env.get("SLACK_WEBHOOK_EVENTS_HM")      ?? "",
  HMAIS:   Deno.env.get("SLACK_WEBHOOK_EVENTS_HMAIS")   ?? "",
  CLINICA: Deno.env.get("SLACK_WEBHOOK_EVENTS_CLINICA") ?? "",
  ETHB:    Deno.env.get("SLACK_WEBHOOK_EVENTS_ETHB")    ?? "",
  IMERSAO: Deno.env.get("SLACK_WEBHOOK_EVENTS_IMERSAO") ?? "",
};

// Mapeamento product_id → chave do canal
const PRODUCT_CHANNEL: Record<string, string> = {
  "1560865": "HT",      // Holding Total (ingresso)
  "2414291": "HT",      // VIP - Holding Total
  "5064314": "HM",      // Holding Masters
  "3507214": "HM",      // Holding - Holding Masters
  "6990981": "HMAIS",   // Holding Mais
  "5682989": "CLINICA", // Clínica de Holding Familiar
  "5951389": "ETHB",    // Encontro do Time Holding Brasil
  "1667133": "IMERSAO", // Imersão em Holding Familiar
  // AURUM entra por NOME (resolveChannel abaixo) — o produto se chama "Aurum" e
  // o product_id ainda não foi confirmado. Quando ele aparecer no primeiro
  // payload (cs.hotmart_eventos), fixar aqui: o id é mais estável que o nome.
};

// Nomes legíveis por canal
const CHANNEL_LABEL: Record<string, string> = {
  HT:      "Holding Total",
  HM:      "Holding Masters",
  HMAIS:   "Holding Mais",
  CLINICA: "Clínica em Holding Familiar - Porto Alegre",
  ETHB:    "Encontro do Time Holding Brasil",
  IMERSAO: "Imersão em Holding Familiar - Porto Alegre",
  AURUM:   "Aurum",
};

function normalizeStr(s: string): string {
  return s.toLowerCase()
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " "); // descarta chars corrompidos (ex: encoding Latin-1)
}

function resolveChannel(productId: string, productName: string): string | null {
  if (PRODUCT_CHANNEL[productId]) return PRODUCT_CHANNEL[productId];

  const name = normalizeStr(productName);
  if (name.includes("holding total")) return "HT";
  if (name.includes("holding masters")) return "HM";
  if (name.includes("holding mais") || name.includes("hmais")) return "HMAIS";
  if (name.includes("clinica") || (name.includes("cl") && name.includes("nica"))) return "CLINICA";
  if (name.includes("encontro do time") || name.includes("ethb")) return "ETHB";
  // Aurum (pitch no ETHB São Paulo, 05/08/2026, oferta qm4lu7py). Mapear o canal
  // faz a venda ser PERSISTIDA em compradores/compras + cs.hotmart_eventos — que
  // é o que hoje NÃO acontece: produto não mapeado leva 200 e é descartado sem
  // deixar rastro, e a Hotmart não retenta.
  //
  // Card no board do Aurum ainda NÃO nasce daqui, de propósito: quem cria card é
  // cs.fn_seed_contato_hm, e só quando a oferta existe em public.hm_product_catalog
  // — e essa função não preenche cs.contatos_hm.produto (fica no default 'HM').
  // Cadastrar a oferta antes de ensinar o produto ao trigger jogaria comprador de
  // Aurum no board do Holding Masters. Então: primeiro não perder a venda; o card
  // vem no backfill, depois da mudança de chave (ver plano).
  if (name.includes("aurum")) return "AURUM";
  if (name.includes("imersao") || (name.includes("imers") && name.includes("holding"))) return "IMERSAO";

  return null;
}

// Tenta extrair o telefone do payload. Hotmart pode mandar em vários formatos:
//   - buyer.checkout_phone (string já formatada)
//   - buyer.phone (string)
//   - buyer.phone_local_code + buyer.phone_number (DDD + número separados)
//   - buyer.documents.phone (raro, contexto B2B)
function extractPhone(buyer: Record<string, unknown>): string | null {
  const candidates: Array<string | null | undefined> = [
    buyer.checkout_phone as string,
    buyer.phone as string,
  ];

  const localCode = buyer.phone_local_code as string | undefined;
  const phoneNumber = buyer.phone_number as string | undefined;
  if (localCode && phoneNumber) candidates.push(`${localCode}${phoneNumber}`);

  for (const raw of candidates) {
    const normalized = normalizePhone(raw);
    if (normalized) return normalized;
  }
  return null;
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  if (!digits.startsWith("55") && (digits.length === 10 || digits.length === 11)) digits = "55" + digits;
  return digits;
}

// CPF/CNPJ do comprador — a identidade FORTE, estável entre e-mails diferentes.
// É o que impede o "pagou e sumiu": a mesma pessoa paga com outro e-mail e, sem
// isto, virava cadastro novo com o pagamento órfão do card (caso Caria). O
// telefone NÃO serve para isso — em holding familiar cônjuges/sócios dividem o
// mesmo número (nos dados: mesmo telefone, CPFs distintos).
function extractDocumento(buyer: Record<string, unknown>): { documento: string | null; tipo: string | null } {
  const docs = buyer.documents as Record<string, unknown> | undefined;
  const raw = (buyer.document ?? docs?.document ?? docs?.number) as string | undefined;
  const digits = raw ? String(raw).replace(/\D/g, "") : "";
  if (digits.length < 11) return { documento: null, tipo: null }; // CPF=11, CNPJ=14
  const tipo = buyer.document_type ? String(buyer.document_type) : (digits.length === 14 ? "CNPJ" : "CPF");
  return { documento: digits, tipo };
}

// True se a cidade for Porto Alegre OU o telefone (normalizado p/ 55DDD...) tiver DDD 51.
function isPortoAlegre(city: string | null | undefined, phone: string | null): boolean {
  const cityNorm = city ? normalizeStr(city).trim() : "";
  if (cityNorm === "porto alegre") return true;
  // phone vem como 55 + DDD + número; DDD 51 = Porto Alegre / região metropolitana.
  if (phone && phone.startsWith("55") && phone.substring(2, 4) === "51") return true;
  return false;
}

function formatBrDate(ms: number | null | undefined): string {
  if (!ms) return "-";
  const d = new Date(ms);
  if (isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

// Dia civil (dd/mm/aaaa) em São Paulo, para comparar datas ignorando a hora.
function brDay(ms: number | null | undefined): string | null {
  if (!ms) return null;
  const d = new Date(ms);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

// Converte epoch (ms) para ISO. Retorna null se ausente/inválido.
function msToIso(ms: number | null | undefined): string | null {
  if (!ms) return null;
  const d = new Date(Number(ms));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Extrai cidade/estado tentando várias localizações conhecidas do payload da
// Hotmart. Em produtos cujo checkout NÃO solicita endereço, todos esses caminhos
// virão vazios — isso só se resolve marcando "endereço obrigatório" no painel.
function extractAddress(
  data: Record<string, unknown>,
  buyer: Record<string, unknown>,
  purchase: Record<string, unknown>,
): { cidade: string | null; estado: string | null } {
  const candidates: Array<Record<string, unknown> | undefined> = [
    buyer.address as Record<string, unknown> | undefined,
    purchase.address as Record<string, unknown> | undefined,
    (data?.subscriber as Record<string, unknown> | undefined)?.address as Record<string, unknown> | undefined,
  ];

  for (const addr of candidates) {
    if (!addr) continue;
    const rawCity = (addr.city ?? addr.address_city ?? addr.cidade) as string | undefined;
    const rawState = (addr.state ?? addr.address_state ?? addr.estado ?? addr.uf) as string | undefined;
    const cidade = rawCity ? String(rawCity).trim() : null;
    const estado = rawState ? String(rawState).trim().substring(0, 2).toUpperCase() : null;
    if (cidade || estado) return { cidade, estado };
  }

  // Fallbacks planos: alguns payloads vêm com campos no nível do buyer/purchase.
  const flatCity = (buyer.address_city ?? buyer.city ?? purchase.address_city) as string | undefined;
  const flatState = (buyer.address_state ?? buyer.state ?? buyer.uf ?? purchase.address_state) as string | undefined;
  return {
    cidade: flatCity ? String(flatCity).trim() : null,
    estado: flatState ? String(flatState).trim().substring(0, 2).toUpperCase() : null,
  };
}

// Extrai a string sck (tracking) de vários caminhos possíveis do payload.
function extractSck(purchase: Record<string, unknown>): string {
  const originObj = purchase.origin as Record<string, unknown> | undefined;
  const trackingParams = purchase.tracking as Record<string, unknown> | undefined;
  const raw =
    originObj?.sck
    ?? originObj?.xcod
    ?? purchase.sck
    ?? purchase.checkout_origin
    ?? trackingParams?.source_sck
    ?? trackingParams?.utm_source
    ?? "";
  return String(raw).trim();
}

async function notifySlack(channel: string, payload: {
  nome: string;
  email: string;
  telefone: string | null;
  produto: string;
  valor: number | null;
  moeda: string;
  dataCompraMs: number | null;
  dataAprovacaoMs: number | null;
  origem: string | null;
  cidade: string | null;
  estado: string | null;
  markPortoAlegre: boolean;
}) {
  const webhookUrl = SLACK_WEBHOOKS[channel];
  if (!webhookUrl) {
    console.warn(`Webhook não configurado para canal: ${channel}`);
    return;
  }

  const dataFormatada = formatBrDate(payload.dataCompraMs);
  // Aprovação só é exibida quando cai em outro DIA que a compra (boleto pendente).
  // Comparar o texto formatado com hora acusaria diferença em quase todo pix/cartão,
  // que aprova minutos depois — linha redundante no card.
  const dataAprovacaoFormatada = formatBrDate(payload.dataAprovacaoMs);
  const mostrarAprovacao =
    payload.dataAprovacaoMs != null
    && payload.dataCompraMs != null
    && brDay(payload.dataAprovacaoMs) !== brDay(payload.dataCompraMs);
  const linhaAprovacao = mostrarAprovacao ? `\n*Data da aprovação:* ${dataAprovacaoFormatada}` : "";
  const valorFormatado = payload.valor != null
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: payload.moeda || "BRL" }).format(payload.valor)
    : "-";
  const origemLabel = payload.origem || "Não identificada";

  // Região exibida em toda compra para permitir filtro na busca do Slack.
  const cidadeLabel = payload.cidade || "-";
  const estadoLabel = payload.estado || "-";
  const regiaoLabel = `${cidadeLabel}${estadoLabel !== "-" ? ` / ${estadoLabel}` : ""}`;

  // Menção real à Isabela quando a compra é de Porto Alegre (cidade ou DDD 51).
  const mencaoIsabela = payload.markPortoAlegre && SLACK_USER_ISABELA
    ? `\n\n:round_pushpin: *Cliente de Porto Alegre* — <@${SLACK_USER_ISABELA}>`
    : "";

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `Nova compra: ${payload.produto}`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Nome:* ${payload.nome}\n*E-mail:* ${payload.email}\n*Telefone:* ${payload.telefone ?? "-"}\n*Produto:* ${payload.produto}\n*Valor:* ${valorFormatado}\n*Origem:* ${origemLabel}\n*Região:* ${regiaoLabel}\n*Data da compra:* ${dataFormatada}${linhaAprovacao}${mencaoIsabela}`,
          },
        },
        { type: "divider" },
      ],
    }),
  });

  if (!response.ok) {
    console.error(`Falha ao notificar Slack (${channel}):`, response.status, await response.text());
  }
}

// Persiste a compra aprovada nas tabelas canônicas public.compradores / public.compras.
// Idempotente (upsert por email / hotmart_transaction) e NÃO-FATAL: qualquer erro é
// logado, nunca lançado — assim uma falha de DB não provoca retry da Hotmart nem
// atrapalha a notificação do Slack. Reusa o modelo existente (não cria compradores_ht).
// Guarda o evento como a Hotmart mandou. Nunca derruba o webhook: se falhar, o
// pagamento continua sendo processado — o log é para nós, não para ela.
async function logEventoHotmart(
  evento: string,
  transacao: string | null,
  email: string | null,
  payload: unknown,
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await supabase.schema("cs").from("hotmart_eventos").insert({
      evento,
      transacao,
      email: email || null,
      payload,
    });
  } catch (e) {
    console.error("[DB] falha ao guardar evento cru:", e instanceof Error ? e.message : e);
  }
}

async function persistPurchase(args: {
  nome: string;
  email: string;
  telefone: string | null;
  documento: string | null;
  tipoDocumento: string | null;
  cidade: string | null;
  estado: string | null;
  transaction: string;
  productId: string;
  productName: string;
  offerCode: string | null;
  moeda: string;
  valor: number | null;
  status: string;
  isAssinatura: boolean;
  numeroRecorrencia: number | null;
  metodoPagamento: string | null;
  parcelas: number | null;
  dataCompraIso: string | null;
  dataAprovacaoIso: string | null;
  // ---- o extrato financeiro que o webhook jogava fora ----
  // `numeroCobranca` é o mais caro deles: no Parcelado Hotmart a MESMA transação é
  // recobrada todo mês e este contador sobe (2, 3, ...). Sem ele, a 2ª parcela some
  // — o upsert por transação sobrescreve a linha e ninguém percebe. A Marina pagou
  // duas e o sistema contava uma.
  numeroCobranca: number | null;
  tipoCobranca: string | null;
  valorComImpostos: number | null;
  valorLiquido: number | null;
  taxaProcessamento: number | null;
  canalVenda: string | null;
  codigoAssinante: string | null;
}): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[DB] SUPABASE_URL/SERVICE_ROLE_KEY ausentes — persistência ignorada");
    return;
  }
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const agora = new Date().toISOString();

    // 1) Achar o comprador CERTO antes de criar um novo. Prioridade:
    //      e-mail (caminho feliz, mesma conta) → CPF (identidade forte).
    //    NUNCA por telefone: casaria pessoas diferentes que dividem o número.
    //    Quando acha por CPF, a compra é anexada ao cadastro existente em vez de
    //    nascer um duplicado com o novo e-mail — é a correção do "pagou e sumiu".
    type CompradorLite = {
      id: string; nome: string | null; telefone: string | null; documento: string | null;
      endereco_cidade: string | null; endereco_estado: string | null;
    };
    const SEL = "id, nome, telefone, documento, endereco_cidade, endereco_estado";
    let existente: CompradorLite | null = null;

    {
      const { data } = await supabase.from("compradores").select(SEL).eq("email", args.email).maybeSingle();
      if (data) existente = data as CompradorLite;
    }
    if (!existente && args.documento) {
      const { data } = await supabase.from("compradores").select(SEL)
        .eq("documento", args.documento).limit(1).maybeSingle();
      if (data) existente = data as CompradorLite;
    }

    let compradorId: string;
    if (existente) {
      // Enriquece SEM sobrescrever: preenche só o que falta. Reanexar uma compra
      // nunca degrada um cadastro bom (nome certo, telefone canônico, e-mail original).
      const patch: Record<string, unknown> = { atualizado_em: agora, is_manual: false };
      if (!existente.nome || nomeSuspeito(existente.nome)) patch.nome = args.nome;
      if (!existente.telefone && args.telefone) patch.telefone = args.telefone;
      if (!existente.documento && args.documento) { patch.documento = args.documento; patch.tipo_documento = args.tipoDocumento; }
      if (!existente.endereco_cidade && args.cidade) patch.endereco_cidade = args.cidade;
      if (!existente.endereco_estado && args.estado) patch.endereco_estado = args.estado;
      const { error: uErr } = await supabase.from("compradores").update(patch).eq("id", existente.id);
      if (uErr) { console.error("[DB] falha ao enriquecer comprador:", uErr.message); return; }
      compradorId = existente.id;
      console.log(`[DB] compra anexada ao cadastro existente (${existente.id}) via ${existente.documento === args.documento && args.documento ? "CPF" : "e-mail"}`);
    } else {
      // Comprador novo — upsert por email (UNIQUE). Não sobrescreve criado_em.
      const { data: comprador, error: cErr } = await supabase
        .from("compradores")
        .upsert(
          {
            nome: args.nome,
            email: args.email,
            telefone: args.telefone,
            documento: args.documento,
            tipo_documento: args.tipoDocumento,
            endereco_cidade: args.cidade,
            endereco_estado: args.estado,
            is_manual: false,
            atualizado_em: agora,
          },
          { onConflict: "email" },
        )
        .select("id")
        .single();

      if (cErr || !comprador) {
        console.error("[DB] falha ao upsert comprador:", cErr?.message ?? cErr);
        return;
      }
      compradorId = comprador.id;
    }

    // 2) Compra — upsert por hotmart_transaction (UNIQUE).
    const { error: pErr } = await supabase
      .from("compras")
      .upsert(
        {
          comprador_id: compradorId,
          hotmart_transaction: args.transaction,
          produto_id: args.productId || null,
          produto_nome: args.productName || null,
          oferta_codigo: args.offerCode,
          moeda: args.moeda || "BRL",
          preco: args.valor,
          status: args.status,
          is_assinatura: args.isAssinatura,
          numero_recorrencia: args.numeroRecorrencia,
          metodo_pagamento: args.metodoPagamento,
          parcelas: args.parcelas,
          data_compra: args.dataCompraIso,
          data_aprovacao: args.dataAprovacaoIso,
          hotmart_event: "PURCHASE_APPROVED",
          // O extrato completo (0088). O upsert por transação continua — o que muda
          // é que a recobrança agora atualiza `numero_cobranca`, e o gatilho do razão
          // lança a parcela nova em vez de perdê-la.
          numero_cobranca: args.numeroCobranca,
          tipo_cobranca: args.tipoCobranca,
          valor_com_impostos: args.valorComImpostos,
          valor_liquido: args.valorLiquido,
          taxa_processamento: args.taxaProcessamento,
          canal_venda: args.canalVenda,
          codigo_assinante: args.codigoAssinante,
          atualizado_em: agora,
        },
        { onConflict: "hotmart_transaction" },
      );

    if (pErr) {
      console.error("[DB] falha ao upsert compra:", pErr.message);
      return;
    }

    console.log(`[DB] compra persistida: ${args.transaction} (${args.email})`);
  } catch (e) {
    console.error("[DB] exceção em persistPurchase:", e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------------------
// O nome do comprador.
//
// buyer.name é o que foi DIGITADO no checkout — quando a venda nasce de
// automação/GPT, chega o telefone ("+55 (86) 99834-3773") ou o próprio e-mail.
// O nome de verdade é o da CONTA Hotmart (o que o painel mostra em "Detalhes do
// comprador") e não vem no payload: só pela API de vendas, pela transação.
// ---------------------------------------------------------------------------

// Mesmo critério do banco (public.fn_nome_suspeito): isto não pode ser um nome
// de gente — vazio, e-mail, telefone/CPF (8+ dígitos) ou sem letra nenhuma.
function nomeSuspeito(nome: string | null | undefined): boolean {
  if (!nome) return true;
  const n = nome.trim();
  if (!n || n.toLowerCase() === "sem nome") return true;
  if (n.includes("@")) return true;
  if (n.replace(/\D/g, "").length >= 8) return true;
  if (!/\p{L}/u.test(n)) return true;
  return false;
}

// Token OAuth da Hotmart, cacheado em memória enquanto a instância viver.
let tokenCache: { token: string; expiraEm: number } | null = null;

async function hotmartToken(): Promise<string | null> {
  if (!HOTMART_CLIENT_ID || !HOTMART_CLIENT_SECRET || !HOTMART_BASIC) return null;
  if (tokenCache && Date.now() < tokenCache.expiraEm) return tokenCache.token;

  const url = "https://api-sec-vlc.hotmart.com/security/oauth/token"
    + `?grant_type=client_credentials&client_id=${encodeURIComponent(HOTMART_CLIENT_ID)}`
    + `&client_secret=${encodeURIComponent(HOTMART_CLIENT_SECRET)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Basic ${HOTMART_BASIC}`, "Content-Type": "application/json" },
  });
  if (!res.ok) {
    console.error("[HOTMART API] falha ao obter token:", res.status, await res.text());
    return null;
  }

  const json = await res.json() as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;

  // Renova 60s antes do vencimento real.
  const ttlMs = Math.max(0, ((json.expires_in ?? 3600) - 60) * 1000);
  tokenCache = { token: json.access_token, expiraEm: Date.now() + ttlMs };
  return json.access_token;
}

// Nome da conta Hotmart do comprador daquela transação. null se a API não
// responder ou também não souber — nunca inventa nome.
async function nomeDoCompradorNaHotmart(transaction: string): Promise<string | null> {
  const token = await hotmartToken();
  if (!token) return null;

  try {
    const res = await fetch(
      `https://developers.hotmart.com/payments/api/v1/sales/users?transaction=${encodeURIComponent(transaction)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      console.error("[HOTMART API] sales/users falhou:", res.status, await res.text());
      return null;
    }

    const json = await res.json() as {
      items?: Array<{ users?: Array<{ role?: string; user?: { name?: string } }> }>;
    };

    for (const item of json.items ?? []) {
      for (const u of item.users ?? []) {
        if (u.role !== "BUYER") continue;
        const nome = u.user?.name?.trim();
        if (nome && !nomeSuspeito(nome)) return nome;
      }
    }
    return null;
  } catch (e) {
    console.error("[HOTMART API] exceção em sales/users:", e instanceof Error ? e.message : e);
    return null;
  }
}

// "JENISVALDO OLIVEIRA ROCHA" → "Jenisvaldo Oliveira Rocha". A Hotmart devolve
// o nome da conta em caixa alta; a base grava em caixa mista.
function capitalizarNome(nome: string): string {
  if (nome !== nome.toUpperCase()) return nome; // já vem em caixa mista: respeita
  const minusculas = new Set(["de", "da", "do", "das", "dos", "e"]);
  return nome
    .toLowerCase()
    .split(/\s+/)
    .map((p, i) => (i > 0 && minusculas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

// Nome do checkout se ele for um nome; senão, o da conta Hotmart. Se nem a API
// souber, devolve o que veio (o telefone é o único dado real que sobrou) — e o
// banco marca o card com `revisar` para o operador confirmar.
async function resolveNomeComprador(nomeCheckout: string, transaction: string): Promise<string> {
  if (!nomeSuspeito(nomeCheckout)) return nomeCheckout;

  const nomeApi = await nomeDoCompradorNaHotmart(transaction);
  if (nomeApi) {
    console.log(`[NOME] checkout sujo ("${nomeCheckout}") → conta Hotmart: "${nomeApi}"`);
    return capitalizarNome(nomeApi);
  }

  console.warn(`[NOME] checkout sujo ("${nomeCheckout}") e API não resolveu — card sobe para revisão`);
  return nomeCheckout;
}

// ---------------------------------------------------------------------------
// O cancelamento.
//
// Reembolso, chargeback, protesto e cancelamento de assinatura: é aqui que o
// sistema fica sabendo que alguém saiu. Antes disto, um reembolso feito no
// painel da Hotmart era invisível — o aluno continuava com acesso a tudo e
// ninguém era avisado de que precisava tirá-lo.
//
// O status que cada evento grava na compra (o histórico do dinheiro é fato: a
// compra não é apagada, é reclassificada).
const EVENTOS_CANCELAMENTO: Record<string, string> = {
  PURCHASE_REFUNDED: "REFUNDED",
  PURCHASE_CHARGEBACK: "CHARGEBACK",
  PURCHASE_PROTEST: "PROTESTED",
  PURCHASE_CANCELED: "CANCELED",
  SUBSCRIPTION_CANCELLATION: "CANCELED",
};

const EVENTO_LABEL: Record<string, string> = {
  PURCHASE_REFUNDED: "Reembolso",
  PURCHASE_CHARGEBACK: "Chargeback",
  PURCHASE_PROTEST: "Protesto",
  PURCHASE_CANCELED: "Compra cancelada",
  SUBSCRIPTION_CANCELLATION: "Assinatura cancelada",
};

// Este aviso é INFORMATIVO, para o canal de vendas do produto: "fulano pediu
// reembolso". Ele NÃO chama o Thomas.
//
// A ordem de serviço — "remova os acessos deste aluno" — quem manda é o BANCO
// (cs.fn_hm_avisar_remocao, migration 0073), disparada pelo gatilho no instante
// em que o cancelamento vira fato. O motivo é que o cancelamento tem duas portas
// (esta, da Hotmart, e a do comercial, que cancela por fora) e o Thomas não pode
// ser chamado duas vezes para a mesma tarefa. Com um único emissor — o fato, não
// quem o registrou — duplicar fica impossível por construção.
async function notifySlackCancelamento(channel: string, payload: {
  evento: string;
  nome: string;
  email: string;
  telefone: string | null;
  produto: string;
  valor: number | null;
  moeda: string;
  transaction: string;
  eraAluno: boolean;
  turma?: string | null;
}) {
  const webhookUrl = SLACK_WEBHOOKS[channel];
  if (!webhookUrl) return;

  const valorFormatado = payload.valor != null
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: payload.moeda || "BRL" }).format(payload.valor)
    : "-";
  const label = EVENTO_LABEL[payload.evento] ?? payload.evento;

  const dados = [
    `*Nome:* ${payload.nome}`,
    `*E-mail:* ${payload.email || "-"}`,
    `*Telefone:* ${payload.telefone ?? "-"}`,
    payload.turma ? `*Turma:* ${payload.turma}` : null,
    `*Produto:* ${payload.produto}`,
    `*Valor:* ${valorFormatado}`,
    `*Transação:* ${payload.transaction}`,
  ].filter(Boolean).join("\n");

  // Quem era aluno gera tarefa — mas ela vai pelo canal dos acessos, não aqui.
  // Dizer isto evita que o time de vendas ache que ninguém foi acionado.
  const rodape = payload.eraAluno
    ? "\n\n_A remoção dos acessos já foi pedida no canal de acessos._"
    : "\n\n_Ainda não era aluno — não há acesso a remover._";

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `${label}: ${payload.produto}`,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `:x: *${label}*\n${dados}${rodape}` } },
        { type: "divider" },
      ],
    }),
  });

  if (!response.ok) {
    console.error(`Falha ao notificar cancelamento no Slack (${channel}):`, response.status, await response.text());
  }
}

// O que o banco devolve sobre o cancelamento. Nome/e-mail/telefone/turma vêm do
// SISTEMA (compradores + card), não do payload — é no payload que o nome chega
// sujo, e o Thomas precisa do nome certo para achar a pessoa no Searchie.
type CancelamentoNoBanco = {
  achouCompra: boolean;
  temCardHm: boolean;
  eraAluno: boolean;
  nome?: string | null;
  email?: string | null;
  telefone?: string | null;
  turma?: string | null;
  compradorId?: string | null;
};

function lerRetorno(r: Record<string, unknown>): CancelamentoNoBanco {
  return {
    achouCompra: r.achou_compra === true || r.achou_comprador === true,
    temCardHm: r.tem_card_hm === true,
    eraAluno: r.resultado === "cancelado",
    nome: (r.nome as string) ?? null,
    email: (r.email as string) ?? null,
    telefone: (r.telefone as string) ?? null,
    turma: (r.turma as string) ?? null,
    compradorId: (r.comprador_id as string) ?? null,
  };
}

// Marca a compra como cancelada e, se houver card no HM, efetiva o cancelamento
// (aluno marcado — nunca apagado — e pendência de remover os acessos).
//
// `ocorridoEm` é a data do EVENTO na Hotmart, não a de agora: um reembolso pode
// chegar aqui minutos ou horas depois de acontecer, e é a data dele que responde
// "quando o aluno cancelou de fato" (ver migration 0091).
//
// Não-fatal: erro aqui vira log, nunca um retry da Hotmart.
async function cancelarNoBanco(
  transaction: string,
  evento: string,
  status: string,
  ocorridoEm: string | null,
): Promise<CancelamentoNoBanco> {
  const vazio: CancelamentoNoBanco = { achouCompra: false, temCardHm: false, eraAluno: false };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[DB] SUPABASE_URL/SERVICE_ROLE_KEY ausentes — cancelamento não persistido");
    return vazio;
  }
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.rpc("fn_hm_cancelar_por_transacao", {
      p_transaction: transaction,
      p_evento: evento,
      p_status: status,
      p_ocorrido_em: ocorridoEm,
    });

    if (error) {
      console.error("[DB] falha ao cancelar:", error.message);
      return vazio;
    }

    const r = (data ?? {}) as Record<string, unknown>;
    console.log(`[DB] cancelamento processado (${transaction}):`, JSON.stringify(r));
    return { ...lerRetorno(r), achouCompra: r.achou_compra === true };
  } catch (e) {
    console.error("[DB] exceção em cancelarNoBanco:", e instanceof Error ? e.message : e);
    return vazio;
  }
}

// O gêmeo de cancelarNoBanco para quando não há transação (assinatura): casa o
// contato pelo e-mail. Não mexe em compras — nenhuma compra específica foi
// desfeita aqui; o que acabou foi a assinatura.
async function cancelarPorEmailNoBanco(
  email: string,
  evento: string,
  ocorridoEm: string | null,
): Promise<CancelamentoNoBanco> {
  const vazio: CancelamentoNoBanco = { achouCompra: false, temCardHm: false, eraAluno: false };
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[DB] SUPABASE_URL/SERVICE_ROLE_KEY ausentes — cancelamento não persistido");
    return vazio;
  }
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase.rpc("fn_hm_cancelar_por_email", {
      p_email: email,
      p_evento: evento,
      p_ocorrido_em: ocorridoEm,
    });

    if (error) {
      console.error("[DB] falha ao cancelar por e-mail:", error.message);
      return vazio;
    }

    const r = (data ?? {}) as Record<string, unknown>;
    console.log(`[DB] assinatura cancelada (${email}):`, JSON.stringify(r));
    return lerRetorno(r);
  } catch (e) {
    console.error("[DB] exceção em cancelarPorEmailNoBanco:", e instanceof Error ? e.message : e);
    return vazio;
  }
}

serve(async (req) => {
  if (req.method === "GET") return new Response("OK", { status: 200 });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (!HOTMART_HOTTOK) {
    console.error("HOTMART_HOTTOK não configurado nos secrets da Edge Function");
    return new Response(JSON.stringify({ ok: false, reason: "server_misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Hotmart manda o hottok no corpo (campo top-level "hottok").
  // Compatível também com o header X-Hotmart-Hottok caso a Hotmart mude o formato.
  const receivedFromBody = typeof body.hottok === "string" ? body.hottok : null;
  const receivedFromHeader = req.headers.get("x-hotmart-hottok");
  const received = receivedFromBody ?? receivedFromHeader;
  if (received !== HOTMART_HOTTOK) {
    return new Response(JSON.stringify({ ok: false, reason: "invalid_hottok" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const event = (body.event as string) ?? "";
  const statusCancelamento = EVENTOS_CANCELAMENTO[event];
  if (event !== "PURCHASE_APPROVED" && !statusCancelamento) {
    return new Response(JSON.stringify({ ok: true, reason: "event_ignored" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Quando o evento aconteceu NA HOTMART. A entrega do webhook pode atrasar, e
  // "o aluno cancelou dia 12" tem de dizer 12 — não a hora em que o nosso
  // servidor processou. Sem creation_date no payload, o banco cai no now().
  const eventoEm = msToIso(Number(body.creation_date ?? 0) || null);

  const data = body.data as Record<string, unknown>;
  const buyer = data?.buyer as Record<string, unknown>;
  const purchase = data?.purchase as Record<string, unknown>;
  const product = data?.product as Record<string, unknown>;
  const subscriber = data?.subscriber as Record<string, unknown> | undefined;

  // O produto identifica o canal em TODO evento — inclusive nos que não têm
  // compra (cancelamento de assinatura). Por isso vem antes do guard de payload.
  const productId = String(product?.id ?? "");
  const productName = String(product?.name ?? "");
  const channel = resolveChannel(productId, productName);

  if (!channel) {
    console.log(`Produto não mapeado para nenhum canal: ${productId} (${productName})`);
    return new Response(JSON.stringify({ ok: true, reason: "product_not_mapped" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ---- Assinatura cancelada: o payload fala de ASSINANTE, não de compra ----
  // SUBSCRIPTION_CANCELLATION não traz purchase.transaction — não há transação a
  // reclassificar. O elo é o e-mail do assinante. Tratado antes do guard de
  // payload justamente porque não passaria por ele.
  if (event === "SUBSCRIPTION_CANCELLATION") {
    const email = String(subscriber?.email ?? buyer?.email ?? "").trim();
    if (!email) {
      console.warn("[CANCELAMENTO] assinatura cancelada sem e-mail no payload — nada a casar");
      return new Response(JSON.stringify({ ok: true, reason: "incomplete_payload" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // O payload cru do cancelamento passa a ser guardado. Antes só a compra
    // aprovada era registrada em cs.hotmart_eventos — de um reembolso não
    // sobrava rastro nenhum, e é justamente o reembolso que alguém vai querer
    // auditar depois ("cadê a prova de que a Hotmart devolveu o dinheiro?").
    await logEventoHotmart(event, null, email, body);

    const r = await cancelarPorEmailNoBanco(email, event, eventoEm);
    await notifySlackCancelamento(channel, {
      evento: event,
      // O nome do sistema vem primeiro: é o corrigido. O do payload é reserva.
      nome: r.nome || String(subscriber?.name ?? buyer?.name ?? email),
      email: r.email || email,
      telefone: r.telefone ?? (buyer ? extractPhone(buyer) : null),
      produto: CHANNEL_LABEL[channel] ?? productName,
      valor: null,
      moeda: "BRL",
      transaction: "— (assinatura)",
      eraAluno: r.eraAluno,
      turma: r.turma,
    });

    return new Response(JSON.stringify({ ok: true, channel, event, ...r }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!buyer?.email || !purchase?.transaction) {
    return new Response(JSON.stringify({ ok: false, reason: "incomplete_payload" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ---- Cancelamento: reembolso, chargeback, protesto, assinatura cancelada ----
  // A compra é reclassificada (o dinheiro entrou e voltou — isso é história, não
  // se apaga), o card vai para "Solicitou Cancelamento" com o fato datado, o
  // aluno é MARCADO como cancelado (some do GPS, continua no banco) e o Slack
  // chama quem tem de remover os acessos.
  if (statusCancelamento) {
    const transaction = String(purchase.transaction);
    // Guarda o payload cru do reembolso/chargeback antes de agir (ver acima).
    await logEventoHotmart(event, transaction, String(buyer.email ?? ""), body);

    const r = await cancelarNoBanco(transaction, event, statusCancelamento, eventoEm);

    if (!r.achouCompra) {
      // Cancelamento de uma compra que nunca chegou aqui (anterior ao webhook,
      // ou de produto não mapeado). Nada a reclassificar — mas o time precisa
      // saber, então o aviso vai assim mesmo.
      console.warn(`[CANCELAMENTO] transação desconhecida no banco: ${transaction} (${event})`);
    }

    const precoC = purchase.price as Record<string, unknown> | undefined;
    await notifySlackCancelamento(channel, {
      evento: event,
      // O nome do sistema vem primeiro: é o corrigido (o do payload pode ser o
      // telefone). Cai no payload só quando a compra não existe no banco.
      nome: r.nome || String(buyer.name ?? "Sem nome"),
      email: r.email || String(buyer.email ?? ""),
      telefone: r.telefone ?? extractPhone(buyer),
      produto: CHANNEL_LABEL[channel] ?? productName,
      valor: (precoC?.value as number) ?? null,
      moeda: (precoC?.currency_code as string) ?? "BRL",
      transaction,
      eraAluno: r.eraAluno,
      turma: r.turma,
    });

    return new Response(JSON.stringify({ ok: true, channel, event, ...r }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  const price = purchase.price as Record<string, unknown> | undefined;
  // Data da compra de fato (order_date) vs. data em que o pagamento foi aprovado
  // (approved_date). Divergem em boleto/pix pendente: o boleto é gerado no
  // order_date e só compensa depois, gerando o approved_date. Em cartão ficam
  // praticamente iguais. Antes o card usava só a aprovação, o que fazia um boleto
  // gerado dia 02 e pago dia 04 aparecer como "compra dia 04".
  const orderDate = Number(purchase.order_date ?? 0) || null;
  const approvedDate = Number(purchase.approved_date ?? 0) || null;
  const compraDate = orderDate ?? approvedDate;
  const isRenovacao = channel === "HM"
    && (
      productId === "3507214"
      || (purchase.is_subscription === true && Number(purchase.recurrency_number ?? 1) > 1)
    );
  const produtoLabel = isRenovacao
    ? "Holding Masters — Renovação"
    : (CHANNEL_LABEL[channel] ?? productName);

  const rawSck = extractSck(purchase);
  const origem = rawSck ? resolveOrigemLabel(rawSck) : null;

  // Endereço do comprador. Tenta vários caminhos conhecidos do payload da Hotmart.
  const { cidade, estado } = extractAddress(data, buyer, purchase);

  const telefone = extractPhone(buyer);
  // CPF/CNPJ — identidade forte que dedup usa para não criar cadastro órfão.
  const { documento, tipo: tipoDocumento } = extractDocumento(buyer);
  // Marca a Isabela apenas em compras de HT vindas de Porto Alegre (cidade ou DDD 51).
  const markPortoAlegre = channel === "HT" && isPortoAlegre(cidade, telefone);

  // Nome do comprador: o do checkout quando presta, o da conta Hotmart quando não.
  // Um só valor para o Slack e para o banco — os dois rotulavam o card com o telefone.
  const nome = await resolveNomeComprador(
    String(buyer.name ?? ""),
    String(purchase.transaction),
  ) || "Sem nome";

  // Logging diagnóstico (temporário) — sai para TODOS os canais enquanto auditamos
  // a precisão dos webhooks de evento. Remover depois que confirmarmos que tudo
  // chega correto em cada canal.
  console.log(`[DIAG ${channel}] buyer keys:`, Object.keys(buyer));
  console.log(`[DIAG ${channel}] purchase keys:`, Object.keys(purchase));
  console.log(`[DIAG ${channel}] buyer.address:`, JSON.stringify(buyer.address ?? null));
  console.log(`[DIAG ${channel}] purchase.address:`, JSON.stringify(purchase.address ?? null));
  console.log(`[DIAG ${channel}] subscriber.address:`, JSON.stringify((data?.subscriber as Record<string, unknown> | undefined)?.address ?? null));
  console.log(`[DIAG ${channel}] cidade/estado extraídos:`, cidade, "/", estado);
  console.log(`[DIAG ${channel}] telefones brutos:`, {
    checkout_phone: buyer.checkout_phone ?? null,
    phone: buyer.phone ?? null,
    phone_local_code: buyer.phone_local_code ?? null,
    phone_number: buyer.phone_number ?? null,
  }, "-> normalizado:", telefone);
  console.log(`[DIAG ${channel}] nome do checkout:`, buyer.name ?? null, "-> gravado:", nome);
  console.log(`[DIAG ${channel}] sck bruto:`, rawSck, "-> rotulado:", origem);
  console.log(`[DIAG ${channel}] productId/name:`, productId, "/", productName, "| isRenovacao:", isRenovacao);

  await notifySlack(channel, {
    nome,
    email: String(buyer.email ?? ""),
    telefone,
    produto: produtoLabel,
    valor: (price?.value as number) ?? null,
    moeda: (price?.currency_code as string) ?? "BRL",
    dataCompraMs: compraDate,
    dataAprovacaoMs: approvedDate,
    origem,
    cidade,
    estado,
    markPortoAlegre,
  });

  // [ADICIONADO] Persiste a compra aprovada no banco (compradores/compras).
  // Roda para todos os canais mapeados (base canônica é multi-produto). É a fonte
  // de contatos do workspace de CS; a esteira de CS é semeada por trigger no banco.
  const offer = purchase.offer as Record<string, unknown> | undefined;
  const payment = purchase.payment as Record<string, unknown> | undefined;
  const fullPrice = purchase.full_price as Record<string, unknown> | undefined;

  // QUAL COBRANÇA É ESTA. No Parcelado Hotmart a MESMA transação é recobrada todo
  // mês e o contador sobe — e é esse número que diz "a Marina já pagou 2 de 12".
  // O nome do campo não é confiável: `recurrency_number` veio NULO nas 258 compras
  // que temos, então ou a Hotmart não o manda aqui, ou usa outro nome. Tentamos
  // todos os que a documentação e o export sugerem, e, se nenhum vier, assumimos a
  // 1ª cobrança — que é o comportamento seguro (nunca infla o que a pessoa pagou).
  // O payload cru fica guardado em cs.hotmart_eventos: quando a próxima parcela
  // cair, `select * from cs.vw_hotmart_campos` mostra o nome certo sem adivinhação.
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  const numeroCobranca =
    num(purchase.recurrency_number)
    ?? num((purchase as Record<string, unknown>).charge_number)
    ?? num(payment?.charge_number)
    ?? num(payment?.current_installment)
    ?? num((purchase as Record<string, unknown>).installment_number)
    ?? null;

  await persistPurchase({
    nome,
    email: String(buyer.email),
    telefone,
    documento,
    tipoDocumento,
    cidade,
    estado,
    transaction: String(purchase.transaction),
    productId,
    productName,
    offerCode: offer?.code ? String(offer.code) : null,
    moeda: (price?.currency_code as string) ?? "BRL",
    valor: (price?.value as number) ?? null,
    status: String(purchase.status ?? "APPROVED"),
    isAssinatura: purchase.is_subscription === true,
    numeroRecorrencia: num(purchase.recurrency_number),
    metodoPagamento: payment?.type ? String(payment.type) : null,
    parcelas: num(payment?.installments_number),
    dataCompraIso: msToIso(Number(purchase.order_date ?? 0) || null),
    dataAprovacaoIso: msToIso(Number(purchase.approved_date ?? 0) || null),
    numeroCobranca,
    tipoCobranca: payment?.type ? String(payment.type) : null,
    // `price` é o valor SEM impostos; `full_price` é o que o cliente desembolsou
    // (com juros do parcelamento). Guardar os dois: um é receita, o outro é o que
    // o cliente jura que pagou quando liga reclamando.
    valorComImpostos: num(fullPrice?.value),
    valorLiquido: num((purchase.producer as Record<string, unknown> | undefined)?.net_value)
      ?? num((purchase as Record<string, unknown>).net_value),
    taxaProcessamento: num((purchase as Record<string, unknown>).hotmart_fee),
    canalVenda: origem ?? null,
    codigoAssinante: (purchase.subscription as Record<string, unknown> | undefined)?.subscriber_code
      ? String((purchase.subscription as Record<string, unknown>).subscriber_code) : null,
  });

  // O evento CRU, inteiro. Sem isto, todo bug de integração vira arqueologia: foi
  // não ter guardado o payload que nos deixou às cegas sobre o número da cobrança.
  await logEventoHotmart(event, String(purchase.transaction), String(buyer.email ?? ""), body);

  return new Response(JSON.stringify({ ok: true, channel }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

// Classifica a string sck bruta em rótulo legível.
// Formato sck: "s=Metaads|c=...|m=...|co=...|t=...|utm_id=..."
// ou qualquer string livre como "Comercial", "GPT Maker", etc.
function resolveOrigemLabel(sck: string): string {
  const lower = sck.toLowerCase();

  // Extrai o parâmetro s= quando presente (fonte principal)
  const sMatch = sck.match(/(?:^|[|&])s=([^|&]+)/i);
  const fonte = sMatch ? sMatch[1].trim().toLowerCase() : "";

  if (fonte === "metaads" || lower.includes("metaads") || lower.includes("meta ads") || lower.includes("facebook") || lower.includes("instagram")) {
    return "Meta Ads";
  }
  if (fonte === "google" || lower.includes("google") || lower.includes("googleads") || lower.includes("google ads")) {
    return "Google Ads";
  }
  if (lower.includes("youtube")) return "YouTube Ads";
  if (lower.includes("tiktok")) return "TikTok Ads";
  if (lower.includes("organic") || lower.includes("organico") || lower.includes("orgânico")) return "Orgânico";
  if (lower.includes("email") || lower.includes("e-mail")) return "E-mail Marketing";
  if (lower.includes("comercial") || lower.includes("vendas") || lower.includes("sdv") || lower.includes("sdr")) return "Comercial";
  if (lower.includes("gpt") || lower.includes("chatbot") || lower.includes("ia") || lower.includes("whatsapp bot")) return "GPT / Automação";
  if (lower.includes("hotmart") && (lower.includes("marketplace") || lower.includes("club"))) return "Hotmart Marketplace";
  if (lower.includes("indicacao") || lower.includes("indicação") || lower.includes("referral")) return "Indicação";
  if (lower.includes("direto") || lower.includes("direct")) return "Acesso Direto";

  // Nenhuma regra bateu — retorna a string bruta truncada para não poluir o Slack
  return sck.length > 80 ? sck.substring(0, 80) + "…" : sck;
}
