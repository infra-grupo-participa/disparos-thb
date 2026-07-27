import CentralAjuda from "@/app/_components/ajuda";

// Central de Ajuda do portal (HT / Seminário / Curso). Conteúdo estático,
// compartilhado com o HM — a página só ancora a rota dentro do portal para a
// navegação (e a marca do topo) continuarem no contexto de quem pediu ajuda.
export default function AjudaPage() {
  return <CentralAjuda />;
}
