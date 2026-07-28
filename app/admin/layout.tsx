import { redirect } from "next/navigation";
import { getSessao } from "@/lib/auth";
import { podeGerirAcesso } from "@/lib/papeis";

// Central de administração (28/07) — o "um lugar só" que o Marcio pediu para
// gerir contas, equipes, portais e canais, independente do portal em que se
// está. Só o MASTER (admin do Grupo Participa) entra: mesma régua de
// podeGerirAcesso que já protege /usuarios e /canais. Quem não é master volta
// para a seleção de portais. É uma árvore própria (app/admin/*), fora dos
// portais, porque administração não pertence a nenhum evento específico.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const sessao = await getSessao();
  if (!sessao) redirect("/login");
  if (!podeGerirAcesso(sessao)) redirect("/?sem_acesso=admin");
  return <>{children}</>;
}
