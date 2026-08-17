import { z } from "zod";
import { NextResponse } from "next/server";

// Validação de entrada das rotas (substitui os casts `as {...}` inseguros).
// parseBody devolve os dados já tipados ou uma resposta 400 pronta.
export async function parseBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  const body = await req.json().catch(() => ({}));
  const r = schema.safeParse(body);
  if (!r.success) {
    return {
      ok: false,
      res: NextResponse.json(
        { ok: false, reason: "dados inválidos", detalhes: r.error.issues.map((i) => ({ campo: i.path.join("."), erro: i.message })) },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: r.data };
}

const id = z.string().min(1);

// ----- Período (?de=&ate=) das rotas de atividade/relatório -----
// Valida o FORMATO antes de parametrizar: data inválida viraria erro 22007 do
// Postgres (500 derrubando o painel) — aqui é 400 `data_invalida`, que é o que
// a entrada malformada merece. Regra ÚNICA para /api/atividade e
// /api/hm/atividade (o HM não validava e o ?ate=invalido estourava 500).
const DATA_ISO_RE = /^\d{4}-\d{2}-\d{2}(T[0-9:.+-]+Z?)?$/;
export function parsePeriodo(
  sp: URLSearchParams,
): { ok: true; de: string | null; ate: string | null } | { ok: false; res: NextResponse } {
  const de = sp.get("de");
  const ate = sp.get("ate");
  if ((de && !DATA_ISO_RE.test(de)) || (ate && !DATA_ISO_RE.test(ate))) {
    return { ok: false, res: NextResponse.json({ ok: false, reason: "data_invalida" }, { status: 400 }) };
  }
  return { ok: true, de, ate };
}

// ----- Granularidade (?granularidade=) das rotas de atividade (D1) -----
// FONTE ÚNICA da whitelist dia/semana/mês — antes vivia triplicada (aqui,
// lib/services/hm-atividade.ts e app/_components/atividade-colaboradores.tsx);
// as três listavam os mesmos 3 valores por conta própria, e nada garantia que
// continuassem casando se um dia alguém adicionasse um bucket (ex.: 'ano') só
// num lado. Backend e front importam `GRANULARIDADES`/`Granularidade` daqui.
export const GRANULARIDADES = ["dia", "semana", "mes"] as const;
export type Granularidade = (typeof GRANULARIDADES)[number];

// Mesma régua do parsePeriodo: valida ANTES de chegar no service — um valor
// fora da lista vira 400 aqui, não interpolação livre num date_trunc lá
// embaixo (lib/services/hm-atividade.ts). Ausente = default 'dia' (o service
// já cobre isso, mas validar aqui barra "?granularidade=lixo" de virar 'dia'
// silenciosamente — o cliente erra e é avisado, não mascarado).
export function parseGranularidade(
  sp: URLSearchParams,
): { ok: true; granularidade: Granularidade | null } | { ok: false; res: NextResponse } {
  const g = sp.get("granularidade");
  if (!g) return { ok: true, granularidade: null };
  if (!GRANULARIDADES.includes(g as Granularidade)) {
    return { ok: false, res: NextResponse.json({ ok: false, reason: "granularidade_invalida" }, { status: 400 }) };
  }
  return { ok: true, granularidade: g as Granularidade };
}

// ----- Atalho de período (?periodo=hoje|7d|30d|mes|livre&de=&ate=) de /api/hm/painel (B2) -----
// Datas aqui são calendário (YYYY-MM-DD), sempre INCLUSIVAS dos dois lados — diferente de
// parsePeriodo (de/ate em timestamptz, semiaberto), porque o painel soma "período anterior"
// contando dias de calendário, não timestamps. "livre" exige de/ate válidos e de <= ate; os
// atalhos ignoram de/ate se vierem (o service resolve a janela sozinho).
const DATA_DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
export const PERIODOS_ATALHO = ["hoje", "7d", "30d", "mes", "livre"] as const;
export type PeriodoAtalho = (typeof PERIODOS_ATALHO)[number];

export function parsePeriodoAtalho(
  sp: URLSearchParams,
): { ok: true; periodo: PeriodoAtalho; de: string | null; ate: string | null } | { ok: false; res: NextResponse } {
  const p = sp.get("periodo") || "30d";
  if (!PERIODOS_ATALHO.includes(p as PeriodoAtalho)) {
    return { ok: false, res: NextResponse.json({ ok: false, reason: "periodo_invalido" }, { status: 400 }) };
  }
  const de = sp.get("de");
  const ate = sp.get("ate");
  if (p === "livre") {
    if (!de || !ate || !DATA_DIA_RE.test(de) || !DATA_DIA_RE.test(ate) || de > ate) {
      return {
        ok: false,
        res: NextResponse.json({ ok: false, reason: "periodo_livre_exige_de_e_ate_validos" }, { status: 400 }),
      };
    }
  }
  return {
    ok: true,
    periodo: p as PeriodoAtalho,
    de: de && DATA_DIA_RE.test(de) ? de : null,
    ate: ate && DATA_DIA_RE.test(ate) ? ate : null,
  };
}

export const AuthSchema = z.object({
  email: z.string().trim().min(1).email(),
  senha: z.string().min(1),
});

// ----- Usuários (gestão por admin + perfil) -----
const senhaForte = z.string().min(6, "mínimo de 6 caracteres");

export const UsuarioCriarSchema = z.object({
  nome: z.string().trim().min(2),
  email: z.string().trim().email(),
  senha: senhaForte,
  papel: z.enum(["admin", "disparador", "operador"]).default("operador"),
});

export const UsuarioPatchSchema = z.object({
  nome: z.string().trim().min(2).optional(),
  papel: z.enum(["admin", "disparador", "operador"]).optional(),
  ativo: z.boolean().optional(),
  // GERENTE DISTRIBUIDOR (11/08): existia só como coluna, ligada na mão por SQL
  // no dia em que a Kelly precisou. Poder que só se concede por migration não é
  // regra do sistema — é exceção que ninguém audita. Agora é campo da tela de
  // Contas, master-only como o resto do PATCH.
  gerente_distribuidor: z.boolean().optional(),
});

// Portais que a conta pode acessar (0145) — a whitelist inteira de uma vez.
export const UsuarioPortaisSchema = z.object({
  // "CNHF" saiu do enum em 10/08/2026 (ver lib/marcas.ts). A migration 0170
  // limpou a whitelist das 16 contas que o tinham — sem isso, salvar qualquer
  // uma delas passaria a ser recusado aqui.
  portais: z.array(z.enum(["HT", "SEM", "HM", "AURUM", "ETHB"])),
});

// Cor em hex (#rrggbb) — usada por equipes (0140) e pelo catálogo de tags.
const corHex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "cor em hex (#rrggbb)");

// ----- Equipes (HM, 0140) -----
export const EquipeCriarSchema = z.object({
  nome: z.string().trim().min(2),
  cor: corHex.default("#64748b"),
});
export const EquipePatchSchema = z.object({
  nome: z.string().trim().min(2).optional(),
  cor: corHex.optional(),
  ativo: z.boolean().optional(),
});
export const EquipeMembroSchema = z.object({
  usuario_id: z.string().uuid(),
  acao: z.enum(["vincular", "remover"]).default("vincular"),
  papel: z.enum(["admin", "disparador", "operador"]).optional(),
  // Líder/ADM da própria equipe (0143): distribui dentro da equipe.
  lider_equipe: z.boolean().optional(),
});
export const EquipeRotaSchema = z.object({
  canal: z.string().trim().min(1),
  equipe_id: z.string().uuid().nullable(),
});

// Equipe padrão p/ novas vendas HM (0146) — para onde toda venda nova é
// carimbada na criação. null = volta ao pool (comportamento anterior).
export const EquipePadraoSchema = z.object({
  equipe_id: z.string().uuid().nullable(),
});

// Canal → pessoa (0154): o operador cuida de um canal (vê E age nos cards dele).
export const UsuarioCanalSchema = z.object({
  usuario_id: z.string().uuid(),
  canal: z.string().trim().min(1),
  acao: z.enum(["vincular", "remover"]).default("vincular"),
});

// Troca de senha: admin reseta (só novaSenha) ou o próprio usuário troca
// (atualSenha + novaSenha — validado na rota).
export const SenhaSchema = z.object({
  atualSenha: z.string().optional(),
  novaSenha: senhaForte,
});

export const SendSchema = z.object({
  templateId: id,
  compradorIds: z.array(id).min(1),
  edicao: z.string().optional(),
  // Passar por cima do limite diário/hora (anti-ban). Só o admin consegue — a
  // rota confere o papel; aqui é só a intenção.
  forcar: z.boolean().optional(),
});

// ----- Canais de disparo (credencial de API por evento, admin) -----
export const CanalCriarSchema = z.object({
  evento_chave: z.string().trim().min(1),
  nome: z.string().trim().min(2),
  provider: z.string().trim().min(1).default("unnichat"),
  api_key: z.string().trim().min(1),
  base_url: z.string().trim().url().optional().or(z.literal("")),
  numero: z.string().trim().optional(),
});

export const CanalPatchSchema = z.object({
  nome: z.string().trim().min(2).optional(),
  api_key: z.string().trim().min(1).optional(),
  base_url: z.string().trim().optional(),
  numero: z.string().trim().optional(),
  ativo: z.boolean().optional(),
});

export const InboxMsgSchema = z.object({ texto: z.string().trim().min(1), atendente: z.string().optional() });
export const InboxStatusSchema = z.object({ status: z.enum(["resolvido", "pendente"]) });

// Data de FORMULÁRIO (YYYY-MM-DD): valida o formato antes do ::date do
// Postgres (22007 viraria 500); "" e null limpam o campo.
const dataCampo = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "data em YYYY-MM-DD"), z.literal(""), z.null()]);

export const ContatoPatchSchema = z.object({
  estagio_chave: z.string().optional(),
  proxima_acao_em: z.string().nullable().optional(),
  proxima_acao_nota: z.string().nullable().optional(),
  observacoes: z.string().nullable().optional(),
  nota: z.string().optional(),
  tags: z.array(z.string()).optional(),
  responsavel: z.string().nullable().optional(),
  opt_out: z.boolean().optional(),
  // ----- Acordo e crédito (0149 — espelham a nomenclatura do HM/0056) -----
  // Contrato completo documentado no comentário de app/api/contato/[id]/route.ts.
  acordo: z.string().nullable().optional(),
  pagamento_previsto_em: dataCampo.optional(),
  credito_oferta: z.string().nullable().optional(),
  credito_compra_em: dataCampo.optional(),
  credito_valor_pago: z.number().nonnegative().nullable().optional(),
});

// Registro de atendimento do operador. Vale para qualquer canal — o que o funil
// precisa saber é que houve um toque e o que saiu dele, não o meio.
// `operador` NÃO entra aqui de propósito: vem da sessão, na rota. Aceitar do
// cliente deixaria qualquer um assinar o atendimento com o nome de outro.
export const AtendimentoRegistrarSchema = z.object({
  compradorId: id,
  telefone: z.string().trim().min(1),
  canal: z.enum(["ligacao", "whatsapp", "presencial", "outro"]).default("ligacao"),
  resultado: z.enum(["atendeu", "nao_atendeu", "caixa_postal", "ocupado", "numero_errado"]).optional(),
  duracaoSeg: z.number().int().nonnegative().optional(),
  anotacao: z.string().trim().optional(),
  retornoEm: z.string().nullable().optional(),
});

export const KanbanMoverSchema = z.object({ compradorId: id, estagioChave: z.string().min(1) });

// ----- Holding Masters (módulo de ativação, evento HM) -----
// `antesDe` posiciona o card na vertical da coluna: é o comprador_id do card que
// deve ficar logo abaixo dele, ou null para o fim da fila. Âncora, e não índice,
// porque o board pode estar filtrado — "antes do João" vale na coluna inteira, o
// índice 3 da tela não. Campo ausente = sem gesto de posição (o card vai ao topo).
export const HmMoverSchema = z.object({
  compradorId: id,
  estagioChave: z.string().min(1),
  antesDe: id.nullable().optional(),
});

// Cadastro manual na esteira HM. O e-mail é obrigatório de propósito: é a chave
// que casa com o que o webhook da Hotmart já gravou (evita criar um comprador
// duplicado de alguém que a Hotmart mandou com outra grafia de nome). O resto é
// opcional — o operador registra com o que tem na mão e completa depois na ficha.
export const HmCadastroSchema = z.object({
  nome: z.string().trim().min(1, "informe o nome"),
  email: z.string().trim().min(1, "informe o e-mail").email("e-mail inválido"),
  telefone: z.string().trim().optional(),
  documento: z.string().trim().optional(),
  turma: z.string().trim().optional(),
  categoria: z.enum(["sinal", "compra_cheia"]).nullable().optional(),
  responsavel: z.string().trim().nullable().optional(),
  // Onde alocar. Padrão no serviço: "Contato Inicial" do comercial (a entrada do
  // funil). Restrito às duas entradas que fazem sentido para um cadastro novo.
  estagio_chave: z.enum(["hm_comprou", "hm_pendente_liberacao"]).optional(),
  // Board em que o card nasce (0155): HM (default), AURUM ou ETHB.
  produto: z.enum(["HM", "AURUM", "ETHB"]).optional(),
});

export const HmContatoPatchSchema = z.object({
  estagio_chave: z.string().optional(),
  responsavel: z.string().nullable().optional(),
  // Responsável por ID (equipes): "Assumir para mim" / devolver ao pool (null) /
  // reatribuir. Prioritário sobre `responsavel` texto quando ambos vierem.
  responsavel_id: z.string().uuid().nullable().optional(),
  // Responsável da ATIVAÇÃO (pedido do Marcio, 12/08): "assumir a ativação" —
  // o operador da Ativação toma posse daquele card ESPECIFICAMENTE na aba dele,
  // sem mexer no operador vigente (`responsavel_id`) nem no comercial (imutável,
  // trigger 0212). Distinto de `responsavel_ativacao` (texto, só leitura hoje —
  // ver o comentário completo em app/api/hm/contato/[id]/route.ts). null limpa
  // (devolve o card de ativação ao "sem dono de ativação").
  responsavel_ativacao_id: z.string().uuid().nullable().optional(),
  observacoes: z.string().nullable().optional(),
  nota: z.string().optional(),
  tags: z.array(z.string()).optional(),
  plano: z.string().nullable().optional(),
  reuniao_em: z.string().nullable().optional(),
  reuniao_resultado: z.string().nullable().optional(),
  reuniao_gravacao_url: z.string().nullable().optional(),
  entrevista_em: z.string().nullable().optional(),
  entrevista_resultado: z.string().nullable().optional(),
  entrevista_gravacao_url: z.string().nullable().optional(),
  // ----- agendamento / reagendamento -----
  // Mudar reuniao_em/entrevista_em quando já havia data É um reagendamento: o
  // motivo explica por que a marcação anterior caiu, e o histórico guarda as duas.
  agendamento_motivo: z.string().nullable().optional(),
  // Fecha a marcação vigente (o que aconteceu com ela).
  agendamento_tipo: z.enum(["reuniao", "entrevista"]).optional(),
  agendamento_status: z.enum(["realizado", "nao_compareceu", "cancelado"]).optional(),
  // ----- gesto "sinalizei que enviei a mensagem" (D1) -----
  // true = o operador confirma que já mandou a primeira abordagem. Carimba
  // contato_inicial_em e, se o card estiver em "Contato Inicial", avança
  // para "Aguardando Retorno" (lib/services/hm.ts). Não aceita `false`: não
  // existe "desfazer o sinal" pela ficha — é um carimbo de fato, não um
  // toggle (mesmo espírito de link_saldo_enviado).
  contato_inicial_sinalizado: z.literal(true).optional(),
  // ----- desfecho comercial da reunião (D2) -----
  // Declaração comercial, irmã de `acordo` — NUNCA dado de pagamento (ver
  // pagamento_so_hotmart no topo da rota). null limpa.
  intencao_pagamento: z.enum(["vai_pagar", "indeciso", "nao_vai_pagar"]).nullable().optional(),
  intencao_pagamento_obs: z.string().nullable().optional(),
  // ----- acordo do saldo (o que o comercial combina com o aluno) -----
  pagamento_meio: z.enum(["boleto", "cartao", "cartao_recorrente", "pix", "avista"]).nullable().optional(),
  pagamento_previsto_em: z.string().nullable().optional(),   // "vai pagar dia 17"
  acordo: z.string().nullable().optional(),                  // o combinado, em texto
  oferta_saldo_codigo: z.string().nullable().optional(),     // link de saldo escolhido
  link_saldo_enviado: z.boolean().optional(),                // marca/desmarca o envio (carimba a hora)
  // Saldo a pagar informado pelo Victor (0151). null limpa e volta ao pró-rata.
  saldo_a_pagar_manual: z.number().nonnegative().nullable().optional(),
  // ----- travas operacionais -----
  nao_contatar: z.boolean().optional(),
  nao_contatar_motivo: z.string().nullable().optional(),
  revisar: z.boolean().optional(),
  revisar_motivo: z.string().nullable().optional(),
  // ----- checklist de ativação (trava a saída de "Acesso Liberado") -----
  ativ_searchie: z.boolean().optional(),
  ativ_comunidade: z.boolean().optional(),
  ativ_grupo: z.boolean().optional(),
  ativ_pesquisa: z.boolean().optional(),
  grupo_informes: z.string().nullable().optional(),          // qual grupo ("THB #27")
  pendencia: z.string().nullable().optional(),
  // ----- cancelamento -----
  cancelamento_motivo: z.string().nullable().optional(),
  // Valor financeiro do cancelamento (0152): a reembolsar/reter. null limpa.
  cancelamento_valor: z.number().nonnegative().nullable().optional(),
  // Arrastar o card para "Solicitou Cancelamento" é o PEDIDO. Estas duas ações
  // são o FATO: confirmar (o reembolso saiu) marca o aluno como cancelado e abre
  // a pendência de remover os acessos; desfazer volta atrás (reembolso negado).
  confirmar_cancelamento: z.boolean().optional(),
  desfazer_cancelamento: z.boolean().optional(),
  // ----- revogação de acessos (o cancelado ainda está dentro de tudo) -----
  rev_searchie: z.boolean().optional(),
  rev_comunidade: z.boolean().optional(),
  rev_grupo: z.boolean().optional(),
  rev_pesquisa: z.boolean().optional(),
  link_facebook: z.string().nullable().optional(),
  // turma do aluno NO HM (a atual, T39 por padrão) — editável para exceções
  turma: z.string().nullable().optional(),
  // ----- crédito pró-rata (insumos; o crédito é calculado) -----
  credito_oferta: z.string().nullable().optional(),
  credito_compra_em: z.string().nullable().optional(),
  credito_valor_pago: z.number().nonnegative().nullable().optional(),
  credito_dias_totais: z.number().int().positive().nullable().optional(),
  // Motivo do pró-rata manual (F4) — por que este valor/data, em texto livre. O
  // crédito em si é CALCULADO (fn_hm_prorata); isto é só a justificativa que o
  // operador digita para o número não ficar "confia em mim" (mesmo padrão de
  // cs.aurum_pagamento_aluno.obs/excecao_motivo, lidos em hm-ficha.ts).
  credito_obs: z.string().nullable().optional(),
  // atalho de pagamento do saldo (14.700) — dispara a ida para a Ativação e o
  // provisionamento do aluno na base THB (os valores viram o bloco financeiro)
  pagamento_forma: z.enum(["avista", "parcelado"]).optional(),
  pagamento_parcelas: z.number().int().positive().nullable().optional(),
  valor_total: z.number().nonnegative().nullable().optional(),
  valor_pago: z.number().nonnegative().nullable().optional(),
  marcar_pagamento: z.boolean().optional(),
  // desfazer o último movimento de etapa (miss click)
  reverter: z.boolean().optional(),
  // desfazer a última EDIÇÃO de campo da ficha — atalho para recuperar a versão
  // mais recente. Distinto de `reverter`, que é o movimento de etapa.
  desfazer_edicao: z.boolean().optional(),
  // recuperar uma versão específica do histórico (0097) — o id da versão.
  restaurar_versao: z.number().int().positive().optional(),
});
// ----- Sócios do HM (aba "SÓCIOS T39") -----
// O sócio tem checklist próprio: ele também é ativado, pendurado no titular.
//
// 0263: CPF e endereço entraram porque o webhook do Respondi passou a mandar o
// formulário de sócios (esses campos já existem em cs.hm_socios desde a 0201).
// CPF sempre OPCIONAL, nunca obrigatório — tornar obrigatório quebraria o
// cadastro rápido pela ficha (em uso; hoje são 15 sócios com 0 CPF justamente
// porque não havia campo). A escrita de fato é feita por cs.fn_hm_socio_upsert,
// que é quem decide identidade (CPF > e-mail) — este schema só valida formato.
export const HmSocioCriarSchema = z.object({
  nome: z.string().trim().min(2),
  email: z.string().trim().email().nullable().optional().or(z.literal("")),
  telefone: z.string().trim().nullable().optional(),
  cpf: z.string().trim().nullable().optional(),
  cep: z.string().trim().nullable().optional(),
  cidade: z.string().trim().nullable().optional(),
  estado: z.string().trim().nullable().optional(),
  bairro: z.string().trim().nullable().optional(),
  pais: z.string().trim().nullable().optional(),
  endereco: z.string().trim().nullable().optional(),
  numero: z.string().trim().nullable().optional(),
  complemento: z.string().trim().nullable().optional(),
  observacao: z.string().trim().nullable().optional(),
});

export const HmSocioPatchSchema = z.object({
  socioId: id,
  nome: z.string().trim().min(2).optional(),
  email: z.string().trim().nullable().optional(),
  telefone: z.string().trim().nullable().optional(),
  // 0263: opcional, sempre — mesma regra do schema de criação.
  cpf: z.string().trim().nullable().optional(),
  link_facebook: z.string().nullable().optional(),
  ativ_searchie: z.boolean().optional(),
  ativ_comunidade: z.boolean().optional(),
  ativ_grupo: z.boolean().optional(),
  // Estágio próprio do sócio (0150): arrastar o card para uma coluna da Ativação.
  // "" / null volta ao modo derivado (coluna calculada pelos 3 acessos).
  estagio_chave: z.string().nullable().optional(),
});

export const KanbanLoteSchema = z.object({
  compradorIds: z.array(id).min(1),
  addTag: z.string().optional(),
  responsavel: z.string().nullable().optional(),
});

// Ações em massa da tabela HM. Só entra aqui o que é seguro aplicar a vários de
// uma vez: responsável, etapa (que passa pelo serviço — a trava do checklist
// vale para cada um), itens do checklist e o carimbo do link do saldo.
// Pagamento e cancelamento ficam de fora de propósito: têm consequência na base
// mestre (matrícula do GPS) e exigem a confirmação da ficha, um por um.
export const HmLoteSchema = z.object({
  compradorIds: z.array(id).min(1),
  responsavel: z.string().nullable().optional(),
  estagio_chave: z.string().min(1).optional(),
  ativ_searchie: z.boolean().optional(),
  ativ_comunidade: z.boolean().optional(),
  ativ_grupo: z.boolean().optional(),
  ativ_pesquisa: z.boolean().optional(),
  // marca/desmarca o envio do link — carimba a HORA em cada um (não um booleano)
  link_saldo_enviado: z.boolean().optional(),
  // tags livres (criar = digitar um nome novo). Tags de turma/origem são
  // gerenciadas pelo sistema e o serviço recusa — ver RE_TAG_GERENCIADA em hm.ts.
  addTag: z.string().trim().min(1).optional(),
  removeTag: z.string().trim().min(1).optional(),
});

// ----- Catálogo de tags do HM (cs.tags, 0067) — corHex definido acima -----
export const HmTagCriarSchema = z.object({
  nome: z.string().trim().min(2).max(40),
  cor: corHex.nullable().optional(),
});

// As 6 categorias do CHECK de cs.tags/cs.tag_categoria (migration 0206) — a
// MESMA lista, literal, dos dois lados. Nunca aceitar string crua aqui: um
// valor fora da whitelist passaria no parseBody e estouraria o CHECK do
// Postgres lá na frente, virando 500 (erro interno vazando) em vez do 400
// que a validação deveria ter barrado antes de chegar no banco.
const categoriaTagHm = z.enum(["publico", "canal", "turma", "origem_base", "produto", "operacional"]);

// Renomear/recolorir/descrever/recategorizar. Renomear propaga para todos os
// cards — a rota exige admin.
//
// ⚠️ z.object (não-strict) DESCARTA chave desconhecida em vez de rejeitar —
// foi exatamente isso que perdeu o dado do usuário nesta leva: o front mandava
// `descricao`, o schema só conhecia `nome`/`cor`, a chave sumia no parse, o
// handler não entrava em nenhum `if`, e a rota respondia {ok:true} para um
// PATCH que não tinha feito NADA. Sucesso mentiroso — a lição é que todo campo
// editável pela tela precisa ter uma linha aqui, senão o parse é quem apaga
// silenciosamente o que o usuário digitou.
export const HmTagPatchSchema = z.object({
  nome: z.string().trim().min(2).max(40).optional(),
  cor: corHex.nullable().optional(),
  // Limpar a descrição é gesto legítimo (o admin quer remover uma explicação
  // desatualizada) — string vazia é normalizada para null no service, não
  // fica sobrando "" no banco. Teto de 500: é texto de apoio para quem olha o
  // card sem contexto, não um campo de redação.
  descricao: z.string().trim().max(500).nullable().optional(),
  // Editável pela tela (decisão do usuário, 12/08): tag nova nasce
  // 'operacional' em criarTagHm, e o admin recategoriza na hora se precisar —
  // sem depender de deploy/migration para corrigir a família de uma tag.
  categoria: categoriaTagHm.nullable().optional(),
});

// ----- Edição administrativa (só admin) -----
// Identidade se corrige na FONTE (public.compradores, via fn definer) e espelha
// na base THB; financeiro refaz o saldo; datas ajustam histórico errado.
export const HmAdminEditSchema = z.object({
  nome: z.string().trim().min(2).optional(),
  email: z.string().trim().email().optional(),
  telefone: z.string().trim().min(8).optional(),
  valor_total: z.number().nonnegative().optional(),
  valor_pago: z.number().nonnegative().optional(),
  pagamento_em: z.string().nullable().optional(),
  cancelamento_em: z.string().nullable().optional(),
  turma_origem: z.string().trim().nullable().optional(),
});

// ----- Catálogo de ofertas (0255/0256/0257, master-only) -----
// PATCH só toca colunas DESCRITIVAS — a régua financeira (pacote_cheio,
// entrada_condicao_fechada, entrada_do_programa, concede_trilha, categoria)
// nem existe neste schema: quem chama não tem como pedir para mudá-la, o
// mesmo desenho de cs.fn_hm_catalogo_atualizar (0255).
export const HmOfertaPatchSchema = z.object({
  offer_code: z.string().trim().min(1),
  patch: z.object({
    nome_comercial: z.string().trim().max(200).nullable().optional(),
    valor_tabela: z.number().positive().nullable().optional(),
    explicacao: z.string().trim().max(2000).nullable().optional(),
    link: z.string().trim().max(500).startsWith("https://").nullable().optional(),
    produto_checkout: z.string().trim().max(60).nullable().optional(),
    dono_email: z.string().trim().email().nullable().optional(),
    recorrente: z.boolean().optional(),
    ativo: z.boolean().optional(),
    papel: z.enum([
      "entrada", "saldo", "pacote_cheio", "renovacao", "ingresso",
      "upgrade_ingresso", "transmissao", "acordo_individual",
    ]).nullable().optional(),
  }).refine((p) => Object.keys(p).length > 0, "patch vazio não muda nada"),
});

// Uma linha da planilha, já parseada pelo CLIENTE (upload/CSV) — o backend
// classifica (motivo_quarentena) e insere em staging; nunca escreve direto no
// catálogo. Teto de 2000 linhas no array (abaixo, na rota) — planilha real
// tem 65; CSV de 50MB não passa disso sem já ter estourado o body parser.
export const HmOfertaImportarLinhaSchema = z.object({
  linha_num: z.number().int().nonnegative(),
  produto_txt: z.string().trim().max(400).nullable().optional(),
  nome_txt: z.string().trim().max(400).nullable().optional(),
  valor_txt: z.string().trim().max(200).nullable().optional(),
  explicacao_txt: z.string().trim().max(4000).nullable().optional(),
  nome_hotmart_txt: z.string().trim().max(4000).nullable().optional(),
  offer_code: z.string().trim().max(60).nullable().optional(),
  link: z.string().trim().max(500).nullable().optional(),
});
export const HmOfertaImportarSchema = z.object({
  arquivo: z.string().trim().min(1).max(200),
  linhas: z.array(HmOfertaImportarLinhaSchema).min(1).max(2000),
});

export const HmOfertaPromoverSchema = z.object({
  staging_ids: z.array(z.number().int().positive()).min(1).max(500),
});
