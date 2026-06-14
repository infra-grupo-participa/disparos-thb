"use client";

import { usePathname } from "next/navigation";

// Portal (evento) derivado da URL — /ht/* ou /seminario/*. É a fonte única do
// contexto: cada portal é um espaço próprio (telas e dados isolados), não um
// seletor que troca o conteúdo no mesmo lugar. HT é o default.
export type PortalId = "ht" | "seminario";

type Info = { evento: "HT" | "SEM"; nome: string; cor: string };
export const PORTAIS: Record<PortalId, Info> = {
  ht: { evento: "HT", nome: "Holding Total", cor: "#F97316" },
  seminario: { evento: "SEM", nome: "Seminário", cor: "#2563EB" },
};

export function portalDoPath(pathname: string | null | undefined): PortalId {
  const seg = (pathname || "").split("/").filter(Boolean)[0];
  return seg === "seminario" ? "seminario" : "ht";
}

export function usePortal() {
  const portal = portalDoPath(usePathname());
  const info = PORTAIS[portal];
  return {
    portal,
    base: `/${portal}`,
    evento: info.evento,
    nome: info.nome,
    cor: info.cor,
    ehHT: portal === "ht",
  };
}
