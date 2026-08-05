"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { portalDoPath } from "@/lib/marcas";

// Marca no <html> em qual portal o operador está, para o CSS pintar os detalhes
// com a cor daquele portal (ver [data-portal="aurum"] em globals.css). A MESMA
// tela serve HM, Aurum e ETHB (0155) — sem isto o board do Aurum sai com o
// laranja da casa, que é a cor do Holding Masters.
//
// Fica no root layout de propósito: o TopNav é renderizado lá, fora do
// app/aurum/layout.tsx, então um wrapper dentro do layout do Aurum deixaria o
// cabeçalho laranja e só o miolo dourado.
//
// O primeiro paint já vem certo por causa do script inline no <head> (mesmo
// truque do tema claro/escuro); este efeito existe para a navegação client-side,
// em que o pathname muda sem recarregar a página.
export default function PortalTheme() {
  const pathname = usePathname();
  useEffect(() => {
    document.documentElement.dataset.portal = portalDoPath(pathname);
  }, [pathname]);
  return null;
}
