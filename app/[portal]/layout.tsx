import { notFound } from "next/navigation";

// Layout do portal: valida o segmento (/ht/*, /seminario/* ou /curso/*). Qualquer outro
// valor cai em 404. O cabeçalho (TopNav) vive no layout raiz e se adapta ao
// portal pela URL. Cada portal é um espaço isolado — telas e dados próprios.
export default function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { portal: string };
}) {
  if (params.portal !== "ht" && params.portal !== "seminario" && params.portal !== "curso") notFound();
  return <>{children}</>;
}
