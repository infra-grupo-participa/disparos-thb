import { redirect } from "next/navigation";
import { getSessao } from "@/lib/auth";
import { podeAcessarPortal } from "@/lib/papeis";

// Controle de acesso por portal (0145) para o HM. O HM é uma árvore própria
// (app/hm/*) e não passa pelo [portal]/layout, então tem o seu gate aqui: quem
// não tem 'HM' na whitelist da conta é mandado de volta à seleção de portais.
export default async function HmLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao();
  if (!sessao) redirect("/login");
  if (!podeAcessarPortal(sessao.portais, "HM")) redirect("/?sem_acesso=hm");
  return <>{children}</>;
}
