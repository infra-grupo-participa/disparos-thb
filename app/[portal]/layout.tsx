import { notFound, redirect } from "next/navigation";
import { getSessao } from "@/lib/auth";
import { podeAcessarPortal } from "@/lib/papeis";

// slug do portal → chave de evento (a whitelist de acesso é por evento).
// `curso` (CNHF) saiu da lista em 10/08/2026: /curso/* passa a cair em 404, que é
// o comportamento certo para um portal que não existe mais. Os dados do CNHF não
// foram tocados — ver o cabeçalho de lib/marcas.ts.
const EVENTO_DO_SLUG: Record<string, string> = { ht: "HT", seminario: "SEM" };

// Layout do portal: valida o segmento (/ht/* ou /seminario/*). Qualquer outro
// valor cai em 404. Além disso, aplica o CONTROLE DE ACESSO POR PORTAL (0145): quem
// não tem o portal na whitelist da conta é mandado de volta à seleção (não entra).
// Cada portal é um espaço isolado — telas e dados próprios.
export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { portal: string };
}) {
  const evento = EVENTO_DO_SLUG[params.portal];
  if (!evento) notFound();

  const sessao = await getSessao();
  if (!sessao) redirect("/login");
  if (!podeAcessarPortal(sessao.portais, evento)) redirect("/?sem_acesso=" + params.portal);

  return <>{children}</>;
}
