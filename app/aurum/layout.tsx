import { redirect } from "next/navigation";
import { getSessao } from "@/lib/auth";
import { podeAcessarPortal } from "@/lib/papeis";

// Board do Aurum (0155): a MESMA esteira do HM, recortada por produto='AURUM'.
// Gate por portal (0145), como o HM: quem não tem 'AURUM' na whitelist volta à
// seleção. As páginas reusam os componentes do HM (que leem o produto da URL).
export default async function AurumLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao();
  if (!sessao) redirect("/login");
  if (!podeAcessarPortal(sessao.portais, "AURUM")) redirect("/?sem_acesso=aurum");
  return <>{children}</>;
}
