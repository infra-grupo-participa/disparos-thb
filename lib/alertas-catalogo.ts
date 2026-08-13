// Tipos e textos dos alertas — SEM dependência de banco, porque a tela
// (/admin/alertas) é client component: importar o service traria `pg` para o
// bundle do navegador e quebraria o build. Mesmo par que lib/busca.ts faz com
// contatos-filtro.ts: a semântica compartilhada mora no arquivo puro.

export type Alerta = {
  id: string;
  tipo: string;
  chave: string | null;
  severidade: string;
  detalhe: string;
  detectado_em: string;
};

export type CancelamentoHotmart = {
  contato_hm_id: string;
  nome: string;
  email: string | null;
  produto: string | null;
  etapa: string | null;
  evento: string | null;
  transacao: string | null;
  motivo: string | null;
  cancelado_em: string;
  origem: string | null;
};

// O que cada tipo significa e o que fazer — a tela não pode exigir que o operador
// conheça o schema para entender o alerta.
export const EXPLICACAO: Record<string, { titulo: string; acao: string }> = {
  oferta_orfa: {
    titulo: "Oferta fora do catálogo",
    acao: "Alguém pagou numa oferta que o sistema não conhece: o card não anda e o pagamento não entra no razão. Cadastrar em public.hm_product_catalog com a categoria certa (sinal, diferenca ou compra_cheia) — ao cadastrar, o pagamento é lançado sozinho.",
  },
  // 0230: receita que o razão ignora DE PROPÓSITO. Não é defeito — é dinheiro
  // que a operação precisa enxergar e que, até a auditoria de 12/08, não
  // aparecia em lugar nenhum: nem em saldo, nem no board, nem no export.
  // Aviso (não crítico) porque não há nada quebrado para consertar: o alerta
  // existe para o número ser conhecido. Crítico aqui viraria ruído, e alerta que
  // grita sem motivo treina o time a ignorar o painel (lição dos 13 falsos
  // positivos de "Reclamada", 0208).
  compra_fora_do_razao: {
    titulo: "Receita que não entra no saldo",
    acao: "Compra aprovada numa categoria que não abate o pacote de 15k (renovação, reserva). Ela não vira card nem pagamento — de propósito, senão marcaria como quitado quem não pagou o pacote. Está aqui só para o dinheiro ser visível: conferir se a receita foi reconhecida fora do sistema e dar baixa. Se a categoria estiver errada no catálogo, corrigir lá é o que faz o pagamento entrar no razão.",
  },
  cancelamento_ambiguo: {
    titulo: "Cancelamento sem board definido",
    acao: "A pessoa cancelou a assinatura na Hotmart, mas tem card em mais de um board e o evento não diz qual. O sistema não escolheu de propósito — decidir na mão qual produto perde o acesso.",
  },
  card_faltando: {
    titulo: "Pagou e não tem card",
    acao: "Existe pagamento sem card na esteira. Conferir o cadastro do comprador e criar o card, senão ninguém vai atrás desse dinheiro.",
  },
  reembolso_sem_baixa: {
    titulo: "Reembolso sem baixa",
    acao: "O card está em Reclamada/Reembolsado mas a compra segue aprovada no banco — o razão ainda conta esse valor como recebido. Conferir na Hotmart.",
  },
  sem_canal: {
    titulo: "Card sem canal de aquisição",
    acao: "O card não tem tag de canal: ele some da régua do board e das contagens por campanha. Rodar cs.fn_sync_hm_atm() ou conferir a oferta de entrada.",
  },
  monitor_falhou: {
    titulo: "O próprio monitor falhou",
    acao: "A rotina de verificação não completou. Enquanto isso, nenhum dos outros alertas é confiável.",
  },
};
