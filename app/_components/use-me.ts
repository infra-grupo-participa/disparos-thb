"use client";

import { useEffect, useState } from "react";

export type Papel = "admin" | "disparador" | "operador";
export type Me = { id: string; nome: string; email: string; papel: Papel };

// Usuário logado para gating de UI. `podeDisparar` espelha a regra do backend
// (lib/auth.ts) — admin ou disparador. Enquanto carrega (ou se falhar), é
// false: a UI nasce "fechada" e só revela os botões de disparo quem tem papel.
// A trava real vive em /api/send; isto é só conveniência visual.
export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => { if (d.ok) setMe(d.usuario); }).catch(() => {});
  }, []);
  const podeDisparar = me?.papel === "admin" || me?.papel === "disparador";
  return { me, podeDisparar };
}
