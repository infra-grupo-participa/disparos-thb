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

// 0234 — o que sobrou dos 27 alertas que não pediam ação: um número.
// Mora aqui (arquivo puro) porque a tela é client component; o service só
// reexporta. Ver lib/services/hm-alertas.ts.
export type ReceitaForaDoSaldo = { compras: number; total: number; desde: string | null };

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

// A família de cada tipo de alerta — usada só para escolher o ícone (13/08,
// pedido do Marcio: "bota ícones para indicar as coisas"). Não é severidade
// (isso já vem do banco em a.severidade) nem texto: é só "que tipo de coisa
// é essa" para quem bate o olho reconhecer antes de ler.
export type CategoriaAlerta = "dinheiro" | "cadastro" | "integracao" | "pessoa";

// O que cada tipo significa e o que fazer.
//
// 13/08 — DIVISÃO DE TRABALHO ENTRE OS DOIS TEXTOS. Na tela, o alerta crítico
// mostra `detalhe` (vem do banco, é específico: nome, valor, data) e logo
// abaixo este `acao`. Até hoje os dois diziam A MESMA COISA — o webhook
// aparecia com "não há pagamento perdido por causa disso" no detalhe e "não há
// pagamento perdido por causa disto" no O QUE FAZER, uma linha depois. Quem lê
// duas vezes a mesma frase para de ler.
//
//   detalhe  = O QUE ACONTECEU  (banco, específico)
//   acao     = O QUE EU FAÇO    (aqui, imperativo, nunca repete o de cima)
//
// E termina dizendo QUEM RESOLVE. Metade destes alertas o operador não tem como
// resolver sozinho (não existe tela para cadastrar oferta nem para recalcular
// canal) — sem essa linha ele fica tentando, ou ignora tudo.
//
// Nada de nome de tabela, de função ou de arquivo aqui: isso vive atrás de
// "detalhes técnicos", que abre fechado. Ver docs/padrao-visual.md.
export const EXPLICACAO: Record<string, { titulo: string; acao: string; categoria: CategoriaAlerta }> = {
  oferta_orfa: {
    titulo: "Oferta que o sistema não conhece",
    acao: "Peça ao time técnico para cadastrar essa oferta e dizer o que ela é: sinal, diferença ou compra cheia. Feito isso o pagamento entra sozinho e o aluno aparece na Jornada — não precisa lançar nada na mão.",
    categoria: "cadastro",
  },
  // 0230: receita que o razão ignora DE PROPÓSITO. Não é defeito — é dinheiro
  // que a operação precisa enxergar e que, até a auditoria de 12/08, não
  // aparecia em lugar nenhum: nem em saldo, nem no board, nem no export.
  // Aviso (não crítico) porque não há nada quebrado para consertar: o alerta
  // existe para o número ser conhecido. Crítico aqui viraria ruído, e alerta que
  // grita sem motivo treina o time a ignorar o painel (lição dos 13 falsos
  // positivos de "Reclamada", 0208).
  // 0232: o log bruto do webhook parou em 17/07 e ninguém notou por 27 dias.
  // Crítico não porque há dinheiro perdido — não há —, mas porque enquanto durar
  // ninguém consegue PROVAR que não há. É o alerta que devolve a capacidade de
  // investigar.
  webhook_sem_log: {
    titulo: "Não dá para auditar pagamento",
    acao: "Nada a fazer na operação: siga trabalhando normalmente. Quem resolve é o time técnico, e o aviso some sozinho quando o registro voltar. Enquanto durar, se um aluno jurar que pagou e não aparecer, confira direto na Hotmart — aqui não tem como conferir.",
    categoria: "integracao",
  },
  // 0234 — `compra_fora_do_razao` SAIU daqui. Eram 27 alertas dizendo a mesma
  // coisa sobre dinheiro que o saldo ignora DE PROPÓSITO (renovação, reserva):
  // nada quebrado, nada para resolver, e mesmo assim 27 linhas vermelhas na
  // tela. Virou um número em "Saúde do dinheiro" — ver cs.fn_hm_receita_fora_do_saldo().
  // Alerta que grita sem ter o que fazer treina o time a ignorar o painel
  // inteiro (mesma lição dos 13 falsos "Reclamada" do 0208).
  cancelamento_ambiguo: {
    titulo: "Cancelou, mas não disse de qual produto",
    acao: "Escolha na mão qual acesso cai. O sistema não escolhe sozinho de propósito: chutar aqui tira o produto errado de quem está pagando em dia.",
    categoria: "pessoa",
  },
  card_faltando: {
    titulo: "Pagou e não apareceu",
    acao: "Confira o cadastro do comprador na Hotmart — normalmente é e-mail diferente do que ele usa aqui. Achando a pessoa, crie a ficha dela na Jornada; se não achar, chame o time técnico.",
    categoria: "dinheiro",
  },
  reembolso_sem_baixa: {
    titulo: "Devolveu o dinheiro só de um lado",
    acao: "Confira na Hotmart se o reembolso saiu mesmo. Se saiu, chame o time técnico para dar baixa — até lá o sistema segue contando esse valor como recebido. Se não saiu, devolva a ficha para a etapa em que ela estava.",
    categoria: "dinheiro",
  },
  sem_canal: {
    titulo: "Aluno sem origem",
    acao: "Não some da Jornada, mas não conta em nenhuma campanha e some da régua de canais lá em cima. São muitos de uma vez — o time técnico recalcula todos juntos, não vale corrigir um a um.",
    categoria: "cadastro",
  },
  monitor_falhou: {
    titulo: "A checagem automática não terminou",
    acao: "Não confie nesta tela enquanto isto estiver aqui — nem no que ela mostra, nem no que ela deixou de mostrar. Quem resolve: time técnico.",
    categoria: "integracao",
  },
  // 0263: webhook do Respondi (formulário de sócios) — titular não encontrado ou
  // ambíguo (2+ cards HM) não escolhe sozinho (mesma lição do cancelamento_ambiguo,
  // 0218): vira pendência + este alerta. Dono é a Equipe de Ativação porque é ela
  // quem já trabalha a ficha do titular (checklist, acessos) — é quem tem contexto
  // para achar a pessoa certa.
  socio_sem_titular: {
    titulo: "Sócio sem titular",
    acao: "Confira o nome e o e-mail do titular que o formulário trouxe. Achando a ficha certa na Jornada, refaça o cadastro do sócio por lá. Quem resolve: Equipe de Ativação.",
    categoria: "pessoa",
  },
  // 0265: venda nova de HM/AURUM deixou de nascer com dono (o carimbo
  // automático da 0161/0212 foi desligado) — o card fica na fila de entrada
  // até a gestão distribuir. Crítico porque enquanto ninguém distribui,
  // ninguém trabalha o lead: dinheiro parado sem ninguém sabendo.
  venda_sem_operador: {
    titulo: "Venda sem operador",
    acao: "Associe esta pessoa a alguém do comercial — da sua equipe ou a você mesma. Quem resolve: quem gerencia a distribuição do HM/Aurum (Kelly).",
    categoria: "pessoa",
  },
  // 0284/D3: inadimplência (60+ dias sem pagar uma mensalidade lançada, ver
  // cs.vw_hm_financeiro.inadimplente) SÓ SINALIZA — decisão do Marcio: nunca
  // move o card sozinho. Crítico porque é dinheiro que já foi combinado e
  // parou de entrar sem ninguém decidir que parou.
  parou_de_pagar: {
    titulo: "Parou de pagar a mensalidade",
    acao: "Entre em contato e confirme o que aconteceu — a ficha NÃO se move sozinha por causa disto. Se combinou uma nova data, registre em \"acordo\"; se a pessoa não vai mais pagar, registre a intenção na ficha.",
    categoria: "dinheiro",
  },
  // 0266: a régua da aba "Transações Inválidas" da planilha VENDAS AURUM —
  // compra cancelada/reembolsada/em disputa não conta como dinheiro recebido.
  // Crítico porque o valor pago aparece maior do que entrou: quem cobra pede
  // menos do que deveria, e o relatório de recebido mente para cima.
  pagamento_de_transacao_invalida: {
    titulo: "Dinheiro que voltou ainda conta como pago",
    acao: "Confira na Hotmart se a compra foi mesmo devolvida e, se foi, estorne o lançamento na ficha da pessoa. Quem resolve: financeiro (Fernanda).",
    categoria: "dinheiro",
  },
};
