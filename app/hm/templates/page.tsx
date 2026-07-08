// Templates do portal HM. A tela é portal-agnóstica (usa usePortal, que deriva
// o evento do pathname → /hm mapeia para o evento 'HM'), então reaproveitamos a
// mesma página do HT/Seminário. O CRUD via /api/templates já filtra por evento.
export { default } from "@/app/[portal]/templates/page";
