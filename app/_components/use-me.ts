"use client";

import { useEffect, useState } from "react";
import {
  podeDisparar as regraPodeDisparar,
  podeVerTudo as regraPodeVerTudo,
  ehEquipePrincipal,
  type Papel,
  type TipoEquipe,
} from "@/lib/papeis";

export type { Papel, TipoEquipe };
export { ehEquipePrincipal };
export type Me = {
  id: string; nome: string; email: string; papel: Papel;
  equipe_id: string | null; equipe_tipo: TipoEquipe | null; equipe_nome: string | null; equipe_cor: string | null;
};

// Usuário logado para gating de UI. `podeDisparar(evento)` espelha a regra do
// backend (lib/papeis): admin/disparador em tudo, operador só em SEM/CNHF.
// `podeVerTudo` = admin OU equipe principal (GP) — libera a aba de config de
// equipes e a visão global. Enquanto carrega (ou se falhar) é sempre false — a
// UI nasce "fechada" e só revela o que quem tem direito pode ver/fazer. A trava
// real vive no backend.
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => { if (d.ok) setMe(d.usuario); }).catch(() => {});
  }, []);
  const podeDisparar = (evento?: string | null) => regraPodeDisparar(me?.papel, evento);
  const podeVerTudo = () => regraPodeVerTudo(me?.papel, me?.equipe_tipo);
  return { me, podeDisparar, podeVerTudo };
}
