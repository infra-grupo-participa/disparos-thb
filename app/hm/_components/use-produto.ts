"use client";

import { usePathname } from "next/navigation";
import type { PortalId } from "@/lib/marcas";

// Produto/board da esteira de ativação (0155). A MESMA tela do HM serve os três
// boards — HM, Aurum e ETHB — separados pela URL: /hm/*, /aurum/*, /ethb/*. Este
// hook lê o segmento e devolve o produto (para o ?produto= das APIs) + o portal
// (para a marca e os links). Default HM (o board histórico).
export type ProdutoHm = "HM" | "AURUM" | "ETHB";

const PORTAL_DO_PRODUTO: Record<ProdutoHm, PortalId> = { HM: "hm", AURUM: "aurum", ETHB: "ethb" };

export function useProdutoHm(): { produto: ProdutoHm; portal: PortalId; base: string } {
  const seg = (usePathname() || "").split("/").filter(Boolean)[0];
  const produto: ProdutoHm = seg === "aurum" ? "AURUM" : seg === "ethb" ? "ETHB" : "HM";
  return { produto, portal: PORTAL_DO_PRODUTO[produto], base: `/${PORTAL_DO_PRODUTO[produto]}` };
}
