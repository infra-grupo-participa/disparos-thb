import { redirect } from "next/navigation";
import { getSessao } from "@/lib/auth";
import { podeAcessarPortal } from "@/lib/papeis";
import { HmNotificacoes } from "@/app/hm/_components/hm-notificacoes";

// Board do ETHB (0155): a MESMA esteira do HM, recortada por produto='ETHB'.
// Gate por portal (0145), como o HM. Comercial/ativação: Kelly + monitores + Ellen.
export default async function EthbLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao();
  if (!sessao) redirect("/login");
  if (!podeAcessarPortal(sessao.portais, "ETHB")) redirect("/?sem_acesso=ethb");
  return (
    <>
      {/* Sino de notificação de automação (pedido do Marcio, 12/08): antes só
          existia no HM. `HmNotificacoes` já lê o produto do board pela URL
          (useProdutoHm) e propaga ?produto=ETHB sozinho. */}
      <HmNotificacoes />
      {children}
    </>
  );
}
