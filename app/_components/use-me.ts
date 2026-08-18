"use client";

import { useEffect, useState } from "react";
import {
  podeDisparar as regraPodeDisparar,
  podeAcessarPortal as regraPodeAcessarPortal,
  nivelDe as regraNivelDe,
  ehMaster as regraEhMaster,
  podeVerTudo as regraPodeVerTudo,
  podeGerirAcesso as regraPodeGerirAcesso,
  podeDistribuir as regraPodeDistribuir,
  podeAtribuirPara as regraPodeAtribuirPara,
  escopoAcao as regraEscopoAcao,
  acaoLivrePorEquipeEvento as regraAcaoLivre,
  esteiraCompartilhada as regraEsteiraCompartilhada,
  ehEquipeDeAtivacao as regraEhEquipeDeAtivacao,
  type Papel,
  type TipoEquipe,
  type Nivel,
} from "@/lib/papeis";

export type { Papel, TipoEquipe, Nivel };

// Satisfaz o tipo `Ator` de lib/papeis — as regras recebem o objeto inteiro,
// nunca (papel, tipo) soltos: é o que impede a UI de reimplementar a regra.
export type Me = {
  id: string; nome: string; email: string; papel: Papel;
  equipe_id: string | null; equipe_tipo: TipoEquipe | null; equipe_nome: string | null; equipe_cor: string | null;
  // Líder/ADM da própria equipe (0143): junto com papel=admin fora do GP, define o gestor.
  lider_equipe: boolean;
  // GERENTE (caso da Kelly): distribui para qualquer equipe e LÊ a esteira
  // inteira. Faltava aqui — /api/me já mandava o campo, mas o tipo não o
  // carregava, então `podeVerTudo` dava false na UI e a tela escondia da
  // gerente o que o backend já devolvia.
  gerente_distribuidor: boolean;
  // Portais que a conta pode acessar (0145).
  portais: string[];
  // EQUIPE DE ATIVAÇÃO (0202, Ana Camila e Thomas): move qualquer card da aba
  // Ativação do HM, de qualquer dono. Opcional no tipo porque uma sessão antiga
  // em cache pode não trazer o campo — e `!!undefined` é false, que é o
  // fail-closed certo: na dúvida, sem o bônus.
  equipe_ativacao?: boolean;
  // FUNÇÕES POR PORTAL (0210/0212): "portal:funcao" achatado (ex.: "HM:comercial",
  // "HM:ativacao") — fonte PRINCIPAL do predicado de esteira compartilhada,
  // casada por `temFuncao`/`ehEquipeDeAtivacao` (lib/papeis). Opcional pelo
  // mesmo motivo de `equipe_ativacao`: sessão em cache sem o campo ainda não
  // deve travar a UI, só deixá-la cair na rede de segurança abaixo.
  funcoes?: string[];
};

// Usuário logado para gating de UI. Os três NÍVEIS efetivos (decisão 27/07):
//   master   = admin do Grupo Participa — vê tudo, gere tudo.
//   gestor   = admin OU líder de equipe — vê o pool + a própria equipe, distribui nela.
//   operador = o resto — vê o pool + os cards dele, só assume para si.
// TODA regra vem de lib/papeis (a mesma que as rotas usam): aqui só se passa o
// `me`. Enquanto carrega (ou se falhar), tudo é false e `nivel` é null — a UI
// nasce "fechada" e só revela o que quem tem direito pode ver/fazer. A trava
// real vive no backend.
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => { if (d.ok) setMe(d.usuario); }).catch(() => {});
  }, []);
  // null enquanto carrega — quem gating por nível deve tratar null como "nada".
  const nivel: Nivel | null = me ? regraNivelDe(me) : null;
  const ehMaster = () => !!me && regraEhMaster(me);
  // Visão global de cards = só master (GP admin). Um admin de equipe comum NÃO vê tudo.
  const podeVerTudo = () => !!me && regraPodeVerTudo(me);
  // Gestão de contas/canais/tags/portais/equipes/config = só master.
  const podeGerirAcesso = () => !!me && regraPodeGerirAcesso(me);
  // Distribuir cards a OUTRA pessoa: master (a qualquer um) ou gestor (só na equipe dele).
  const podeDistribuir = () => !!me && regraPodeDistribuir(me);
  // Este destino específico é permitido? (master: sempre; gestor: mesma equipe; operador: só ele.)
  const podeAtribuirPara = (destino: { id: string; equipe_id: string | null } | null) =>
    !!me && regraPodeAtribuirPara(me, destino);
  // `podeDisparar(evento)` espelha a regra do backend: admin/disparador em tudo,
  // operador só em SEM/CNHF.
  const podeDisparar = (evento?: string | null) => regraPodeDisparar(me?.papel, evento);
  // Acesso por portal (0145): um portal só é acessível se estiver na whitelist da conta.
  const podeAcessarPortal = (evento?: string | null) => !!evento && regraPodeAcessarPortal(me?.portais, evento);
  // Card de OUTRO operador? (leitura ≠ ação, 28/07.) A regra é o escopoAcao de
  // lib/papeis — o MESMO que o backend usa: operador age só no pool e nos cards
  // dele; master/gestor agem em tudo que veem. Card assim abre em LEITURA e a
  // API recusa escrita com 403 `card_de_outro_operador`. Sessão carregando ou
  // card sem dono → false (não é "de colega"; o backend segue protegendo).
  // Ação livre no board por equipe×evento (SEM + equipe principal, 30/07): quando
  // vale, nenhum card é "de colega" — a equipe principal arrasta a fila do
  // Seminário inteira. Espelha o backend (podeAgirContato via acaoLivrePorEquipeEvento).
  const acaoLivre = (evento?: string | null) => !!me && regraAcaoLivre(me, evento);
  // Esteira compartilhada (P6, 12/08, pedido do Marcio): equipe principal +
  // evento HM + aba/produto Ativação-HM. Espelha o backend (lib/papeis) para o
  // dia em que a lista de eventos/abas mudar — hoje, no HM, `acaoLivre("HM")`
  // já cobre a equipe principal na aba inteira, então este predicado sozinho
  // não muda o board da Ana; ele existe para não deixar a UI e o backend
  // divergirem quando o critério deixar de ser "evento inteiro".
  // Mesma ordem de parâmetros de lib/papeis: (evento, aba, produto).
  // Rede de segurança (0210/0212, mesmo espírito de `ehEquipeDeAtivacao` acima):
  // sem NENHUMA função em cs.usuario_funcoes, `regraEsteiraCompartilhada` dá
  // sempre false — quem ainda só tem o boolean antigo `equipe_ativacao=true`
  // não pode perder o card na aba Ativação-HM só porque o backfill de funções
  // não rodou/foi conferido. O `||` cobre exatamente essa aba+produto.
  const esteiraCompartilhada = (evento?: string | null, aba?: string | null, produto?: string | null) =>
    !!me && (
      regraEsteiraCompartilhada(me, evento, aba, produto)
      || (!!me.equipe_ativacao && evento === "HM" && aba === "ativacao" && (produto == null || produto === "HM"))
    );
  const ehCardDeColega = (
    card: { responsavel_id?: string | null; estagio_aba?: string | null } | null | undefined,
    evento?: string | null,
    produto?: string | null,
  ) => {
    if (!me || !card?.responsavel_id) return false;
    if (acaoLivre(evento)) return false; // ação livre no evento → arrasta/edita tudo
    // 9 cards da Kelly na Ativação-HM (P6): mesmo sem o evento HM na chamada
    // (telas antigas), a esteira compartilhada já os libera pela aba+produto.
    if (esteiraCompartilhada(evento, card.estagio_aba, produto)) return false;
    return regraEscopoAcao(me).modo === "operador" && card.responsavel_id !== me.id;
  };
  // Marca de pessoa: "esta conta é da equipe de ativação?". A UI usa para
  // sinalizar que a aba Ativação é o território dela — o selo é informativo, a
  // permissão de verdade está no backend.
  // 0210/0212: passa a usar o predicado novo (temFuncao "HM:ativacao"), com o
  // boolean antigo (`equipe_ativacao`) mantido como REDE DE SEGURANÇA — o
  // MESMO `||` que o backend usa em `ehEquipeDeAtivacao` (lib/papeis.ts): cobre
  // a janela entre "o código novo foi para produção" e "o backfill de
  // cs.usuario_funcoes rodou/foi conferido". Sai num deploy futuro, junto com o
  // do backend.
  const ehEquipeDeAtivacao = !!me && (regraEhEquipeDeAtivacao(me) || !!me.equipe_ativacao);
  return { me, nivel, ehMaster, podeVerTudo, podeGerirAcesso, podeDistribuir, podeAtribuirPara, podeDisparar, podeAcessarPortal, ehCardDeColega, acaoLivre, esteiraCompartilhada, ehEquipeDeAtivacao };
}

// ===== Mensagem de falha ao CARREGAR uma tela (rede × servidor) =============
// Um 500 (servidor respondeu, mas quebrou) e uma queda de rede (o fetch nem
// completou) viravam o MESMO "Sem conexão com o servidor" — o time já perdeu
// tempo de diagnóstico atrás disso. Passe `status` quando o fetch RESPONDEU
// com erro HTTP (r.ok === false); deixe em branco quando o fetch lançou
// exceção (catch) — aí é rede de verdade.
export function msgErroCarregamento(status?: number): string {
  if (status != null) {
    return `O servidor respondeu com erro (${status}). Tente de novo em instantes.`;
  }
  return "Sem conexão com o servidor. Verifique sua internet e tente de novo.";
}

// ===== Tradução dos erros de permissão das rotas (403) ======================
// As rotas devolvem { ok:false, reason } — a UI mostra o motivo em pt-BR em vez
// de engolir o erro ou dar um "não foi possível" genérico.
export function msgErroPermissao(reason?: string | null): string | null {
  switch (reason) {
    case "sem_portal":
      return "Sua conta não tem acesso a este portal. Peça a liberação a um administrador do Grupo Participa.";
    case "sem_permissao":
      return "Você não tem permissão para esta ação.";
    case "destino_fora_da_equipe":
      return "Você só pode atribuir para alguém da sua equipe.";
    case "atribuicao_travada":
      // Dois motivos caem no MESMO reason (o backend não distingue, 12/08):
      //   1. o admin/gerente travou a atribuição (0142) — ninguém abaixo remaneja.
      //   2. esteira compartilhada (P6): você MOVE e EDITA o card de outra
      //      equipe (ex.: os 9 da Kelly aparecendo na Ativação-HM para o Grupo
      //      Participa), mas ASSUMIR — reatribuir para si — continua bloqueado
      //      de propósito ("ver/mover ≠ tomar posse", lib/papeis). Texto cobre
      //      os dois sem inventar reason novo — é território do backend.
      return "Não é possível assumir este card para você — ele é de outra equipe (ou a atribuição foi travada pelo administrador). Você pode movê-lo e editá-lo normalmente; só a reatribuição para si é que fica bloqueada. Fale com o administrador do Grupo Participa se precisar mudar o dono.";
    case "cancelamento_so_admin_gp":
      return "Card em Reclamada/Reembolsado — só o administrador do Grupo Participa altera cards cancelados.";
    case "reuniao_finalizada_travada":
      // 12/08: a reunião já aconteceu; data, remarcação e resultado viram
      // registro. O card continua editável no resto — o texto precisa deixar
      // isso claro, senão o operador acha que a ficha inteira congelou.
      return "A reunião já foi finalizada e os dados dela ficam travados — data, remarcação e resultado não mudam mais. O resto da ficha continua editável. Se algo ficou errado no registro da reunião, fale com o administrador do Grupo Participa.";
    case "responsavel_comercial_imutavel":
      // Espelho do errcode `restrict_violation` que a trigger
      // cs.fn_hm_congela_comercial (0212) devolve se algo tentar reescrever
      // responsavel_comercial_id depois de gravado — hoje o front nunca manda
      // esse campo (o comercial é sempre leitura na ficha), então este caso é
      // rede de segurança para quando o backend passar a mapear o errcode para
      // este reason. Não é permissão, é natureza do dado: como
      // `pagamento_so_hotmart` acima, corrigir é migration pontual, não edição
      // pela aplicação — nem o master reescreve pela tela.
      return "O comercial responsável é histórico imutável — quem fechou a venda não se reescreve, nem pelo administrador. Se o dado está errado, é correção de banco (migration pontual), não edição pela ficha.";
    case "pagamento_so_hotmart":
      return "Pagamento não é lançado à mão — a confirmação vem da Hotmart. Envie o link do saldo; ao pagar, o card entra sozinho na Ativação. Se a Hotmart não refletiu, avise o admin para catalogar a oferta.";
    case "saldo_so_hotmart":
      return "O saldo é calculado sobre o que a Hotmart registrou — não se digita à mão.";
    case "valor_so_hotmart":
      return "Valor total/pago vêm da Hotmart e não são editáveis à mão. Corrija identidade e datas normalmente.";
    case "cadastro_manual_so_admin":
      return "Cards nascem da compra na Hotmart. O cadastro manual é restrito ao administrador do Grupo Participa.";
    case "sem_permissao_ativacao":
      // Dois gates devolvem este mesmo reason, e a mensagem precisa servir aos dois:
      //   · "Assumir a ativação" (12/08) — só quem tem a função HM:ativacao;
      //   · escopo de CAMPO (13/08) — quem só tem a função de Comercial não
      //     escreve em campo da ativação (checklist de acesso, entrevista).
      // O texto diz a REGRA, não o caminho: o operador não sabe qual gate barrou,
      // e "você não tem permissão" seco é o que faz ele abrir chamado.
      return "Esta parte do card é da Ativação — só quem tem essa função (ou é gestor/administrador) mexe aqui. O trabalho do Comercial no mesmo card continua liberado para você.";
    case "sem_permissao_comercial":
      // O espelho do de cima (13/08). Existe para quando alguém tiver SÓ a função
      // de Ativação — hoje ninguém tem (Ana Camila e Thomas têm as duas), então a
      // mensagem é preventiva: no dia em que a operação separar de verdade, ela
      // já está aqui, em vez de o operador levar um erro genérico.
      return "Esta parte do card é do Comercial — quem vendeu, a reunião e a etapa comercial. Só quem tem essa função (ou é gestor/administrador) altera. O seu trabalho na Ativação segue liberado.";
    case "fora_da_ativacao":
      return "Este card ainda não chegou na Ativação — só é possível assumir a ativação quando o aluno está nessa aba.";
    case "card_de_outro_operador":
      // Novo modelo (28/07): o operador VÊ os cards da equipe, mas só AGE no que
      // é dele ou está no pool. A ficha do colega abre em leitura.
      return "Este card é de outro operador da sua equipe — você pode ver a ficha e o histórico, mas não alterar. Fale com seu gestor para redistribuir.";
    case "coluna_da_hotmart":
      // COLUNAS IMUTÁVEIS (17/08): fallback genérico sem `coluna`/`direcao` — a
      // tela que TEM esses campos no corpo da resposta monta a frase completa
      // (ver patchMover em kanban/page.tsx e patch em tabela/page.tsx); este
      // texto só cobre o caminho que não tem para onde puxar o nome da etapa.
      return "Esta etapa é automática — vem da Hotmart e não se move à mão. Se algo não andou sozinho, avise o administrador do Grupo Participa.";
    case "unauthorized":
      return "Sua sessão expirou — entre de novo.";
    default:
      return null;
  }
}
