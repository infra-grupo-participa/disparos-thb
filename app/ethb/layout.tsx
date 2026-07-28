import { redirect } from "next/navigation";
import { getSessao } from "@/lib/auth";
import { podeAcessarPortal } from "@/lib/papeis";

// Board do ETHB (0155): a MESMA esteira do HM, recortada por produto='ETHB'.
// Gate por portal (0145), como o HM. Comercial/ativação: Kelly + monitores + Ellen.
export default async function EthbLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao();
  if (!sessao) redirect("/login");
  if (!podeAcessarPortal(sessao.portais, "ETHB")) redirect("/?sem_acesso=ethb");
  return <>{children}</>;
}
