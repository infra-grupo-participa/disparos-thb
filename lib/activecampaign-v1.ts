// Cliente da API ActiveCampaign v1 (só-servidor). Companheiro de
// lib/activecampaign.ts (v3) — não substituto.
//
// POR QUE DUAS APIs. A v3 é a moderna e é o que usamos para ler (campanhas,
// contatos, engajamento) e para escrever contato/tag. Mas ela NÃO SABE disparar
// uma campanha: dá para criar a campanha e dá para criar a mensagem, e não
// existe endpoint que ligue as duas. Quem faz "escrever o corpo e mandar" é a
// v1 — legada, ainda suportada, e a única saída para disparar e-mail sem montar
// uma automação no AC a cada campanha.
//   https://www.activecampaign.com/api/overview.php
//
// Contrato: POST /admin/api.php?api_action=<acao>&api_output=json, corpo
// application/x-www-form-urlencoded, auth pelo header Api-Token. A resposta traz
// result_code (1 = ok, 0 = falha) e result_message com o motivo.
// Limite da conta: 5 requisições por segundo.
import { logger } from "@/lib/log";
import type { CanalCfg } from "@/lib/activecampaign";

const TIMEOUT_MS = 20000;
const log = logger("ac-v1");

function resolveBase(cfg?: CanalCfg): string {
  const base = cfg?.baseUrl || process.env.ACTIVECAMPAIGN_API_URL;
  if (!base) throw new Error("ActiveCampaign sem base: configure um canal (admin) ou ACTIVECAMPAIGN_API_URL");
  return base.replace(/\/+$/, "");
}

function token(cfg?: CanalCfg): string {
  const key = cfg?.apiKey || process.env.ACTIVECAMPAIGN_API_TOKEN;
  if (!key) throw new Error("ActiveCampaign sem credencial: configure um canal (admin) ou ACTIVECAMPAIGN_API_TOKEN");
  return key;
}

export type RespostaV1<T = Record<string, unknown>> = {
  ok: boolean;
  erro?: string;
  data?: T;
};

// Campos vão como form-urlencoded. Valores nulos/vazios são omitidos: o AC trata
// campo presente-e-vazio como "apagar", e não é isso que queremos.
type Campos = Record<string, string | number | undefined | null>;

async function chamar<T = Record<string, unknown>>(
  acao: string,
  campos: Campos,
  cfg?: CanalCfg,
): Promise<RespostaV1<T>> {
  const corpo = new URLSearchParams();
  for (const [k, v] of Object.entries(campos)) {
    if (v === undefined || v === null || v === "") continue;
    corpo.set(k, String(v));
  }

  try {
    const res = await fetch(`${resolveBase(cfg)}/admin/api.php?api_action=${acao}&api_output=json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Api-Token": token(cfg),
      },
      body: corpo.toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const txt = await res.text();
    let data: unknown;
    try { data = JSON.parse(txt); } catch { data = null; }

    if (!res.ok || data === null) {
      return { ok: false, erro: `HTTP ${res.status}${txt ? `: ${txt.slice(0, 200)}` : ""}` };
    }

    // A v1 responde 200 mesmo quando recusa: result_code é quem diz a verdade.
    const d = data as { result_code?: number | string; result_message?: string };
    const codigo = Number(d.result_code);
    if (codigo !== 1) {
      const erro = d.result_message || "o ActiveCampaign recusou a requisição";
      log.warn("ActiveCampaign v1 recusou", { acao, erro });
      return { ok: false, erro };
    }

    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : "erro de rede" };
  }
}

// ===== Remetente ============================================================
// O AC exige, por lei anti-spam (CAN-SPAM), quem envia e de onde: nome, e-mail,
// endereço físico e a frase que lembra o destinatário de por que ele recebe.
// Vive em cs.config (chave `email_remetente`), configurado uma vez pelo admin.
export type Remetente = {
  nome: string;
  email: string;
  url: string;        // site do remetente (sender_url)
  lembrete: string;   // "Você recebe este e-mail porque se inscreveu em..."
  endereco: string;
  cidade: string;
  estado?: string;
  cep?: string;
  pais?: string;
};

// ===== Lista ================================================================
// Uma lista por disparo. É a única forma de a campanha atingir EXATAMENTE quem o
// operador selecionou: campaign_create exige uma lista, e a API não permite
// criar segmento (só listar os que existem). Bônus: a campanha fica 1:1 com o
// disparo, então as métricas do AC já chegam separadas por disparo.
export async function criarLista(opts: {
  nome: string;
  remetente: Remetente;
  cfg?: CanalCfg;
}): Promise<RespostaV1 & { listId?: string }> {
  const { remetente: r } = opts;
  const res = await chamar<{ id?: number | string }>(
    "list_add",
    {
      name: opts.nome,
      sender_url: r.url,
      sender_reminder: r.lembrete,
      sender_name: r.nome,
      sender_addr1: r.endereco,
      sender_city: r.cidade,
      sender_state: r.estado,
      sender_zip: r.cep,
      sender_country: r.pais || "Brasil",
      // Lista técnica: não aparece nos formulários públicos de inscrição.
      private: 1,
    },
    opts.cfg,
  );
  if (!res.ok) return res;
  const listId = res.data?.id != null ? String(res.data.id) : undefined;
  if (!listId) return { ok: false, erro: "o AC criou a lista mas não devolveu o id" };
  return { ok: true, data: res.data, listId };
}

// ===== Mensagem (o corpo do e-mail) =========================================
// É aqui que o "criar o corpo e lançar" acontece: o operador escreve assunto e
// texto no nosso sistema, e isto vira a mensagem no AC. Sem automação, sem
// template pré-montado lá dentro.
export async function criarMensagem(opts: {
  assunto: string;
  html: string;
  texto: string;
  listId: string;
  remetente: Remetente;
  cfg?: CanalCfg;
}): Promise<RespostaV1 & { messageId?: string }> {
  const res = await chamar<{ id?: number | string }>(
    "message_add",
    {
      format: "mime", // manda HTML e texto puro; o cliente de e-mail escolhe
      subject: opts.assunto,
      fromname: opts.remetente.nome,
      fromemail: opts.remetente.email,
      reply2: opts.remetente.email,
      priority: 3,
      charset: "utf-8",
      encoding: "quoted-printable",
      htmlconstructor: "editor",
      html: opts.html,
      textconstructor: "editor",
      text: opts.texto,
      [`p[${opts.listId}]`]: opts.listId,
    },
    opts.cfg,
  );
  if (!res.ok) return res;
  const messageId = res.data?.id != null ? String(res.data.id) : undefined;
  if (!messageId) return { ok: false, erro: "o AC criou a mensagem mas não devolveu o id" };
  return { ok: true, data: res.data, messageId };
}

// ===== Campanha (o disparo) =================================================
// `status: 1` = agendada; com sdate = agora, o AC envia na próxima passada do
// scheduler dele (minutos). `m[messageId] = 100` = 100% do público recebe esta
// mensagem (é assim que a v1 expressa split test — aqui, sem split).
export async function criarCampanha(opts: {
  nome: string;
  listId: string;
  messageId: string;
  quando: Date;
  cfg?: CanalCfg;
}): Promise<RespostaV1 & { campaignId?: string }> {
  const res = await chamar<{ id?: number | string }>(
    "campaign_create",
    {
      type: "single",
      name: opts.nome,
      sdate: formatarData(opts.quando),
      status: 1,
      public: 0, // não publica a campanha no arquivo público
      tracklinks: "all",
      trackreads: 1,
      htmlunsub: 1, // link de descadastro obrigatório
      textunsub: 1,
      [`p[${opts.listId}]`]: opts.listId,
      [`m[${opts.messageId}]`]: 100,
    },
    opts.cfg,
  );
  if (!res.ok) return res;
  const campaignId = res.data?.id != null ? String(res.data.id) : undefined;
  if (!campaignId) return { ok: false, erro: "o AC criou a campanha mas não devolveu o id" };
  return { ok: true, data: res.data, campaignId };
}

// A v1 quer 'YYYY-MM-DD HH:MM:SS' na timezone da conta. Mandamos o horário local
// do servidor, que é o mesmo fuso da operação.
function formatarData(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
