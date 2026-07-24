"use client";

import { useEffect, useState } from "react";
import { podeDisparar as regraPodeDisparar, type Papel } from "@/lib/papeis";

export type { Papel };
export type Me = { id: string; nome: string; email: string; papel: Papel };

// Usuário logado para gating de UI. `podeDisparar(evento)` espelha a regra do
// backend (lib/papeis): admin/disparador em tudo, operador só em SEM/CNHF.
// Enquanto carrega (ou se falhar) é sempre false — a UI nasce "fechada" e só
// revela os botões de disparo a quem tem direito. A trava real vive em /api/send.
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => { if (d.ok) setMe(d.usuario); }).catch(() => {});
  }, []);
  const podeDisparar = (evento?: string | null) => regraPodeDisparar(me?.papel, evento);
  return { me, podeDisparar };
}
