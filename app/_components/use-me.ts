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
  // Portais que a conta pode acessar (0145).
  portais: string[];
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
  return { me, nivel, ehMaster, podeVerTudo, podeGerirAcesso, podeDistribuir, podeAtribuirPara, podeDisparar, podeAcessarPortal };
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
      return "A atribuição deste card foi travada pelo administrador — só o Grupo Participa pode alterá-la.";
    case "cancelamento_so_admin_gp":
      return "Card em Reclamada/Reembolsado — só o administrador do Grupo Participa altera cards cancelados.";
    case "unauthorized":
      return "Sua sessão expirou — entre de novo.";
    default:
      return null;
  }
}
