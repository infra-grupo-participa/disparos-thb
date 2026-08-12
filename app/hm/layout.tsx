import { redirect } from "next/navigation";
import { getSessao } from "@/lib/auth";
import { podeAcessarPortal } from "@/lib/papeis";
import { HmNotificacoes } from "@/app/hm/_components/hm-notificacoes";

// Controle de acesso por portal (0145) para o HM. O HM é uma árvore própria
// (app/hm/*) e não passa pelo [portal]/layout, então tem o seu gate aqui: quem
// não tem 'HM' na whitelist da conta é mandado de volta à seleção de portais.
export default async function HmLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao();
  if (!sessao) redirect("/login");
  if (!podeAcessarPortal(sessao.portais, "HM")) redirect("/?sem_acesso=hm");
  return (
    <>
      {/* Sino de notificação de automação (pedido do Marcio, 12/08): fixo no
          canto superior direito, para não sumir quando a página rola. É
          client component próprio — este layout continua server. Também
          montado em /aurum e /ethb (mesmo componente, produto lido da URL). */}
      <HmNotificacoes />
      {children}
    </>
  );
}
