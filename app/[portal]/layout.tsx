import { notFound, redirect } from "next/navigation";
import { getSessao } from "@/lib/auth";
import { podeAcessarPortal } from "@/lib/papeis";

// slug do portal → chave de evento (a whitelist de acesso é por evento).
const EVENTO_DO_SLUG: Record<string, string> = { ht: "HT", seminario: "SEM", curso: "CNHF" };

// Layout do portal: valida o segmento (/ht/*, /seminario/* ou /curso/*). Qualquer outro
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
