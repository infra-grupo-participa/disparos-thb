// Disparos do portal HM. A tela é portal-agnóstica (usa usePortal → evento 'HM'),
// então reaproveitamos a mesma página do HT/Seminário. As APIs /api/disparos*
// filtram por evento; o histórico/retomar/reenviar já servem HM. As ações de
// disparo só aparecem para quem tem podeDisparar('HM') = admin/disparador.
export { default } from "@/app/[portal]/disparos/page";
