"use client";

import { usePathname } from "next/navigation";
import { PORTAIS, portalDoPath, type PortalId } from "@/lib/marcas";

// Portal (evento) derivado da URL — /ht/*, /seminario/*, /hm/*, /acelera/*... É a
// fonte única do contexto: cada portal é um espaço próprio (telas e dados
// isolados), não um seletor que troca o conteúdo no mesmo lugar. Qualquer portal
// registrado em lib/marcas vale aqui; HT é o default só para path desconhecido.
// A identidade visual (nome, cor, logo) mora em lib/marcas.
export { PORTAIS, portalDoPath };
export type { PortalId };

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
    ehHM: portal === "hm",
  };
}
