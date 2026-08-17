"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, cn, fieldClass, Spinner } from "@/app/_components/ui";
import { corAvatar, inicial, Avatar } from "@/app/_components/avatar";
import { DisparoModal } from "@/app/_components/disparo";
import { TagChip } from "@/app/_components/tags";
import { ContatoDoNome } from "@/app/_components/copiavel";
import { TagPicker, type TagOpcao } from "@/app/hm/_components/tag-picker";
import { useMe, msgErroPermissao } from "@/app/_components/use-me";
import { SeloEquipe } from "@/app/hm/_components/selo-equipe";
import { origemRecompra, SeloRecompra, ehAlunoAntigo, SeloAlunoAntigo, SeloSemOperador, faltaExplicarCredito } from "@/app/hm/_components/card-sinais";
import { useProdutoHm } from "@/app/hm/_components/use-produto";
// A cor da marca de cada portal — a MESMA que o operador vê no topo da tela.
import { PORTAIS, type PortalId } from "@/lib/marcas";

type Estagio = { chave: string; nome: string; aba: string | null };
type Contato = {
  comprador_id: string; nome: string; email: string | null; telefone: string | null;
  turma: string | null; turma_origem: string | null; plano: string | null; categoria_entrada: string | null;
  estagio_chave: string | null; estagio_nome: string | null; estagio_aba: string | null; responsavel: string | null;
  // Dono por id + trava do admin (0142) — decidem o que o OPERADOR pode fazer
  // com a atribuição. Opcionais: a rota pode ainda não devolvê-los (em voo).
  responsavel_id?: string | null; atribuicao_admin?: boolean;
  // 13/08: usado no bloco "esta pessoa em cada portal" para dizer se ela já
  // virou aluno na base NESTE portal. A ficha (hm-ficha.ts) já devolve k.aluno_id.
  aluno_id?: string | null;
  // Equipe dona do card (0140/0146) — a ficha (hm-ficha.ts) já devolve.
  equipe_id?: string | null; equipe_nome?: string | null; equipe_cor?: string | null;
  // DUPLO RESPONSÁVEL (0211/0212, 12/08): dono POR ABA, carimbado uma vez ao
  // ENTRAR nela e mantido depois — histórico, não "quem está mexendo agora"
  // (isso é `responsavel`/`responsavel_id`, o campo VIGENTE, inalterado).
  // Comercial é IMUTÁVEL depois de gravado (trigger fn_hm_congela_comercial,
  // errcode restrict_violation) — "quem fechou a venda; não muda nem para o
  // master". Ativação segue as regras normais de atribuição. Opcionais: a
  // rota pode ainda não devolvê-los (backend subindo em paralelo).
  responsavel_comercial_id?: string | null; responsavel_comercial?: string | null;
  responsavel_ativacao_id?: string | null; responsavel_ativacao?: string | null;
  reuniao_em: string | null; reuniao_resultado: string | null; reuniao_gravacao_url: string | null;
  entrevista_em: string | null; entrevista_resultado: string | null; entrevista_gravacao_url: string | null;
  pagamento_em: string | null; pagamento_forma: string | null; apto_ativacao: boolean; tags: string[] | null;
  // acordo do saldo
  pagamento_meio: string | null; pagamento_previsto_em: string | null; acordo: string | null;
  oferta_saldo_codigo: string | null; link_saldo_enviado_em: string | null;
  // Motivo do crédito pró-rata (novo campo, cs.contatos_hm.credito_obs): o
  // pró-rata é calculado à mão (planilha do Victor / analista) — este texto
  // explica POR QUE aquele aluno tem aquele crédito. Opcional: a rota pode
  // ainda não devolvê-lo (backend subindo em paralelo).
  credito_obs?: string | null;
  // travas
  nao_contatar: boolean; nao_contatar_motivo: string | null;
  revisar: boolean; revisar_motivo: string | null;
  // ativação
  ativ_searchie: boolean; ativ_comunidade: boolean; ativ_grupo: boolean; ativ_pesquisa: boolean;
  grupo_informes: string | null; pendencia: string | null; link_facebook: string | null;
  cancelamento_em: string | null; cancelamento_motivo: string | null; cancelamento_valor: string | null;
  // cancelamento: o pedido (cancelamento_em) e o fato (cancelamento_efetivado_em)
  cancelamento_efetivado_em: string | null; cancelamento_origem: string | null;
  // …e o fato pelos olhos da HOTMART (0091). Só o webhook escreve nestes.
  hotmart_cancelado_em: string | null;
  hotmart_cancelamento_evento: string | null;
  hotmart_cancelamento_transacao: string | null;
  rev_searchie: boolean; rev_comunidade: boolean; rev_grupo: boolean; rev_pesquisa: boolean;
  acessos_revogados_em: string | null; acessos_revogados_por: string | null;
};

// Reembolso, chargeback e protesto acabam todos em "aluno sem acesso", mas são
// coisas muito diferentes para o financeiro: um é devolução combinada, o outro é
// o cliente contestando na operadora do cartão.
const EVENTO_HOTMART: Record<string, string> = {
  PURCHASE_REFUNDED: "reembolso",
  PURCHASE_CHARGEBACK: "chargeback (contestou na operadora)",
  PURCHASE_PROTEST: "compra protestada",
  PURCHASE_CANCELED: "compra cancelada",
  SUBSCRIPTION_CANCELLATION: "assinatura cancelada",
};
type Interacao = { tipo: string; descricao: string | null; autor: string | null; criado_em: string };
// Marcação de reunião/entrevista. `status` conta a história: a vigente é
// "agendado"; as que caíram viram "reagendado" (com motivo), "nao_compareceu"
// (o no-show, que é o dado que a operação não tinha) ou "cancelado".
type Agendamento = {
  tipo: "reuniao" | "entrevista";
  quando: string;
  status: "agendado" | "reagendado" | "realizado" | "nao_compareceu" | "cancelado";
  motivo: string | null;
  autor: string | null;
  criado_em: string;
};
// numeric do Postgres chega como string no driver pg — normalize antes de somar.
type Financeiro = {
  valor_total: string | null; valor_pago: string | null; aluno_id: string | null;
  categoria_entrada: string | null; sugestao_valor_total: string | null; hotmart_bruto: string | null;
  // Saldo a pagar informado pelo Victor (0151) — vence o pró-rata quando preenchido.
  saldo_a_pagar_manual: string | null; saldo_a_pagar_manual_por: string | null; saldo_a_pagar_manual_em: string | null;
  /** quitado · mensalidade_em_curso · oferta_enviada · saldo_parado · incalculavel · cancelado (0165) */
  situacao: string | null;
  // 0185: a conta aberta do saldo. `saldo_a_perseguir` e a regua VIVA (pacote da
  // oferta de entrada - entrada paga - credito pro-rata, com o cravado tendo
  // precedencia) e deve vencer `prorata.saldo_a_pagar`, que ainda tem o 14.700
  // cravado e erra em quem entrou pela oferta de R$ 697.
  saldo_a_perseguir: string | null; pacote_regra: string | null;
  pago: string | null; credito: string | null;
};
type Prorata = {
  dias_usados: number; dias_restantes: number; valor_dia: string | null;
  consumido: string | null; credito: string | null; saldo_a_pagar: string | null;
};
type LinkSaldo = { codigo: string; valor: string; recorrente: boolean; link: string };
// HISTÓRICO FINANCEIRO (12/08) — uma linha da razão (`cs.hm_pagamentos`).
// Já vem filtrado por produto pela ficha: o card do HM nunca mostra o dinheiro
// do Aurum. `valor` chega como string (numeric do Postgres).
type Pagamento = {
  categoria: string | null; valor: string | null; pago_em: string | null;
  origem: string | null; transacao: string | null; oferta_codigo: string | null;
  metodo_pagamento: string | null; parcela: number | null; obs: string | null; autor: string | null;
};
// Categoria em português de gente. O banco fala `diferenca`/`compra_cheia`; o
// operador não. Cair no próprio código quando for categoria nova é melhor que
// esconder a linha — dinheiro sem rótulo ainda é dinheiro que entrou.
const ROTULO_CATEGORIA: Record<string, string> = {
  sinal: "Entrada (sinal)",
  saldo: "Pagamento do saldo",
  diferenca: "Pagamento do saldo",
  compra_cheia: "Compra à vista (valor cheio)",
  mensalidade: "Mensalidade",
  entrada: "Entrada",
  renovacao: "Renovação",
};
const ROTULO_METODO: Record<string, string> = {
  PIX: "Pix",
  CREDIT_CARD: "Cartão de crédito",
  BILLET: "Boleto",
  HYBRID: "Pagamento híbrido (cartão + outro)",
  HOTMART_INSTALLMENTS: "Parcelado pela Hotmart",
  PAYPAL: "PayPal",
};
// Saldo do Aurum ETHB SP (0158): crédito pró-rata calculado FORA do banco (planilha
// do Victor) e ingerido. `saldo_a_pagar` vem null nas exceções (gratuidade,
// cancelado, em revisão) — nesse caso mostra-se o rótulo, nunca um valor.
// A mesma pessoa em OUTRO board (0164). No card é um selo de uma linha; aqui vem
// completo, porque é o que muda a conversa: etapa, dono, se pagou, se virou aluno.
type OutroPortal = {
  outro_produto: string;
  outro_estagio: string | null;
  outro_aba: string | null;
  outro_apto: boolean;
  outro_pagamento_em: string | null;
  outro_tem_matricula: boolean;
  outro_responsavel: string | null;
  outro_atualizado_em: string | null;
  comprador_id: string;
};
type AurumSaldoDrawer = {
  credito: string | null;
  situacao: string;
  excecao: boolean;
  excecao_motivo: string | null;
  obs: string | null;
  ultima_oferta: string | null;
  pacote_cheio: string;
  entrada_paga: string;
  base_saldo: string;
  saldo_a_pagar: string | null;
  rotulo_operador: string;
};
// O sócio tem checklist próprio — ele também é ativado, pendurado no titular.
// `aluno_id` preenchido = já foi provisionado na base THB.
type Socio = {
  id: string; nome: string; email: string | null; telefone: string | null; link_facebook: string | null;
  ativ_searchie: boolean; ativ_comunidade: boolean; ativ_grupo: boolean; aluno_id: string | null;
};
// Sócio anterior deste titular (17/08, webhook do Respondi): quem saiu e
// quando — a view cs.vw_hm_socios_historico_titular já filtra por card; a
// ficha só lê o que já não é o vigente (o backend só devolve os arquivados).
// Sem CPF: a ficha não expõe documento de sócio que já saiu.
type SocioAnterior = { nome: string; criado_em: string; substituido_em: string };

// Resultado da reunião comercial — os mesmos estados que a planilha usava, agora
// como campo (e não texto solto misturado com a data).
const RESULTADOS = ["Aguardando retorno", "Agendada", "Realizada", "Realizada/pago", "Reagendar", "Não respondeu"];

const MEIOS: { v: string; label: string }[] = [
  { v: "avista", label: "À vista" },
  { v: "pix", label: "Pix" },
  { v: "boleto", label: "Boleto parcelado" },
  { v: "cartao", label: "Cartão" },
  { v: "cartao_recorrente", label: "Cartão recorrente" },
];

const ITENS_CHECKLIST: { campo: keyof Contato; label: string }[] = [
  { campo: "ativ_searchie", label: "Acesso ao Searchie/Óbvio" },
  { campo: "ativ_comunidade", label: "Acesso à comunidade THB" },
  { campo: "ativ_grupo", label: "Grupo de informes" },
  { campo: "ativ_pesquisa", label: "Pesquisa" },
];

// O avesso do checklist acima: cancelou, alguém tem de TIRAR a pessoa de cada
// lugar em que ela foi posta. Um a um, porque é item a item que se esquece —
// sai do Searchie e continua no grupo do WhatsApp por mais um ano.
const ITENS_REVOGACAO: { campo: keyof Contato; label: string }[] = [
  { campo: "rev_searchie", label: "Removido do Searchie/Óbvio" },
  { campo: "rev_comunidade", label: "Removido da comunidade THB" },
  { campo: "rev_grupo", label: "Removido do grupo de informes" },
  { campo: "rev_pesquisa", label: "Removido da pesquisa" },
];

function num(v: string | number | null | undefined): number {
  const n = typeof v === "string" ? Number(v) : v ?? 0;
  return Number.isFinite(n) ? (n as number) : 0;
}
function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}
// Só a data (dd/mm/aaaa), sem hora — para o histórico de sócio anterior, onde
// só o dia importa. `substituido_em` é timestamptz (tem hora certa, ao
// contrário de um `date` puro do Postgres), então dá para formatar direto.
function fmtData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR");
}

// ===== Timeline do card (auditoria) =========================================
// Atores automáticos do sistema — não são gente; no rodapé viram "automático"
// para não parecer que alguém da operação fez a ação.
// `respondi` entrou na lista em 12/08: é o webhook do formulário, e sem ele aqui
// aparecia como se fosse uma pessoa da equipe na atividade.
const ATORES_SISTEMA = new Set(["sistema", "make", "hotmart", "lead", "cs", "webhook", "respondi"]);
function autorLegivel(autor: string | null): string {
  const a = (autor ?? "").trim();
  // "automático" dizia que ninguém fez, mas não dizia QUEM fez no lugar da gente.
  // Nomear a fonte é o que permite o operador entender sem perguntar: pagamento
  // que caiu da Hotmart, resposta que veio do formulário, regra do próprio board.
  if (!a) return "pelo sistema";
  const k = a.toLowerCase();
  if (k === "hotmart") return "pela Hotmart";
  if (k === "respondi") return "pelo formulário";
  if (k === "make" || k === "webhook") return "por uma automação";
  if (ATORES_SISTEMA.has(k) || k.startsWith("migration")) return "pelo sistema";
  // Gente também vira frase ("por Kelly") para a linha ler igual nos dois casos.
  return `por ${a}`;
}
// Cor da barra/ponto por tipo de interação — leitura rápida do que é cada linha.
function corTimeline(tipo: string): string {
  switch (tipo) {
    case "mudanca_estagio": return "#6366f1"; // indigo — mudou de etapa
    case "nota": return "#0d9488";             // teal — anotação da operação
    case "resposta": return "#059669";         // emerald — lead respondeu
    case "disparo": return "#7c3aed";          // violet — disparo enviado
    default: return "#94a3b8";                 // slate — sistema/outros
  }
}
// 12/08, pedido do Marcio: "lembra que são operadores que não conhecem o sistema
// nem programação — a informação tem que ser tratada para uma linguagem mais
// humana, não linguagem de máquina". "Ação do sistema" e "Resposta do lead" eram
// o vocabulário de quem escreveu o banco, não o de quem opera o board.
function rotuloTipo(tipo: string): string {
  switch (tipo) {
    case "mudanca_estagio": return "Mudou de etapa";
    case "nota": return "Anotação da equipe";
    case "resposta": return "O aluno respondeu";
    case "disparo": return "Mensagem enviada";
    // O sistema faz isso sozinho quando a Hotmart avisa de um pagamento, de um
    // cancelamento ou quando uma regra do board dispara. Ninguém da equipe fez.
    case "sistema": return "Feito automaticamente";
    default: return tipo;
  }
}
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Painel rápido do card: mover etapa, agendar, pagamento e responsável sem sair
// do board. Edições persistem via /api/hm/contato/[id] e recarregam o board.
export function HmDrawer({
  compradorId, estagios, responsaveis, onClose, onChanged,
}: {
  compradorId: string; estagios: Estagio[]; responsaveis: string[];
  onClose: () => void; onChanged: () => void;
}) {
  const { me, podeDisparar: podeDisparaFn, podeDistribuir, ehMaster, ehCardDeColega, ehEquipeDeAtivacao } = useMe();
  const podeDisparar = podeDisparaFn("HM");
  // 0164: a mesma pessoa pode ter card em 2 boards — a ficha precisa saber QUAL abrir.
  const { produto: produtoBoard, nome: nomePortal, base } = useProdutoHm();
  const [c, setC] = useState<Contato | null>(null);
  // O GET pode ser RECUSADO (403 cancelamento_so_admin_gp num link colado, sessão
  // caída…). Sem este estado o drawer ficava no "Carregando…" para sempre.
  const [erroCarga, setErroCarga] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<Interacao[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [reuniao, setReuniao] = useState("");
  const [entrevista, setEntrevista] = useState("");
  const [nota, setNota] = useState("");
  const [disparar, setDisparar] = useState(false);
  const [fin, setFin] = useState<Financeiro | null>(null);
  // (pagamento/valor/saldo manual removidos em 30/07: dados de transação vêm da Hotmart)
  // acordo do saldo + ativação (rascunho local; só grava no OK/blur)
  const [prorata, setProrata] = useState<Prorata | null>(null);
  // 0231: quando existe, o crédito da ficha é o MESMO número que gerou o link de
  // pagamento enviado ao aluno. É o que permite o comercial defender o valor ao
  // telefone em vez de torcer para bater.
  const [prorataFonte, setProrataFonte] = useState<{ fonte?: string | null; importado_em?: string | null } | null>(null);
  // Saldo do Aurum (0158) + saldo cheio do board (14.700 no HM, 59.000 no Aurum).
  const [aurum, setAurum] = useState<AurumSaldoDrawer | null>(null);
  const [saldoCheio, setSaldoCheio] = useState<string | null>(null);
  const [outrosPortais, setOutrosPortais] = useState<OutroPortal[]>([]);
  const [links, setLinks] = useState<LinkSaldo[]>([]);
  // Histórico financeiro (12/08): a razão do card. Fechado por padrão — a ficha
  // já é longa e a pergunta do dia a dia ("quanto deve, quando pagou a última")
  // é respondida pelo resumo, que fica sempre visível no cabeçalho do bloco.
  const [pagamentos, setPagamentos] = useState<Pagamento[]>([]);
  const [verFinanceiro, setVerFinanceiro] = useState(false);
  const [acordo, setAcordo] = useState("");
  const [previsao, setPrevisao] = useState("");
  const [pendencia, setPendencia] = useState("");
  // Motivo do crédito pró-rata — o mesmo padrão de rascunho local (grava no
  // blur, um por abertura de card) já usado por acordo/previsão/pendência.
  const [creditoObs, setCreditoObs] = useState("");
  const [grupo, setGrupo] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [motivoAgenda, setMotivoAgenda] = useState("");
  const [socios, setSocios] = useState<Socio[]>([]);
  const [historicoSocios, setHistoricoSocios] = useState<SocioAnterior[]>([]);
  const [novoSocio, setNovoSocio] = useState({ nome: "", email: "", telefone: "" });
  const [catalogoTags, setCatalogoTags] = useState<TagOpcao[]>([]);
  // O histórico de versões da ficha (0097) — ver e recuperar, como na planilha.
  const [versoes, setVersoes] = useState<Array<{ id: number; resumo: string; autor: string | null; criado_em: string }>>([]);
  const [historicoAberto, setHistoricoAberto] = useState(false);
  // Guarda de qual card já teve os rascunhos locais inicializados — impede que o
  // recarregar pós-ação atropele o que a pessoa está digitando (A3).
  const rascunhoIniciado = useRef<string | null>(null);

  const recarregar = useCallback(async () => {
    const r = await fetch(`/api/hm/contato/${compradorId}?produto=${produtoBoard}`);
    const d = await r.json().catch(() => ({}));
    if (!d.ok) {
      setErroCarga(msgErroPermissao(d?.reason) ?? "Não foi possível abrir esta ficha. Tente de novo.");
      return;
    }
    setErroCarga(null);
    {
      setC(d.contato);
      setTimeline(d.timeline ?? []);
      setReuniao(toLocalInput(d.contato.reuniao_em));
      setEntrevista(toLocalInput(d.contato.entrevista_em));
      setFin(d.financeiro ?? null);
      setProrata(d.prorata ?? null);
      setProrataFonte(d.prorataFonte ?? null);
      setAurum(d.aurumSaldo ?? null);
      setSaldoCheio(d.saldoCheio ?? null);
      setOutrosPortais(d.outrosPortais ?? []);
      setLinks(d.linksSaldo ?? []);
      setPagamentos(d.pagamentos ?? []);
      setSocios(d.socios ?? []);
      setHistoricoSocios(d.historicoSocios ?? []);
      setAgendamentos(d.agendamentos ?? []);
      setVersoes(d.versoes ?? []);
      setMotivoAgenda("");
      // Rascunhos locais (só gravam no blur): inicializados UMA VEZ por abertura,
      // não a cada recarregar. Senão avançar a etapa — que dispara recarregar —
      // sobrescreveria o acordo/pendência que a pessoa está digitando com o valor
      // antigo do servidor, e o dado lançado sumiria (era o bug do "avançar apaga").
      if (rascunhoIniciado.current !== compradorId) {
        setAcordo(d.contato.acordo ?? "");
        setPrevisao(d.contato.pagamento_previsto_em?.slice(0, 10) ?? "");
        setPendencia(d.contato.pendencia ?? "");
        setGrupo(d.contato.grupo_informes ?? "");
        setCreditoObs(d.contato.credito_obs ?? "");
        rascunhoIniciado.current = compradorId;
      }
    }
  }, [compradorId, produtoBoard]);
  useEffect(() => { setC(null); setErroCarga(null); recarregar(); }, [recarregar]);
  useEffect(() => {
    fetch("/api/hm/tags").then((r) => r.json()).then((d) => { if (d.ok) setCatalogoTags(d.tags); }).catch(() => {});
  }, []);

  // Adiciona/remove tag pelo MESMO caminho do lote (serviço + timeline). Criar
  // é digitar um nome novo no picker — o serviço registra no catálogo sozinho.
  async function mexerTag(payload: { addTag?: string; removeTag?: string }) {
    if (cardDeColega) { window.alert(msgErroPermissao("card_de_outro_operador")); return; }
    setSalvando(true);
    try {
      // 0187: ver comentário gêmeo em app/hm/tabela/page.tsx — o lote é mono-produto.
      await fetch(`/api/hm/lote?produto=${produtoBoard}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compradorIds: [compradorId], ...payload }),
      });
      await recarregar();
      onChanged();
      const d = await fetch("/api/hm/tags").then((r) => r.json()).catch(() => null);
      if (d?.ok) setCatalogoTags(d.tags);
    } finally {
      setSalvando(false);
    }
  }
  // cor_efetiva (0206) = a cor que se DESENHA (override da tag ou herdada da
  // categoria); cai para `cor` se a API ainda não trouxer o campo novo.
  const coresTags = Object.fromEntries(catalogoTags.map((t) => [t.nome, t.cor_efetiva ?? t.cor]));
  // 12/08: a descrição já vinha do catálogo e era descartada — vira tooltip
  // nativo (`title`) no chip, para responder "o que significa esta tag" onde
  // o operador de fato trabalha, não só em /hm/tags.
  const descricoesTags = Object.fromEntries(catalogoTags.map((t) => [t.nome, t.descricao]));
  const ehGerenciada = (t: string) => /^(Origem|Turma|Aurum) /.test(t);

  // O servidor pode RECUSAR a edição: "Ativação Realizada" é a linha de chegada
  // e só entra quem cumpriu os 4 itens do checklist. Ele devolve 400 com o que
  // falta — a ficha diz isso ao operador, com as mesmas palavras do board, em vez
  // de recarregar com o seletor de volta na etapa antiga sem explicação nenhuma.
  // Recusa não é mudança: o board não é avisado (onChanged), mas a ficha
  // recarrega para que o seletor volte ao que de fato está gravado.
  async function patch(payload: Record<string, unknown>) {
    // Card de colega: TODA escrita da ficha desemboca aqui — barrar no ponto
    // único (como a tabela faz com o cancelado) evita depender de cada input
    // desabilitar a si mesmo. O backend recusa igual (403); aqui o motivo
    // aparece na hora.
    if (cardDeColega) { window.alert(msgErroPermissao("card_de_outro_operador")); return; }
    setSalvando(true);
    try {
      const r = await fetch(`/api/hm/contato/${compradorId}?produto=${produtoBoard}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        if (d?.reason === "checklist_incompleto") {
          window.alert(
            `${c?.nome ?? "Esta pessoa"} ainda não pode entrar em "Ativação Realizada".\n\n` +
              `Falta: ${(d.faltando ?? []).join(", ")}.\n\n` +
              "Marque os itens do checklist de ativação aqui na ficha.",
          );
        } else if (d?.reason === "saldo_em_aberto") {
          const falta = typeof d.faltam === "number" && d.faltam > 0
            ? ` Faltam ${d.faltam.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} do saldo.`
            : "";
          window.alert(
            `${c?.nome ?? "Esta pessoa"} ainda não pagou o saldo — o sinal não é pagamento realizado.${falta}\n\n` +
              "Registre o pagamento do saldo (valor cheio) antes de mover para a Ativação.",
          );
        } else if (d?.reason === "entrevista_finalizada_travada") {
          // 12/08: msgErroPermissao (app/_components/use-me.ts) é de outro agente
          // nesta rodada — mensagem própria aqui, mesmo texto/critério do 403
          // gêmeo da reunião (reuniao_finalizada_travada).
          window.alert(
            "A entrevista já foi finalizada e os dados dela ficam travados — data, remarcação e resultado não mudam mais.\n\n" +
              "O resto da ficha continua editável. Se algo ficou errado no registro, fale com o administrador do Grupo Participa.",
          );
        } else {
          // 403 de permissão vem com reason específico — mostra o MOTIVO
          // (ex.: "Você só pode atribuir para alguém da sua equipe.").
          window.alert(msgErroPermissao(d?.reason) ?? "Não foi possível salvar esta alteração. Tente de novo.");
        }
        await recarregar();
        return;
      }
      // Pagamento parcial: registrou o valor, mas o sinal/parcial não finaliza —
      // o card fica no comercial, com o saldo em aberto. Avisa em vez de deixar o
      // operador achar que "deu baixa".
      const d = await r.json().catch(() => ({}));
      if (d?.pagamento_parcial) {
        const falta = typeof d.faltam === "number" && d.faltam > 0
          ? ` Faltam ${d.faltam.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}.`
          : "";
        window.alert(
          `Pagamento parcial registrado.${falta}\n\n` +
            "Como não cobre o pacote inteiro, o aluno continua no Comercial e o saldo segue no contas a receber.",
        );
      }
      await recarregar();
      onChanged();
    } finally {
      setSalvando(false);
    }
  }

  // Sócios: rota própria porque o sócio é um registro (com checklist), não um
  // campo do card. Se o titular já é aluno, gravar um sócio o leva junto para a base.
  async function socioReq(method: "POST" | "PATCH" | "DELETE", body?: Record<string, unknown>, socioId?: string) {
    if (cardDeColega) { window.alert(msgErroPermissao("card_de_outro_operador")); return; }
    setSalvando(true);
    try {
      // 0187: o produto vai SEMPRE; o socioId, quando houver (por isso o & no 2o caso).
      const url = `/api/hm/contato/${compradorId}/socios?produto=${produtoBoard}${socioId ? `&socioId=${socioId}` : ""}`;
      await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      await recarregar();
      onChanged();
    } finally {
      setSalvando(false);
    }
  }

  // "Pagou" é a marca operacional (apto_ativacao), não a data: um card devolvido
  // ao Comercial conserva a data do pagamento como histórico, mas volta a pedir a
  // confirmação — senão o formulário de pagamento nunca mais reapareceria.
  const jaPagou = !!c?.apto_ativacao;
  // Link de saldo do HM para o botão único "Abrir checkout Hotmart" (0255): não
  // é mais o link fixo `off=2vibw97m` (R$14.700) — é o mesmo `links` que a
  // ficha já calcula pelo saldo REAL desta pessoa (hm-ficha.ts), preferindo a
  // opção à vista. Sem match dentro da tolerância, `links` vem vazio e a tela
  // não pode oferecer link nenhum — errar o valor é pior que não mostrar.
  const linkSaldoRecomendado = links.find((l) => !l.recorrente) ?? links[0] ?? null;
  // Reunião finalizada (0152): o bloco financeiro de cancelamento só aparece
  // depois que a reunião comercial foi de fato realizada — é a regra pedida
  // ("tem que vir após a reunião finalizada"). Vale o resultado OU já ter data.
  const reuniaoFinalizada = c?.reuniao_resultado === "Realizada" || c?.reuniao_resultado === "Realizada/pago";
  const temHistorico = timeline.some((it) => it.tipo === "mudanca_estagio");
  // Trava dos cancelados (27/07): card em Reclamada/Reembolsado é read-only para
  // quem não é MASTER. O backend barra; aqui a UI avisa e desabilita.
  const travadoCancelado = (c?.estagio_chave === "hm_cancelamento" || c?.estagio_chave === "hm_reembolsado") && !ehMaster();
  // Card de COLEGA (28/07): o operador VÊ os cards da equipe, mas só AGE no que
  // é dele ou no pool — a ficha do colega abre em leitura, e a API recusa
  // escrita com 403 `card_de_outro_operador`. A regra é o escopoAcao de
  // lib/papeis (via useMe.ehCardDeColega), a MESMA do backend.
  // Evento "HM" (P6, 12/08): faltava aqui — o drawer abria a ficha da Ana em
  // leitura mesmo quando o board (kanban/page.tsx) já deixava arrastar o mesmo
  // card. Mesma divergência de app/hm/tabela/page.tsx, corrigida junto.
  // `produtoBoard`: mesmo drawer serve HM/Aurum/ETHB (0164).
  const cardDeColega = ehCardDeColega(c, "HM", produtoBoard);
  // O MESMO padrão do card cancelado: um único flag de leitura desliga toda
  // escrita da ficha (campos, etapa, sócios, pagamento) — timeline e histórico
  // continuam abertos, que é o ponto de ver o card do colega.
  const somenteLeitura = travadoCancelado || cardDeColega;
  // REUNIÃO FINALIZADA TRAVA A REUNIÃO (12/08, pedido do Marcio): "como a
  // reunião foi finalizada a gente não precisa mais mexer... não quero que o
  // pessoal da ativação mexa aí. Alguns cards de algumas etapas podem ser
  // truncados, não podem ser mais alterados — a gente evita que o pessoal mexa
  // e cause problema."
  //
  // Trava SÓ o bloco da reunião, não a ficha: o card segue andando na ativação
  // (é justamente o que acontece depois da reunião). O que congela é o registro
  // do que já aconteceu — data, remarcação e resultado.
  //
  // O master continua podendo corrigir, mesmo critério do card cancelado: erro
  // de digitação numa reunião realizada precisa de alguém que possa desfazer.
  const reuniaoTravada = (reuniaoFinalizada || c?.estagio_chave === "hm_reuniao_finalizada") && !ehMaster();
  // ENTREVISTA FINALIZADA TRAVA A ENTREVISTA (12/08, mesmo pedido do Marcio, ver
  // o comentário gêmeo em app/api/hm/contato/[id]/route.ts): a entrevista de
  // ativação é o espelho da reunião comercial, e vira registro do mesmo jeito.
  // `entrevista_resultado` é texto livre (sem os valores fixos de RESULTADOS),
  // então o sinal de "já aconteceu" é a ETAPA — "Entrevista Finalizada"
  // (chave hm_entrevista_realizada) ou a linha de chegada seguinte, "Ativação
  // Realizada". O master corrige, mesmo critério da reunião e do cancelado.
  const entrevistaTravada = (c?.estagio_chave === "hm_entrevista_realizada" || c?.estagio_chave === "hm_ativacao_realizada") && !ehMaster();
  const feitos = c ? ITENS_CHECKLIST.filter((i) => !!c[i.campo]).length : 0;
  const revogados = c ? ITENS_REVOGACAO.filter((i) => !!c[i.campo]).length : 0;

  // EXPLICAÇÃO DO CRÉDITO PRÓ-RATA (13/08, pedido do Marcio: "o comercial vai
  // explicar o motivo do pró-rata com base nessa observação — me garante que
  // isso está em dia"). HM (credito_obs) e AURUM (obs/excecao_motivo) são fontes
  // diferentes do mesmo par (valor, motivo) — mesma regra de pendência da
  // tabela (faltaExplicarCredito, card-sinais.tsx), para as duas telas nunca
  // discordarem sobre quem está sem explicação.
  //
  // `mostrarCreditoHm` esconde o bloco quando não há narrativa de pró-rata a
  // explicar: saldo informado À MÃO pelo Victor (vence o cálculo) ou quitado
  // sem histórico registrado. Antes a caixa (vazia) aparecia SEMPRE — some
  // nesses dois casos, e é o espaço que a explicação em destaque ganhou.
  const manualSaldo = fin?.saldo_a_pagar_manual != null;
  const quitadoSemManual = jaPagou && !manualSaldo;
  const creditoHmValor = prorata?.credito != null ? num(prorata.credito) : num(fin?.credito);
  const mostrarCreditoHm = !aurum && !manualSaldo && (!quitadoSemManual || !!creditoObs.trim());
  const pendenteCreditoHm = mostrarCreditoHm && faltaExplicarCredito(creditoHmValor, creditoObs);
  // AURUM: a exceção (gratuidade/cancelado/revisar) sempre precisa do motivo —
  // é ele que justifica "não cobrar"; fora da exceção só é pendência se HÁ
  // crédito a abater.
  const aurumMotivo = aurum ? (aurum.excecao ? aurum.excecao_motivo : aurum.obs) : null;
  const mostrarCreditoAurum = !!aurum && (aurum.excecao || num(aurum.credito) > 0 || !!aurum.obs?.trim());
  const pendenteCreditoAurum = mostrarCreditoAurum && (aurum?.excecao ? !aurumMotivo?.trim() : faltaExplicarCredito(num(aurum?.credito), aurumMotivo));

  async function reverter() {
    await patch({ reverter: true });
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-hidden border-l border-slate-200 bg-white shadow-pop animate-fade-in dark:border-slate-800 dark:bg-slate-900">
        {erroCarga ? (
          // 403/erro no GET (ex.: card cancelado aberto por link — só o master
          // acessa): diz o motivo e oferece a saída, em vez de girar para sempre.
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            </span>
            <p className="max-w-xs text-sm text-slate-600 dark:text-slate-300">{erroCarga}</p>
            <Button variant="secondary" size="sm" onClick={onClose}>Fechar</Button>
          </div>
        ) : !c ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-slate-400"><Spinner className="h-5 w-5" /> Carregando…</div>
        ) : (
          <>
            <div className="flex items-start gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
              <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-semibold", corAvatar(c.nome))}>{inicial(c.nome)}</span>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">{c.nome}</h2>
                {/* Telefone e e-mail copiáveis, logo abaixo do nome: é o que o
                    operador leva para o Searchie, para o grupo, para o discador. */}
                <ContatoDoNome telefone={c.telefone} email={c.email} className="mt-0.5" />
                {c.turma && <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">{c.turma}</p>}
                {c.plano && <p className="mt-0.5 truncate text-xs text-slate-400 dark:text-slate-500">{c.plano}</p>}
                {/* Equipe dona + recompra — os mesmos selos do board, para a ficha
                    não contar outra história. Equipe sem cor cai no cinza padrão. */}
                {(c.equipe_nome || origemRecompra(c.tags) || ehAlunoAntigo(c.tags)) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {c.equipe_nome && <SeloEquipe nome={c.equipe_nome} cor={c.equipe_cor} grande abreviado={false} />}
                    {origemRecompra(c.tags) && <SeloRecompra origem={origemRecompra(c.tags)!} />}
                    {ehAlunoAntigo(c.tags) && <SeloAlunoAntigo />}
                  </div>
                )}
                {/* Tags editáveis: × remove (menos as gerenciadas — turma/origem
                    são do sistema) e "+ Tag" busca/cria/atribui na hora. */}
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {(c.tags ?? []).map((t) =>
                    ehGerenciada(t) || somenteLeitura ? (
                      <TagChip key={t} tag={t} mini cor={coresTags[t]} titulo={descricoesTags[t]} />
                    ) : (
                      <span key={t} className="group/tag relative inline-flex">
                        <TagChip tag={t} mini cor={coresTags[t]} titulo={descricoesTags[t]} />
                        <button
                          type="button"
                          disabled={salvando}
                          onClick={() => mexerTag({ removeTag: t })}
                          title={`Remover a tag "${t}"`}
                          className="absolute -right-1 -top-1 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-slate-600 text-white shadow group-hover/tag:flex dark:bg-slate-500"
                        >
                          <svg className="h-2 w-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                        </button>
                      </span>
                    ),
                  )}
                  {!somenteLeitura && <TagPicker opcoes={catalogoTags} jaTem={c.tags ?? []} disabled={salvando} onEscolher={(nome) => mexerTag({ addTag: nome })} />}
                </div>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {/* Travas primeiro: quem abre a ficha para ligar precisa ver isto
                  ANTES de qualquer outra coisa — era o "NÃO ENTRAR EM CONTATO NO
                  MOMENTO" que vivia perdido na coluna de observações da planilha. */}
              {c.nao_contatar && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 dark:border-rose-500/30 dark:bg-rose-500/10">
                  <p className="flex items-center gap-2 text-sm font-semibold text-rose-700 dark:text-rose-300">
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="m4.9 4.9 14.2 14.2" /></svg>
                    Não entrar em contato
                  </p>
                  {c.nao_contatar_motivo && <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">{c.nao_contatar_motivo}</p>}
                </div>
              )}
              {c.revisar && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
                    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
                    Revisar antes de tratar
                  </p>
                  {c.revisar_motivo && <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">{c.revisar_motivo}</p>}
                </div>
              )}

              {c.apto_ativacao && (
                <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  Pagamento do saldo confirmado{c.pagamento_em ? ` · pago ${fmt(c.pagamento_em)}` : ""}
                </div>
              )}

              {/* Histórico de versões (0097) — como na planilha: ver as versões e
                  recuperar qualquer uma. A rede de segurança para o valor
                  sobrescrito por engano. "Desfazer" é o atalho da mais recente. */}
              {versoes.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10">
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setHistoricoAberto((v) => !v)}
                      className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-200"
                      title="Ver o histórico de versões da ficha"
                    >
                      <svg className={cn("h-3.5 w-3.5 shrink-0 transition-transform", historicoAberto && "rotate-90")} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                      Histórico de versões ({versoes.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => patch({ desfazer_edicao: true })}
                      disabled={salvando || somenteLeitura}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-500/15"
                      title="Recuperar a versão mais recente"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" /></svg>
                      Desfazer
                    </button>
                  </div>
                  {historicoAberto && (
                    <ul className="max-h-56 overflow-y-auto border-t border-amber-200/70 px-1 py-1 dark:border-amber-500/20">
                      {versoes.map((v) => (
                        <li key={v.id} className="flex items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-amber-100/60 dark:hover:bg-amber-500/10">
                          <span className="min-w-0 text-[11px] text-amber-900/90 dark:text-amber-100/90">
                            <span className="font-medium tabular-nums">{fmt(v.criado_em)}</span>
                            {v.autor && <span className="text-amber-700/80 dark:text-amber-200/70"> · {v.autor}</span>}
                            <span className="block truncate opacity-80">{v.resumo}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => patch({ restaurar_versao: v.id })}
                            disabled={salvando || somenteLeitura}
                            className="shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-200/70 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-500/20"
                            title="Restaurar a ficha para esta versão"
                          >
                            Recuperar
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {travadoCancelado && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  <strong>Card em {c.estagio_chave === "hm_reembolsado" ? "Reembolsado" : "Reclamada"}.</strong> Só o administrador do Grupo Participa pode alterar cards cancelados. Você pode visualizar, mas não editar.
                </div>
              )}

              {/* Card de colega: contexto, não erro — slate, sem tom de alerta.
                  O mesmo padrão do aviso do cancelado acima (um banner + a ficha
                  em leitura), sem inventar um terceiro jeito. */}
              {cardDeColega && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  <strong className="text-slate-700 dark:text-slate-200">Card de {c.responsavel ?? "outro operador"}.</strong>{" "}
                  Você pode ver a ficha, a timeline e o histórico, mas não alterar — só quem pode agir é o dono ou o gestor.
                </div>
              )}

              {/* A SITUAÇÃO DELA EM CADA PORTAL (13/08, pedido do Marcio:
                  "quero que você diferencie a situação dela no HM e a situação
                  dela no AURUM... uma diferenciação visual mesmo, pra gente
                  saber o que é o quê").

                  Antes isto era um bloco índigo único listando "os outros
                  boards" — tudo da mesma cor, e o portal em que você ESTÁ nem
                  aparecia. Quem abria a ficha de alguém que existe no HM e no
                  Aurum via dois textos parecidos e tinha de adivinhar qual era
                  qual.

                  Agora cada portal usa A COR DA PRÓPRIA MARCA (lib/marcas.ts —
                  a mesma que o operador já vê no topo da tela: HM âmbar, Aurum
                  ouro, ETHB teal), e o portal ATUAL entra na lista, em primeiro
                  e marcado como "você está aqui". A diferenciação deixa de
                  depender de ler o texto: é a cor da faixa.

                  Só aparece quando a pessoa existe em mais de um portal — para
                  quem só tem um card, seria uma caixa dizendo o óbvio. */}
              {outrosPortais.length > 0 && (() => {
                const idDoProduto: Record<string, PortalId> = { HM: "hm", AURUM: "aurum", ETHB: "ethb" };
                const linhas = [
                  {
                    produto: produtoBoard,
                    aqui: true,
                    estagio: c.estagio_nome,
                    aba: c.estagio_aba,
                    responsavel: c.responsavel,
                    pagamento_em: c.pagamento_em,
                    tem_matricula: !!c.aluno_id,
                    comprador_id: c.comprador_id as string,
                  },
                  ...outrosPortais.map((o) => ({
                    produto: o.outro_produto,
                    aqui: false,
                    estagio: o.outro_estagio,
                    aba: o.outro_aba,
                    responsavel: o.outro_responsavel,
                    pagamento_em: o.outro_pagamento_em,
                    tem_matricula: o.outro_tem_matricula,
                    comprador_id: o.comprador_id,
                  })),
                ];
                return (
                  <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Esta pessoa em cada portal
                    </p>
                    <ul className="space-y-1.5">
                      {linhas.map((l) => {
                        const marca = PORTAIS[idDoProduto[l.produto] ?? "hm"];
                        const conteudo = (
                          <>
                            <span className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-100">
                              <span className="inline-flex items-center gap-1">
                                {/* A cor da marca é o portador: o operador
                                    reconhece o portal sem ler. */}
                                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: marca.cor }} aria-hidden="true" />
                                {marca.nome}
                              </span>
                              <span className="font-normal text-slate-400 dark:text-slate-500">·</span>
                              <span className="font-normal">{l.estagio ?? "sem etapa"}</span>
                              {l.aba && (
                                <span className="rounded px-1 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200 dark:text-slate-400 dark:ring-slate-700">
                                  {l.aba === "ativacao" ? "Ativação" : "Comercial"}
                                </span>
                              )}
                              {l.aqui ? (
                                <span className="rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] font-semibold text-white dark:bg-slate-100 dark:text-slate-900">
                                  você está aqui
                                </span>
                              ) : (
                                <svg className="h-3 w-3 opacity-0 transition group-hover:opacity-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7M9 7h8v8" /></svg>
                              )}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
                              {l.responsavel ? `com ${l.responsavel}` : "sem operador"}
                              {l.pagamento_em ? ` · pagou em ${fmt(l.pagamento_em)}` : ""}
                              {l.tem_matricula ? " · já é aluno na base" : ""}
                            </span>
                          </>
                        );
                        return (
                          <li
                            key={l.produto}
                            className="rounded-md border-l-[3px] pl-2"
                            style={{ borderLeftColor: marca.cor }}
                          >
                            {l.aqui ? (
                              <div className="px-1.5 py-1">{conteudo}</div>
                            ) : (
                              <Link
                                href={`/${l.produto.toLowerCase()}/kanban?card=${l.comprador_id}`}
                                className="group block rounded-md px-1.5 py-1 transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                                title={`Abrir ${c.nome} no portal ${marca.nome}`}
                              >
                                {conteudo}
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })()}

              {/* ACORDO DO SALDO — o gargalo. Vive logo no topo da ficha (antes
                  de Etapa/Turma/Operador): "quanto ela deve" é uma das
                  perguntas que o operador faz o dia todo, e antes só se
                  respondia depois de rolar a ficha inteira. Na planilha isto
                  era "Como vai pagar o saldo restante?" + "Link enviado" +
                  "pagamento agendado 17/07", três colunas de texto solto que
                  ninguém conseguia filtrar. */}
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {jaPagou && fin?.saldo_a_pagar_manual == null ? "Acordo do saldo (histórico)" : "Acordo do saldo"}
                </p>

                {/* Saldo e link só para quem ainda deve. Para quem já quitou, o
                    pró-rata é história: mostrar "saldo a pagar" seria mentir.
                    EXCEÇÃO (0159): saldo informado à mão VENCE o "quitado". `jaPagou`
                    é só `apto_ativacao`, e quem paga parcelado entra na Ativação
                    DEVENDO — foi o caso da Quelen, cujo saldo pago em duas ofertas o
                    cálculo automático dava como quitado. Esconder o valor informado
                    faria o operador parar de cobrar as parcelas restantes. */}
                {jaPagou && fin?.saldo_a_pagar_manual == null ? (
                  <p className="mb-2 rounded bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    Saldo quitado{c.pagamento_em ? ` em ${fmt(c.pagamento_em)}` : ""}.
                  </p>
                ) : fin?.saldo_a_pagar_manual != null ? (
                  // O Victor informou o valor — vence o pró-rata calculado (0151).
                  <p className="mb-2 rounded bg-indigo-50 px-2 py-1.5 text-[11px] font-medium text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                    Saldo a pagar: <strong>{brl(num(fin.saldo_a_pagar_manual))}</strong>
                    <span className="ml-1 font-normal text-indigo-500 dark:text-indigo-300/80">
                      (informado{fin.saldo_a_pagar_manual_por ? ` por ${fin.saldo_a_pagar_manual_por}` : ""}{fin.saldo_a_pagar_manual_em ? ` em ${fmt(fin.saldo_a_pagar_manual_em)}` : ""})
                    </span>
                  </p>
                ) : aurum ? (
                  // AURUM (0158): o crédito vem da planilha do Victor, já ingerido —
                  // o comercial abre o card com a conta pronta, sem consultar planilha.
                  // Exceção (gratuidade/cancelado/revisar) não tem valor: mostra o motivo.
                  aurum.excecao ? (
                    <p className="mb-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                      {aurum.rotulo_operador}
                      {aurum.obs ? <><br /><span className="font-normal">{aurum.obs}</span></> : null}
                    </p>
                  ) : (
                    <p className="mb-2 rounded bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                      {num(aurum.credito) > 0 ? (
                        <>Crédito pró-rata: <strong>{brl(num(aurum.credito))}</strong>{" · "}</>
                      ) : (
                        <>Sem crédito a abater{" · "}</>
                      )}
                      saldo a pagar: <strong>{brl(num(aurum.saldo_a_pagar))}</strong>
                      <br />
                      <span className="text-slate-400 dark:text-slate-500">
                        Pacote {brl(num(aurum.pacote_cheio))} − entrada {brl(num(aurum.entrada_paga))} = {brl(num(aurum.base_saldo))}
                        {aurum.ultima_oferta ? ` · crédito sobre: ${aurum.ultima_oferta}` : ""}
                      </span>
                    </p>
                  )
                ) : prorata?.saldo_a_pagar ? (
                  // O QUE O ALUNO AINDA DEVE, com a conta aberta.
                  // ⚠️ O valor exibido é `fin.saldo_a_perseguir` (régua viva: pacote da
                  // oferta de entrada − entrada paga − crédito pró-rata, com o cravado
                  // tendo precedência), NÃO `prorata.saldo_a_pagar` — este último ainda
                  // tem o 14.700 cravado, que assume entrada de R$ 300 e erra em quem
                  // entrou pela oferta de R$ 697.
                  <p className="mb-2 rounded bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                    Crédito pró-rata: <strong>{brl(num(prorata.credito))}</strong> ({prorata.dias_restantes} dias não usados)
                    {" · "}ainda deve:{" "}
                    <strong className="text-slate-900 dark:text-slate-100">
                      {brl(num(fin?.saldo_a_perseguir ?? prorata.saldo_a_pagar))}
                    </strong>
                    <br />
                    <span className="text-slate-400 dark:text-slate-500">
                      {num(fin?.pacote_regra) > 0 ? (
                        <>
                          Pacote {brl(num(fin?.pacote_regra))}
                          {num(fin?.pago) > 0 ? <> − já pago {brl(num(fin?.pago))}</> : null}
                          {" = "}{brl(num(fin?.saldo_a_perseguir))}
                          {" · "}
                        </>
                      ) : null}
                      o crédito encolhe a cada dia — o valor vale para hoje.
                    </span>
                  </p>
                ) : fin?.situacao === "incalculavel" ? (
                  // ALUNO DA BASE sem crédito calculado (0165). Antes caía no ramo do
                  // "saldo cheio" e o card dizia R$ 14.700 — mas ele tem direito ao
                  // desconto pró-rata/mensalidade, que o analista ainda não passou.
                  // Mostrar o cheio faria o operador cobrar a mais; some o número.
                  <p className="mb-2 rounded bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                    <strong>Saldo a definir</strong> — é aluno da base
                    {c.turma_origem ? ` (turma ${c.turma_origem})` : ""} e tem direito ao abatimento
                    do que já pagou. O valor vem do analista; não cobre o cheio.
                  </p>
                ) : (
                  // Saldo cheio do BOARD, não 14.700 fixo: no Aurum são 59.000 (0158).
                  // 0174: o `|| 14700` saiu. Era falsy — card QUITADO tem saldo 0 e
                  // caía no literal, mostrando "Saldo cheio: R$ 14.700" para quem não
                  // devia nada. E com a régua vindo da porta de entrada, 14.700 deixou
                  // de ser um chute razoável: quem entrou pelos R$697 deve 14.303.
                  // Sem valor, a tela diz que não sabe (vocabulário da 0165).
                  <p className="mb-2 text-[11px] text-slate-400 dark:text-slate-500">
                    Saldo cheio: {saldoCheio == null ? "saldo a definir" : brl(num(saldoCheio))}
                  </p>
                )}

                {/* Saldo a pagar manual removido (30/07): o saldo é calculado pelo
                    pró-rata sobre o que a Hotmart registrou — não se digita à mão. */}

                {/* POR QUE ESTE CRÉDITO — destacada, na mesma altura em que o
                    comercial acabou de ler o valor acima (13/08). Antes era um
                    <textarea> com rótulo genérico igual a "Como vai pagar" —
                    lia como só mais um campo de formulário, não como a resposta
                    de "por que este número". Âmbar quando falta preencher e HÁ
                    crédito a explicar (pendência, não erro); índigo quando está
                    em dia. AURUM é leitura (a planilha do Victor é a fonte, não
                    esta tela); HM continua editável, grava no blur. */}
                {mostrarCreditoAurum && (
                  <div className={cn(
                    "mb-2 rounded-md border px-2.5 py-2",
                    pendenteCreditoAurum
                      ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10"
                      : "border-indigo-200 bg-indigo-50/70 dark:border-indigo-500/30 dark:bg-indigo-500/10",
                  )}>
                    <p className={cn(
                      "mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide",
                      pendenteCreditoAurum ? "text-amber-700 dark:text-amber-300" : "text-indigo-600 dark:text-indigo-300",
                    )}>
                      <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-5M12 8h.01" /></svg>
                      Por que {aurum?.excecao ? "não cobrar" : "este crédito"}
                    </p>
                    {pendenteCreditoAurum ? (
                      <p className="text-[12px] font-medium text-amber-800 dark:text-amber-300">
                        Sem explicação registrada na planilha do Victor — confira com ele antes de cobrar.
                      </p>
                    ) : (
                      <p className="text-[12px] text-slate-700 dark:text-slate-200">{aurumMotivo}</p>
                    )}
                  </div>
                )}
                {mostrarCreditoHm && (
                  <div className={cn(
                    "mb-2 rounded-md border px-2.5 py-2",
                    pendenteCreditoHm
                      ? "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10"
                      : "border-indigo-200 bg-indigo-50/70 dark:border-indigo-500/30 dark:bg-indigo-500/10",
                  )}>
                    <label className="block">
                      <span className={cn(
                        "mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide",
                        pendenteCreditoHm ? "text-amber-700 dark:text-amber-300" : "text-indigo-600 dark:text-indigo-300",
                      )}>
                        <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-5M12 8h.01" /></svg>
                        Por que este crédito
                      </span>
                      {/* A CONTA, escrita pelo sistema (13/08). Medido em produção:
                          88 pessoas têm crédito pró-rata e ZERO tinham o motivo
                          preenchido — o campo nasceu ontem (0207) e ninguém escreveu.
                          Deixar o comercial cobrar sem nada para dizer é o problema
                          que o Marcio levantou.

                          O sistema explica a ARITMÉTICA (o que é fato: quanto pagou,
                          quando, quantos dias usou, quanto sobra); o campo de texto
                          abaixo segue sendo do humano, para a EXCEÇÃO (desconto
                          combinado, acordo com o Victor). Não escrevemos no
                          `credito_obs` de ninguém: dado calculado não pode se
                          disfarçar de anotação de pessoa. */}
                      {prorata && num(prorata.credito) > 0 && (
                        <p className="mb-1.5 rounded bg-white/70 px-2 py-1.5 text-[11px] leading-relaxed text-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
                          {/* 0231: dizer a FONTE muda o que o comercial pode
                              afirmar. Número congelado da planilha = o mesmo que
                              foi para o link do aluno, defensável ao telefone.
                              Número calculado = conta do sistema, que muda a cada
                              dia e pode não bater com o link que já saiu. */}
                          {prorataFonte ? (
                            <span className="mb-1 flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                              <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                              Conferido com a planilha do Victor
                              {prorataFonte.importado_em ? ` · import de ${new Date(prorataFonte.importado_em).toLocaleDateString("pt-BR")}` : ""}
                              {" — é este o valor do link enviado ao aluno."}
                            </span>
                          ) : null}
                          <span className="font-semibold">{prorataFonte ? "A conta:" : "Conta do sistema:"}</span>{" "}
                          do acesso anterior{c.turma_origem ? ` (turma ${c.turma_origem})` : ""}, usou{" "}
                          <strong>{prorata.dias_usados} dias</strong> a {brl(num(prorata.valor_dia))}/dia
                          {" "}= {brl(num(prorata.consumido))} consumidos. Sobram{" "}
                          <strong>{prorata.dias_restantes} dias</strong>, que viram o crédito de{" "}
                          <strong>{brl(num(prorata.credito))}</strong>.
                        </p>
                      )}
                      <textarea
                        value={creditoObs}
                        disabled={somenteLeitura}
                        onChange={(e) => setCreditoObs(e.target.value)}
                        onBlur={() => patch({ credito_obs: creditoObs || null })}
                        rows={2}
                        placeholder={pendenteCreditoHm
                          ? "Pendente — o comercial vai cobrar sem saber explicar. Ex.: dias não usados na turma anterior…"
                          : "Ex.: dias não usados na turma anterior, desconto combinado com o Victor…"}
                        className={fieldClass}
                      />
                    </label>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Como vai pagar
                    <select
                      value={c.pagamento_meio ?? ""}
                      onChange={(e) => patch({ pagamento_meio: e.target.value || null })}
                      className={fieldClass}
                      disabled={salvando || somenteLeitura}
                    >
                      <option value="">— a combinar —</option>
                      {MEIOS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
                    </select>
                  </label>
                  <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Previsão de pagamento
                    <input
                      type="date"
                      value={previsao}
                      disabled={somenteLeitura}
                      onChange={(e) => setPrevisao(e.target.value)}
                      onBlur={() => patch({ pagamento_previsto_em: previsao || null })}
                      className={fieldClass}
                    />
                  </label>
                </div>

                <label className="mt-2 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  O combinado
                  <textarea
                    value={acordo}
                    disabled={somenteLeitura}
                    onChange={(e) => setAcordo(e.target.value)}
                    onBlur={() => patch({ acordo: acordo || null })}
                    rows={2}
                    placeholder="12x no boleto, primeira parcela dia 15…"
                    className={fieldClass}
                  />
                </label>

                {/* Link de saldo: o sistema escolhe pelo valor (cada saldo tem sua
                    própria oferta na Hotmart) — antes isso era procurado à mão.
                    Some depois de quitado: não há mais o que cobrar. */}
                {!jaPagou && !somenteLeitura && links.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">Link do saldo (sugerido pelo valor)</p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {links.map((l) => (
                        <button
                          key={l.codigo}
                          type="button"
                          onClick={async () => {
                            await navigator.clipboard.writeText(l.link);
                            setCopiado(true);
                            setTimeout(() => setCopiado(false), 1500);
                            patch({ oferta_saldo_codigo: l.codigo, link_saldo_enviado: true });
                          }}
                          className={cn(
                            "rounded-md border px-2 py-1 text-[11px] font-medium transition",
                            c.oferta_saldo_codigo === l.codigo
                              ? "border-brand bg-brand/10 text-brand dark:border-brand-400 dark:text-brand-300"
                              : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
                          )}
                          title={`Copiar link e marcar como enviado — ${l.link}`}
                        >
                          {brl(num(l.valor))} {l.recorrente ? "recorrente" : "à vista"}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                      {copiado
                        ? "Link copiado."
                        : c.link_saldo_enviado_em
                          ? `Link enviado em ${fmt(c.link_saldo_enviado_em)}`
                          : "Clique para copiar e marcar como enviado."}
                    </p>
                  </div>
                )}
              </div>

              {/* HISTÓRICO FINANCEIRO (12/08, pedido do Marcio) — "toda a linha
                  do tempo do pagamento dele", dentro do card do aluno.
                  Três decisões:
                  · O RESUMO fica sempre aberto (último pagamento + quanto falta):
                    é o "acesso rápido" pedido. A lista completa é que colapsa —
                    a ficha já é longa e ninguém abre 12 linhas de parcela todo dia.
                  · Vem da RAZÃO (cs.hm_pagamentos), não dos campos do card: é a
                    mesma fonte que o board e o XLSX leem. Duas fontes divergiriam.
                  · Já chega filtrado por produto — o card do HM não mostra a
                    mensalidade do Aurum (a regra da 0196/0197, agora na tela). */}
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Histórico financeiro
                  </p>
                  {pagamentos.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setVerFinanceiro((v) => !v)}
                      className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      aria-expanded={verFinanceiro}
                      title="Ver todos os pagamentos registrados deste aluno"
                    >
                      {verFinanceiro ? "Ocultar" : `Ver os ${pagamentos.length}`}
                    </button>
                  )}
                </div>

                {pagamentos.length === 0 ? (
                  // Nenhum pagamento na razão não é o mesmo que "não pagou": pode
                  // ser card criado à mão, ou compra numa categoria que não entra
                  // no razão (renovação/reserva). O texto não afirma nem nega.
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    Nenhum pagamento registrado na razão para este card.
                  </p>
                ) : (
                  <>
                    {/* ACESSO RÁPIDO: o último pagamento e o que ainda falta. */}
                    {(() => {
                      const ultimo = pagamentos[0];
                      const total = pagamentos.reduce((s, p) => s + num(p.valor), 0);
                      const falta = fin?.saldo_a_perseguir != null ? num(fin.saldo_a_perseguir) : null;
                      return (
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div className="rounded bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
                            <p className="text-slate-400 dark:text-slate-500">Último pagamento</p>
                            <p className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                              {brl(num(ultimo.valor))}
                            </p>
                            <p className="text-slate-500 dark:text-slate-400">
                              {ultimo.pago_em ? fmt(ultimo.pago_em) : "sem data"}
                              {ultimo.metodo_pagamento ? ` · ${ROTULO_METODO[ultimo.metodo_pagamento] ?? ultimo.metodo_pagamento}` : ""}
                            </p>
                          </div>
                          <div className="rounded bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60">
                            <p className="text-slate-400 dark:text-slate-500">
                              {falta != null && falta > 0 ? "Ainda deve" : "Total pago"}
                            </p>
                            <p className={cn(
                              "font-semibold tabular-nums",
                              falta != null && falta > 0
                                ? "text-amber-700 dark:text-amber-300"
                                : "text-emerald-700 dark:text-emerald-300",
                            )}>
                              {falta != null && falta > 0 ? brl(falta) : brl(total)}
                            </p>
                            <p className="text-slate-500 dark:text-slate-400">
                              {/* `falta` nulo é "o sistema não sabe" (exceção do
                                  Aurum, lead sem lastro) — não vira R$ 0,00. */}
                              {falta == null
                                ? "saldo não calculado"
                                : falta > 0
                                  ? `de ${brl(total + falta)} · ${pagamentos.length} pagamento${pagamentos.length > 1 ? "s" : ""}`
                                  : `em ${pagamentos.length} pagamento${pagamentos.length > 1 ? "s" : ""}`}
                            </p>
                          </div>
                        </div>
                      );
                    })()}

                    {/* A LINHA DO TEMPO — do mais recente para o mais antigo. */}
                    {verFinanceiro && (
                      <ul className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 dark:border-slate-800">
                        {pagamentos.map((p, i) => (
                          <li key={`${p.transacao ?? "x"}-${p.parcela ?? 0}-${i}`} className="flex items-start justify-between gap-2 text-[11px]">
                            <div className="min-w-0">
                              <p className="font-medium text-slate-700 dark:text-slate-200">
                                {ROTULO_CATEGORIA[p.categoria ?? ""] ?? p.categoria ?? "Pagamento"}
                                {p.parcela && p.parcela > 1 ? <span className="font-normal text-slate-400 dark:text-slate-500"> · parcela {p.parcela}</span> : null}
                              </p>
                              <p className="truncate text-slate-500 dark:text-slate-400">
                                {p.pago_em ? fmt(p.pago_em) : "sem data"}
                                {p.metodo_pagamento ? ` · ${ROTULO_METODO[p.metodo_pagamento] ?? p.metodo_pagamento}` : ""}
                                {/* `origem` é de onde o dinheiro foi registrado —
                                    "hotmart" é automático; qualquer outra coisa
                                    foi alguém que lançou, e o nome importa. */}
                                {p.origem && p.origem !== "hotmart" ? ` · lançado por ${p.autor ?? p.origem}` : ""}
                              </p>
                              {p.obs && <p className="truncate text-slate-400 dark:text-slate-500" title={p.obs}>{p.obs}</p>}
                            </div>
                            <span className="shrink-0 font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                              {brl(num(p.valor))}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>

              <Campo label="Etapa">
                <select value={c.estagio_chave ?? ""} onChange={(e) => patch({ estagio_chave: e.target.value })} className={fieldClass} disabled={salvando || somenteLeitura}>
                  {estagios.map((s) => <option key={s.chave} value={s.chave}>{s.aba === "ativacao" ? "Ativação · " : "Comercial · "}{s.nome}</option>)}
                </select>
                {temHistorico && !somenteLeitura && (
                  <button
                    type="button"
                    onClick={reverter}
                    disabled={salvando}
                    className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-brand disabled:opacity-50 dark:text-slate-400 dark:hover:text-brand-300"
                    title="Desfazer o último movimento de etapa (miss click)"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-1" /></svg>
                    Voltar ao estágio anterior
                  </button>
                )}
              </Campo>

              {/* Turma do programa: a atual vem sozinha ao pagar. O campo existe
                  para a exceção — alguém que entra em outra turma.
                  0165: o rótulo e o placeholder eram fixos do HM ("Turma no HM",
                  "T39") e apareciam assim no board do Aurum. Agora seguem o portal. */}
              <Campo label={`Turma no ${nomePortal}`}>
                <div className="flex items-center gap-2">
                  <input
                    defaultValue={c.turma ?? ""}
                    disabled={somenteLeitura}
                    onBlur={(e) => { if (e.target.value.trim() && e.target.value !== (c.turma ?? "")) patch({ turma: e.target.value.trim() }); }}
                    placeholder="turma"
                    className={fieldClass}
                  />
                  {c.turma_origem && (
                    <span className="shrink-0 rounded bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400" title="Turma de onde ele veio">
                      veio da {c.turma_origem}
                    </span>
                  )}
                </div>
              </Campo>

              {/* DUPLO RESPONSÁVEL (0211/0212, 12/08) — três campos, três
                  perguntas diferentes:
                    · Comercial: quem VENDEU. Histórico, IMUTÁVEL (o banco
                      recusa a escrita — errcode restrict_violation). SEMPRE
                      leitura, inclusive para master: oferecer um seletor que o
                      servidor vai recusar só faria a pessoa descobrir o limite
                      errando.
                    · Ativação: quem RECEBEU na aba de ativação. Também
                      histórico, carimbado sozinho pela trigger ao entrar na
                      aba (só se ainda vazio) — hoje sem endpoint de edição
                      direta, então também sai como leitura.
                    · Vigente (responsavel_id, abaixo): o campo de SEMPRE, quem
                      está com o card AGORA — segue com o seletor/assumir
                      normal, sem mudança de comportamento.
                  Nulo mostra "—", nunca some: um card comercial sem
                  responsável de ativação ainda não passou pela Ativação — é
                  informação, não vazio para esconder. */}
              <Campo label="Comercial">
                <div
                  className="flex items-center gap-2"
                  title="Quem fechou a venda — é estrutural: não muda nem para o administrador do Grupo Participa. Corrigido só por migration pontual, fora da aplicação."
                >
                  <svg
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-500"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  {c.responsavel_comercial ? (
                    <>
                      <Avatar nome={c.responsavel_comercial} className="h-7 w-7 text-xs" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{c.responsavel_comercial}</span>
                    </>
                  ) : (
                    <span className="text-sm text-slate-400 dark:text-slate-500">—</span>
                  )}
                </div>
              </Campo>

              <Campo label="Ativação">
                <div className="flex items-center gap-2">
                  {c.responsavel_ativacao ? (
                    <>
                      <Avatar nome={c.responsavel_ativacao} className="h-7 w-7 text-xs" />
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{c.responsavel_ativacao}</span>
                    </>
                  ) : (
                    <span className="text-sm text-slate-400 dark:text-slate-500">—</span>
                  )}
                </div>
                {/* Assumir a ATIVAÇÃO (pedido de 12/08): ao sair do comercial, a
                    pessoa da ativação assume o aluno — dois responsáveis, um por
                    etapa. Diferente do "Assumir para mim" abaixo, que mexe no
                    dono VIGENTE: aqui grava quem cuida da ativação.
                    Gating só de UI — a rota revalida (403 sem_permissao_ativacao,
                    400 fora_da_ativacao), ambos traduzidos em msgErroPermissao. */}
                {me?.id && !somenteLeitura && c.estagio_aba === "ativacao"
                  && c.responsavel_ativacao !== me.nome
                  && (ehEquipeDeAtivacao || podeDistribuir()) && (
                  <button
                    type="button"
                    onClick={() => patch({ responsavel_ativacao_id: me.id })}
                    disabled={salvando}
                    className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-brand transition hover:underline disabled:opacity-50 dark:text-brand-300"
                    title={c.responsavel_ativacao ? `Assumir a ativação de ${c.responsavel_ativacao}` : "Assumir a ativação deste aluno"}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
                    Assumir a ativação
                  </button>
                )}
              </Campo>

              <Campo label="Operador (vigente)">
                {/* SEM OPERADOR (17/08): o mesmo selo do board/tabela, aqui na
                    ficha — o aviso "gritando" precisa seguir o card até onde a
                    associação de fato acontece. `posicao="inline"`: a ficha não
                    tem canto de card. `responsavel_id` (não `responsavel`
                    texto): é a condição que a venda nova nasce nula. */}
                {c.responsavel_id === null && (
                  <SeloSemOperador posicao="inline" className="mb-1.5" />
                )}
                {podeDistribuir() ? (
                  // MASTER/GESTOR: o seletor distribui. A lista `responsaveis` já
                  // vem recortada do servidor (master = todos os ativos; gestor =
                  // só a equipe dele) — e o backend barra destino fora da equipe.
                  <div className="flex items-center gap-2">
                    {c.responsavel && <Avatar nome={c.responsavel} className="h-8 w-8 text-xs" />}
                    <select value={c.responsavel ?? ""} onChange={(e) => patch({ responsavel: e.target.value || null })} className={fieldClass} disabled={salvando}>
                      <option value="">— Sem operador —</option>
                      {c.responsavel && !responsaveis.includes(c.responsavel) && <option value={c.responsavel}>{c.responsavel}</option>}
                      {responsaveis.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                ) : (
                  // OPERADOR: não há seletor — só a leitura de quem é o dono (ou
                  // de que o card está no pool, livre para assumir).
                  <div className="flex items-center gap-2">
                    {c.responsavel ? (
                      <>
                        <Avatar nome={c.responsavel} className="h-8 w-8 text-xs" />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{c.responsavel}</span>
                      </>
                    ) : c.atribuicao_admin ? (
                      <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                        Atribuição travada pelo administrador
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-teal-400 px-2.5 py-1.5 text-xs font-medium text-teal-700 dark:border-teal-500/50 dark:text-teal-300">
                        No pool — livre para assumir
                      </span>
                    )}
                  </div>
                )}
                {/* Assumir: master/gestor sempre; OPERADOR só em card do POOL (sem
                    dono e sem trava do admin). Card com dono ou travado: o operador
                    não vê ação nenhuma de atribuição. */}
                {me?.id && c.responsavel !== me.nome && (podeDistribuir() || (!c.responsavel && !c.atribuicao_admin)) && (
                  <button
                    type="button"
                    onClick={() => patch({ responsavel_id: me.id })}
                    disabled={salvando}
                    aria-busy={salvando}
                    className="mt-1.5 inline-flex items-center gap-1.5 rounded text-xs font-medium text-brand transition hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 dark:text-brand-300"
                    title={c.responsavel ? `Assumir de ${c.responsavel}` : "Associe esse cliente a alguém da sua equipe ou a você mesma."}
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
                    {c.responsavel ? "Assumir para mim" : "Associar a mim"}
                  </button>
                )}
              </Campo>

              <BlocoAgendamento
                tipo="reuniao"
                rotulo="Reunião comercial"
                atual={c.reuniao_em}
                valor={reuniao}
                onValor={setReuniao}
                motivo={motivoAgenda}
                onMotivo={setMotivoAgenda}
                historico={agendamentos}
                salvando={salvando || somenteLeitura || reuniaoTravada}
                onSalvar={(quando, motivo) => patch({ reuniao_em: quando, agendamento_motivo: motivo })}
                onFechar={(status) => patch({ agendamento_tipo: "reuniao", agendamento_status: status, agendamento_motivo: motivoAgenda || null })}
              >
                {/* A reunião acabou: o bloco vira registro. Diz POR QUE está
                    travado — campo desabilitado sem explicação é o que faz o
                    operador achar que o sistema quebrou e chamar o suporte. */}
                {reuniaoTravada && (
                  <p className="mt-1.5 flex items-start gap-1.5 rounded bg-slate-100 px-2 py-1.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <svg className="mt-0.5 h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    <span>
                      <strong>Reunião finalizada — dados travados.</strong> O que
                      foi combinado aqui não muda mais; o card segue normalmente
                      na ativação. Precisa corrigir? Fale com o administrador do
                      Grupo Participa.
                    </span>
                  </p>
                )}
                <select
                  value={c.reuniao_resultado ?? ""}
                  onChange={(e) => patch({ reuniao_resultado: e.target.value || null })}
                  className={cn(fieldClass, "mt-1.5")}
                  disabled={salvando || somenteLeitura || reuniaoTravada}
                >
                  <option value="">— Status da reunião —</option>
                  {RESULTADOS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <LinkGravacao
                  atual={c.reuniao_gravacao_url}
                  disabled={salvando || somenteLeitura}
                  onSalvar={(v) => patch({ reuniao_gravacao_url: v })}
                />
              </BlocoAgendamento>

              <BlocoAgendamento
                tipo="entrevista"
                rotulo="Entrevista de ativação"
                atual={c.entrevista_em}
                valor={entrevista}
                onValor={setEntrevista}
                motivo={motivoAgenda}
                onMotivo={setMotivoAgenda}
                historico={agendamentos}
                salvando={salvando || somenteLeitura || entrevistaTravada}
                onSalvar={(quando, motivo) => patch({ entrevista_em: quando, agendamento_motivo: motivo })}
                onFechar={(status) => patch({ agendamento_tipo: "entrevista", agendamento_status: status, agendamento_motivo: motivoAgenda || null })}
              >
                {/* Mesmo aviso da reunião finalizada — a entrevista virou registro. */}
                {entrevistaTravada && (
                  <p className="mt-1.5 flex items-start gap-1.5 rounded bg-slate-100 px-2 py-1.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <svg className="mt-0.5 h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                    <span>
                      <strong>Entrevista finalizada — dados travados.</strong> O que
                      foi registrado aqui não muda mais; o card segue normalmente
                      na ativação. Precisa corrigir? Fale com o administrador do
                      Grupo Participa.
                    </span>
                  </p>
                )}
                <LinkGravacao
                  atual={c.entrevista_gravacao_url}
                  disabled={salvando || somenteLeitura || entrevistaTravada}
                  onSalvar={(v) => patch({ entrevista_gravacao_url: v })}
                />
              </BlocoAgendamento>

              {/* CHECKLIST DE ATIVAÇÃO — as 4 colunas TRUE/FALSE da planilha.
                  Juntas elas SÃO "ativado": é o que abre a porta de "Ativação
                  Realizada", a última coluna da esteira (o servidor recusa a
                  entrada e diz o que falta). Fora dessa porta, o board é livre. */}
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Checklist de ativação</p>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                    feitos === ITENS_CHECKLIST.length
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                      : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
                  )}>
                    {feitos}/{ITENS_CHECKLIST.length}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {ITENS_CHECKLIST.map((item) => (
                    <label key={item.campo} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        checked={!!c[item.campo]}
                        disabled={salvando || somenteLeitura}
                        onChange={(e) => patch({ [item.campo]: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600"
                      />
                      {item.label}
                    </label>
                  ))}
                </div>

                <label className="mt-2 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Qual grupo de informes
                  <input
                    value={grupo}
                    disabled={somenteLeitura}
                    onChange={(e) => setGrupo(e.target.value)}
                    onBlur={() => patch({ grupo_informes: grupo || null })}
                    placeholder="THB #27"
                    className={fieldClass}
                  />
                </label>

                <label className="mt-2 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  O que está pendente para conclusão
                  <textarea
                    value={pendencia}
                    disabled={somenteLeitura}
                    onChange={(e) => setPendencia(e.target.value)}
                    onBlur={() => patch({ pendencia: pendencia || null })}
                    rows={2}
                    className={fieldClass}
                  />
                </label>

                <label className="mt-2 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Link do Facebook
                  <input
                    defaultValue={c.link_facebook ?? ""}
                    disabled={somenteLeitura}
                    onBlur={(e) => { if (e.target.value !== (c.link_facebook ?? "")) patch({ link_facebook: e.target.value || null }); }}
                    placeholder="https://facebook.com/groups/…"
                    className={fieldClass}
                  />
                </label>
              </div>

              {/* CANCELAMENTO — o pedido e o fato são coisas diferentes.
                  Enquanto é só pedido, o aluno continua aluno: reembolso pode ser
                  negado, e gente desiste de cancelar. Confirmado, o aluno é
                  MARCADO (nunca apagado): some do GPS, mantém turma, histórico e
                  sócios — e abre o checklist de remoção dos acessos, que é o que
                  de fato tira a pessoa de dentro do Searchie, do grupo e da
                  comunidade. Se ele voltar, é este mesmo cadastro que revive. */}
              {/* Bloco financeiro do cancelamento (0152): aparece após a REUNIÃO
                  FINALIZADA, ou sempre que já houver um cancelamento em curso (não
                  esconder um pedido/efetivado só porque a reunião não foi marcada). */}
              {(reuniaoFinalizada || c.cancelamento_em || c.cancelamento_efetivado_em) && (
                <div className={cn(
                  "rounded-lg border p-3",
                  c.cancelamento_efetivado_em
                    ? "border-rose-200 bg-rose-50/50 dark:border-rose-500/30 dark:bg-rose-500/5"
                    : (c.cancelamento_em)
                      ? "border-amber-200 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5"
                      // Só o registro financeiro pós-reunião (sem pedido ainda): neutro.
                      : "border-slate-200 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-800/40",
                )}>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      {c.cancelamento_efetivado_em ? "Cancelado" : c.cancelamento_em ? "Cancelamento solicitado" : "Cancelamento (financeiro)"}
                    </p>
                    {c.cancelamento_efetivado_em && (
                      <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
                        {c.cancelamento_origem === "hotmart" ? "pela Hotmart" : "confirmado à mão"}
                      </span>
                    )}
                  </div>

                  {c.cancelamento_em ? (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Pediu em {fmt(c.cancelamento_em)}
                      {c.cancelamento_efetivado_em && <> · efetivado em {fmt(c.cancelamento_efetivado_em)}</>}
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-400 dark:text-slate-500">
                      Registre aqui o financeiro caso o aluno peça o cancelamento diretamente à equipe.
                    </p>
                  )}

                  {/* O que a HOTMART diz — o fato, separado da nossa leitura dele.
                      Confirmar à mão é um palpite ("o reembolso deve ter saído");
                      só isto aqui prova que o dinheiro voltou. */}
                  {c.hotmart_cancelado_em ? (
                    <p className="mt-1.5 rounded bg-rose-100/70 px-2 py-1 text-[11px] font-medium text-rose-800 dark:bg-rose-500/15 dark:text-rose-200">
                      Hotmart confirmou em {fmt(c.hotmart_cancelado_em)}
                      {c.hotmart_cancelamento_evento && <> · {EVENTO_HOTMART[c.hotmart_cancelamento_evento] ?? c.hotmart_cancelamento_evento}</>}
                      {c.hotmart_cancelamento_transacao && (
                        <span className="block font-normal opacity-75">transação {c.hotmart_cancelamento_transacao}</span>
                      )}
                    </p>
                  ) : c.cancelamento_efetivado_em ? (
                    <p className="mt-1.5 rounded bg-amber-100/70 px-2 py-1 text-[11px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                      ⚠ A Hotmart nunca confirmou este cancelamento. Ou o reembolso ainda não saiu,
                      ou o card foi marcado por engano — e neste caso tiramos o acesso de quem continua pagando.
                    </p>
                  ) : null}

                  <label className="mt-2 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Motivo
                    <textarea
                      defaultValue={c.cancelamento_motivo ?? ""}
                      disabled={somenteLeitura}
                      onBlur={(e) => { if (e.target.value !== (c.cancelamento_motivo ?? "")) patch({ cancelamento_motivo: e.target.value || null }); }}
                      rows={2}
                      placeholder="Por que saiu?"
                      className={fieldClass}
                    />
                  </label>

                  {/* Valor financeiro do cancelamento (0152): a reembolsar/reter. */}
                  <label className="mt-2 block text-[11px] font-medium text-slate-500 dark:text-slate-400">
                    Valor do cancelamento (a reembolsar/reter)
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-xs text-slate-400">R$</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        defaultValue={c.cancelamento_valor != null ? String(num(c.cancelamento_valor)) : ""}
                        disabled={somenteLeitura}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          const atual = c.cancelamento_valor != null ? String(num(c.cancelamento_valor)) : "";
                          if (v === atual) return;
                          patch({ cancelamento_valor: v === "" ? null : Number(v) });
                        }}
                        placeholder="ex.: 300"
                        className={cn(fieldClass, "flex-1")}
                      />
                    </div>
                  </label>

                  {/* Só o registro financeiro pós-reunião (sem pedido de fato): nada
                      de confirmar/remover acessos — não há cancelamento a processar. */}
                  {!c.cancelamento_em && !c.cancelamento_efetivado_em ? null : !c.cancelamento_efetivado_em ? (
                    <button
                      onClick={() => {
                        if (window.confirm(
                          `Confirmar o cancelamento de ${c.nome}?\n\n` +
                          "Isto marca o aluno como cancelado na base (ele sai das telas do GPS, mas o cadastro e o histórico ficam) " +
                          "e abre o checklist de remoção dos acessos.\n\nFaça isto só quando o reembolso tiver saído de fato.",
                        )) patch({ confirmar_cancelamento: true });
                      }}
                      disabled={salvando || somenteLeitura}
                      className="mt-2 w-full rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    >
                      Confirmar cancelamento (o reembolso saiu)
                    </button>
                  ) : (
                    <>
                      {/* A fila do Thomas. O acesso não cai sozinho quando o
                          dinheiro volta: alguém tem de tirar a pessoa de cada
                          lugar. O "quando" e o "quem" são carimbados pelo banco. */}
                      <div className="mt-3 border-t border-rose-200 pt-2 dark:border-rose-500/20">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Remover acessos</p>
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
                            revogados === ITENS_REVOGACAO.length
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                              : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
                          )}>
                            {revogados}/{ITENS_REVOGACAO.length}
                          </span>
                        </div>

                        <div className="space-y-1.5">
                          {ITENS_REVOGACAO.map((item) => (
                            <label key={item.campo} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                              <input
                                type="checkbox"
                                checked={!!c[item.campo]}
                                disabled={salvando || somenteLeitura}
                                onChange={(e) => patch({ [item.campo]: e.target.checked })}
                                className="h-4 w-4 rounded border-slate-300 text-rose-600 focus:ring-rose-500 dark:border-slate-600"
                              />
                              {item.label}
                            </label>
                          ))}
                        </div>

                        {c.acessos_revogados_em ? (
                          <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300">
                            Acessos removidos em {fmt(c.acessos_revogados_em)}
                            {c.acessos_revogados_por ? ` por ${c.acessos_revogados_por}` : ""}.
                          </p>
                        ) : (
                          <p className="mt-2 text-[11px] text-rose-700 dark:text-rose-300">
                            Este aluno ainda tem acesso ao que não está marcado acima.
                          </p>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          if (window.confirm(
                            `Desfazer o cancelamento de ${c.nome}?\n\n` +
                            "O aluno volta a valer na base. O pedido de cancelamento continua registrado no histórico.",
                          )) patch({ desfazer_cancelamento: true });
                        }}
                        disabled={salvando || somenteLeitura}
                        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Desfazer cancelamento
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* SÓCIOS — a aba "SÓCIOS T39". O sócio é ativado também (tem o
                  próprio checklist) e, quando o titular vira aluno, ele vai junto
                  para a base: mesma turma, mesma validade, vinculado a ele. */}
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  Sócios convidados{socios.length > 0 ? ` (${socios.length})` : ""}
                </p>

                {socios.map((s) => (
                  <div key={s.id} className="mb-2 rounded-md border border-slate-100 p-2 dark:border-slate-800">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{s.nome}</p>
                        <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">
                          {[s.email, s.telefone].filter(Boolean).join(" · ") || "sem contato"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {s.aluno_id && (
                          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" title="Já está na base de alunos">
                            na base
                          </span>
                        )}
                        <button
                          type="button"
                          disabled={salvando || somenteLeitura}
                          onClick={() => { if (window.confirm(`Remover o sócio ${s.nome} deste card?`)) socioReq("DELETE", undefined, s.id); }}
                          className="rounded p-1 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                          title="Remover sócio"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>

                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                      {([
                        ["ativ_searchie", "Searchie"],
                        ["ativ_comunidade", "Comunidade"],
                        ["ativ_grupo", "Grupo"],
                      ] as const).map(([campo, label]) => (
                        <label key={campo} className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                          <input
                            type="checkbox"
                            checked={s[campo]}
                            disabled={salvando || somenteLeitura}
                            onChange={(e) => socioReq("PATCH", { socioId: s.id, [campo]: e.target.checked })}
                            className="h-3.5 w-3.5 rounded border-slate-300 text-brand focus:ring-brand dark:border-slate-600"
                          />
                          {label}
                        </label>
                      ))}
                    </div>

                    <input
                      defaultValue={s.link_facebook ?? ""}
                      disabled={somenteLeitura}
                      onBlur={(e) => { if (e.target.value !== (s.link_facebook ?? "")) socioReq("PATCH", { socioId: s.id, link_facebook: e.target.value || null }); }}
                      placeholder="Link do Facebook do sócio"
                      className={cn(fieldClass, "mt-1.5 text-[11px]")}
                    />
                  </div>
                ))}

                {/* Convidar sócio é escrita — some no modo leitura. */}
                {!somenteLeitura && (<>
                <div className="grid grid-cols-3 gap-1.5">
                  <input
                    value={novoSocio.nome}
                    onChange={(e) => setNovoSocio({ ...novoSocio, nome: e.target.value })}
                    placeholder="Nome do sócio"
                    className={cn(fieldClass, "text-[11px]")}
                  />
                  <input
                    value={novoSocio.email}
                    onChange={(e) => setNovoSocio({ ...novoSocio, email: e.target.value })}
                    placeholder="E-mail"
                    className={cn(fieldClass, "text-[11px]")}
                  />
                  <input
                    value={novoSocio.telefone}
                    onChange={(e) => setNovoSocio({ ...novoSocio, telefone: e.target.value })}
                    placeholder="Telefone"
                    className={cn(fieldClass, "text-[11px]")}
                  />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-1.5"
                  disabled={salvando || novoSocio.nome.trim().length < 2}
                  onClick={async () => {
                    await socioReq("POST", {
                      nome: novoSocio.nome.trim(),
                      email: novoSocio.email.trim() || null,
                      telefone: novoSocio.telefone.trim() || null,
                    });
                    setNovoSocio({ nome: "", email: "", telefone: "" });
                  }}
                >
                  Adicionar sócio
                </Button>
                </>)}

                {/* Sócio anterior deste titular (17/08): discreto, atrás de um
                    "detalhes" — não pode competir com o sócio vigente acima.
                    Só aparece quando já houve troca (nunca uma seção vazia). */}
                {historicoSocios.length > 0 && (
                  <details className="group/hist mt-2.5 border-t border-slate-100 pt-2 dark:border-slate-800">
                    <summary className="alvo-toque inline-flex cursor-pointer list-none items-center gap-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 [&::-webkit-details-marker]:hidden">
                      <svg className="h-3 w-3 shrink-0 transition-transform group-open/hist:rotate-90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                      {historicoSocios.length === 1 ? "sócio anterior" : `sócios anteriores (${historicoSocios.length})`}
                    </summary>
                    <ul className="mt-1.5 space-y-1">
                      {historicoSocios.map((h, i) => (
                        <li key={`${h.nome}-${h.substituido_em}-${i}`} className="text-[11px] text-slate-500 dark:text-slate-400">
                          sócio anterior: <span className="font-medium text-slate-600 dark:text-slate-300">{h.nome}</span>, trocado em {fmtData(h.substituido_em)}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>

              {!jaPagou && !somenteLeitura && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    {/* 0174: sem `|| 14700`. O Aurum manda quando tem valor; senão o
                        saldo do card. Nenhum dos dois → a tela assume que não sabe, em
                        vez de inventar o número da porta antiga. */}
                    Saldo — {aurum?.saldo_a_pagar != null ? brl(num(aurum.saldo_a_pagar))
                             : saldoCheio != null ? brl(num(saldoCheio))
                             : "a definir"}
                  </p>
                  {/* Pagamento NÃO é mais lançado à mão (30/07): quem confirma a venda é a
                      Hotmart. Ao aprovar o pagamento do saldo, o card entra sozinho na
                      Ativação. Aqui só o link do checkout e a orientação. */}
                  <div>
                    <p className="mb-2 text-[11px] text-amber-800 dark:text-amber-200">
                      O pagamento é confirmado <strong>automaticamente pela Hotmart</strong>. Envie o link
                      do saldo ao aluno; assim que ele pagar, o card vai sozinho para a Ativação
                      (Pendente de Liberação) e o aluno é criado na base. Não há lançamento manual.
                    </p>
                    {/* No card do AURUM não há link de checkout próprio ainda — some
                        até o Aurum ter um cadastrado (o comercial combina o
                        pagamento pelo valor que o card já mostra). No HM, o link é
                        o do SALDO REAL desta pessoa (0255) — nunca mais um valor
                        fixo que erraria o valor de quem não bate com ele. */}
                    {aurum ? (
                      <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80">
                        O Aurum ainda não tem link de checkout próprio — combine o pagamento pelo valor acima.
                      </p>
                    ) : linkSaldoRecomendado ? (
                      <a href={linkSaldoRecomendado.link} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand hover:underline dark:text-brand-300">Abrir checkout Hotmart</a>
                    ) : (
                      <p className="text-[11px] text-amber-800/80 dark:text-amber-200/80">
                        Não existe link para este saldo — gerar um novo checkout na Hotmart.
                      </p>
                    )}
                  </div>
                </div>
              )}

              <Campo label="Nota rápida">
                <div className="flex items-end gap-2">
                  <textarea value={nota} disabled={somenteLeitura} onChange={(e) => setNota(e.target.value)} rows={2} className={fieldClass} placeholder="Anotar na timeline…" />
                  <Button variant="secondary" size="sm" disabled={!nota.trim() || salvando || somenteLeitura} onClick={() => { patch({ nota }); setNota(""); }}>Anotar</Button>
                </div>
              </Campo>

              {timeline.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Histórico do card <span className="font-normal normal-case text-slate-400">· {timeline.length} registro{timeline.length > 1 ? "s" : ""}</span>
                  </p>
                  {/* Cronológico do INÍCIO ao FIM (mais antigo em cima) — a API entrega
                      desc, então invertemos. Cada entrada mostra o que aconteceu + o
                      rodapé com QUEM fez e QUANDO: o card vira registro auditável. */}
                  <ol className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
                    {[...timeline].reverse().map((it, i) => (
                      <li key={i} className="relative border-l-2 pl-3" style={{ borderColor: corTimeline(it.tipo) }}>
                        <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full" style={{ backgroundColor: corTimeline(it.tipo) }} />
                        <p className="text-xs leading-snug text-slate-700 dark:text-slate-200">{it.descricao || rotuloTipo(it.tipo)}</p>
                        {/* Rodapé: quem fez + quando, em frase ("por Kelly",
                            "pela Hotmart", "pelo sistema") — o operador precisa
                            distinguir o que a equipe fez do que caiu sozinho. */}
                        <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                          <span className="font-medium text-slate-500 dark:text-slate-400">{autorLegivel(it.autor)}</span>
                          <span className="tabular-nums"> · {fmt(it.criado_em)}</span>
                        </p>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Edição administrativa — só o MASTER (admin do GP). Um admin de
                  equipe comum não mexe na fonte (compradores/base THB). Identidade
                  corrige a FONTE e espelha na base; tudo vai para a timeline. */}
              {ehMaster() && (
                <AdminEdicao
                  compradorId={c.comprador_id}
                  atual={{
                    nome: c.nome, email: c.email, telefone: c.telefone, turma_origem: c.turma_origem,
                    valor_total: fin?.valor_total ?? null, valor_pago: fin?.valor_pago ?? null,
                    pagamento_em: c.pagamento_em, cancelamento_em: c.cancelamento_em,
                  }}
                  onSalvo={async () => { await recarregar(); onChanged(); }}
                />
              )}
            </div>

            <div className="sticky bottom-0 flex flex-wrap gap-2 border-t border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <Link href={`${base}/contatos/${c.comprador_id}`} className="min-w-[7rem] flex-1">
                <Button variant="secondary" className="w-full">Ficha completa</Button>
              </Link>
              {/* Download direto (o servidor devolve o arquivo com Content-Disposition) */}
              <a href={`/api/hm/contato/${c.comprador_id}/export`} className="min-w-[7rem] flex-1" title="Baixar a ficha completa em Excel">
                <Button variant="secondary" className="w-full">Baixar .xlsx</Button>
              </a>
              {/* Disparar é AGIR no lead do colega — some no modo leitura. */}
              {podeDisparar && c.telefone && !somenteLeitura && (
                <Button variant="secondary" className="min-w-[7rem] flex-1" onClick={() => setDisparar(true)}>Disparar</Button>
              )}
              {c.telefone && (
                <a href={`https://wa.me/${c.telefone.replace(/\D/g, "").replace(/^(?!55)/, "55")}`} target="_blank" rel="noreferrer" className="w-full">
                  <Button variant="primary" className="w-full">WhatsApp</Button>
                </a>
              )}
            </div>
          </>
        )}
      </aside>

      {disparar && c && c.telefone && (
        <DisparoModal
          selecao={[{ comprador_id: c.comprador_id, nome: c.nome, telefone: c.telefone, edicao: null }]}
          onClose={() => { setDisparar(false); onChanged(); }}
        />
      )}
    </>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</label>
      {children}
    </div>
  );
}

// O link da gravação, ao lado da marcação (C1). Salva no blur (evita um PATCH por
// tecla) e, quando há link, mostra o "▶" que abre a gravação numa aba. `key`
// força o input a refletir o valor recém-salvo depois do recarregar da ficha.
function LinkGravacao({ atual, disabled, onSalvar }: {
  atual: string | null; disabled: boolean; onSalvar: (v: string | null) => void;
}) {
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <input
        key={atual ?? ""}
        type="url"
        defaultValue={atual ?? ""}
        disabled={disabled}
        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (atual ?? "")) onSalvar(v || null); }}
        placeholder="Link da gravação (Meet/Zoom…)"
        className={cn(fieldClass, "flex-1")}
      />
      {atual && (
        <a
          href={atual}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded-md border border-slate-300 px-2.5 py-2 text-xs font-medium text-brand transition hover:bg-brand/5 dark:border-slate-700"
          title="Abrir a gravação"
        >
          ▶ Ver
        </a>
      )}
    </div>
  );
}

// Agendar e REAGENDAR no mesmo lugar. Com data marcada, o botão deixa de ser
// "Agendar" e vira "Reagendar", pedindo o motivo — porque remarcar não é corrigir
// um campo, é um fato da operação: a pessoa tinha um horário e ele caiu. O bloco
// também fecha a marcação vigente (realizada / não compareceu), que é o que
// distingue quem remarcou de quem simplesmente não apareceu.
function BlocoAgendamento({
  tipo, rotulo, atual, valor, onValor, motivo, onMotivo, historico, salvando, onSalvar, onFechar, children,
}: {
  tipo: "reuniao" | "entrevista";
  rotulo: string;
  atual: string | null;
  valor: string;
  onValor: (v: string) => void;
  motivo: string;
  onMotivo: (v: string) => void;
  historico: Agendamento[];
  salvando: boolean;
  onSalvar: (quando: string | null, motivo: string | null) => void;
  onFechar: (status: "realizado" | "nao_compareceu") => void;
  children?: React.ReactNode;
}) {
  const doTipo = historico.filter((a) => a.tipo === tipo);
  const remarcadas = doTipo.filter((a) => a.status === "reagendado").length;
  const faltas = doTipo.filter((a) => a.status === "nao_compareceu").length;
  const marcado = !!atual;
  const mudou = fromLocalInput(valor) !== (atual ?? null);

  return (
    <Campo label={`${rotulo} (data e hora)`}>
      <div className="flex items-center gap-2">
        {/* `salvando` também carrega o modo leitura (card cancelado/de colega). */}
        <input type="datetime-local" value={valor} onChange={(e) => onValor(e.target.value)} className={fieldClass} disabled={salvando} />
        <Button
          variant={marcado && mudou ? "primary" : "secondary"}
          size="sm"
          disabled={salvando || !mudou}
          onClick={() => onSalvar(fromLocalInput(valor), motivo.trim() || null)}
          title={marcado ? "Registrar a remarcação (guarda a data anterior)" : "Agendar"}
        >
          {marcado ? (fromLocalInput(valor) ? "Reagendar" : "Desmarcar") : "Agendar"}
        </Button>
      </div>

      {/* O motivo só faz sentido quando já existe uma marcação: é a explicação de
          por que a anterior caiu. */}
      {marcado && mudou && (
        <input
          value={motivo}
          onChange={(e) => onMotivo(e.target.value)}
          placeholder="Motivo da remarcação (ex.: aluno pediu para adiar, não compareceu)"
          className={cn(fieldClass, "mt-1.5 text-xs")}
        />
      )}

      {marcado && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Button variant="secondary" size="sm" disabled={salvando} onClick={() => onFechar("realizado")}>Realizada</Button>
          <Button variant="secondary" size="sm" disabled={salvando} onClick={() => onFechar("nao_compareceu")}>Não compareceu</Button>
        </div>
      )}

      {(remarcadas > 0 || faltas > 0) && (
        <p className="mt-1.5 flex flex-wrap gap-1.5">
          {remarcadas > 0 && (
            <span className="inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              remarcada {remarcadas}x
            </span>
          )}
          {faltas > 0 && (
            <span className="inline-flex items-center rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
              {faltas} não comparecimento{faltas > 1 ? "s" : ""}
            </span>
          )}
        </p>
      )}

      {/* As marcações anteriores, com o porquê de cada uma ter caído. */}
      {doTipo.length > 1 && (
        <ul className="mt-1.5 space-y-0.5 border-l-2 border-slate-100 pl-2 dark:border-slate-800">
          {doTipo.filter((a) => a.status !== "agendado").slice(0, 4).map((a, i) => (
            <li key={i} className="text-[11px] text-slate-400 dark:text-slate-500">
              <span className="tabular-nums">{fmt(a.quando)}</span> · {ROTULO_STATUS[a.status] ?? a.status}
              {a.motivo ? ` — ${a.motivo}` : ""}
            </li>
          ))}
        </ul>
      )}

      {children}
    </Campo>
  );
}

const ROTULO_STATUS: Record<string, string> = {
  reagendado: "remarcada",
  realizado: "realizada",
  nao_compareceu: "não compareceu",
  cancelado: "cancelada",
  agendado: "agendada",
};

// Edição administrativa (só admin): os dados que nenhuma outra tela deixa
// tocar. Identidade vai para a FONTE (public.compradores, via fn definer) e se
// espelha na base THB; financeiro refaz o saldo; datas ajustam histórico
// importado errado. Só os campos ALTERADOS viajam — e a rota grava a mudança
// na timeline ("[admin] Dados editados: …"): maleável, mas nunca sem rastro.
function AdminEdicao({ compradorId, atual, onSalvo }: {
  compradorId: string;
  atual: {
    nome: string; email: string | null; telefone: string | null; turma_origem: string | null;
    valor_total: string | null; valor_pago: string | null;
    pagamento_em: string | null; cancelamento_em: string | null;
  };
  onSalvo: () => Promise<void>;
}) {
  // 0187: a rota /admin é mono-produto no servidor.
  const { produto: produtoBoard } = useProdutoHm();
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [f, setF] = useState({
    nome: atual.nome, email: atual.email ?? "", telefone: atual.telefone ?? "",
    turma_origem: atual.turma_origem ?? "",
    pagamento_em: toLocalInput(atual.pagamento_em),
    cancelamento_em: toLocalInput(atual.cancelamento_em),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function salvar() {
    // Só o que mudou: mandar tudo sobrescreveria dados iguais e sujaria a timeline.
    const body: Record<string, unknown> = {};
    if (f.nome.trim() && f.nome.trim() !== atual.nome) body.nome = f.nome.trim();
    if (f.email.trim() && f.email.trim() !== (atual.email ?? "")) body.email = f.email.trim();
    if (f.telefone.trim() && f.telefone.trim() !== (atual.telefone ?? "")) body.telefone = f.telefone.trim();
    if (f.turma_origem.trim() !== (atual.turma_origem ?? "")) body.turma_origem = f.turma_origem.trim() || null;
    // valor_total/valor_pago não se editam à mão (30/07): vêm da Hotmart.
    if (f.pagamento_em !== toLocalInput(atual.pagamento_em)) body.pagamento_em = f.pagamento_em ? new Date(f.pagamento_em).toISOString() : null;
    if (f.cancelamento_em !== toLocalInput(atual.cancelamento_em)) body.cancelamento_em = f.cancelamento_em ? new Date(f.cancelamento_em).toISOString() : null;
    if (Object.keys(body).length === 0) { setAberto(false); return; }

    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/hm/contato/${compradorId}/admin?produto=${produtoBoard}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) { setErro(d.reason || "não foi possível salvar"); return; }
      await onSalvo();
      setAberto(false);
    } finally {
      setSalvando(false);
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-left text-xs font-medium text-slate-500 transition hover:border-brand hover:text-brand dark:border-slate-700 dark:text-slate-400 dark:hover:border-brand-400 dark:hover:text-brand-300"
      >
        Edição administrativa — nome, contato e datas
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">Edição administrativa</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-xs text-slate-500 dark:text-slate-400">Nome
          <input value={f.nome} onChange={set("nome")} className={fieldClass} />
        </label>
        <label className="col-span-2 text-xs text-slate-500 dark:text-slate-400">E-mail
          <input type="email" value={f.email} onChange={set("email")} className={fieldClass} />
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400">Telefone
          <input value={f.telefone} onChange={set("telefone")} className={fieldClass} />
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400">Turma de origem
          <input value={f.turma_origem} onChange={set("turma_origem")} placeholder="T12" className={fieldClass} />
        </label>
        {/* Valor total/pago não se editam à mão (30/07): vêm da Hotmart. */}
        <label className="text-xs text-slate-500 dark:text-slate-400">Saldo pago em
          <input type="datetime-local" value={f.pagamento_em} onChange={set("pagamento_em")} className={fieldClass} />
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400">Cancelamento em
          <input type="datetime-local" value={f.cancelamento_em} onChange={set("cancelamento_em")} className={fieldClass} />
        </label>
      </div>
      {erro && <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{erro}</p>}
      <div className="mt-2 flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={salvando} onClick={() => setAberto(false)}>Cancelar</Button>
        <Button variant="primary" size="sm" disabled={salvando} onClick={salvar}>Salvar alterações</Button>
      </div>
    </div>
  );
}
